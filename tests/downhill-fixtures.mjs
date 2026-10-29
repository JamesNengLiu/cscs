import {RULES,movePlayer,trace,collides} from '../public/shared.js';
export const DOWNHILL_CASES=[
  {name:'T-spawn ramp',start:[-12.8,3.2,16.8],direction:[1,0],distance:13.6},
  {name:'A-long ramp',start:[34.4,2,-64.8],direction:[0,1],distance:8},
  {name:'CT-B ramp',start:[-29.6,0,-55.2],direction:[1,0],distance:12},
  {name:'B-tunnel approach',start:[-45.6,3.2,16],direction:[0,-1],distance:15}
];
export function slopeStart(c,crouch=false){const [x,hint,z]=c.start,height=crouch?RULES.crouchHeight:RULES.bodyHeight;
  const floor=trace({x,y:hint+.6,z},{x,y:hint-2,z},height);
  if(floor.startSolid||floor.fraction===1)throw Error('Invalid slope fixture '+c.name);
  return {...floor.end,vx:0,vy:0,vz:0,yaw:Math.atan2(-c.direction[0],-c.direction[1]),pitch:0,crouch};}
export function sampleSlope(c,hz=60,options={}){
  const p=slopeStart(c,options.crouch),start={...p},speed=options.crouch?RULES.crouchSpeed:options.walk?RULES.walkSpeed:RULES.speed;
  // This fixture measures steady downhill travel, independently of the run-up.
  p.vx=c.direction[0]*speed;p.vz=c.direction[1]*speed;
  const samples=[],total=c.distance/speed+.25,dt=1/hz;let stalls=0,air=0,solid=0,upward=0,minSpeed=Infinity,maxStep=0;
  for(let t=0;t<total;t+=dt){const before={...p};(options.move||movePlayer)(p,{f:1,yaw:p.yaw,crouch:!!options.crouch,walk:!!options.walk},dt);
    const delta=Math.hypot(p.x-before.x,p.z-before.z),dy=p.y-before.y;
    if(t>.3){stalls+=delta<speed*dt*.1;air+=!p.grounded;solid+=collides(p.x,p.z,RULES.radius,p.y,options.crouch?RULES.crouchHeight:RULES.bodyHeight);upward+=dy>.002;minSpeed=Math.min(minSpeed,delta/dt);maxStep=Math.max(maxStep,Math.abs(dy));}
    samples.push({t,x:p.x,y:p.y,z:p.z,vx:p.vx,vy:p.vy,vz:p.vz,grounded:p.grounded,delta,dy});}
  return {name:c.name,hz,mode:options.crouch?'crouch':options.walk?'walk':'run',start:{x:start.x,y:start.y,z:start.z},end:{x:p.x,y:p.y,z:p.z},travel:Math.hypot(p.x-start.x,p.z-start.z),stalls,air,solid,upward,minSpeed,maxStep,samples};
}
