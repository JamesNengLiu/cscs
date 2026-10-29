import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Game} from '../game.mjs';
import {crouchPressed,queueJumpPulse} from '../public/controls.js';
import {createViewmodelSettings,applyWeaponHand,WEAPON_HAND} from '../public/viewmodel-settings.js';
import {createProjectileBuffer} from '../public/projectile-buffer.js';
import {createProjectileModels,PROJECTILE_DISPLAY_SCALE} from '../public/projectile-models.js';
const close=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} vs ${b}`);
test('C and either Control key crouch independently; releasing one binding preserves the other',()=>{
  for(const code of ['KeyC','ControlLeft','ControlRight'])assert.equal(crouchPressed(new Set([code])),true);
  const keys=new Set(['ControlLeft','KeyC']);keys.delete('ControlLeft');assert.equal(crouchPressed(keys),true);keys.delete('KeyC');assert.equal(crouchPressed(keys),false);
});
test('wheel jump enqueues an atomic press/release pair preserving other held actions',()=>{
  const queue=[],input={jump:false,crouch:true,fire:true,f:1,yaw:2};assert.equal(queueJumpPulse(queue,input),true);
  assert.deepEqual(queue,[{...input,jump:true},{...input,jump:false}]);assert.equal(input.jump,false);
  assert.equal(queueJumpPulse([], {...input,jump:true}),false);
  const full=Array(7).fill(input);assert.equal(queueJumpPulse(full,input),false);assert.equal(full.length,7);
});
test('wheel jump reaches the authoritative command queue and cannot manufacture another jump in flight',()=>{
  const g=new Game(),p=g.add('p','Wheel','T');g.begin();const base=p.y,edges=[];queueJumpPulse(edges,{jump:false,yaw:p.yaw});
  g.inputBatch(p.id,edges.map((input,i)=>({input,seq:i+1,round:g.round})));g.step();assert.ok(p.vy>0);g.step();assert.equal(p.jumpHeld,false);
  const velocity=p.vy,more=[];queueJumpPulse(more,{jump:false,yaw:p.yaw});g.inputBatch(p.id,more.map((input,i)=>({input,seq:i+3,round:g.round})));g.step();assert.ok(p.vy<velocity);
  for(let i=0;i<100;i++)g.step();assert.equal(p.grounded,true);close(p.y,base,.002);assert.equal(p.jumpHeld,false);
});
test('hand preference defaults to right, persists left, and stays usable without local storage',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},settings=createViewmodelSettings(storage);
  assert.equal(settings.hand,'right');settings.setHand('left');assert.equal(values.get(WEAPON_HAND.storageKey),'left');assert.equal(createViewmodelSettings(storage).hand,'left');
  assert.equal(settings.setHand('__proto__'),false);assert.equal(settings.hand,'left');
  const denied=createViewmodelSettings({getItem(){throw Error('denied');},setItem(){throw Error('denied');}});denied.setHand('left');assert.equal(denied.hand,'left');assert.equal(denied.saved,false);
});
test('left hand mirrors original camera-space geometry around the camera, including the legacy origin',()=>{
  const group=new THREE.Group(),model=new THREE.Object3D();group.position.set(.25,-.24,-.42);model.position.set(.4-.25,0,-.5);group.add(model);
  applyWeaponHand(group,'right',.01);group.updateMatrixWorld(true);const right=model.getWorldPosition(new THREE.Vector3());
  applyWeaponHand(group,'left',.01);group.updateMatrixWorld(true);const left=model.getWorldPosition(new THREE.Vector3());close(left.x,-right.x);close(left.y,right.y);close(left.z,right.z);assert.equal(group.scale.y,1);
});
test('flight interpolation stays between authoritative poses and clears on detonation/round changes',()=>{
  const b=createProjectileBuffer(),p={id:'g',kind:'hegrenade',x:0,y:1,z:0};b.push([p],1,1);b.push([{...p,x:1,y:2}],1+1/30,1);
  const middle=b.sample(1+1/30+1/60)[0];close(middle.x,.5);close(middle.y,1.5);assert.equal(p.x,0);
  b.remove('g');assert.deepEqual(b.sample(2),[]);b.push([{...p,x:9}],2,2);assert.equal(b.sample(2)[0].x,9);
  b.push([{...p,x:10,resting:true}],2.03,2);assert.equal(b.sample(2.04)[0].x,10);b.clear();assert.deepEqual(b.sample(3),[]);
});
test('grenades are visually doubled while authoritative positions and geometry stay unchanged',()=>{
  const scene=new THREE.Scene(),models=createProjectileModels(THREE,scene,{loadAssets:false}),p={id:'g',kind:'hegrenade',x:1,y:2,z:3,resting:true};
  models.update([p],1);const matrix=new THREE.Matrix4();scene.getObjectByName('projectile:hegrenade:0').getMatrixAt(0,matrix);
  const size=new THREE.Vector3();matrix.decompose(new THREE.Vector3(),new THREE.Quaternion(),size);close(size.x,PROJECTILE_DISPLAY_SCALE,1e-6);assert.equal(matrix.elements[12],1);assert.equal(matrix.elements[14],3);assert.equal(p.y,2);models.dispose();
});
