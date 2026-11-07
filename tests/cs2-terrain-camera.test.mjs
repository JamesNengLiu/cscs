import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTerrainCameraResponse,CS2_TERRAIN_CAMERA} from '../public/cs2-terrain-camera.js';
import {createPresentationClock} from '../public/cs2-presentation-clock.js';
const rules={tick:60,stepHeight:.4572,eye:1.6256,crouchEye:1.1684};
const body=(await readFile(new URL('../public/cs2-player-camera.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'').replace('export function createPlayerCamera','function createPlayerCamera');
const clear=(a,b)=>({fraction:1,startSolid:false,end:{...b}});
function factory(trace=clear){return new Function('RULES','eyeHeight','movePlayer','maxMoveSpeed','trace','createPresentationClock','createTerrainCameraResponse','CS2_TERRAIN_CAMERA',body+'\nreturn createPlayerCamera;')(rules,p=>p.crouch?rules.crouchEye:rules.eye,(p,input,dt)=>{p.x+=(p.vx||0)*dt;},()=>6.35,trace,createPresentationClock,createTerrainCameraResponse,CS2_TERRAIN_CAMERA);}
const close=(a,b,epsilon=1e-9)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} != ${b}`);
const initial=()=>({x:0,y:1,z:0,vx:6,vy:0,vz:0,grounded:true,alive:true,crouch:false});
function simulate(hz,trajectory,{trace=clear,mode='baseline'}={}){
 const create=factory(trace),old=create({mode,stablePresentation:true}),next=create({mode,stablePresentation:true,terrainSmoothing:true}),p=initial();old.reset(p);next.reset(p);let acc=0,last=0,tick=0;const rows=[];
 for(let frame=1;frame<=hz*3;frame++){
  const now=frame/hz,dt=now-last;last=now;acc+=dt;
  while(acc>=1/60-1e-10){tick++;p.x=tick*.1;Object.assign(p,trajectory(tick));old.push(p,{f:1},[]);next.push(p,{f:1},[]);acc=Math.max(0,acc-1/60);}
  const options={fractionSeconds:acc,dt,frameTimeMs:1000+now*1000};const before={...p};old.update(p,options);next.update(p,options);assert.deepEqual(p,before,'camera must not mutate physical state');close(next.position.x,old.position.x);close(next.position.z,old.position.z);
  rows.push({frame,tick,old:{...old.position},next:{...next.position},player:{...p},acc,now,dt});
 }
 return {rows,old,next,p,acc,last};
}

test('ground response is bounded, monotone and settles after a stop at 60/75/120/144Hz',()=>{
 for(const hz of [60,75,120,144]){
  const response=createTerrainCameraResponse();response.reset(1);let target=1,shown=1;
  for(let i=1;i<=hz;i++){target-=.6/hz;const next=response.sample(target,{dt:1/hz,sampleTime:i/hz,eligible:true});assert.ok(next<=shown+1e-12&&next>=target-1e-12);assert.ok(next-target<=.015+1e-12);shown=next;}
  for(let i=1;i<=Math.ceil(hz*.2);i++)shown=response.sample(target,{dt:1/hz,sampleTime:1+i/hz,eligible:true});
  close(shown,target,1e-6);assert.ok(response.diagnostics().peakOffsetMetres<=CS2_TERRAIN_CAMERA.maxOffsetMetres+1e-12);
 }
});

test('sampled presentation time rather than jittered callback dt drives the response',()=>{
 const a=createTerrainCameraResponse(),b=createTerrainCameraResponse();a.reset(1);b.reset(1);
 for(let i=0;i<600;i++){const target=1-Math.min(i,300)*.004,time=i/75;close(a.sample(target,{dt:1/75,sampleTime:time,eligible:true}),b.sample(target,{dt:1/75+(i%2?.0005:-.0005),sampleTime:time,eligible:true}));}
});

test('bypass, long frames, clock discontinuities and reset leave no stale height',()=>{
 const r=createTerrainCameraResponse();r.reset(1);r.sample(.9,{dt:1/75,sampleTime:1,eligible:true});
 close(r.sample(.8,{dt:1/75,sampleTime:1.013,eligible:false}),.8);
 close(r.sample(.5,{dt:.1,sampleTime:1.113,eligible:true}),.5);
  close(r.sample(.45,{dt:.05,sampleTime:1.163,eligible:true}),.45);
 close(r.sample(.4,{dt:1/75,sampleTime:.5,eligible:true}),.4);
 close(r.sample(.3,{dt:1/75,sampleTime:.514,eligible:true,enabled:false}),.3);
 r.reset(100);close(r.sample(100,{dt:1/75,sampleTime:5,eligible:true}),100);
 assert.throws(()=>r.sample(NaN),/Finite/);
});

for(const hz of [60,75,120,144])test(`new camera leaves flat running, jumping and stance display unchanged at ${hz}Hz`,()=>{
 for(const trajectory of [()=>({y:1,grounded:true}),tick=>({y:tick>=30&&tick<75?1+Math.sin((tick-30)/45*Math.PI):1,grounded:tick<30||tick>=75}),tick=>({y:1,grounded:true,crouch:tick>=30&&tick<75})]){
  const r=simulate(hz,trajectory);for(const row of r.rows)assert.deepEqual(row.next,row.old);
 }
});

for(const hz of [60,75,120,144])test(`ground slope response changes only bounded Y and keeps air plus landing tail exact at ${hz}Hz`,()=>{
 const r=simulate(hz,tick=>tick<60?{y:1-tick*.01,grounded:true}:tick<90?{y:.4+Math.sin((tick-60)/30*Math.PI),grounded:false}:{y:.4,grounded:true});
 let changed=false;
 for(const row of r.rows){const delta=row.next.y-row.old.y;assert.ok(Math.abs(delta)<=.015+1e-9);if(row.tick>=60&&row.tick<=97)close(delta,0);if(row.tick>5&&row.tick<58&&Math.abs(delta)>1e-5)changed=true;}
 assert.ok(changed);close(r.rows.at(-1).next.y,r.rows.at(-1).old.y,1e-6);
});

test('visibility rejection discards only the new Y response and never assigns hit X/Z',()=>{
 let rejects=0;const trace=(a,b)=>{if(Math.abs(a.x-b.x)<1e-9&&Math.abs(a.z-b.z)<1e-9&&Math.abs(a.y-b.y)>1e-9){rejects++;return{fraction:.5,startSolid:false,end:{x:999,y:(a.y+b.y)/2,z:999}};}return clear(a,b);};
 const r=simulate(75,tick=>({y:1-tick*.005,grounded:true}),{trace});
 assert.ok(rejects>0);assert.ok(r.next.diagnostics().terrainPresentation.rejectedFrames>0);
 for(const row of r.rows)assert.deepEqual(row.next,row.old);
});

test('small network rebase/correction is not smoothed twice and teleport clears the response',()=>{
 const r=simulate(75,tick=>({y:1-tick*.002,grounded:true}));const before={...r.p},shown={...r.next.position},after={...r.p,x:r.p.x+.03,y:r.p.y+.01,z:r.p.z-.02};
 r.next.rebase(before,after);r.next.update(after,{fractionSeconds:r.acc,dt:0,frameTimeMs:1000+r.last*1000,correction:{x:-.03,y:-.01,z:.02}});
 for(const key of ['x','y','z'])close(r.next.position[key],shown[key]);
 r.next.reset({...after,x:100,y:50});r.next.update({...after,x:100,y:50},{fractionSeconds:0,dt:1/75,frameTimeMs:5000});close(r.next.position.y,50+rules.eye);
});

test('near-zero offset does not add safety traces on a flat floor',()=>{
 let traces=0;const r=simulate(75,()=>({y:1,grounded:true}),{trace:(a,b)=>{traces++;return clear(a,b);}});assert.equal(traces,r.rows.length*2);assert.equal(r.next.diagnostics().terrainPresentation.filteredFrames,0);
});

test('authority stance/ground changes clear the new response even when no physical push occurs',()=>{
 for(const patch of [{grounded:false},{crouch:true}]){
  const r=simulate(75,tick=>({y:1-tick*.002,grounded:true})),before={...r.p},after={...r.p,...patch};
  assert.ok(Math.abs(r.next.position.y-r.old.position.y)>1e-5);
  for(const camera of [r.old,r.next]){camera.rebase(before,after);camera.update(after,{fractionSeconds:r.acc,dt:0,frameTimeMs:1000+r.last*1000});}
  assert.deepEqual(r.next.position,r.old.position);assert.equal(r.next.diagnostics().terrainPresentation.offsetMetres,0);
 }
});

test('responsive preview preserves the original XYZ across the same terrain',()=>{
 const r=simulate(120,tick=>({y:1-tick*.002,grounded:true}),{mode:'responsive'});
 for(const row of r.rows)assert.deepEqual(row.next,row.old);
});
