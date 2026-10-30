import {RULES,WEAPONS,RIFLE_PATTERN} from './config.js';
import {GUNS} from './arsenal.js';
import {clamp,direction} from './math.js';
import {isGrounded} from './map.js';
import {baseAccuracy,advanceAccuracy,accuracySpread,applyKick,decayPunch,usesMainAutoRules} from './weapon-feel.js';
import {PITCH_LIMIT} from './view-settings.js';
const grounded=p=>Boolean(p.groundPlayer&&p.grounded)||isGrounded(p);
export function resetWeapon(p,{keepPunch=false}={}){p.burstCount=0;p.accuracy=baseAccuracy(p.weapon);p.recoveryAt=0;p.recoilDirection=0;
  if(usesMainAutoRules(p))p.delayFire=false;
  if(!keepPunch){p.recoilYaw=0;p.recoilPitch=0;}p.spread=weaponSpread(p);}
export function updateWeapon(p,dt,now,preserveHeldTrigger=false){
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
export function weaponSpread(p){const w=WEAPONS[p.weapon],speed=Math.hypot(p.vx||0,p.vz||0)/RULES.speed;
  const spread=accuracySpread(p,grounded(p));if(spread!==null)return spread;
  return (w.spread+w.moveSpread*speed*speed+(isGrounded(p)?0:w.airSpread)+w.heatSpread*Math.min(p.burstCount||0,12)+(GUNS[p.weapon]?.category==='sniper'&&(!p.zoom||p.zoom===90)?.08:0))*(p.crouch?.7:1);
}
export function spreadDirection(profile,random=Math.random){
  const {yaw,pitch,spread}=profile,x=(random()+random()-1)*spread,y=(random()+random()-1)*spread,d=direction(yaw,pitch);
  d.x+=x*Math.cos(yaw)+y*Math.sin(yaw)*Math.sin(pitch);d.y+=y*Math.cos(pitch);d.z-=x*Math.sin(yaw)-y*Math.cos(yaw)*Math.sin(pitch);
  const len=Math.hypot(d.x,d.y,d.z);return {x:d.x/len,y:d.y/len,z:d.z/len};
}
export function shotProfile(p,random=Math.random,now=p.lastShot,follow=false,kickRandom=random){
  const spread=follow&&p.weapon==='glock18'?.05:follow&&Number.isFinite(p.burstSpread)?p.burstSpread:weaponSpread(p),yaw=p.yaw+(p.recoilYaw||0),pitch=clamp(p.pitch+(p.recoilPitch||0),-PITCH_LIMIT,PITCH_LIMIT);
  const profile={spread,yaw,pitch},d=spreadDirection(profile,random);
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
