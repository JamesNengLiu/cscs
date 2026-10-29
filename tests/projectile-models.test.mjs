import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import * as THREE from 'three';
import {createProjectileModels,PROJECTILE_MODEL_LIMIT} from '../public/projectile-models.js';
const hasAssets=existsSync(new URL('../public/assets/weapons/manifest.json',import.meta.url));
const localFetch=async url=>{try{return new Response(await readFile(new URL('../public'+url,import.meta.url)));}catch{return new Response('Missing',{status:404});}};
const kinds=['hegrenade','flashbang','smokegrenade'];
class LocalTextures{
  async loadAsync(url){await readFile(new URL('../public'+url,import.meta.url));const texture=new THREE.Texture();texture.userData.file=url;return texture;}
}

test('projectile models: available grenade bodies load with their own textures and exclude all hands', {skip:!hasAssets},async t=>{
  const old=globalThis.fetch;globalThis.fetch=localFetch;t.after(()=>{globalThis.fetch=old;});
  const scene=new THREE.Scene(),models=createProjectileModels({...THREE,TextureLoader:LocalTextures},scene);t.after(()=>models.dispose());
  await models.ready;
  for(const model of models.info().models){
    assert.equal(model.source,'viewmodel-weapon-body',model.error);assert.equal(model.bodypart,'weapon');assert.ok(model.triangles>0);
    const source=JSON.parse(await readFile(new URL(`../public/assets/weapons/${model.kind}/model.json`,import.meta.url)));
    const selected=source.meshes.filter(m=>source.bodyparts[m.bodypart].name==='weapon'&&m.model===0);
    const meshes=scene.children.filter(m=>m.name.startsWith(`projectile:${model.kind}:`));
    assert.equal(meshes.length,selected.length);
    assert.equal(meshes.reduce((sum,m)=>sum+m.geometry.index.count/3,0),selected.reduce((sum,m)=>sum+m.indices.length/3,0));
    const bounds=new THREE.Box3();
    for(const mesh of meshes){
      assert.equal(mesh.material.depthTest,true);assert.equal(mesh.material.depthWrite,true);assert.equal(mesh.layers.mask,1);
      assert.ok(!/texture-[012]\.png$/.test(mesh.material.map.userData.file));
      assert.equal(mesh.material.map.flipY,false);assert.equal(mesh.material.map.colorSpace,THREE.SRGBColorSpace);
      mesh.geometry.computeBoundingBox();bounds.union(mesh.geometry.boundingBox);
      assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
    }
    const size=bounds.getSize(new THREE.Vector3());assert.ok(size.y>.09&&size.y<.12);assert.ok(size.x<.08&&size.z<.08);
    assert.ok(bounds.getCenter(new THREE.Vector3()).length()<1e-7);
  }
  assert.equal(scene.children.length,9);
});

test('projectile models: flight follows authoritative positions, tumbles and stays still after resting',async()=>{
  const scene=new THREE.Scene(),models=createProjectileModels(THREE,scene,{loadAssets:false});
  const p={id:'moving',kind:'hegrenade',x:3,y:4,z:5,bornAt:1,resting:false};
  const mesh=scene.getObjectByName('projectile:hegrenade:0'),a=new THREE.Matrix4(),b=new THREE.Matrix4();
  models.update([p],1);mesh.getMatrixAt(0,a);models.update([p],1.1);mesh.getMatrixAt(0,b);
  assert.notDeepEqual(a.elements,b.elements);assert.equal(b.elements[12],p.x);assert.equal(b.elements[14],p.z);
  p.x=6;p.resting=true;models.update([p],2);mesh.getMatrixAt(0,a);models.update([p],20);mesh.getMatrixAt(0,b);
  assert.deepEqual(a.elements,b.elements);assert.equal(b.elements[12],6);
  models.update([],21);assert.ok(scene.children.every(m=>!m.visible));models.dispose();
});

test('projectile models: sustained crowded updates reuse at most nine batches and bounded instances',()=>{
  const scene=new THREE.Scene(),models=createProjectileModels(THREE,scene,{loadAssets:false});
  const geometry=scene.children.map(m=>m.geometry),material=scene.children.map(m=>m.material);
  const crowded=Array.from({length:500},(_,i)=>({id:String(i),kind:kinds[i%3],x:i/100,y:2,z:0,bornAt:0}));
  for(let i=0;i<200;i++)models.update(crowded,i/60);
  assert.equal(models.info().peak,PROJECTILE_MODEL_LIMIT);assert.equal(scene.children.length,9);
  assert.equal(scene.children.filter(m=>m.name.endsWith(':0')).reduce((sum,m)=>sum+m.count,0),PROJECTILE_MODEL_LIMIT);
  assert.deepEqual(scene.children.map(m=>m.geometry),geometry);assert.deepEqual(scene.children.map(m=>m.material),material);
  assert.ok(scene.children.every(m=>m.instanceMatrix.array.every(Number.isFinite)));
  models.dispose();models.dispose();assert.equal(scene.children.length,0);
});

test('projectile models: missing assets keep a typed non-spherical fallback and expose the error',async t=>{
  const old=globalThis.fetch;globalThis.fetch=async()=>new Response('Missing',{status:404});t.after(()=>{globalThis.fetch=old;});
  const scene=new THREE.Scene(),models=createProjectileModels(THREE,scene);await models.ready;
  for(const model of models.info().models){assert.equal(model.source,'procedural-grenade-fallback');assert.match(model.error,/404/);}
  assert.ok(scene.children.every(m=>m.geometry.type!=='SphereGeometry'&&m.material.color.getHex()!==0xffffff));
  models.update([{kind:'constructor',x:0,y:0,z:0},{kind:'hegrenade',x:NaN,y:0,z:0}],1);
  assert.ok(scene.children.every(m=>!m.visible));models.dispose();
});

test('projectile models: disposal during delayed loading releases late textures without reinstalling meshes', {skip:!hasAssets},async t=>{
  const old=globalThis.fetch;globalThis.fetch=localFetch;t.after(()=>{globalThis.fetch=old;});
  let unblock;const gate=new Promise(resolve=>{unblock=resolve;}),textures=[];
  class DelayedTextures extends LocalTextures{async loadAsync(url){await gate;const texture=await super.loadAsync(url);texture.userData.disposals=0;texture.addEventListener('dispose',()=>texture.userData.disposals++);textures.push(texture);return texture;}}
  const scene=new THREE.Scene();let changes=0;
  const models=createProjectileModels({...THREE,TextureLoader:DelayedTextures},scene,{onChange:()=>changes++});
  models.dispose();unblock();await models.ready;
  assert.equal(scene.children.length,0);assert.equal(changes,0);assert.equal(textures.length,9);
  assert.ok(textures.every(t=>t.userData.disposals===1));
});
