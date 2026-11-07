// Presentation clock only. Source-derived strides never alter movement, ammo,
// recoil, input duration or rays. The contact-fit candidates and explicit
// direction fallbacks are not the unavailable retail animation graph/IK.
import {validLocomotion} from './player-locomotion.js';
export const NATIVE_GAIT_PHASE_VERSION='continuous-source-stride-candidate-v1';
const phase=value=>Number.isFinite(value)&&value>=0;

export function nativeMotionDirection(p){
 let vx=p.vx||0,vz=p.vz||0;
 if(Math.hypot(vx,vz)<1e-6&&Number.isFinite(p.gaitYaw)){vx=-Math.sin(p.gaitYaw);vz=-Math.cos(p.gaitYaw);}
 const directions=['n','ne','e','se','s','sw','w','nw'],side=vx*Math.cos(p.yaw||0)-vz*Math.sin(p.yaw||0),forward=-vx*Math.sin(p.yaw||0)-vz*Math.cos(p.yaw||0);
 return directions[(Math.round(Math.atan2(side,forward)/(Math.PI/4))+8)%8];
}

export function effectiveNativeStride(p,rig){
 if(!validLocomotion(p?.playerLocomotion)||!rig?.clipStrides)return null;
 const map=rig.actionsByWeapon?.[p.weapon]||rig.actions,l=p.playerLocomotion,dir=nativeMotionDirection(p);
 if(!map)return null;
 const components=[['run',(1-l.duck)*(1-l.walk)],['walk',(1-l.duck)*l.walk],['crouchMove',l.duck]];
 let stride=0,total=0;
 for(const [action,weight]of components){
  if(weight<=0)continue;
  const key=map[action+'_'+dir]||map[action],entry=rig.clipStrides[key];
  if(!Number.isFinite(entry?.strideMeters)||entry.strideMeters<=0)return null;
  stride+=entry.strideMeters*weight;total+=weight;
 }
 // Idle amplitude does not dilute a measured stride. Actual delta distance is
 // already zero while stationary, including the authoritative stop blend.
 return total>0&&Number.isFinite(stride)&&stride>0?stride/total:null;
}

export function nativeGaitPhaseOf(p,rig){
 return rig?.clipStrides&&validLocomotion(p?.playerLocomotion)&&phase(p.nativeGaitPhase)?p.nativeGaitPhase:(p.gaitDistance||0)/Math.max(.1,rig?.stride||1.6);
}

// previous is private authority presentation state (normally in a WeakMap).
// A spawn explicitly sets nativeGaitPhase=0 and gaitDistance=0; the first
// post-movement call must integrate from spawn distance0, not lose that step.
export function advanceNativeAnimationPhase(p,rig,previous=null){
 if(!p||p.alive===false||!validLocomotion(p.playerLocomotion)||!Number.isFinite(p.gaitDistance)||!rig?.clipStrides)return previous;
 const round=p.playedRound??null,current=phase(p.nativeGaitPhase)?p.nativeGaitPhase:0;
 const reset=!previous||previous.round!==round||current===0&&previous.phase>0;
 const from=reset?(current===0?0:p.gaitDistance):previous.distance;
 let value=reset?current:Math.max(current,previous.phase);
 const stride=effectiveNativeStride(p,rig),distance=Math.abs(p.gaitDistance-from),increment=stride===null?0:distance/stride;
 if(Number.isFinite(increment)&&Number.isFinite(value+increment))value+=increment;
 p.nativeGaitPhase=value;
 return{round,distance:p.gaitDistance,phase:value};
}
