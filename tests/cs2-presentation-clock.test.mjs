import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPresentationClock} from '../public/cs2-presentation-clock.js';

const body=(await readFile(new URL('../public/cs2-player-camera.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'').replace('export function createPlayerCamera','function createPlayerCamera');
const createCamera=new Function('RULES','eyeHeight','movePlayer','maxMoveSpeed','trace','createPresentationClock',body+'\nreturn createPlayerCamera;')(
 {tick:60,stepHeight:.45,eye:1.6256,crouchEye:1.1684},p=>p.crouch?1.1684:1.6256,(p,input,dt)=>{p.x+=(p.vx||0)*dt;},()=>6.35,(a,b)=>({fraction:1,startSolid:false,end:{...b}}),createPresentationClock);
const close=(a,b,epsilon=1e-9)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} != ${b}`);
const stats=values=>{const mean=values.reduce((a,b)=>a+b,0)/values.length,sd=Math.sqrt(values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length);return{mean,sd,min:Math.min(...values),max:Math.max(...values)};};
function replay({stable=false,mode='baseline',withFrameTime=true,seconds=18}={}){
 const camera=createCamera({mode,stablePresentation:stable}),p={x:0,y:0,z:0,vx:6.35,vy:0,vz:0,grounded:true,alive:true};camera.reset(p);
 let accumulator=0,previousRaw=0,previousPosition=null;const rows=[],velocity=[];
 for(let frame=1;frame<=75*seconds;frame++){
  const raw=frame/75+(frame%2?.0005:-.0005),dt=raw-previousRaw;previousRaw=raw;accumulator+=dt;
  while(accumulator>=1/60){p.x+=6.35/60;camera.push(p,{f:1},[]);accumulator-=1/60;}
  const before={...p},options={fractionSeconds:accumulator,dt};if(withFrameTime)options.frameTimeMs=10000+raw*1000;
  camera.update(p,options);assert.deepEqual(p,before,'presentation must not mutate simulation');
  const position={...camera.position};if(frame>75&&previousPosition)velocity.push((position.x-previousPosition.x)*75);
  rows.push(position);previousPosition=position;
 }
 return{camera,p,rows,velocity:stats(velocity),accumulator,frameTimeMs:10000+previousRaw*1000};
}

test('stable 75Hz feedback loses callback-phase speed wobble without changing simulation or mean pace',()=>{
 const old=replay(),candidate=replay({stable:true});assert.deepEqual(candidate.p,old.p);close(candidate.accumulator,old.accumulator);
 assert.ok(candidate.velocity.sd<old.velocity.sd*.05,JSON.stringify({old:old.velocity,candidate:candidate.velocity}));
 assert.ok(Math.abs(candidate.velocity.mean-6.35)<.0001);assert.ok(candidate.velocity.min>6.3&&candidate.velocity.max<6.4,'no zero/double visual steps across fixed-tick boundaries');
 assert.equal(candidate.camera.diagnostics().presentationClock.cadenceHz,75);
});

test('old API without frameTimeMs is exactly legacy even when the candidate flag is enabled',()=>{
 assert.deepEqual(replay({withFrameTime:false}).rows,replay({stable:true,withFrameTime:false}).rows);
});

test('responsive B output is identical with the candidate flag on or off',()=>{
 assert.deepEqual(replay({mode:'responsive'}).rows,replay({mode:'responsive',stable:true}).rows);
});

test('clock is read-only, monotonic and bounded to rawSim minus 2ms through cadence changes and gaps',()=>{
 const clock=createPresentationClock();let raw=0,frame=0,last=null;
 for(const hz of [75,60,144,120,75])for(let i=0;i<150;i++){
  const dt=1/hz+(i%2?.0003:-.0003);raw+=dt;frame+=dt*1000;
  const out=clock.sample(raw,{frameTimeMs:frame});assert.ok(out<=raw+1e-12&&out>=raw-.002-1e-12);if(last!==null)assert.ok(out>=last);last=out;
  assert.equal(clock.sample(raw,{frameTimeMs:frame}),out,'same frame is idempotent');
 }
 raw+=.05;frame+=150;close(clock.sample(raw,{frameTimeMs:frame}),raw);assert.equal(clock.diagnostics().locked,false,'clamped simulation/long frame must fall back');
 raw-=.01;frame+=13;close(clock.sample(raw,{frameTimeMs:frame}),raw);assert.equal(clock.diagnostics().locked,false);
 close(clock.sample(raw,{frameTimeMs:frame,enabled:false}),raw);close(clock.sample(raw),raw);
});

test('small rebase translates all three poses and correction cancels it in the same frame',()=>{
 const r=replay({stable:true,seconds:2}),before={...r.p},shown={...r.camera.position},after={...r.p,x:r.p.x+.03,y:r.p.y+.01,z:r.p.z-.02};
 r.camera.rebase(before,after);r.camera.update(after,{fractionSeconds:r.accumulator,dt:0,frameTimeMs:r.frameTimeMs,correction:{x:-.03,y:-.01,z:.02}});
 for(const axis of ['x','y','z'])close(r.camera.position[axis],shown[axis]);
 r.camera.reset({...after,x:100});r.camera.update({...after,x:100},{fractionSeconds:0,dt:1/75,frameTimeMs:r.frameTimeMs+100});close(r.camera.position.x,100);
});

test('stopping leaves no permanent position offset, and disabling restores the original baseline sample',()=>{
 const r=replay({stable:true,seconds:2}),p={...r.p,vx:0};
 for(let i=1;i<=6;i++){r.camera.push(p,{f:0},[]);r.camera.update(p,{fractionSeconds:0,dt:1/60,frameTimeMs:r.frameTimeMs+i*1000/60});}
 close(r.camera.position.x,p.x);r.camera.setPresentationClockEnabled(false);r.camera.update(p,{fractionSeconds:0,dt:1/75,frameTimeMs:r.frameTimeMs+200});close(r.camera.position.x,p.x);
 assert.equal(r.camera.diagnostics().presentationClock.enabled,false);
});

test('three-pose sampling stays within available history on step terrain and never mutates input data',()=>{
 const camera=createCamera({stablePresentation:true}),p={x:0,y:0,z:0,vx:6.35,vy:0,vz:0,grounded:true,alive:true};camera.reset(p);let acc=0,previousRaw=0,tick=0;
 for(let frame=1;frame<=750;frame++){
  const raw=frame/75+(frame%2?.00045:-.00045),dt=raw-previousRaw;previousRaw=raw;acc+=dt;
  while(acc>=1/60){p.x+=6.35/60;p.y=tick>=120&&tick<200?.2:0;camera.push(p,{f:1},[]);acc-=1/60;tick++;}
  const before={...p};camera.update(p,{fractionSeconds:acc,dt,frameTimeMs:raw*1000});assert.deepEqual(p,before);assert.ok(Object.values(camera.position).every(Number.isFinite));
  assert.ok(camera.position.x<=p.x+1e-12&&camera.position.x>=p.x-6.35*(2/60)-1e-9);assert.ok(camera.diagnostics().presentationClock.extraDelayMs<=2+1e-8);
 }
});
