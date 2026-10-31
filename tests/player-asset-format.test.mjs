import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import * as THREE from 'three';
import {playerAssetFixture,FIXTURE_PLAYER_SHA} from './fixtures/player-asset-model.mjs';import {packPlayerAsset,hydratePlayerAsset,playerTransferList,preparePlayerAsset} from '../public/player-asset-format.js';import {validatePlayerModel,fetchPlayerBytes} from '../public/player-asset-validation.js';import {createBonePose} from '../public/bone-pose.js';
const entry={source:'original-mdl',sourceSHA256:FIXTURE_PLAYER_SHA};const hydrate=p=>hydratePlayerAsset(p,{yieldTask:()=>Promise.resolve()});
test('compact assets transfer only bounded numerical buffers and preserve all geometry precision',async()=>{
 const raw=playerAssetFixture();validatePlayerModel(raw,'terror',entry,false);const packed=packPlayerAsset(raw),buffers=playerTransferList(packed);assert.equal(buffers.length,8);assert.equal(new Set(buffers).size,8);assert.ok(buffers.every(b=>b instanceof ArrayBuffer));assert.ok(!JSON.stringify(packed.header).includes('32768'));
 const {data}=await hydrate(packed);for(const key of ['positions','normals','uvPixels','vertexBones','normalBones','indices'])assert.deepEqual(Array.from(data.meshes[0][key]),raw.meshes[0][key]);assert.equal(data.meshes[0].positions[0],.123456789012345);assert.ok(data.meshes[0].positions instanceof Float64Array);assert.ok(Object.isFrozen(data));assert.ok(Object.isFrozen(data.sequences));assert.ok(Object.isFrozen(data.sequences[0].tracks));assert.ok(Object.isFrozen(data.sequences[0].tracks[0][0]));
 assert.equal(data.sequences[0].tracks,data.sequences[0].blendTracks[0],'identical legacy blend-0 storage is shared');assert.deepEqual(Array.from(data.sequences[0].tracks[0][0].values),[-32768,0,32767]);assert.deepEqual(Array.from(data.sequences[0].tracks[0][0].positionHold),[0]);
});
test('transferring prepared buffers detaches worker ownership without cloning huge number graphs',async()=>{
 const packed=packPlayerAsset(playerAssetFixture()),moved=structuredClone(packed,{transfer:playerTransferList(packed)});assert.equal(packed.values.byteLength,0);const {data}=await hydrate(moved);assert.equal(data.sequences[0].tracks[0][0].values[0],-32768);
});
test('packed and original tracks give identical bone matrices for time interpolation, hold and nine blends',async()=>{
 const raw=playerAssetFixture(),{data}=await hydrate(packPlayerAsset(raw)),a=createBonePose(THREE,raw),b=createBonePose(THREE,data);
 for(let s=0;s<raw.sequences.length;s++)for(const frame of [0,.5,1,1.75,2])for(const blendX of [0,.25,.5,1]){const p={blendX,blendY:.7,pitch:.2};a.pose(raw.sequences[s],frame,p);b.pose(data.sequences[s],frame,p);for(let i=0;i<a.matrices.length;i++)assert.deepEqual(a.matrices[i].elements,b.matrices[i].elements);}
});
test('compact decoding cooperatively yields and validates offsets before constructing views',async()=>{
 const packed=packPlayerAsset(playerAssetFixture());let yields=0;await hydratePlayerAsset(packed,{budgetMs:.00001,yieldTask:async()=>{yields++;}});assert.ok(yields>0);
 const cases=[p=>p.version=99,p=>p.entries[1]=p.values.length+1,p=>p.entries[0]=-1,p=>p.setStarts[1]=p.entries.length+1,p=>p.header.meshes[0].positions=p.geometry.length+1,p=>p.header.sequences[0].trackSet=9999];
 for(const mutate of cases){const p=packPlayerAsset(playerAssetFixture());mutate(p);await assert.rejects(hydrate(p),/Invalid|Wrong/);}
});
test('missing and unsupported blend data retains original fallback semantics',async()=>{
 const raw=playerAssetFixture();delete raw.sequences[0].blendTracks;const {data}=await hydrate(packPlayerAsset(raw));assert.equal(data.sequences[0].blendTracks,undefined);assert.equal(data.sequences[0].blendCount,9);const pose=createBonePose(THREE,data);pose.pose(data.sequences[0],1,{});assert.match(pose.blendInfo(),/blend 0 only/);
});
test('background preparation keeps raw-byte SHA checks, original shape budgets and path restrictions',async t=>{
 const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);let raw=playerAssetFixture(),text=JSON.stringify(raw),bytes=new TextEncoder().encode(text);const request=()=>({url:'/assets/players/terror/model.json',id:'terror',entry:{...entry,convertedSHA256:createHash('sha256').update(bytes).digest('hex')}});globalThis.fetch=async()=>new Response(bytes);
 const result=await preparePlayerAsset(request());assert.equal(result.verified,true);assert.equal(result.metrics.sourceBytes,bytes.length);assert.equal((await hydrate(result.packed)).data.metadata.source,'original-mdl');
 await assert.rejects(preparePlayerAsset({...request(),url:'https://invalid.example/model.json'}),/Unsafe/);
 await assert.rejects(preparePlayerAsset({...request(),entry:{...entry,convertedSHA256:'b'.repeat(64)}}),/SHA256 mismatch/);
 raw.bones=Array(129).fill(raw.bones[0]);bytes=new TextEncoder().encode(JSON.stringify(raw));await assert.rejects(preparePlayerAsset(request()),/bones/);
 globalThis.fetch=async()=>new Response('{}',{headers:{'content-length':'999999999'}});await assert.rejects(preparePlayerAsset(request()),/byte limit/);
});
test('stream limits and fatal UTF-8 remain enforced before parsing',async t=>{
 const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);let cancelled=false;globalThis.fetch=async()=>({ok:true,headers:new Headers(),body:new ReadableStream({start(c){c.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}})});await assert.rejects(fetchPlayerBytes('/test',4),/byte limit/);assert.equal(cancelled,true);
 globalThis.fetch=async()=>new Response(new Uint8Array([0xff]));await assert.rejects(preparePlayerAsset({url:'/assets/players/terror/model.json',id:'terror',entry}),/encoded|UTF|valid/i);
});

test('out-of-range or fractional animation samples are rejected before Int16 conversion',async t=>{
 const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);for(const bad of [32768,-32769,1.5]){const raw=playerAssetFixture();raw.sequences[0].blendTracks[0][0][0].values[0]=bad;const text=JSON.stringify(raw);globalThis.fetch=async()=>new Response(text);await assert.rejects(preparePlayerAsset({url:'/assets/players/terror/model.json',id:'terror',entry}),/Invalid animation sample/);}
});

test('small-asset fast path defers oversized streams before decode while keeping the original maximum',async t=>{
 const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);let cancelled=0;globalThis.fetch=async()=>({ok:true,headers:new Headers(),body:new ReadableStream({start(c){c.enqueue(new Uint8Array(8));},cancel(){cancelled++;}})});assert.equal((await fetchPlayerBytes('/test',100,undefined,{deferAbove:4})).deferred,true);assert.equal(cancelled,1);
 globalThis.fetch=async()=>new Response('{}',{headers:{'content-length':'1000'}});await assert.rejects(fetchPlayerBytes('/test',100,undefined,{deferAbove:4}),/byte limit/);
});

test('optional null metadata and absent movement descriptors retain their previous semantics',async()=>{
 const raw=playerAssetFixture();raw.metadata.sourceURL=null;raw.metadata.sourceAuthenticity=null;raw.sequences[0].linearMovement=null;raw.sequences[0].flags=null;validatePlayerModel(raw,'terror',entry,false);const {data}=await hydrate(packPlayerAsset(raw));assert.equal(data.metadata.sourceURL,null);assert.equal(data.sequences[0].flags,null);assert.equal(data.sequences[0].linearMovement,undefined);
});
