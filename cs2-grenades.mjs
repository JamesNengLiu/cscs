import {randomUUID} from 'node:crypto';
import {direction} from './public/math.js';
import {RULES as LEGACY_RULES} from './public/config.js';
import {FLASH_TIMING} from './public/grenade-state.js';
import {createSmokeVolume,pruneSmokeFields} from './public/cs2-smoke-field.js';

// Independently implemented from the references and deviations in docs/grenades-fidelity.md.
export const GRENADE_LIMITS = Object.freeze({active:64, smokes:32, ttl:10, smokeSeconds:20,
  smokeRadius:4, substep:1/LEGACY_RULES.tick, maxDelta:.25, maxSpeed:50});
// Subtracting two fractional server clocks can round a generated 20s lifetime
// a few ULPs above 20. This admits only numeric noise; actual expiry stays exact.
const SMOKE_DURATION_EPSILON=1e-6;

export function createGrenadeRuntime(world,{profile=null}={}){
 if(!world?.collision?.trace||!world.movement)throw Error('Experimental grenade world required');
 const METRES_PER_UNIT=profile?.metresPerUnit??1/40;
 const RULES=world.movement.rules,MAP_BOUNDS=world.collision.bounds,{eyeHeight,bodyHeight}=world.movement;
 const trace=(a,b)=>world.collision.trace(a,b,0,{radius:0,channel:'grenade'});
 const projectileTrace=(a,b)=>world.collision.trace(a,b,0,{radius:profile?.radius||0,channel:'grenade'});
const KINDS = new Set(['hegrenade', 'flashbang', 'smokegrenade']);
const FUSE = profile?.fuseSeconds??1.5;
const HE_RADIUS = 350*METRES_PER_UNIT;
const FLASH_RADIUS = 1500*METRES_PER_UNIT;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const finite = (n, fallback=0) => Number.isFinite(n) ? n : fallback;
const position = p => ({x:p.x, y:p.y, z:p.z});
const length = p => Math.hypot(p.vx, p.vy, p.vz);
const validId = id => (typeof id === 'string' && id.length > 0 && id.length <= 128) || Number.isSafeInteger(id);
const validPosition = p => p && ['x','y','z'].every((k,i) => Number.isFinite(p[k]) &&
  p[k] >= MAP_BOUNDS.min[i]-64 && p[k] <= MAP_BOUNDS.max[i]+64);
const validPlayer = p => p?.alive === true && validId(p.id) && validPosition(p);
function capVelocity(p) {
  const speed = length(p);
  if (speed > GRENADE_LIMITS.maxSpeed) {
    const scale = GRENADE_LIMITS.maxSpeed/speed;
    p.vx *= scale; p.vy *= scale; p.vz *= scale;
  }
}

/** Authoritative throw commit; consume inventory only after successful creation. Invalid throws return null. */
function createGrenade(owner, kind, now, secondary=false) {
  if (!validPlayer(owner) || !['T','CT'].includes(owner.team) || !KINDS.has(kind) ||
      !Number.isFinite(now) || now < 0 || now > Number.MAX_SAFE_INTEGER-FUSE) return null;
  const yaw = (finite(owner.yaw) % (Math.PI*2)+finite(owner.recoilYaw) % (Math.PI*2)) % (Math.PI*2);
  // Browser pitch is positive up; GoldSrc pitch is positive down.
  const pitch = -clamp(finite(owner.pitch)+finite(owner.recoilPitch), -Math.PI/2, Math.PI/2)*180/Math.PI;
  const throwPitch = -10 + pitch*(pitch < 0 ? 80/90 : 100/90);
  const forward = direction(yaw, -throwPitch*Math.PI/180);
  const speed = profile?profile.weapons[kind].throwVelocity*profile.throwVelocityScale*METRES_PER_UNIT:Math.min(750,(90-throwPitch)*6)*METRES_PER_UNIT;
  const eye = {x:owner.x, y:owner.y+eyeHeight(owner), z:owner.z};
  const clearanceDistance=profile?.throwClearance??16*METRES_PER_UNIT;
  const clearance=projectileTrace(eye,{x:eye.x+forward.x*clearanceDistance,y:eye.y+forward.y*clearanceDistance,z:eye.z+forward.z*clearanceDistance});
  if (clearance.startSolid) return null;
  // CS secondary is shield operation, not an underhand throw. Keep the API flag without inventing one.
  void secondary;
  const backoff=profile?.throwBackoff||0,inherit=profile?.inheritedVelocityScale??1,origin=profile?{x:clearance.end.x-forward.x*backoff,y:clearance.end.y-forward.y*backoff,z:clearance.end.z-forward.z*backoff}:clearance.end;
  if(projectileTrace(origin,origin).startSolid)return null;
  const p = {id:`grenade-${randomUUID()}`, ownerId:owner.id, team:owner.team, kind,
    ...origin, vx:forward.x*speed+clamp(finite(owner.vx),-50,50)*inherit,
    vy:forward.y*speed+clamp(finite(owner.vy),-50,50)*inherit,
    vz:forward.z*speed+clamp(finite(owner.vz),-50,50)*inherit,
    bornAt:now, detonateAt:now+FUSE, simulatedAt:now, grounded:false, resting:false, bounces:0, nextThinkAt:now+.1, detonationQueued:false};
  capVelocity(p);
  return p;
}

// Slab sweep against authoritative player hulls; no endpoint-only body overlap checks.
function sweepBody(start, end, player) {
  const min = [player.x-RULES.radius, player.y, player.z-RULES.radius];
  const max = [player.x+RULES.radius, player.y+bodyHeight(player), player.z+RULES.radius];
  let enter = 0, leave = 1, normal = [0,0,0], inside = true;
  for (const [i,k] of ['x','y','z'].entries()) {
    const delta = end[k]-start[k];
    if (start[k] <= min[i] || start[k] >= max[i]) inside = false;
    if (Math.abs(delta) < 1e-12) {
      if (start[k] <= min[i] || start[k] >= max[i]) return null;
      continue;
    }
    let near = (min[i]-start[k])/delta, far = (max[i]-start[k])/delta;
    const sign = delta > 0 ? -1 : 1;
    if (near > far) [near,far] = [far,near];
    if (near >= enter) { enter = near; normal = [0,0,0]; normal[i] = sign; }
    leave = Math.min(leave,far);
    if (enter > leave) return null;
  }
  if (leave < 0 || enter > 1 || (!inside && leave === 0)) return null;
  return {fraction:enter, normal, startSolid:inside, body:true};
}

function sweep(start, end, players, ownerId) {
  let hit = projectileTrace(start,end);
  for (const player of players) {
    if (!validPlayer(player) || player.id === ownerId) continue;
    const body = sweepBody(start,end,player);
    if (body && body.fraction < hit.fraction) hit = body;
  }
  return hit;
}

// MOVETYPE_BOUNCE uses (2 - entity friction) as the clip overbounce.
// Friction .8 therefore retains .2 of normal speed, not .8 of tangent speed.
function clipBounceVelocity(velocity,normal,friction) {
  const into=velocity.reduce((sum,v,i)=>sum+v*normal[i],0);
  return velocity.map((v,i)=>{const out=v-normal[i]*into*(2-friction);return Math.abs(out)<.1*METRES_PER_UNIT?0:out;});
}
function pushEntity(p,seconds,players,onBounce) {
  const start=position(p),end={x:p.x+p.vx*seconds,y:p.y+p.vy*seconds,z:p.z+p.vz*seconds};
  const hit=sweep(start,end,players,p.ownerId);
  if(hit.startSolid)return hit;
  for(const k of ['x','y','z'])p[k]=start[k]+(end[k]-start[k])*hit.fraction;
  if(hit.fraction<1){
    p.bounces++;
    const entity=null; // Dynamic breakable simulation is not inferred from static PHYS.
    if(entity?.classname==='func_breakable'&&Number(entity.rendermode||0)!==0){
      p.vx*=-2;p.vy*=-2;p.vz*=-2;
    }else if(p.grounded&&!profile){p.vx*=.8;p.vy*=.8;p.vz*=.8;}
    else{
      if(length(p)>1)onBounce(p);
      if((p.airBounces||0)>=10){p.grounded=true;p.vx=p.vy=p.vz=0;}
      p.airBounces=(p.airBounces||0)+1;
    }
  }
  return hit;
}
function integrate(p,dt,players,onBounce=()=>{}) {
  if(p.vy>0||p.groundBody)p.grounded=false;
  if(p.resting){
    const floor=projectileTrace(p,{x:p.x,y:p.y-.015,z:p.z});
    if(!floor.startSolid&&floor.fraction<1&&floor.normal[1]>.7)return true;
    p.resting=false;p.grounded=false;
  }
  p.vy-=(profile?RULES.gravity*profile.gravityScale:(800*METRES_PER_UNIT)*(p.kind==='hegrenade'?.55:.5))*dt;
  capVelocity(p);
  const hit=pushEntity(p,dt,players,onBounce);
  // The local tracer has startSolid but no allSolid. Embedded projectiles are
  // removed safely rather than pushed through geometry to find an exit.
  if(hit.startSolid)return false;
  if(hit.fraction===1)return validPosition(p);
  if(profile){const velocity=[p.vx,p.vy,p.vz],dot=velocity.reduce((sum,v,i)=>sum+v*hit.normal[i],0);[p.vx,p.vy,p.vz]=velocity.map((v,i)=>(v-2*hit.normal[i]*dot)*profile.elasticity);}else [p.vx,p.vy,p.vz]=clipBounceVelocity([p.vx,p.vy,p.vz],hit.normal,p.kind==='hegrenade'?.7:.8);
  if(hit.normal[1]>.7){
    const speedSquared=p.vx*p.vx+p.vy*p.vy+p.vz*p.vz;
    if(p.vy<(profile?RULES.gravity*profile.gravityScale:800*METRES_PER_UNIT)*dt){p.grounded=true;p.vy=0;p.groundBody=Boolean(hit.body);}
    if(speedSquared<(profile?.restSpeed??30*METRES_PER_UNIT)**2){
      p.grounded=true;p.groundBody=Boolean(hit.body);p.vx=p.vy=p.vz=0;p.resting=!hit.body;
    }else{
      // The engine makes one extra ground push, with touch friction but without
      // recursively clipping the velocity again during this simulation tick.
      const extra=pushEntity(p,(1-hit.fraction)*dt*.9,players,onBounce);
      if(extra.startSolid)return false;
    }
  }
  return validPosition(p);
}
function smokeThink(p,time) {
  if(time+1e-9<p.nextThinkAt)return false;
  if(p.detonationQueued)return true;
  if(p.grounded){p.vx*=.95;p.vy*=.95;p.vz*=.95;}
  p.nextThinkAt=time+.1;
  if(time+1e-9>=p.detonateAt&&p.grounded)p.detonationQueued=true;
  return false;
}

function visible(start, end) {
  const hit = trace(start,end);
  return !hit.startSolid && hit.fraction === 1;
}

function explode(game, p, players) {
  game.emit({type:'explosion', id:p.id, ownerId:p.ownerId, kind:p.kind, x:p.x,y:p.y,z:p.z});
  if (p.kind === 'smokegrenade') {
    if(game.smokes.length<GRENADE_LIMITS.smokes){const data={id:p.id,x:p.x,y:p.y,z:p.z,bornAt:game.time,endAt:game.time+(profile?.smokeSeconds??GRENADE_LIMITS.smokeSeconds),radius:profile?.smokeRadius??GRENADE_LIMITS.smokeRadius,height:profile?.smokeHeight};game.smokes.push(profile?createSmokeVolume(data):data);}
    return;
  }
  // Sweep even the one-GoldSrc-unit lift, so a ceiling cannot move the blast through a brush.
  const lifted = trace(p,{x:p.x,y:p.y+1*METRES_PER_UNIT,z:p.z});
  if (lifted.startSolid) return;
  const source = lifted.end;
  const killer = game.players.get(p.ownerId) ?? null;
  for (const player of players) {
    if (!validPlayer(player)) continue;
    if (p.kind === 'hegrenade') {
      if (player.id !== p.ownerId && player.team === p.team && game.friendlyFire !== true) continue;
      const center = {x:player.x,y:player.y+bodyHeight(player)/2,z:player.z};
      const distance = Math.hypot(center.x-source.x,center.y-source.y,center.z-source.z);
      const amount = (profile?.weapons.hegrenade.damage??100)*(1-distance/HE_RADIUS);
      if (amount >= 1 && visible(source,center)) game.damage(player,amount,killer,
        {kind:'hegrenade',hitgroup:'chest',blast:true,armourRatio:1});
      continue;
    }
    const eye = {x:player.x,y:player.y+eyeHeight(player),z:player.z};
    const dx=source.x-eye.x, dy=source.y-eye.y, dz=source.z-eye.z;
    const distance = Math.hypot(dx,dy,dz);
    if (distance >= FLASH_RADIUS || !visible(source,eye) || !visible(eye,source)) continue;
    // Other players can shield a flash in the source trace, using current authoritative hulls.
    if (players.some(other => other !== player && validPlayer(other) && sweepBody(source,eye,other))) continue;
    const facing = direction(finite(player.yaw),clamp(finite(player.pitch),-Math.PI/2,Math.PI/2));
    const front = dx*facing.x+dy*facing.y+dz*facing.z >= 0;
    const strength = 1-distance/FLASH_RADIUS;
    const fade = strength*(front ? FLASH_TIMING.frontFade : FLASH_TIMING.backFade);
    const hold = strength*(front ? FLASH_TIMING.frontHold : FLASH_TIMING.backHold);
    const previous = finite(player.flashUntil) > game.time;
    const amount = Math.max(front ? 1 : 200/255, previous ? clamp(finite(player.flashAmount),0,1) : 0);
    const duration = Math.max(hold+fade, previous ? player.flashUntil-game.time : 0);
    const previousHold = previous ? Math.max(0,player.flashUntil-finite(player.flashFade)-game.time) : 0;
    const mergedHold = Math.min(duration,Math.max(hold,previousHold));
    player.flashAmount = amount;
    player.flashUntil = game.time+duration;
    player.flashFade = duration-mergedHold;
    // emit() is a queue API: transport MUST route this private event only to its target id.
    game.emit({type:'flash',private:true,id:player.id,amount,duration,fade:player.flashFade});
  }
}

function validProjectile(p, now) {
  return p && validId(p.id) && validId(p.ownerId) && ['T','CT'].includes(p.team) && KINDS.has(p.kind) &&
    validPosition(p) && ['vx','vy','vz','bornAt','detonateAt'].every(k => Number.isFinite(p[k])) &&
    p.bornAt >= 0 && p.bornAt <= now && p.detonateAt >= p.bornAt && now-p.bornAt < GRENADE_LIMITS.ttl;
}

/** Game advances time first. dt is elapsed seconds, not milliseconds. No client hit data is accepted. */
function stepGrenades(game, dt) {
  if (!Number.isFinite(game?.time) || game.time < 0 || !Number.isFinite(dt) || dt < 0) return;
  const now = game.time, elapsed = Math.min(dt,GRENADE_LIMITS.maxDelta);
  if(profile)pruneSmokeFields(game.smokes,now);
  const players = [...game.players.values()].filter(validPlayer);
  for (const p of players) if (!Number.isFinite(p.flashUntil) || p.flashUntil <= now) {
    p.flashUntil=0; p.flashAmount=0;p.flashFade=0;
  }
  // Slice before processing to bound work even if an integrating caller overfills a queue.
  game.smokes = (Array.isArray(game.smokes) ? game.smokes : []).slice(0,GRENADE_LIMITS.smokes)
    .filter(s => validId(s?.id) && validPosition(s) && Number.isFinite(s.bornAt) && s.bornAt <= now &&
      Number.isFinite(s.endAt) && s.endAt > now && s.endAt-s.bornAt <= GRENADE_LIMITS.smokeSeconds+SMOKE_DURATION_EPSILON &&
      Number.isFinite(s.radius) && s.radius > 0 && s.radius <= GRENADE_LIMITS.smokeRadius);
  const active = (Array.isArray(game.projectiles) ? game.projectiles : []).slice(0,GRENADE_LIMITS.active);
  game.projectiles = [];
  const ids = new Set();
  for (const p of active) {
    if (!validProjectile(p,now) || ids.has(p.id) || trace(p,p).startSolid) continue;
    ids.add(p.id);
    capVelocity(p);
    p.bounces = Number.isSafeInteger(p.bounces) && p.bounces >= 0 ? p.bounces : 0;
    let time=Math.max(p.bornAt,finite(p.simulatedAt,p.bornAt));
    // Keep a fractional fixed-step remainder; discard only elapsed stall debt.
    if(now-time>elapsed+GRENADE_LIMITS.substep+1e-9)time=now-elapsed;
    const end=p.kind==='smokegrenade'?now:Math.min(now,p.detonateAt);
    if(!Number.isFinite(p.nextThinkAt))p.nextThinkAt=p.bornAt+.1;
    let valid=true,detonated=false;
    while(time+GRENADE_LIMITS.substep<=end+1e-9){
      const next=time+GRENADE_LIMITS.substep;
      if(p.kind==='smokegrenade'&&smokeThink(p,next)){detonated=true;break;}
      if(!integrate(p,GRENADE_LIMITS.substep,players,projectile=>{
        if(game.time-(projectile.lastBounceSound??-100)>.12){projectile.lastBounceSound=game.time;game.emit({type:'bounce',id:projectile.id,kind:projectile.kind,from:position(projectile)});}
      })){valid=false;break;}
      time=next;
    }
    if(!valid)continue;
    p.simulatedAt=time;
    if(detonated||(p.kind!=='smokegrenade'&&now+1e-9>=p.detonateAt))explode(game,p,players);
    else game.projectiles.push(p);
  }
}

 return{createGrenade,stepGrenades,clipBounceVelocity,limits:GRENADE_LIMITS};
}
