import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadNativeHitboxes} from '../cs2-native-hitboxes.mjs';
import {createCS2Game} from '../cs2-game.mjs';
import {createLagCompensation} from '../cs2-lag-compensation.mjs';
import {createSnapshotBuffer} from '../public/cs2-snapshot-buffer.js';
import {createNativePose} from '../public/cs2-native-pose.js';
import {effectiveNativeStride} from '../public/cs2-animation-phase.js';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {fixtureWorld} from './cs2-game-fixture.mjs';
import {nativeAssetsAvailable,nativeEntries,readNativeAsset} from './fixtures/cs2-native-assets.mjs';
const skip=await nativeAssetsAvailable()?false:'Original CS2 assets/rigs not prepared locally; no copyrighted fixture is bundled.';
test('actual native adapter advances once per Game move and stays continuous through run/walk/duck and read-only hit queries',{skip},async()=>{
 const asset=await readNativeAsset('T');assert.equal(Object.keys(asset.rig.clipStrides).length,72);const hitboxes=await loadNativeHitboxes(nativeEntries),world=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),game=createCS2Game(world,{weaponProfile:'cs2',hitboxes,random:()=>.5}),t=game.add('t','T','T'),ct=game.add('ct','CT','CT');game.begin();game.phase='live';game.endAt=1000;ct.x=8;t.money=16000;game.buy(t.id,'ak47');game.equip(t.id,'ak47');let expected=0,runSample=null;
 for(let tick=0;tick<120;tick++){const before=t.gaitDistance;game.inputBatch(t.id,[{seq:tick+1,round:game.round,input:{f:1,yaw:0,walk:tick>=60&&tick<90,crouch:tick>=90}}]);game.step();const stride=effectiveNativeStride(t,asset.rig);assert.ok(stride>0);expected+=Math.abs(t.gaitDistance-before)/stride;assert.ok(Math.abs(t.nativeGaitPhase-expected)<1e-10,'Actual hook lost a delta or changed phase on a stance switch');if(tick===30)runSample={distance:t.gaitDistance,phase:t.nativeGaitPhase,stride};}
 assert.ok(t.nativeGaitPhase>0);assert.ok(Math.abs(runSample.phase-runSample.distance/runSample.stride)<1e-10);assert.ok(runSample.stride>asset.rig.stride*2,'Production stride must come from measured contact data rather than the old1.6m fallback');assert.equal(hitboxes.hitboxDiagnostics().phaseAdvances,240);
 const before=t.nativeGaitPhase,count=hitboxes.hitboxDiagnostics().phaseAdvances;game.snapshot(t.id);game.equip(t.id,'knife');hitboxes.hitboxAnimation(t,game.time);hitboxes.rayPlayer({x:0,y:1,z:10},{x:0,y:0,z:-1},t,game.time);assert.equal(t.nativeGaitPhase,before);assert.equal(hitboxes.hitboxDiagnostics().phaseAdvances,count);
 const first=structuredClone(t),time=game.time;game.inputBatch(t.id,[{seq:121,round:game.round,input:{f:1,yaw:0}}]);game.step();const last=structuredClone(t),history=createLagCompensation();history.record({time,round:game.round,players:[first]});history.record({time:game.time,round:game.round,players:[last]});const mid=(time+game.time)/2,p=history.pose(t.id,mid,game.round),phase=(first.nativeGaitPhase+last.nativeGaitPhase)/2;assert.ok(Math.abs(p.nativeGaitPhase-phase)<1e-10);
 const buffer=createSnapshotBuffer({minDelayMs:0,maxDelayMs:0,clockSlewMsPerSecond:0});buffer.push({time,round:game.round,players:[first]},1000);buffer.push({time:game.time,round:game.round,players:[last]},1000+(game.time-time)*1000);const visible=buffer.sample(t.id,1000+(game.time-time)*500);assert.ok(Math.abs(visible.nativeGaitPhase-phase)<1e-10);const a=createNativePose(THREE,asset.rig,asset.buffer),b=createNativePose(THREE,asset.rig,asset.buffer);a.pose(p,mid);b.pose({...p,...hitboxes.hitboxAnimation(p,mid)},mid,{explicit:true});assert.deepEqual(a.bones.map(b=>b.world.toArray()),b.bones.map(b=>b.world.toArray()));assert.equal(t.nativeGaitPhase,last.nativeGaitPhase);
});

test('native pose consumes one continuous phase across source run/walk/crouch clips, with explicit evidence for weak directions',{skip},async()=>{
 const asset=await readNativeAsset('T'),rig=asset.rig,pose=createNativePose(THREE,rig,asset.buffer),raw=createNativePose(THREE,rig,asset.buffer),phase=123.37,loco={version:1,duck:0,move:1,walk:0,air:0,airTime:0,origin:.9};
 const values=Object.values(rig.clipStrides);assert.equal(values.filter(v=>v.classification==='bilateral-derived-candidate').length,48);assert.equal(values.filter(v=>v.classification==='family-mode-n-fallback').length,24);for(const [key,entry]of Object.entries(rig.clipStrides))if(entry.classification==='family-mode-n-fallback'){assert.notEqual(entry.referenceClip,key);assert.equal(entry.strideMeters,rig.clipStrides[entry.referenceClip].strideMeters);assert.equal(rig.clipStrides[entry.referenceClip].classification,'bilateral-derived-candidate');}
 for(const [walk,duck,key]of [[0,0,rig.actions.run],[1,0,rig.actions.walk],[0,1,rig.actions.crouchMove]]){const p={alive:true,weapon:'ak47',grounded:true,crouch:duck===1,walk:walk===1,vx:0,vz:-3,yaw:0,gaitDistance:1000000,nativeGaitPhase:phase,playerLocomotion:{...loco,walk,duck}};pose.pose(p,10);raw.pose({playerSequence:key,playerAnimationTime:phase*rig.clips[key].duration,playerLooping:true},10,{explicit:true});for(let i=0;i<pose.bones.length;i++)for(let k=0;k<16;k++)assert.ok(Math.abs(pose.bones[i].world.elements[k]-raw.bones[i].world.elements[k])<1e-9,'A clip change recomputed phase from accumulated distance');assert.equal(p.nativeGaitPhase,phase);}
});
