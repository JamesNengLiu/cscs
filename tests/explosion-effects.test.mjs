import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createExplosionEffects,EXPLOSION_LIMITS,HE_VISUAL_SCALE} from '../public/explosion-effects.js';
import {createWorldEffects} from '../public/effects.js';
const event=(id='he')=>({type:'explosion',kind:'hegrenade',id,time:1,x:3,y:2,z:4});
test('HE explosion produces depth-tested fire, smoke and sparks at the authoritative point',()=>{
  const scene=new THREE.Scene(),fx=createExplosionEffects(THREE,scene);assert.equal(scene.children.length,0);assert.equal(fx.add(event(),1),true);fx.update(1.1,new THREE.Quaternion());
  assert.equal(scene.children.length,3);assert.ok(scene.children.every(m=>m.count>0&&m.visible&&m.material.depthTest&&!m.material.depthWrite));
  const m=new THREE.Matrix4();scene.getObjectByName('he-explosion-fire').getMatrixAt(0,m);assert.ok(Math.abs(m.elements[12]-3)<.2);assert.equal(m.elements[14],4);
  assert.equal(fx.add(event(),1.2),false);fx.dispose();assert.equal(scene.children.length,0);
});
test('HE presentation grows substantially without increasing particle batches or lifetime',()=>{
  const scene=new THREE.Scene(),fx=createExplosionEffects(THREE,scene);fx.add(event(),1);fx.update(1.2,new THREE.Quaternion());
  const m=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
  scene.getObjectByName('he-explosion-fire').getMatrixAt(0,m);m.decompose(p,q,s);
  assert.ok(s.x>3);assert.ok(Math.abs(s.x-(.55+Math.sqrt(.2/.7)*2.5)*HE_VISUAL_SCALE)<1e-5);
  assert.equal(scene.children.length,3);assert.equal(scene.getObjectByName('he-explosion-fire').count,EXPLOSION_LIMITS.firePerBurst);
  fx.update(1+EXPLOSION_LIMITS.seconds);assert.equal(fx.active(),false);fx.dispose();
});
test('explosion effects reject malformed events, expire, reset and reuse bounded batches during crowds',()=>{
  const scene=new THREE.Scene(),fx=createExplosionEffects(THREE,scene);
  for(const bad of [{}, {...event(),kind:'flashbang'},{...event(),x:NaN},{...event(),x:1e308}])assert.equal(fx.add(bad,1),false);
  fx.add(event(),1);const geometry=scene.children.map(m=>m.geometry);for(let i=0;i<2000;i++)fx.add(event('he'+i),1);
  fx.update(1.2);assert.equal(fx.info().active,EXPLOSION_LIMITS.bursts);assert.equal(scene.children.length,3);assert.deepEqual(scene.children.map(m=>m.geometry),geometry);
  assert.ok(scene.children.every(m=>m.instanceMatrix.array.every(Number.isFinite)));fx.update(4);assert.equal(fx.active(4),false);assert.ok(scene.children.every(m=>!m.visible));
  fx.add(event('next'),5);fx.clear();assert.equal(fx.info().active,0);fx.dispose();fx.dispose();
});
test('world effects consume HE events, remove the detonated body immediately and resist older snapshots',()=>{
  const scene=new THREE.Scene(),fx=createWorldEffects(THREE,scene,{loadAssets:false}),p={id:'he',kind:'hegrenade',x:3,y:2,z:4};
  fx.sync({time:1,round:1,projectiles:[p]});fx.update(1,null);assert.equal(fx.info().projectiles,1);
  fx.explode(event(),1);fx.update(1.1,null);assert.equal(fx.info().projectiles,0);assert.equal(fx.info().explosions.active,1);
  fx.sync({time:1,round:1,projectiles:[p]});assert.equal(fx.info().projectiles,0);fx.clear();assert.equal(fx.info().explosions.active,0);fx.dispose();assert.equal(scene.children.length,0);
});
