// Presentation state only. No writes to physics, input, ammunition or RNG.
export const LOCOMOTION_VERSION=1;
const BLENDS=['duck','move','walk','air'],VALUES=[...BLENDS,'airTime','origin'];
export const LOCOMOTION_TIMING=Object.freeze({start:.12,stop:.15,stance:.12,walk:.13,takeoff:.08,land:.08,airPhase:.1});
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const approach=(x,target,step)=>x<target?Math.min(target,x+step):Math.max(target,x-step);
const speed=p=>Math.hypot(p.vx||0,p.vz||0);
const duck=p=>p.crouch?1:clamp(p.duckAmount||0);
export const validLocomotion=p=>p?.version===LOCOMOTION_VERSION&&BLENDS.every(k=>Number.isFinite(p[k])&&p[k]>=0&&p[k]<=1)&&Number.isFinite(p.airTime)&&p.airTime>=0&&p.airTime<=5&&Number.isFinite(p.origin)&&p.origin>=0&&p.origin<=1.35;
export function copyLocomotion(p){if(!validLocomotion(p))return undefined;const result={version:LOCOMOTION_VERSION};for(const k of VALUES)result[k]=p[k];return result;}
export function locomotionOrigin(p){return p?.alive!==false&&validLocomotion(p?.playerLocomotion)?p.playerLocomotion.origin:p?.crouch?.45:.9;}
export function interpolateLocomotion(a,b,t){
 if(!validLocomotion(a)||!validLocomotion(b))return copyLocomotion(a);
 const pose={version:LOCOMOTION_VERSION};for(const k of VALUES)pose[k]=a[k]*(1-t)+b[k]*t;return pose;
}
export function createLocomotionState(p){return {duck:duck(p),move:clamp((speed(p)-.12)/1.5),walk:p.walk?1:0,air:p.grounded===false?1:0,airTime:clamp(p.airTime||0,0,5),origin:p.crouch?.45:.9,crouch:!!p.crouch,grounded:p.grounded!==false,phaseElapsed:1,phaseFrom:0,x:p.x,y:p.y,z:p.z};}
export function stepLocomotion(state,p,dt){
 if(!state||Math.hypot(p.x-state.x,p.y-state.y,p.z-state.z)>3)state=createLocomotionState(p);
 const step=clamp(Number.isFinite(dt)?dt:0,0,.1),air=p.grounded===false,targetMove=clamp((speed(p)-.12)/1.5);
 state.duck=approach(state.duck,duck(p),step/LOCOMOTION_TIMING.stance);
 state.move=approach(state.move,targetMove,step/(targetMove>state.move?LOCOMOTION_TIMING.start:LOCOMOTION_TIMING.stop));
 state.walk=approach(state.walk,p.walk?1:0,step/LOCOMOTION_TIMING.walk);
 state.air=approach(state.air,air?1:0,step/(air?LOCOMOTION_TIMING.takeoff:LOCOMOTION_TIMING.land));
 if(air){
  if(state.grounded){state.phaseFrom=state.airTime;state.phaseElapsed=0;}
  state.phaseElapsed+=step;const t=clamp(state.phaseElapsed/LOCOMOTION_TIMING.airPhase),blend=t*t*(3-2*t);
  state.airTime=state.phaseFrom*(1-blend)+clamp(p.airTime||0,0,5)*blend;
 }else if(state.air===0)state.airTime=0;
 // Airborne crouch changes the hull origin by 18 source units. Cancel that
 // exact origin shift, rather than adding a camera/physics position filter.
 if(!state.grounded&&state.crouch!==!!p.crouch)state.origin-=.45*(p.crouch?1:-1);
 const targetOrigin=air?(p.crouch?.45:.9):.9-.45*state.duck;
 state.origin=clamp(approach(state.origin,targetOrigin,step*4.5),0,1.35);
 state.crouch=!!p.crouch;state.grounded=!air;state.x=p.x;state.y=p.y;state.z=p.z;
 const pose={version:LOCOMOTION_VERSION};for(const k of VALUES)pose[k]=state[k];
 return {state,pose};
}
