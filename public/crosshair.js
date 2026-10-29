// Classic HUD distance/delta facts; CS16Client ammo.cpp. Independent of ballistic spread.
import {GUNS} from './arsenal.js';
const DISTANCE={p228:[8,3],scout:[5,3],hegrenade:[8,3],xm1014:[9,4],c4:[6,3],mac10:[9,3],aug:[3,3],smokegrenade:[8,3],elite:[4,3],fiveseven:[8,3],ump45:[6,3],sg550:[5,3],galil:[4,3],famas:[4,3],usp:[8,3],glock18:[8,3],awp:[8,3],mp5navy:[6,3],m249:[6,3],m3:[8,6],tmp:[7,3],g3sg1:[6,4],flashbang:[8,3],deagle:[8,3],sg552:[5,3],ak47:[4,4],knife:[7,3],p90:[7,3]};
export function createCrosshair(){
  let weapon=null,shots=0,distance=4,predicted=0,queued=0;
  return {
    shot(){predicted++;queued++;},
    reset(){weapon=null;shots=predicted=queued=0;distance=4;},
    update(p,dt,width=1280){
      const [base,delta]=DISTANCE[p.weapon]||[4,3],category=GUNS[p.weapon]?.category,pistol=category==='pistol'&&p.weapon!=='elite';
      let minimum=base;
      const dynamic=pistol||['rifle','machinegun','smg'].includes(category),run=pistol||['rifle','machinegun'].includes(category)||p.weapon==='p90';
      if(dynamic){if(p.grounded===false)minimum*=2;else if(p.crouch&&pistol)minimum*=.5;else if(run&&Math.hypot(p.vx||0,p.vz||0)*40>(pistol?0:p.weapon==='p90'?170:140))minimum*=1.5;}
      if((['usp','m4a1'].includes(p.weapon)&&p.silenced)||(['famas','glock18'].includes(p.weapon)&&p.burstMode))minimum*=1.4;
      if(weapon!==p.weapon||(p.shotsFired||0)<shots){weapon=p.weapon;shots=p.shotsFired||0;distance=minimum;predicted=queued=0;}
      const confirmed=Math.max(0,(p.shotsFired||0)-shots),matched=Math.min(confirmed,predicted),count=queued+confirmed-matched;predicted-=matched;
      if(count)distance=Math.min(15,distance+delta*count);
      else distance=(distance+(.1/.013))*Math.exp(-1.3*Math.max(0,dt))-(.1/.013);
      shots=p.shotsFired||0;queued=0;distance=Math.max(minimum,distance);
      return distance*width/(width<1024?800:640);
    },
  };
}
