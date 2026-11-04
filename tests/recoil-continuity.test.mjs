import test from 'node:test';import assert from 'node:assert/strict';
import {createShotFeedback} from '../public/shot-feedback.js';
import {decayPunch,sampleViewRecoil} from '../public/weapon-feel.js';
import {INPUT_DT,MAX_INPUT_QUEUE} from '../public/input-protocol.js';
import {blankInput,supportHeight} from '../public/shared.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const player=()=>({weapon:'awp',ammo:10,reserve:30,zoom:40,alive:true,ackInputSeq:0,shotsFired:0,recoilSeed:123,lastShot:-100,recoilYaw:0,recoilPitch:0,x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),grounded:true,vx:0,vy:0,vz:0,yaw:0,pitch:0});
const sample=(f,p,seq,fire=false,extra={})=>f.sample({player:p,input:{...blankInput(),fire},seq,round:1,time:10,stateTime:10,fixedStep:true,nowMs:seq*1000*INPUT_DT,allowed:true,...extra});
function predicted(count=8){const p=player(),f=createShotFeedback();f.observe(p,{round:1,stateTime:10,nowMs:0});for(let seq=1;seq<=count;seq++)sample(f,p,seq,seq===1,{switchBlocked:seq>1});return {p,f};}
const switched=(p,weapon='knife')=>({...p,weapon,zoom:90,ammo:weapon==='knife'?0:20,reserve:0,ackInputSeq:1,shotsFired:1,recoilPitch:2*Math.PI/180,lastShot:10+INPUT_DT,nextAttackAt:20});
for(const weapon of ['knife','glock18'])for(const count of [2,4,8,16])test(`${weapon}: ${count} pending commands retain the decayed recoil across a switch snapshot`,()=>{
 const {p,f}=predicted(count),before=f.view().recoilPitch,authority=switched(p,weapon),immutable=structuredClone(authority);
 f.observe(authority,{round:1,stateTime:10+INPUT_DT,nowMs:count*INPUT_DT*1000});near(f.view().recoilPitch,before);
 assert.ok(f.view().recoilPitch<=2*Math.PI/180);assert.deepEqual(authority,immutable);assert.equal(f.view().ammo,authority.ammo);assert.equal(f.view().shotsFired,1);
 const expected={recoilPitch:before,recoilYaw:0};decayPunch(expected,INPUT_DT);assert.equal(sample(f,authority,count+1,false,{stateTime:10+INPUT_DT}),null);near(f.view().recoilPitch,expected.recoilPitch);
 // A duplicate snapshot cannot restore an older punch after another local step.
 f.observe(authority,{round:1,stateTime:10+INPUT_DT,nowMs:(count+1)*INPUT_DT*1000});near(f.view().recoilPitch,expected.recoilPitch);
});
for(const hz of [60,120,144,240])test(`knife view at ${hz}Hz stays continuous between 60Hz commands and 30Hz ACKs`,()=>{
 const {p,f}=predicted(5),authority=switched(p);f.observe(authority,{round:1,stateTime:10+INPUT_DT,nowMs:90});let seq=5,ack=1,sourceTime=10+INPUT_DT,previous=Infinity;
 for(let frame=0;frame<=Math.ceil(hz*.4);frame++){
  const elapsed=frame/hz,next=5+Math.floor(elapsed/INPUT_DT+1e-8);
  while(seq<next)sample(f,authority,++seq,false,{stateTime:sourceTime});
  if(frame&&elapsed+1e-8>=((ack+1)/2)*(2*INPUT_DT)){
   const take=Math.min(2,seq-ack);for(let i=0;i<take;i++)decayPunch(authority,INPUT_DT);ack+=take;authority.ackInputSeq=ack;sourceTime+=take*INPUT_DT;
   f.observe(authority,{round:1,stateTime:sourceTime,nowMs:90+elapsed*1000});
  }
  const value=sampleViewRecoil(f.view(),Math.max(0,elapsed-(next-5)*INPUT_DT)).recoilPitch;assert.ok(value<=previous+1e-8,`${hz}Hz frame ${frame}: ${previous} -> ${value}`);previous=value;
 }
 near(previous,0);assert.equal(f.view().shotsFired,1);
});
test('knife and utility clocks never fire an old gun or modify authoritative ammunition',()=>{
 for(const weapon of ['knife','hegrenade','flashbang','smokegrenade','c4']){
  const {p,f}=predicted(),authority={...switched(p,weapon),ammo:0};f.observe(authority,{round:1,stateTime:10+INPUT_DT,nowMs:140});
  for(let seq=9;seq<=20;seq++)assert.equal(sample(f,authority,seq,true,{stateTime:10+INPUT_DT}),null);
  near(f.view().recoilPitch,0);assert.equal(f.view().ammo,0);assert.equal(f.view().shotsFired,1);assert.equal(authority.ammo,0);
 }
});
test('old trigger commands cannot shoot a newly ready pistol; its fresh press still works',()=>{
 const p=player(),f=createShotFeedback();for(let seq=1;seq<=6;seq++)sample(f,p,seq,true);
 const pistol={...switched(p,'glock18'),nextAttackAt:0,lastShot:-100,fireHeld:false};f.observe(pistol,{round:1,stateTime:10+INPUT_DT,nowMs:110});assert.equal(f.view().ammo,20);assert.equal(f.view().shotsFired,1);
 sample(f,pistol,7,false,{stateTime:10+INPUT_DT});assert.ok(sample(f,pistol,8,true,{stateTime:10+INPUT_DT}));assert.equal(f.view().ammo,19);assert.equal(pistol.ammo,20);
});
test('real incoming damage punch remains visible after a switch, rather than being clamped away',()=>{
 const {p,f}=predicted(),authority=switched(p);f.observe(authority,{round:1,stateTime:10+INPUT_DT,nowMs:140});const before=f.view().recoilPitch;
 const hurt={...authority,ackInputSeq:2,recoilPitch:.2,recoilYaw:-.03},expected={recoilPitch:hurt.recoilPitch,recoilYaw:hurt.recoilYaw};for(let i=0;i<6;i++)decayPunch(expected,INPUT_DT);
 f.observe(hurt,{round:1,stateTime:10+2*INPUT_DT,nowMs:145});assert.ok(f.view().recoilPitch>before);near(f.view().recoilPitch,expected.recoilPitch);near(f.view().recoilYaw,expected.recoilYaw);
});
test('round reset, death, cancel and history capacity retain their existing bounds',()=>{
 const {p,f}=predicted();f.cancel();assert.equal(f.view(),null);assert.equal(f.diagnostics().history,0);
 for(let seq=1;seq<=MAX_INPUT_QUEUE+30;seq++)sample(f,{...p,weapon:'knife'},seq);assert.ok(f.diagnostics().history<=MAX_INPUT_QUEUE);
 assert.equal(sample(f,{...p,alive:false},100),null);assert.equal(f.view(),null);
 f.observe({...p,weapon:'knife',recoilPitch:0},{round:2,stateTime:0,nowMs:0});near(f.view().recoilPitch,0);assert.equal(f.diagnostics().history,0);
});
