// Experimental combat binds world queries explicitly; v1.0 modules are unchanged.
import {RULES as DEFAULT_RULES,WEAPONS as DEFAULT_WEAPONS,RIFLE_PATTERN} from './config.js';
import {GUNS as DEFAULT_GUNS} from './arsenal.js';
import {clamp,direction} from './math.js';
import {baseAccuracy,advanceAccuracy,accuracySpread,applyKick,decayPunch,usesMainAutoRules,shotInterval,nextShotDeadline,sampleViewRecoil as legacySampleViewRecoil} from './weapon-feel.js';
import {PITCH_LIMIT} from './view-settings.js';
import {sourcePlayerSpread} from './source-spread.js';
import {recoilRandom} from './shot-random.js';
export function createWeaponRuntime(context,{rules=DEFAULT_RULES,weapons=DEFAULT_WEAPONS,guns=DEFAULT_GUNS,behavior}={}){
 const world=context.collision||context;if(typeof world.isGrounded!=='function')throw Error('Experimental combat requires a collision world');
 const RULES=rules,WEAPONS=weapons,GUNS=guns,isGrounded=world.isGrounded.bind(world);
const grounded=p=>Boolean(p.groundPlayer&&p.grounded)||isGrounded(p);
if(behavior)for(const key of ['reset','update','weaponSpread','spreadDirection','shotProfile','shotInterval','deploySeconds'])if(typeof behavior[key]!=='function')throw Error('Incomplete weapon behavior: '+key);
function resetWeapon(p,{keepPunch=false}={}){if(behavior)return behavior.reset(p,{keepPunch},grounded(p));p.burstCount=0;p.accuracy=baseAccuracy(p.weapon);p.recoveryAt=0;p.recoilDirection=0;
  if(usesMainAutoRules(p))p.delayFire=false;
  if(!keepPunch){p.recoilYaw=0;p.recoilPitch=0;}p.spread=weaponSpread(p);}
function updateWeapon(p,dt,now,preserveHeldTrigger=false){
  if(behavior)return behavior.update(p,dt,now,grounded(p),preserveHeldTrigger);
  decayPunch(p,Math.max(0,dt));
  if(GUNS[p.weapon]?.category==='pistol'&&!p.input?.fire)p.burstCount=0;
  if(usesMainAutoRules(p)){
    if(!p.input?.fire&&!(preserveHeldTrigger&&p.fireHeld)){
      // Source weapon timers are floats and use a strict deadline comparison.
      const clock=Math.fround(now);
      if(p.delayFire){p.delayFire=false;p.burstCount=Math.min(15,p.burstCount||0);p.recoveryAt=Math.fround(clock+Math.fround(.4));}
      if(p.burstCount>0&&clock>p.recoveryAt){p.burstCount--;p.recoveryAt=Math.fround(clock+Math.fround(.0225));
        if(!p.burstCount)p.accuracy=baseAccuracy(p.weapon);}
    }
  }else if(!p.input?.fire&&p.burstCount>0&&now-p.lastShot>.4){
    const at=p.recoveryAt||p.lastShot+.4;
    if(now>=at){const count=1+Math.floor((now-at)/.0225);p.burstCount=Math.max(0,p.burstCount-count);p.recoveryAt=at+count*.0225;
      if(!p.burstCount)p.accuracy=baseAccuracy(p.weapon);}
  }
  p.spread=weaponSpread(p);
}
function weaponSpread(p){if(behavior)return behavior.weaponSpread(p,grounded(p));const w=WEAPONS[p.weapon],speed=Math.hypot(p.vx||0,p.vz||0)/RULES.speed;
  const spread=accuracySpread(p,grounded(p));if(spread!==null)return spread;
  return (w.spread+w.moveSpread*speed*speed+(isGrounded(p)?0:w.airSpread)+w.heatSpread*Math.min(p.burstCount||0,12)+(GUNS[p.weapon]?.category==='sniper'&&(!p.zoom||p.zoom===90)?.08:0))*(p.crouch?.7:1);
}
function spreadDirection(profile,random=Math.random,sampling='legacy'){
  if(behavior)return behavior.spreadDirection(profile,random,sampling);
  // Single bullets retain four draws so the fallback recoil stream does not shift.
  const a=random(),b=random(),c=random(),e=random();let sx=a+b-1,sy=c+e-1;
  if(sampling==='player'){const offset=sourcePlayerSpread(Math.floor(a*0x100000000)>>>0);sx=offset.x;sy=offset.y;}
  else if(sampling==='buckshot'){
    // FireBuckshots rejects the triangular distribution's corners, per pellet.
    // A broken/injected RNG must not stall the simulation indefinitely.
    for(let attempts=1;sx*sx+sy*sy>1;attempts++){
      if(attempts>=32){sx=sy=0;break;}
      sx=random()+random()-1;sy=random()+random()-1;
    }
  }
  const {yaw,pitch,spread}=profile,x=sx*spread,y=sy*spread,d=direction(yaw,pitch);
  d.x+=x*Math.cos(yaw)+y*Math.sin(yaw)*Math.sin(pitch);d.y+=y*Math.cos(pitch);d.z-=x*Math.sin(yaw)-y*Math.cos(yaw)*Math.sin(pitch);
  const len=Math.hypot(d.x,d.y,d.z);return {x:d.x/len,y:d.y/len,z:d.z/len};
}
function shotProfile(p,random=Math.random,now=p.lastShot,follow=false,kickRandom=random){
  if(behavior)return behavior.shotProfile(p,random,now,follow,grounded(p),kickRandom);
  // GoldSrc PMove includes punch in v_angle; every gun adds it again. Keep
  // this in the pre-shot ray basis only, without scaling player/view recoil.
  const gun=GUNS[p.weapon],scale=gun?2:1,spread=follow&&p.weapon==='glock18'?.05:follow&&Number.isFinite(p.burstSpread)?p.burstSpread:weaponSpread(p);
  const yaw=p.yaw+scale*(p.recoilYaw||0),aimPitch=p.pitch+scale*(p.recoilPitch||0),pitch=gun?aimPitch:clamp(aimPitch,-PITCH_LIMIT,PITCH_LIMIT);
  const profile={spread,yaw,pitch},d=spreadDirection(profile,random,gun?(gun.pellets>1?'buckshot':'player'):'legacy');
  advanceAccuracy(p,now,follow);
  if(!follow){
  p.burstCount=(p.burstCount||0)+1;
  if(GUNS[p.weapon])applyKick(p,grounded(p),kickRandom);
  else{const next=p.weapon==='rifle'?RIFLE_PATTERN[Math.min(p.burstCount,RIFLE_PATTERN.length-1)]:[0,Math.min(.035,p.burstCount*.007)];p.recoilYaw=next[0];p.recoilPitch=next[1];}
  if(usesMainAutoRules(p))p.delayFire=true;else p.recoveryAt=now+.4;
  p.burstSpread=spread;
  }
  p.spread=spread;
  return {...profile,direction:d,burst:p.burstCount,recoilYaw:p.recoilYaw,recoilPitch:p.recoilPitch};
}

function consumeGunShot(p,now,follow=false,random=Math.random){
  const w=GUNS[p.weapon];if(!w||now<(p.nextAttackAt||0)||p.ammo<=0)return null;
  const interval=behavior?behavior.shotInterval(p):shotInterval(p);
  if(!follow&&now<(p.nextShotAt||p.lastShot+interval)-1e-8)return null;
  if(p.reloadAt||(w.reloadTimeline&&p.reloadEndAt)){if(w.reloadStyle==='per-shell'&&p.ammo>0){p.reloadAt=0;if(w.reloadTimeline){p.reloadEndAt=0;p.reloadStage='';p.reloadCancelledAt=now;}}else if(p.reloadAt)return null;}
  p.ammo--;p.shotsFired=(p.shotsFired||0)+1;
  const profile=shotProfile(p,random,now,follow,recoilRandom(p.recoilSeed,p.shotsFired,p.weapon,random));
  if(!follow){p.nextShotAt=nextShotDeadline(p.nextShotAt||0,now,interval,w.automatic&&!p.burstMode&&p.fireHeld);p.nextSecondaryAt=p.nextShotAt;}p.lastShot=now;
  if(p.burstMode&&!follow&&['glock18','famas'].includes(p.weapon)){p.burstRemaining=Math.min(2,p.ammo);p.nextBurstAt=now+(behavior?.shotFollowupInterval?.(p)??(p.weapon==='glock18'?.1:.05));}
  if(['awp','scout'].includes(p.weapon)&&p.zoom!==90){p.resumeZoom=p.zoom;p.zoom=90;p.resumeZoomAt=now+w.interval;}
  return profile;
}
function updateReload(p,now){
 const w=GUNS[p.weapon];if(!w||!Number.isFinite(now))return false;let changed=false;
 if(p.reloadEndAt&&now+1e-8>=p.reloadEndAt){p.reloadEndAt=0;p.reloadStage='';changed=true;}
 if(p.reloadAt&&now+1e-8>=p.reloadAt){
  const deadline=p.reloadAt,n=Math.min(w.clip-p.ammo,p.reserve,w.reloadStyle==='per-shell'?1:Infinity);p.ammo+=n;p.reserve-=n;changed=true;
  if(w.reloadStyle==='per-shell'){
   p.reloadShellsAdded=(p.reloadShellsAdded||0)+n;
   p.reloadAt=p.ammo<w.clip&&p.reserve>0?deadline+w.reload:0;
   // An authored outro is presentation, not a new attack/deploy lock. Existing
   // loaded-shell interruption remains available in both insertion and outro;
   // the original nextAttackAt/nextShotAt deadlines still gate every shot.
   if(w.reloadTimeline){if(p.reloadAt)p.reloadStage='loop';else {p.reloadStage='outro';p.reloadEndAt=deadline+w.reloadEnd;}}
  }else p.reloadAt=0;
 }
 return changed;
}

 return{resetWeapon,updateWeapon,weaponSpread,spreadDirection,shotProfile,consumeGunShot,updateReload,sampleViewRecoil:behavior?.sampleViewRecoil||legacySampleViewRecoil,shotFollowupInterval:behavior?.shotFollowupInterval||(()=>.1),...(behavior?{deploySeconds:behavior.deploySeconds,behaviorId:behavior.id}:{} )};
}
