import {RULES,WEAPONS,RIFLE_PATTERN} from './config.js';
import {clamp,direction} from './math.js';
import {isGrounded} from './map.js';
export function resetWeapon(p){p.burstCount=0;p.recoilYaw=0;p.recoilPitch=0;p.spread=WEAPONS[p.weapon].spread;}
export function updateWeapon(p,dt,now){const w=WEAPONS[p.weapon];if(now-p.lastShot>w.recovery){
  p.burstCount=0;const fade=Math.max(0,1-dt*16);p.recoilYaw=(p.recoilYaw||0)*fade;p.recoilPitch=(p.recoilPitch||0)*fade;
  if(Math.abs(p.recoilYaw)<.0001)p.recoilYaw=0;if(Math.abs(p.recoilPitch)<.0001)p.recoilPitch=0;
}p.spread=weaponSpread(p);}
export function weaponSpread(p){const w=WEAPONS[p.weapon],speed=Math.hypot(p.vx||0,p.vz||0)/RULES.speed;
  return (w.spread+w.moveSpread*speed*speed+(isGrounded(p)?0:w.airSpread)+w.heatSpread*Math.min(p.burstCount||0,12))*(p.crouch?.7:1);
}
export function shotProfile(p,random=Math.random){const spread=weaponSpread(p),yaw=p.yaw+(p.recoilYaw||0),pitch=clamp(p.pitch+(p.recoilPitch||0),-1.5,1.5);
  const d=direction(yaw+(random()*2-1)*spread,pitch+(random()*2-1)*spread);
  p.burstCount=(p.burstCount||0)+1;
  const next=p.weapon==='rifle'?RIFLE_PATTERN[Math.min(p.burstCount,RIFLE_PATTERN.length-1)]:[0,Math.min(.035,p.burstCount*.007)];
  p.recoilYaw=next[0];p.recoilPitch=next[1];p.spread=spread;
  return {direction:d,spread,burst:p.burstCount,recoilYaw:p.recoilYaw,recoilPitch:p.recoilPitch};
}
