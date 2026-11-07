import test from 'node:test';import assert from 'node:assert/strict';
import {CS2_WEAPON_PROFILE,CS2_WEAPON_PROFILE_V1} from '../public/cs2-weapon-profile.js';
import {createCS2WeaponBehaviorV1} from '../public/cs2-weapon-behavior-v1.js';
import {advanceCoreAccuracy,addFireAccuracy,resetCoreAccuracy,accuracyRecoverySeconds,readCoreAccuracy} from '../public/cs2-accuracy-reference.js';
const source=id=>CS2_WEAPON_PROFILE.guns[id].source;
const near=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);
function advanceFor(s,p,seconds,interval){for(let t=0;t<seconds-1e-12;){const dt=Math.min(1/60,seconds-t);t+=dt;advanceCoreAccuracy(s,p,dt,t,interval);}}
test('native AK first follow-up accuracy follows the recovery core',()=>{
 const s=source('ak47'),p={zoom:90,crouch:false,lastShot:0};resetCoreAccuracy(s,p);p.cs2AccuracyValue=.006410279311239719;addFireAccuracy(s,p);advanceCoreAccuracy(s,p,6/64,6/64,.1);near(readCoreAccuracy(s,p),.010748650878667831,1e-8);assert.equal(p.cs2RecoilIndex,1);
});
test('recovery uses the integer part of the pre-decay float index',()=>{
 const s=source('ak47'),p={zoom:90,crouch:false,cs2RecoilIndex:4.8848137855529785,lastShot:0,cs2AccuracyValue:.012427038513123989};
 near(accuracyRecoverySeconds(s,p),.46);advanceCoreAccuracy(s,p,1/64,.2,.1);near(readCoreAccuracy(s,p),.011974362656474113,1e-8);near(p.cs2RecoilIndex,4.545670986175537,1e-6);
});
test('crouching preserves the current accuracy then recovers toward the crouched baseline',()=>{
 const s=source('ak47'),p={zoom:90,crouch:false,lastShot:-100};resetCoreAccuracy(s,p);p.crouch=true;near(readCoreAccuracy(s,p),.00641);advanceFor(s,p,s.m_flRecoveryTimeCrouch,.1);near(readCoreAccuracy(s,p),.00481+(.00641-.00481)*.1);
});
test('AWP scope precision needs recovery; unscoping immediately applies its larger baseline',()=>{
 const s=source('awp'),p={zoom:90,crouch:false,lastShot:-100};resetCoreAccuracy(s,p);p.zoom=40;near(readCoreAccuracy(s,p),.0808);advanceFor(s,p,s.m_flRecoveryTimeStand,1.455);near(readCoreAccuracy(s,p),.002+(.0808-.002)*.1);p.zoom=90;advanceCoreAccuracy(s,p,1/60,2,1.455);near(readCoreAccuracy(s,p),.0808);
});
test('native exponential index recovery starts after the rifle delay and never changes the shot ordinal',()=>{
 const s=source('ak47'),p={zoom:90,crouch:false,lastShot:0,shotsFired:123};resetCoreAccuracy(s,p);p.cs2RecoilIndex=7;advanceCoreAccuracy(s,p,1/64,.109,.1);assert.equal(p.cs2RecoilIndex,7);advanceCoreAccuracy(s,p,1/64,.12,.1);near(p.cs2RecoilIndex,6.514004230499268,1e-6);assert.equal(p.shotsFired,123);
});
test('unverified airborne recovery keeps the previous precision model instead of applying half a native air model',()=>{
 const s=source('ak47'),old={weapon:'ak47',zoom:90,crouch:false,input:{fire:false},lastShot:1,cs2RecoilIndex:3.5,cs2AccuracyPenalty:.02,cs2JumpPenalty:0,cs2LandPenalty:0,cs2WasGrounded:false,recoilPitch:0,recoilYaw:0},p={...old,cs2AccuracyValue:.00641+.02};
 createCS2WeaponBehaviorV1(CS2_WEAPON_PROFILE_V1).update(old,1/60,1+1/60,false);advanceCoreAccuracy(s,p,1/60,1+1/60,.1,false);near(readCoreAccuracy(s,p)-.00641,old.cs2AccuracyPenalty);
});
