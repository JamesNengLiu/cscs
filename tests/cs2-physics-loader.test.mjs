import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getEventListeners} from 'node:events';
import {gzipSync} from 'node:zlib';
import {loadPhysicsPackage} from '../public/cs2-physics-loader.js';

const data={schema:'cs2-physics-v1',shapes:[]},encoded=Buffer.from(JSON.stringify(data)),compressed=gzipSync(encoded);
const digest=createHash('sha256').update(encoded).digest('hex');
const manifest={schema:'cs2-physics-package-v1',file:'physics.json.gz',bytes:encoded.length,downloadBytes:compressed.length,sha256:digest};
const abort=promise=>assert.rejects(promise,error=>error?.name==='AbortError');

function fixture(t,{controller=new AbortController(),onManifest,onPayload,onConstruct,onPost}={}){
 const calls=[],workers=[],previousWorker=Object.getOwnPropertyDescriptor(globalThis,'Worker');
 class Worker{
  constructor(){this.terminated=0;this.posts=0;workers.push(this);onConstruct?.(this);}
  postMessage(message,transfer){this.posts++;this.message=message;this.transfer=transfer;this.savedMessage=this.onmessage;if(onPost)onPost(this);else queueMicrotask(()=>this.onmessage?.({data:{data,parseMs:.5}}));}
  terminate(){this.terminated++;}
 }
 Object.defineProperty(globalThis,'Worker',{configurable:true,writable:true,value:Worker});
 t.after(()=>{if(previousWorker)Object.defineProperty(globalThis,'Worker',previousWorker);else delete globalThis.Worker;});
 t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,signal:options?.signal});if(url.endsWith('manifest.json'))return{ok:true,json:async()=>{onManifest?.();return manifest;}};if(onPayload)return onPayload();return new Response(compressed);});
 return{controller,calls,workers,load:options=>loadPhysicsPackage({signal:controller.signal,...options})};
}

test('physics loader success keeps verified SHA/data and closes worker, timeout and abort listener',async t=>{
 const f=fixture(t),load={},result=await f.load({load});assert.deepEqual(result.manifest,manifest);assert.equal(result.verifiedPhysicsSHA256,digest);assert.equal(result.data,data);assert.equal(load.physicsDecodedBytes,encoded.length);assert.equal(load.physicsWorkerParseMs,.5);
 assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c.signal===f.controller.signal));assert.equal(f.workers[0].terminated,1);assert.equal(f.workers[0].onmessage,null);assert.equal(f.workers[0].onerror,null);assert.equal(getEventListeners(f.controller.signal,'abort').length,0);
});
test('an already aborted load performs no fetch and creates no worker',async t=>{
 const f=fixture(t);f.controller.abort();await abort(f.load());assert.equal(f.calls.length,0);assert.equal(f.workers.length,0);
});
test('abort after manifest parsing prevents payload download and worker construction',async t=>{
 const controller=new AbortController(),f=fixture(t,{controller,onManifest:()=>controller.abort()});await abort(f.load());assert.equal(f.calls.length,1);assert.equal(f.workers.length,0);
});
test('abort during gzip streaming cancels the source and never starts a parser',async t=>{
 let cancelled=false;const body=new ReadableStream({start(c){c.enqueue(compressed.subarray(0,2));},cancel(){cancelled=true;}}),f=fixture(t,{onPayload:()=>new Response(body)});
 const pending=f.load();const rejected=abort(pending);await new Promise(setImmediate);f.controller.abort();await rejected;assert.equal(cancelled,true);assert.equal(f.workers.length,0);
});
test('abort after the asynchronous digest is rechecked before creating a worker',async t=>{
 const f=fixture(t),original=crypto.subtle.digest.bind(crypto.subtle);t.mock.method(crypto.subtle,'digest',async(...args)=>{const hash=await original(...args);f.controller.abort();return hash;});await abort(f.load());assert.equal(f.workers.length,0);
});
test('worker parsing cancellation terminates immediately and ignores late completion',async t=>{
 let posted;const started=new Promise(resolve=>posted=resolve),f=fixture(t,{onPost:posted}),load={};const pending=f.load({load}),rejected=abort(pending);await started;const worker=f.workers[0];f.controller.abort();await rejected;
 assert.equal(worker.terminated,1);assert.equal(worker.onmessage,null);assert.equal(worker.onerror,null);assert.equal(worker.onmessageerror,null);assert.equal(getEventListeners(f.controller.signal,'abort').length,0);worker.savedMessage({data:{data,parseMs:999}});assert.equal(load.physicsWorkerParseMs,undefined);assert.equal(worker.terminated,1);
});
test('abort at worker construction cannot enqueue work after the abort boundary',async t=>{
 const controller=new AbortController(),f=fixture(t,{controller,onConstruct:()=>controller.abort()});await abort(f.load());assert.equal(f.workers.length,1);assert.equal(f.workers[0].posts,0);assert.equal(f.workers[0].terminated,1);assert.equal(getEventListeners(controller.signal,'abort').length,0);
});
test('worker completion followed by immediate cancellation cannot report a ready package',async t=>{
 const controller=new AbortController(),f=fixture(t,{controller,onPost:worker=>{worker.onmessage({data:{data,parseMs:.5}});controller.abort();}});await abort(f.load());assert.equal(f.workers[0].terminated,1);
});
test('timeout closes the parser and removes its cancellation listener',async t=>{
 const original=setTimeout;let timer;const f=fixture(t,{onPost:()=>{}});t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>{const value=original(fn,ms===45000?1:ms,...args);if(ms===45000)timer=value;return value;});await assert.rejects(f.load(),/碰撞解析超时/);assert.equal(f.workers[0].terminated,1);assert.equal(f.workers[0].onmessage,null);assert.equal(getEventListeners(f.controller.signal,'abort').length,0);assert.ok(timer);
});
test('worker transport failures clean all resources without waiting for the timeout',async t=>{
 for(const type of ['error','messageerror','post']){
  await t.test(type,async t=>{const f=fixture(t,{onPost:worker=>{if(type==='post')throw Error('post failed');queueMicrotask(()=>type==='error'?worker.onerror({message:'worker failed',preventDefault(){}}):worker.onmessageerror());}});await assert.rejects(f.load(),/failed|消息解析失败/);assert.equal(f.workers[0].terminated,1);assert.equal(getEventListeners(f.controller.signal,'abort').length,0);});
 }
});
