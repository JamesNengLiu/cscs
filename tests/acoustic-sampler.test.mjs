import test from 'node:test';import assert from 'node:assert/strict';
import {createAcousticSampler} from '../public/acoustic-sampler.js';
import {createMuzzleLighting} from '../public/muzzle-lighting.js';import * as THREE from 'three';
import {prepareCosmetics} from '../public/prepare-cosmetics.js';
test('optional shader/texture preparation failures resolve safely without touching the live scene',async()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());scene.add(mesh);
 for(const renderer of [{initTexture(){throw Error('lost context');},compileAsync(){throw Error('unexpected');}},{initTexture(){},compileAsync(){throw Error('compile');}}])assert.equal(await prepareCosmetics(THREE,renderer,camera,scene,{objects:[mesh],textures:[{}]}),false);
 assert.equal(scene.children[0],mesh);assert.equal(mesh.visible,true);mesh.geometry.dispose();mesh.material.dispose();
});
test('acoustic traces have a bounded cache/budget, never mute blocked sounds, and do not mutate positions',()=>{
 let clock=0,calls=0;const sample=createAcousticSampler(()=>{calls++;return {startSolid:false,fraction:.4};},{now:()=>clock,budget:2,capacity:3}),p={x:0,y:0,z:0},l={x:2,y:1,z:0};const saved=structuredClone({p,l});assert.equal(sample.sample(p,l).gain,.62);assert.equal(sample.sample(p,l).gain,.62);assert.equal(calls,1);assert.equal(sample.sample({...p,x:3},l).gain,.62);assert.equal(sample.sample({...p,x:6},l),null);assert.equal(calls,2);clock=200;for(let i=0;i<10;i++){clock+=100;sample.sample({...p,x:i*2},l);}assert.ok(sample.diagnostics().entries<=3);assert.deepEqual({p,l},saved);
});
test('muzzle programs install after preparation, disable cleanly and dispose pending clones once',async()=>{
 let resolve;const renderer={initTexture(){},compileAsync(){return new Promise(r=>resolve=r);}},camera=new THREE.PerspectiveCamera(),scene=new THREE.Scene(),material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);scene.add(mesh);const original=material.onBeforeCompile,fx=createMuzzleLighting(THREE,{renderer,camera});fx.setEnabled(true);fx.prepare(scene);assert.equal(material.onBeforeCompile,original);assert.equal(fx.diagnostics().pending,1);resolve();await new Promise(r=>setImmediate(r));assert.notEqual(material.onBeforeCompile,original);fx.setEnabled(false);assert.equal(material.onBeforeCompile,original);material.dispose();mesh.geometry.dispose();assert.equal(fx.diagnostics().materials,0);
});
test('muzzle pulse is time-based and never changes a camera or firing state',()=>{
 const scene=new THREE.Scene(),material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);scene.add(mesh);const fx=createMuzzleLighting(THREE);fx.setEnabled(true);fx.prepare(scene);const shader={uniforms:{},vertexShader:'#include <project_vertex>',fragmentShader:'#include <tonemapping_fragment>'};material.onBeforeCompile(shader);const p=new THREE.Vector3(1,2,3);fx.trigger(p,1);fx.update(1.01);const a=shader.uniforms.lsFlashStrength.value;fx.update(1.01);assert.equal(shader.uniforms.lsFlashStrength.value,a);fx.update(1.1);assert.equal(shader.uniforms.lsFlashStrength.value,0);assert.deepEqual(p.toArray(),[1,2,3]);material.dispose();mesh.geometry.dispose();
});
test('disposing a source during optional compilation releases its prepared clone exactly once',async()=>{
 let resolve,disposals=0;const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),material),clone=material.clone.bind(material);material.clone=()=>{const result=clone();result.addEventListener('dispose',()=>disposals++);return result;};scene.add(mesh);
 const fx=createMuzzleLighting(THREE,{renderer:{compileAsync:()=>new Promise(r=>resolve=r)},camera});fx.setEnabled(true);fx.prepare(scene);material.dispose();assert.equal(disposals,0);assert.equal(fx.diagnostics().materials,0);resolve();await new Promise(r=>setImmediate(r));assert.equal(disposals,1);mesh.geometry.dispose();
});
