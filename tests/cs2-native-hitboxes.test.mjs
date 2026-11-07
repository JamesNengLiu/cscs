import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadNativeHitboxes} from '../cs2-native-hitboxes.mjs';
import {createNativePose,rayCapsule} from '../public/cs2-native-pose.js';
import {createLagCompensation} from '../cs2-lag-compensation.mjs';
import {nativeAssetsAvailable,readNativeAsset,nativeEntries} from './fixtures/cs2-native-assets.mjs';
const skip=await nativeAssetsAvailable()?false:'Original CS2 assets/rigs not prepared locally; no copyrighted fixture is bundled.';
const player=(team,patch={})=>({id:'native-target',team,alive:true,weapon:'ak47',x:4,y:2,z:6,yaw:0,vx:0,vz:0,grounded:true,gaitDistance:0,...patch});
function capsules(asset,p,time){const pose=createNativePose(THREE,asset.rig,asset.buffer);pose.pose(p,time);const root=new THREE.Matrix4().makeRotationY(p.yaw+asset.rig.yawOffset).setPosition(p.x,p.y,p.z);return asset.rig.hitboxes.map(h=>{const matrix=new THREE.Matrix4().multiplyMatrices(root,pose.bones[h.bone].world);return{...h,a:new THREE.Vector3().fromArray(h.a).applyMatrix4(matrix),b:new THREE.Vector3().fromArray(h.b).applyMatrix4(matrix)};});}

test('native idle/run/crouch rays hit authored head capsules and use the same posed volume as visibility',{skip},async()=>{
 const service=await loadNativeHitboxes(nativeEntries);for(const team of ['T','CT']){const asset=await readNativeAsset(team);for(const state of [{},{vx:5,gaitDistance:.37},{crouch:true}])for(const yaw of [0,Math.PI/2,-1.1]){const p=player(team,{...state,yaw}),time=4.13,volumes=capsules(asset,p,time),head=volumes.find(h=>h.group===1),center=new THREE.Vector3().addVectors(head.a,head.b).multiplyScalar(.5),origin=center.clone().add(new THREE.Vector3(0,3,0)),direction=new THREE.Vector3(0,-1,0),expected=Math.min(...volumes.map(h=>rayCapsule(origin,direction,h.a,h.b,h.radius))),actual=service.rayPlayer(origin,direction,p,time);assert.ok(Number.isFinite(actual.distance));assert.ok(Math.abs(actual.distance-expected)<1e-7);assert.equal(actual.hitgroup,'head');assert.equal(service.rayPlayer(origin,direction.clone().negate(),p,time).distance,Infinity);}}
 const diagnostic=service.hitboxDiagnostics();assert.equal(diagnostic.source,'source2-native-authored-capsules');assert.ok(diagnostic.queries>=36);assert.deepEqual(Object.keys(diagnostic.teams).sort(),['CT','T']);
});

test('historical team identity remains authoritative across newer team, stance and position mutations',{skip},async()=>{
 const service=await loadNativeHitboxes(nativeEntries),asset=await readNativeAsset('T'),historical=player('T',{yaw:.7,crouch:true}),time=12.3,head=capsules(asset,historical,time).find(h=>h.group===1),center=new THREE.Vector3().addVectors(head.a,head.b).multiplyScalar(.5),origin=center.clone().add(new THREE.Vector3(3,0,0)),direction=new THREE.Vector3(-1,0,0),before=service.rayPlayer(origin,direction,historical,time),snapshot=structuredClone(historical),live={...historical,team:'CT',x:400,y:20,crouch:false,vx:5};assert.equal(service.rayPlayer(origin,direction,live,time).distance,Infinity);assert.deepEqual(service.rayPlayer(origin,direction,snapshot,time),before);assert.deepEqual(historical,snapshot);assert.throws(()=>service.rayPlayer(origin,direction,{...historical,team:undefined},time),/missing team/);
 const animation=service.hitboxAnimation(historical,time);assert.equal(animation.playerRig,'source2-native');assert.equal(animation.playerAction,'crouch');assert.equal(animation.playerAnimationClock,time);assert.equal(animation.playerSequence,asset.rig.actions.crouch);
});

test('actual experimental lag history retains native team/character and replays a moving posed target',{skip},async()=>{
 const service=await loadNativeHitboxes(nativeEntries),asset=await readNativeAsset('T'),history=createLagCompensation(),first=player('T',{character:'tm_phoenix',playedRound:3,yaw:.4,vx:3,gaitDistance:.2,lastShot:4.01,playerLocomotion:{version:1,duck:0,move:.5,walk:0,air:0,airTime:0,origin:.9}});history.record({time:4,round:3,players:[first]});const last={...first,x:first.x+.3,gaitDistance:.5,crouch:true,playerLocomotion:{...first.playerLocomotion,duck:1,move:1,origin:.45}};history.record({time:4.1,round:3,players:[last]});const p=history.pose(first.id,4.05,3);assert.equal(p.team,'T');assert.equal(p.character,'tm_phoenix');assert.ok(Math.abs(p.x-first.x-.15)<1e-10);assert.ok(Math.abs(p.gaitDistance-.35)<1e-10);assert.ok(Math.abs(p.playerLocomotion.duck-.5)<1e-10);
 const head=capsules(asset,p,4.05).find(h=>h.group===1),center=new THREE.Vector3().addVectors(head.a,head.b).multiplyScalar(.5),origin=center.clone().add(new THREE.Vector3(0,3,0)),direction=new THREE.Vector3(0,-1,0),rewound=service.rayPlayer(origin,direction,p,4.05);assert.equal(rewound.hitgroup,'head');assert.ok(Number.isFinite(rewound.distance));last.team='CT';last.character='ctm_sas';last.x+=10;assert.deepEqual(service.rayPlayer(origin,direction,history.pose(first.id,4.05,3),4.05),rewound);
});
