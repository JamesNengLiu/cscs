import {randomUUID} from 'node:crypto';
import {trace, direction, eyeHeight, bodyHeight, RULES, MAP_BOUNDS} from './public/shared.js';

// Independently implemented from the references and deviations in docs/grenades-fidelity.md.
export const GRENADE_LIMITS = Object.freeze({active:64, smokes:32, ttl:10, smokeSeconds:20,
  smokeRadius:4, substep:1/120, maxDelta:.25, maxSpeed:50});
const KINDS = new Set(['hegrenade', 'flashbang', 'smokegrenade']);
const EPS = .002;
const FUSE = 1.5;
const HE_RADIUS = 350/40;
const FLASH_RADIUS = 1500/40;
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

/** Called only after the server accepts a throw and consumes inventory. Invalid throws return null. */
export function createGrenade(owner, kind, now, secondary=false) {
  if (!validPlayer(owner) || !['T','CT'].includes(owner.team) || !KINDS.has(kind) ||
      !Number.isFinite(now) || now < 0 || now > Number.MAX_SAFE_INTEGER-FUSE) return null;
  const yaw = (finite(owner.yaw) % (Math.PI*2)+finite(owner.recoilYaw) % (Math.PI*2)) % (Math.PI*2);
  // Browser pitch is positive up; GoldSrc pitch is positive down.
  const pitch = -clamp(finite(owner.pitch)+finite(owner.recoilPitch), -Math.PI/2, Math.PI/2)*180/Math.PI;
  const throwPitch = -10 + pitch*(pitch < 0 ? 80/90 : 100/90);
  const forward = direction(yaw, -throwPitch*Math.PI/180);
  const speed = Math.min(750, (90-throwPitch)*6)/40;
  const eye = {x:owner.x, y:owner.y+eyeHeight(owner), z:owner.z};
  const clearance = trace(eye, {x:eye.x+forward.x*16/40,
    y:eye.y+forward.y*16/40, z:eye.z+forward.z*16/40});
  if (clearance.startSolid) return null;
  // CS secondary is shield operation, not an underhand throw. Keep the API flag without inventing one.
  void secondary;
  const p = {id:`grenade-${randomUUID()}`, ownerId:owner.id, team:owner.team, kind,
    ...clearance.end, vx:forward.x*speed+clamp(finite(owner.vx),-50,50),
    vy:forward.y*speed+clamp(finite(owner.vy),-50,50),
    vz:forward.z*speed+clamp(finite(owner.vz),-50,50),
    bornAt:now, detonateAt:now+FUSE, simulatedAt:now, grounded:false, resting:false, bounces:0};
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
  let hit = trace(start,end);
  for (const player of players) {
    if (!validPlayer(player) || player.id === ownerId) continue;
    const body = sweepBody(start,end,player);
    if (body && body.fraction < hit.fraction) hit = body;
  }
  return hit;
}

function integrate(p, dt, players) {
  if (p.resting) {
    const floor = trace(p,{x:p.x,y:p.y-.015,z:p.z});
    if (!floor.startSolid && floor.fraction < 1 && floor.normal[1] > .7) return true;
    p.resting = false;
  }
  p.grounded = false;
  // Conventional sv_gravity=800, with the grenade-specific source multiplier.
  p.vy -= (800/40)*(p.kind === 'hegrenade' ? .55 : .5)*dt;
  capVelocity(p);
  let remaining = dt;
  for (let bump=0; bump<4 && remaining > 1e-8; bump++) {
    const start = position(p), end = {x:p.x+p.vx*remaining,y:p.y+p.vy*remaining,z:p.z+p.vz*remaining};
    const hit = sweep(start,end,players,p.ownerId);
    // Never teleport a projectile out of solid geometry or a newly overlapping body.
    if (hit.startSolid) return false;
    for (const k of ['x','y','z']) p[k] = start[k]+(end[k]-start[k])*hit.fraction;
    if (hit.fraction === 1) break;
    const n = hit.normal, into = p.vx*n[0]+p.vy*n[1]+p.vz*n[2];
    if (into >= 0) { p.vx=0; p.vy=0; p.vz=0; break; }
    const friction = p.kind === 'hegrenade' ? .7 : .8;
    const v = [p.vx,p.vy,p.vz].map((value,i) => (value-into*n[i])*friction-into*n[i]*.45);
    p.vx=v[0]; p.vy=v[1]; p.vz=v[2]; p.bounces++;
    p.x += n[0]*EPS; p.y += n[1]*EPS; p.z += n[2]*EPS;
    if (!hit.body && n[1] > .7 && -into*.45 < .5) {
      p.grounded = true;
      const out = p.vx*n[0]+p.vy*n[1]+p.vz*n[2];
      p.vx=(p.vx-out*n[0])*.8; p.vy=(p.vy-out*n[1])*.8; p.vz=(p.vz-out*n[2])*.8;
      if (length(p) < .25) { p.vx=0; p.vy=0; p.vz=0; p.resting=true; break; }
    }
    remaining *= 1-hit.fraction;
  }
  return validPosition(p);
}

function visible(start, end) {
  const hit = trace(start,end);
  return !hit.startSolid && hit.fraction === 1;
}

function explode(game, p, players) {
  game.emit({type:'explosion', id:p.id, ownerId:p.ownerId, kind:p.kind, x:p.x,y:p.y,z:p.z});
  if (p.kind === 'smokegrenade') {
    if (game.smokes.length < GRENADE_LIMITS.smokes) game.smokes.push({id:p.id,x:p.x,y:p.y,z:p.z,
      bornAt:game.time,endAt:game.time+GRENADE_LIMITS.smokeSeconds,radius:GRENADE_LIMITS.smokeRadius});
    return;
  }
  // Sweep even the one-GoldSrc-unit lift, so a ceiling cannot move the blast through a brush.
  const lifted = trace(p,{x:p.x,y:p.y+1/40,z:p.z});
  if (lifted.startSolid) return;
  const source = lifted.end;
  const killer = game.players.get(p.ownerId) ?? null;
  for (const player of players) {
    if (!validPlayer(player)) continue;
    if (p.kind === 'hegrenade') {
      if (player.id !== p.ownerId && player.team === p.team && game.friendlyFire !== true) continue;
      const center = {x:player.x,y:player.y+bodyHeight(player)/2,z:player.z};
      const distance = Math.hypot(center.x-source.x,center.y-source.y,center.z-source.z);
      const amount = 100*(1-distance/HE_RADIUS);
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
    const strength = 4*(1-distance/FLASH_RADIUS);
    const fade = strength*(front ? 3 : 1.75), hold = strength/(front ? 1.5 : 3.5);
    const previous = finite(player.flashUntil) > game.time;
    const amount = Math.max(front ? 1 : 200/255, previous ? clamp(finite(player.flashAmount),0,1) : 0);
    const duration = Math.max(hold+fade, previous ? player.flashUntil-game.time : 0);
    player.flashAmount = amount;
    player.flashUntil = game.time+duration;
    // emit() is a queue API: transport MUST route this private event only to its target id.
    game.emit({type:'flash',private:true,id:player.id,amount,duration,fade:Math.min(fade,duration)});
  }
}

function validProjectile(p, now) {
  return p && validId(p.id) && validId(p.ownerId) && ['T','CT'].includes(p.team) && KINDS.has(p.kind) &&
    validPosition(p) && ['vx','vy','vz','bornAt','detonateAt'].every(k => Number.isFinite(p[k])) &&
    p.bornAt >= 0 && p.bornAt <= now && p.detonateAt >= p.bornAt && now-p.bornAt < GRENADE_LIMITS.ttl;
}

/** Game advances time first. dt is elapsed seconds, not milliseconds. No client hit data is accepted. */
export function stepGrenades(game, dt) {
  if (!Number.isFinite(game?.time) || game.time < 0 || !Number.isFinite(dt) || dt < 0) return;
  const now = game.time, elapsed = Math.min(dt,GRENADE_LIMITS.maxDelta);
  const players = [...game.players.values()].filter(validPlayer);
  for (const p of players) if (!Number.isFinite(p.flashUntil) || p.flashUntil <= now) {
    p.flashUntil=0; p.flashAmount=0;
  }
  // Slice before processing to bound work even if an integrating caller overfills a queue.
  game.smokes = (Array.isArray(game.smokes) ? game.smokes : []).slice(0,GRENADE_LIMITS.smokes)
    .filter(s => validId(s?.id) && validPosition(s) && Number.isFinite(s.bornAt) && s.bornAt <= now &&
      Number.isFinite(s.endAt) && s.endAt > now && s.endAt-s.bornAt <= GRENADE_LIMITS.smokeSeconds &&
      Number.isFinite(s.radius) && s.radius > 0 && s.radius <= GRENADE_LIMITS.smokeRadius);
  const active = (Array.isArray(game.projectiles) ? game.projectiles : []).slice(0,GRENADE_LIMITS.active);
  game.projectiles = [];
  const ids = new Set();
  for (const p of active) {
    if (!validProjectile(p,now) || ids.has(p.id) || trace(p,p).startSolid) continue;
    ids.add(p.id);
    capVelocity(p);
    p.bounces = Number.isSafeInteger(p.bounces) && p.bounces >= 0 ? p.bounces : 0;
    let time = Math.max(p.bornAt,finite(p.simulatedAt,p.bornAt),now-elapsed);
    const end = p.kind === 'smokegrenade' ? now : Math.min(now,p.detonateAt);
    let valid = true;
    while (time < end-1e-9) {
      const step = Math.min(GRENADE_LIMITS.substep,end-time);
      if (!integrate(p,step,players)) { valid=false; break; }
      time += step;
    }
    if (!valid) continue;
    p.simulatedAt = now;
    if (now+1e-9 >= p.detonateAt && (p.kind !== 'smokegrenade' || p.grounded)) explode(game,p,players);
    else game.projectiles.push(p);
  }
}
