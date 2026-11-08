// Bounded Source 2 candidate flight kernel. The caller supplies the existing
// Source 2 hull tracer; this module never advances a player or a global clock.
// One call is one gravity half-step. A collision's remaining segment uses the
// reflected end-of-half-step velocity without applying gravity a second time.
export const GRENADE_FLIGHT_LIMITS=Object.freeze({contacts:4,maxContacts:8,maxStep:.25,minTime:1e-9,minNormal:1e-8});

export function createGrenadeFlight({sweep,trace,gravity,elasticity=.45,restSpeed=.508,maxSpeed=50,maxContacts=4,floorNormal=.7,restNormal=.7,groundProbe=.015,contactSlop=0,traceSkin=.0005,bounceBias=0,floorDampingSpeed=0,floorDampingDot=.5,componentStopEpsilon=0,simulationStep=1/128}={}){
 if(typeof sweep!=='function'||typeof trace!=='function'||![gravity,elasticity,restSpeed,maxSpeed,floorNormal,restNormal,groundProbe,contactSlop,traceSkin,bounceBias,floorDampingSpeed,floorDampingDot,componentStopEpsilon,simulationStep].every(Number.isFinite)||gravity<0||elasticity<0||elasticity>1||restSpeed<0||maxSpeed<=0||floorNormal<0||floorNormal>1||restNormal<0||restNormal>1||groundProbe<=0||contactSlop<0||contactSlop>.01||traceSkin<0||bounceBias<0||bounceBias>1||floorDampingSpeed<0||floorDampingDot<0||floorDampingDot>1||componentStopEpsilon<0||componentStopEpsilon>1||simulationStep<=0||simulationStep>GRENADE_FLIGHT_LIMITS.maxStep||!Number.isInteger(maxContacts)||maxContacts<1||maxContacts>GRENADE_FLIGHT_LIMITS.maxContacts)throw Error('Invalid CS2 grenade flight settings');
 const valid=p=>p&&['x','y','z','vx','vy','vz'].every(k=>Number.isFinite(p[k]));
 const cap=p=>{const speed=Math.hypot(p.vx,p.vy,p.vz);if(speed>maxSpeed){const scale=maxSpeed/speed;p.vx*=scale;p.vy*=scale;p.vz*=scale;}};
 const normal=hit=>{const n=hit?.normal;if(!Array.isArray(n)||n.length!==3||!n.every(Number.isFinite))return null;const length=Math.hypot(...n);return length>GRENADE_FLIGHT_LIMITS.minNormal?[n[0]/length,n[1]/length,n[2]/length]:null;};
 function supported(p){
  const hit=trace(p,{x:p.x,y:p.y-groundProbe,z:p.z}),n=normal(hit);
  return !hit?.startSolid&&Number.isFinite(hit?.fraction)&&hit.fraction>=0&&hit.fraction<1&&n&&n[1]>restNormal;
 }
 function step(p,seconds,players=[],onBounce=()=>{}){
  if(!valid(p)||!Number.isFinite(seconds)||seconds<0||seconds>GRENADE_FLIGHT_LIMITS.maxStep)return false;
  if(seconds===0)return true;
  if(p.resting){
   if(!p.groundBody&&supported(p)){p.grounded=true;p.vx=p.vy=p.vz=0;return true;}
   p.resting=false;
  }
  // Ground-body contacts last only until the next step: a player can move out
  // from under the grenade, and must never leave a permanent floating support.
  p.grounded=false;p.groundBody=false;cap(p);
  // The steep-floor gate observes the velocity after the full pair's gravity,
  // even if the contact belongs to the first half. Reflection itself below
  // uses the velocity of the half in which the actual contact occurred.
  const halfPhase=p.flightHalfPhase===1?1:0;
  if(Math.abs(seconds-simulationStep)<=1e-9)p.flightHalfPhase=1-halfPhase;
  const gateSpeed=Math.hypot(p.vx,p.vy-gravity*simulationStep*(halfPhase?1:2),p.vz);
  const oldVy=p.vy;p.vy-=gravity*seconds;cap(p);
  const initial={x:p.x,y:p.y,z:p.z},end={x:p.x+p.vx*seconds,y:p.y+(oldVy+p.vy)*.5*seconds,z:p.z+p.vz*seconds};
  let from=initial,to=end,remaining=seconds,contacts=0,zeroProgress=0;
  while(remaining>GRENADE_FLIGHT_LIMITS.minTime){
   const hit=sweep(from,to,players,p.ownerId);
   if(!hit||hit.startSolid||!Number.isFinite(hit.fraction)||hit.fraction<0||hit.fraction>1)return false;
   let fraction=hit.fraction;
   const n=fraction<1?normal(hit):null;if(fraction<1&&!n)return false;
   // The map kernel already retreats by traceSkin. Add only the missing part
   // of a requested contact gap, along the original swept segment; that point
   // is known to be clear and cannot move sideways through a neighbouring wall.
   if(n&&contactSlop>0){const travel=Math.abs((to.x-from.x)*n[0]+(to.y-from.y)*n[1]+(to.z-from.z)*n[2]),extra=Math.max(0,contactSlop-(hit.body?0:traceSkin));if(travel>1e-12)fraction=Math.max(0,fraction-extra/travel);}
   p.x=from.x+(to.x-from.x)*fraction;p.y=from.y+(to.y-from.y)*fraction;p.z=from.z+(to.z-from.z)*fraction;
   if(fraction===1)return valid(p);
   const dot=p.vx*n[0]+p.vy*n[1]+p.vz*n[2],speed=Math.hypot(p.vx,p.vy,p.vz);
   contacts++;remaining*=1-fraction;zeroProgress=fraction<=1e-7?zeroProgress+1:0;
   // Near a ceiling apex the averaged chord can contact while the velocity
   // at the half-step end already separates. Keep that velocity and sweep its
   // remaining segment instead of bouncing it back or discarding the time.
   if(dot>=-1e-9){
    if(contacts>=maxContacts||zeroProgress>=2||remaining<=GRENADE_FLIGHT_LIMITS.minTime)return valid(p);
    from={x:p.x,y:p.y,z:p.z};to={x:p.x+p.vx*remaining,y:p.y+p.vy*remaining,z:p.z+p.vz*remaining};continue;
   }
   p.bounces=(Number.isSafeInteger(p.bounces)&&p.bounces>=0?p.bounces:0)+1;
   if(speed>1)onBounce(p,hit);
   const backoff=2*dot+bounceBias;
   const clippedX=p.vx-n[0]*backoff,clippedY=p.vy-n[1]*backoff,clippedZ=p.vz-n[2]*backoff;
   p.vx=(Math.abs(clippedX)<componentStopEpsilon?0:clippedX)*elasticity;p.vy=(Math.abs(clippedY)<componentStopEpsilon?0:clippedY)*elasticity;p.vz=(Math.abs(clippedZ)<componentStopEpsilon?0:clippedZ)*elasticity;cap(p);
   const floor=n[1]>floorNormal;
   // A separate, configurable measured candidate for energetic steep floor
   // impacts. Wall restitution remains exactly the common reflection branch.
   if(floor&&floorDampingSpeed>0&&gateSpeed>floorDampingSpeed){const cosine=Math.max(0,Math.min(1,-dot/speed));if(cosine>floorDampingDot){const factor=1.5-cosine;p.vx*=factor;p.vy*=factor;p.vz*=factor;}}
   const reflectedSpeed=Math.hypot(p.vx,p.vy,p.vz);
   if(n[1]>restNormal&&reflectedSpeed<restSpeed&&!hit.body){p.vx=p.vy=p.vz=0;p.grounded=true;p.resting=true;return true;}
   if(floor){
    p.groundBody=!!hit.body;
    if(p.vy<gravity*seconds){p.grounded=true;const out=p.vx*n[0]+p.vy*n[1]+p.vz*n[2];p.vx-=n[0]*out;p.vy-=n[1]*out;p.vz-=n[2]*out;}
   }
   // Discard only this half-step's unresolved remainder. Do not teleport out
   // of corners, erase the entire projectile, or stop it after N total bounces.
   if(contacts>=maxContacts||zeroProgress>=2||remaining<=GRENADE_FLIGHT_LIMITS.minTime)return valid(p);
   from={x:p.x,y:p.y,z:p.z};to={x:p.x+p.vx*remaining,y:p.y+p.vy*remaining,z:p.z+p.vz*remaining};
  }
  return valid(p);
 }
 return{step,supported,settings:Object.freeze({gravity,elasticity,restSpeed,maxSpeed,maxContacts,floorNormal,restNormal,groundProbe,contactSlop,traceSkin,bounceBias,floorDampingSpeed,floorDampingDot,componentStopEpsilon,simulationStep})};
}
