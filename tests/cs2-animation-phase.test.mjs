import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceNativeAnimationPhase,effectiveNativeStride,nativeGaitPhaseOf,nativeMotionDirection} from '../public/cs2-animation-phase.js';
const locomotion=(patch={})=>({version:1,duck:0,move:1,walk:0,air:0,airTime:0,origin:.9,...patch});
// Deliberately synthetic strides exercise arithmetic; no retail values are
// encoded here. Production tables are generated from the ignored native clips.
const rig={stride:1.6,actions:{run:'run',walk:'walk',crouchMove:'crouch'},actionsByWeapon:{knife:{run:'knifeRun',walk:'knifeWalk',crouchMove:'knifeCrouch'}},clipStrides:Object.fromEntries([['run',4],['walk',2],['crouch',1],['knifeRun',5],['knifeWalk',3],['knifeCrouch',2]].map(([k,strideMeters])=>[k,{strideMeters}]))};
const player=(patch={})=>({alive:true,playedRound:1,weapon:'ak47',gaitDistance:0,nativeGaitPhase:0,playerLocomotion:locomotion(),x:1,y:2,z:3,vx:0,vz:-1,yaw:0,...patch});
test('native gait integrates the very first post-spawn movement and mutates presentation phase only',()=>{
 const p=player({gaitDistance:.2}),before=structuredClone(p),next=advanceNativeAnimationPhase(p,rig);assert.equal(p.nativeGaitPhase,.05);delete p.nativeGaitPhase;delete before.nativeGaitPhase;assert.deepEqual(p,before);assert.equal(next.distance,.2);assert.equal(next.phase,.05);
});
test('large accumulated travel remains continuous through zero-motion walk/crouch/weapon switches',()=>{
 const p=player({gaitDistance:100000,nativeGaitPhase:123.95}),state={round:1,distance:100000,phase:123.95};p.playerLocomotion=locomotion({walk:1});let next=advanceNativeAnimationPhase(p,rig,state);assert.equal(p.nativeGaitPhase,123.95);p.gaitDistance+=.1;next=advanceNativeAnimationPhase(p,rig,next);assert.ok(Math.abs(p.nativeGaitPhase-124)<1e-10);p.playerLocomotion=locomotion({duck:1});p.weapon='knife';next=advanceNativeAnimationPhase(p,rig,next);assert.ok(Math.abs(p.nativeGaitPhase-124)<1e-10);p.gaitDistance-=.2;p.vz=1;next=advanceNativeAnimationPhase(p,rig,next);assert.ok(Math.abs(p.nativeGaitPhase-124.1)<1e-10,'Backwards movement must advance its authored backwards clip, not reverse the clock');
});
test('effective stride blends only measured movement clips while idle amplitude cannot fabricate phase',()=>{
 const p=player({playerLocomotion:locomotion({walk:.5,duck:.5,move:0})});assert.equal(effectiveNativeStride(p,rig),2);const next=advanceNativeAnimationPhase(p,rig);assert.equal(next.phase,0);p.playerLocomotion.move=1;assert.equal(effectiveNativeStride(p,rig),2);assert.equal(advanceNativeAnimationPhase(p,rig,next).phase,0);
});
test('all eight direction symbols select the matching derived clip stride',()=>{
 const directions=['n','ne','e','se','s','sw','w','nw'],map={},data={};for(let i=0;i<8;i++){map['run_'+directions[i]]='d'+i;data['d'+i]={strideMeters:2+i};}const r={actions:map,clipStrides:data};for(let i=0;i<8;i++){const angle=i*Math.PI/4,p=player({vx:Math.sin(angle),vz:-Math.cos(angle)});assert.equal(nativeMotionDirection(p),directions[i]);assert.equal(effectiveNativeStride(p,r),2+i);}
});
test('life resets start from spawn0; raw/no-locomotion callers retain their existing timeline',()=>{
 const p=player({playedRound:2,gaitDistance:.1,nativeGaitPhase:0}),next=advanceNativeAnimationPhase(p,rig,{round:1,distance:100,phase:30});assert.equal(next.phase,.025);assert.equal(nativeGaitPhaseOf(p,rig),.025);const old=player({playerLocomotion:undefined,gaitDistance:8,nativeGaitPhase:999});assert.equal(nativeGaitPhaseOf(old,rig),5);assert.equal(advanceNativeAnimationPhase(old,rig),null);assert.equal(old.nativeGaitPhase,999);assert.equal(effectiveNativeStride(player(),{actions:rig.actions}),null);
});
