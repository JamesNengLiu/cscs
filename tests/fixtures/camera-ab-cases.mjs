import {createHash} from 'node:crypto';
import {createPlayerCamera} from '../../public/player-camera.js';
import {movePlayer,supportHeight,trace,eyeHeight} from '../../public/shared.js';
import {slowdownColumns} from './hit-slowdown-cases.mjs';
import {DOWNHILL_CASES,slopeStart,sampleSlope} from '../downhill-fixtures.mjs';
const base=patch=>({id:'camera-audit',alive:true,weapon:'glock18',x:-21,z:22,y:supportHeight(-21,22,3.3),vx:0,vy:0,vz:0,yaw:-Math.PI/2,pitch:0,grounded:true,crouch:false,velocityModifier:1,jumpFatigue:0,...patch});
export const cameraCases=[
 {name:'flat-start-stop-reverse',start:base(),input:n=>({f:n>=6&&n<60?1:n>=90&&n<125?-1:0,yaw:-Math.PI/2})},
 {name:'flat-wheel',start:base(),input:n=>({f:1,yaw:-Math.PI/2,jump:n>=18&&n%4===0})},
 {name:'flat-crouch-rise',start:base(),input:n=>({f:n<100?1:0,yaw:-Math.PI/2,crouch:n>=12&&n<64})},
 {name:'vertical-wheel',start:base(),input:n=>({jump:n>=6&&n%4===0})},
 {name:'air-stance',start:base(),input:n=>({jump:n%4===0,crouch:n%30>8&&n%30<23})},
 {name:'ceiling',start:base({x:39,y:-1.6,z:-5,crouch:true,duckAmount:1}),input:n=>({jump:n>=12&&n%4===0,crouch:n<70})},
 {name:'ct-crate',start:base({x:18.9,y:supportHeight(18.9,-58.8,-1.4),z:-58.8,yaw:Math.PI/2}),input:n=>({f:1,yaw:Math.PI/2,jump:n%90===6,crouch:n%90>=15})},
 {name:'landing-fatigue',start:base({vx:6.25,jumpFatigue:650}),input:()=>({f:1,yaw:-Math.PI/2})},
 ...DOWNHILL_CASES.flatMap(route=>[false,true].map(up=>{
  let start=slopeStart(route);if(up){const point=sampleSlope(route,120).samples.find(s=>Math.hypot(s.x-route.start[0],s.z-route.start[2])>=route.distance*.85);start={...point,vx:0,vy:0,vz:0,yaw:Math.atan2(route.direction[0],route.direction[1])};}
  return {name:route.name+(up?'-up':'-down'),start:base(start),input:n=>({f:1,yaw:start.yaw,jump:n>=18&&n%4===0})};
 }))
];
export function cameraTrace(spec,hz,mode,{factory=createPlayerCamera,duration=3}={}){
 const p=structuredClone(spec.start),camera=factory({mode}),frames=[],physics=[];camera.reset(p);let rem=0,tick=0,last={...camera.position};camera.update(p);last={...camera.position};let maxUp=0,maxHorizontal=0,solids=0,firstMotion=null;
 const lag=[];
 for(let i=1;i<=Math.round(duration*hz);i++){
  const dt=1/hz;rem+=dt;
  while(rem+1e-10>=1/60){const input=spec.input(tick);movePlayer(p,input,1/60);camera.push(p,input);physics.push(slowdownColumns.map(k=>p[k]??null));tick++;rem=Math.max(0,rem-1/60);}
  camera.update(p,{fractionSeconds:rem,dt});const pos={...camera.position},time=i/hz;
  maxUp=Math.max(maxUp,(pos.y-last.y)/dt);maxHorizontal=Math.max(maxHorizontal,Math.hypot(pos.x-last.x,pos.z-last.z)/dt);solids+=trace(pos,pos).startSolid;
  if(firstMotion===null&&Math.hypot(pos.x-spec.start.x,pos.z-spec.start.z)>.001)firstMotion=time;
  if(spec.name==='flat-start-stop-reverse'&&time>=.7&&time<=.95&&Math.abs(p.vx-6.25)<1e-8)lag.push((p.x+p.vx*rem-pos.x)/p.vx*1000);
  frames.push([time,pos.x,pos.y,pos.z]);last=pos;
 }
 const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
 return {name:spec.name,hz,mode,frames,physicsHash:digest(physics),renderHash:digest(frames),maxUp,maxHorizontal,solids,firstMotion,lagMs:lag.length?lag.reduce((a,b)=>a+b,0)/lag.length:null,diagnostics:camera.diagnostics?.()};
}
