import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {createWeaponView} from '../public/weapon-model.js';
const root=new URL('../public/',import.meta.url);
const fetchLocal=async url=>{try{return new Response(await readFile(new URL(url.slice(1),root)));}catch{return new Response('missing',{status:404});}};
class LocalTextures{async loadAsync(url){const png=await readFile(new URL(url.slice(1),root)),t=new THREE.Texture();t.image={width:png.readUInt32BE(16),height:png.readUInt32BE(20)};return t;}}
const three={...THREE,TextureLoader:LocalTextures};
const meshes=view=>view.group.children.filter(o=>o.name.startsWith('original-mdl:')||o.name.startsWith('procedural-fallback:')).map(o=>o.name);
const setup=async(t,options={})=>{const old=globalThis.fetch;globalThis.fetch=options.fetch||fetchLocal;t.after(()=>globalThis.fetch=old);const v=await createWeaponView(options.three||three,new THREE.PerspectiveCamera(),{skinning:'cpu'});t.after(()=>v.dispose());return v;};

test('warm grenade switches install the exact requested model synchronously, before the next render',async t=>{
 const v=await setup(t);for(const id of ['hegrenade','flashbang','smokegrenade'])await v.setWeapon(id);
 for(let round=0;round<5;round++)for(const id of ['hegrenade','flashbang','smokegrenade']){
  const done=v.setWeapon(id);assert.equal(v.info().id,id);assert.equal(v.info().loading,false);assert.equal(v.info().source,'original-mdl');assert.equal(v.info().convertedSHA256Verified,true);assert.deepEqual(meshes(v),['original-mdl:'+id]);await done;
 }
});
test('cold grenade loading has no diagnostic mesh or previous weapon while resources are pending',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),seen=new Promise(r=>entered=r);t.after(()=>release());
 const v=await setup(t,{fetch:async url=>{if(url.endsWith('/hegrenade/model.json')){entered();await gate;}return fetchLocal(url);}});
 const done=v.setWeapon('hegrenade');await seen;assert.equal(v.info().loading,true);assert.equal(v.info().error,null);assert.equal(v.info().source,'loading-original-mdl');assert.deepEqual(meshes(v),[]);release();await done;
 assert.deepEqual(meshes(v),['original-mdl:hegrenade']);assert.equal(v.info().loading,false);
});
test('LRU eviction keeps both ready and pending model ownership bounded to four slots',async t=>{
 const v=await setup(t);let disposed=0;
 await v.setWeapon('hegrenade');const original=v.group.getObjectByName('original-mdl:hegrenade');original.traverse(o=>{if(o.isMesh)o.geometry.addEventListener('dispose',()=>disposed++);});
 for(const id of ['flashbang','smokegrenade','knife','ak47']){await v.setWeapon(id);assert.ok(v.info().cachedModels<=4);}
 assert.ok(disposed>0,'evicted original geometry must be released');const done=v.setWeapon('hegrenade');assert.equal(v.info().loading,true);assert.deepEqual(meshes(v),[]);await done;
 assert.equal(v.info().source,'original-mdl');assert.notEqual(v.group.getObjectByName('original-mdl:hegrenade'),original);
});
test('superseded grenade loads cannot replace the newest cached model',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),seen=new Promise(r=>entered=r);t.after(()=>release());
 const v=await setup(t,{fetch:async url=>{if(url.endsWith('/hegrenade/model.json')){entered();await gate;}return fetchLocal(url);}});
 await v.setWeapon('flashbang');const slow=v.setWeapon('hegrenade');await seen;const fast=v.setWeapon('flashbang');assert.deepEqual(meshes(v),['original-mdl:flashbang']);release();await Promise.all([slow,fast]);
 assert.equal(v.info().id,'flashbang');assert.equal(v.info().loading,false);assert.deepEqual(meshes(v),['original-mdl:flashbang']);
});
test('disposing a view during a pending grenade load cannot install or leak the completed model',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),seen=new Promise(r=>entered=r);t.after(()=>release());
 const v=await setup(t,{fetch:async url=>{if(url.endsWith('/smokegrenade/model.json')){entered();await gate;}return fetchLocal(url);}});
 const done=v.setWeapon('smokegrenade');await seen;v.dispose();release();await done;await Promise.resolve();assert.equal(v.info().disposed,true);assert.equal(v.info().cachedModels,0);assert.deepEqual(meshes(v),[]);assert.equal(v.group.parent,null);
});
test('real loading failures keep diagnostic errors and can recover on a later request',async t=>{
 let broken=true;const v=await setup(t,{fetch:async url=>broken&&url.endsWith('/flashbang/model.json')?new Response('missing',{status:404}):fetchLocal(url)});
 await v.setWeapon('flashbang');assert.equal(v.info().loading,false);assert.equal(v.info().source,'procedural-fallback');assert.match(v.info().error,/404/);
 broken=false;await v.setWeapon('hegrenade');await v.setWeapon('flashbang');assert.equal(v.info().source,'original-mdl');assert.equal(v.info().error,null);assert.equal(v.info().convertedSHA256Verified,true);
});

test('decoded-texture waits are also empty and never show the diagnostic mesh',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),seen=new Promise(r=>entered=r);t.after(()=>release());
 class Delayed extends LocalTextures{async loadAsync(url){if(url.includes('/hegrenade/')){entered();await gate;}return super.loadAsync(url);}}
 const v=await setup(t,{three:{...three,TextureLoader:Delayed}}),done=v.setWeapon('hegrenade');await seen;assert.equal(v.info().loading,true);assert.equal(v.info().error,null);assert.deepEqual(meshes(v),[]);release();await done;assert.equal(v.info().source,'original-mdl');
});
test('a failed evicted request cannot clear a newer ready model of the same kind',async t=>{
 let release,entered,attempts=0;const gate=new Promise(r=>release=r),seen=new Promise(r=>entered=r);t.after(()=>release());
 const v=await setup(t,{fetch:async url=>{if(url.endsWith('/hegrenade/model.json')&&++attempts===1){entered();await gate;return new Response('old failure',{status:404});}return fetchLocal(url);}});
 const stale=v.setWeapon('hegrenade');await seen;for(const id of ['flashbang','smokegrenade','knife','ak47'])await v.setWeapon(id);await v.setWeapon('hegrenade');const current=v.group.getObjectByName('original-mdl:hegrenade');release();await stale;
 assert.equal(v.info().error,null);await v.setWeapon('smokegrenade');const done=v.setWeapon('hegrenade');assert.equal(v.info().loading,false);assert.equal(v.group.getObjectByName('original-mdl:hegrenade'),current);await done;
});
test('ready-cache references do not double-dispose an evicted model',async t=>{
 const v=await setup(t);await v.setWeapon('hegrenade');const root=v.group.getObjectByName('original-mdl:hegrenade'),counts=[];
 root.traverse(o=>{if(o.isMesh){const c={n:0};counts.push(c);o.geometry.addEventListener('dispose',()=>c.n++);}});
 for(const id of ['flashbang','smokegrenade','knife','ak47','awp'])await v.setWeapon(id);v.dispose();await Promise.resolve();assert.ok(counts.length>0);assert.ok(counts.every(c=>c.n===1));
});
