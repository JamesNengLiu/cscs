import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {gzipSync} from 'node:zlib';
import {createHash,randomBytes} from 'node:crypto';
import {createCS2ResourceLoader} from '../public/cs2-resource-loader.js';
import {fetchInflatedResource,validateResourceRequest,MAX_CS2_RESOURCE_BYTES} from '../public/cs2-resource-format.js';

const asset=id=>`/assets/cs2-optimized/fixture-${id}.bin.gz`;
const encoded=(raw,extra={})=>({gzip:gzipSync(raw).toString('base64'),...extra});
const observe=p=>p.then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason}));
const sha=b=>createHash('sha256').update(b).digest('hex');
async function until(predicate){const end=performance.now()+3000;while(!predicate()){if(performance.now()>end)throw Error('Resource worker fixture timed out');await new Promise(r=>setTimeout(r,2));}}

class BrowserWorker{
  listeners=new Map();notices=[];messages=[];terminated=0;
  constructor(resources,options={}){this.node=new NodeWorker(new URL('./fixtures/cs2-resource-node-worker.mjs',import.meta.url),{workerData:{resources,...options}});
    this.node.on('message',data=>{if(data?.__cs2ResourceFixture){this.notices.push(data);return;}this.messages.push(data);for(const listener of this.listeners.get('message')||[])listener({data});});
    this.node.on('error',error=>{for(const listener of this.listeners.get('error')||[])listener({message:error.message,preventDefault(){}});});
    this.node.on('messageerror',error=>{for(const listener of this.listeners.get('messageerror')||[])listener(error);});
  }
  addEventListener(type,listener){const values=this.listeners.get(type)||new Set();values.add(listener);this.listeners.set(type,values);}
  postMessage(message,transfer){this.node.postMessage(message,transfer);}
  terminate(){this.terminated++;return this.node.terminate();}
}

function fixture(t,resources,options={}){
  const workers=[],mainFetches=[];t.mock.method(globalThis,'fetch',async(...args)=>{mainFetches.push(args);throw Error('Resource payload must be fetched in the worker');});
  const loader=createCS2ResourceLoader({...options,workerFactory:()=>{const w=new BrowserWorker(resources);workers.push(w);return w;}});
  t.after(async()=>{loader.dispose();await Promise.all(workers.map(w=>w.node.terminate()));});
  return {loader,workers,mainFetches,get worker(){return workers[0];}};
}

test('actual resource worker fetches and inflates binary gzip chunks and transfers detached output buffers',async t=>{
  const raw=randomBytes(32771),text=Buffer.from('原始贴图\u0000🙂 '.repeat(701)),f=fixture(t,{[asset('binary')]:encoded(raw,{chunkBytes:97}),[asset('text')]:encoded(text,{chunkBytes:3})},{concurrency:2});
  const results=await Promise.all([f.loader.load(asset('binary'),raw.length),f.loader.load(asset('text'),text.length)]);
  assert.equal(sha(new Uint8Array(results[0])),sha(raw));assert.deepEqual(Buffer.from(results[1]),text);assert.equal(f.mainFetches.length,0);assert.equal(f.workers.length,1);
  await until(()=>f.worker.notices.filter(n=>n.kind==='transfer').length===2);
  const fetches=f.worker.notices.filter(n=>n.kind==='fetch'),transfers=f.worker.notices.filter(n=>n.kind==='transfer');
  assert.equal(fetches.length,2);assert(fetches.every(n=>n.isMainThread===false&&n.hasSignal));
  assert.deepEqual(transfers.map(n=>n.before[0]).sort((a,b)=>a-b),[raw.length,text.length].sort((a,b)=>a-b));assert(transfers.every(n=>n.count===1&&n.after[0]===0));
  assert.equal(f.loader.diagnostics().mainThreadInflateJobs,0);assert.equal(f.loader.diagnostics().transferredBytes,raw.length+text.length);
});

test('shared lightmap gzip paths are canonicalized by callers and decoded by the actual worker',async t=>{
  const spec={file:'../cs2-textured/textures/fixture-lightmap.bin.gz'},canonical=new URL('/assets/cs2-optimized/'+spec.file,'https://fixture.test/').pathname;
  assert.equal(canonical,'/assets/cs2-textured/textures/fixture-lightmap.bin.gz');
  const raw=randomBytes(2057),f=fixture(t,{[canonical]:encoded(raw,{chunkBytes:7})});
  await assert.rejects(f.loader.load('/assets/cs2-optimized/'+spec.file,raw.length),/path/i);
  assert.equal(f.workers.length,0,'The loader still rejects direct traversal syntax');
  const bytes=await f.loader.load(canonical,raw.length);assert.deepEqual(Buffer.from(bytes),raw);assert.equal(f.mainFetches.length,0);
  assert(f.worker.notices.some(n=>n.kind==='fetch'&&n.url===canonical&&n.isMainThread===false));
});

test('short, oversized, corrupt and failed-download jobs reject independently without a main-thread retry',async t=>{
  const raw=Buffer.from('fixture bytes\u0000\uffff'.repeat(101)),f=fixture(t,{[asset('short')]:encoded(raw),[asset('long')]:encoded(raw),[asset('corrupt')]:{gzip:Buffer.from('not a gzip stream').toString('base64')},[asset('missing')]:{status:404},[asset('good')]:encoded(raw)},{concurrency:2});
  const jobs=[observe(f.loader.load(asset('short'),raw.length+1)),observe(f.loader.load(asset('long'),raw.length-1)),observe(f.loader.load(asset('corrupt'),raw.length)),observe(f.loader.load(asset('missing'),raw.length)),observe(f.loader.load(asset('good'),raw.length))];
  const results=await Promise.all(jobs);assert(results.slice(0,4).every(r=>r.status==='rejected'));assert.equal(results[4].status,'fulfilled');assert.deepEqual(Buffer.from(results[4].value),raw);
  assert.equal(f.worker.terminated,0);assert.equal(f.workers.length,1);assert.equal(f.mainFetches.length,0);
  assert.deepEqual(Buffer.from(await f.loader.load(asset('good'),raw.length)),raw);assert.equal(f.workers.length,1);
});

test('real worker acknowledges cancellation and permits the next byte-budgeted job without fallback',async t=>{
  const raw=Buffer.from('verified after cancellation'),f=fixture(t,{[asset('stall')]:{mode:'fetch-stall'},[asset('after')]:encoded(raw)},{concurrency:1,maxActiveBytes:64}),controller=new AbortController();
  const cancelled=observe(f.loader.load(asset('stall'),64,{signal:controller.signal})),next=observe(f.loader.load(asset('after'),raw.length));
  await until(()=>f.worker.notices.some(n=>n.kind==='fetch'&&n.url===asset('stall')));controller.abort();assert.equal((await cancelled).reason.name,'AbortError');
  const result=await next;assert.equal(result.status,'fulfilled');assert.deepEqual(Buffer.from(result.value),raw);assert(f.worker.notices.some(n=>n.kind==='aborted'&&n.url===asset('stall')));assert.equal(f.worker.terminated,0);assert.equal(f.mainFetches.length,0);
});

test('worker aborts fetch lifetime on failed HTTP status and decoder construction failure',async t=>{
  for(const failure of ['http','decoder'])await t.test(failure,async t=>{
    const path=asset('unconsumed-'+failure),worker=new BrowserWorker({[path]:failure==='http'?{status:404}:encoded(Buffer.from([0,1,2]))},{throwDecompressionConstructor:failure==='decoder'});
    t.after(()=>worker.node.terminate());worker.postMessage({type:'inflate-resource',id:1,url:path,bytes:3});
    await until(()=>worker.messages.some(m=>m.id===1));assert.equal(worker.messages.find(m=>m.id===1).type,'resource-error');
    await until(()=>worker.notices.some(n=>n.kind==='fetch-signal-aborted'&&n.url===path));
    assert(!worker.notices.some(n=>n.kind==='transfer'));
  });
});

test('worker independently bounds total reserved bytes and eight concurrent fetches',async t=>{
  const MiB=1024*1024,resources={[asset('large-stall')]:{mode:'fetch-stall'},[asset('over-budget')]:{mode:'fetch-stall'},[asset('recovery')]:encoded(Buffer.from([0,17,254,255]))};
  for(let i=0;i<9;i++)resources[asset('parallel-'+i)]={mode:'fetch-stall'};
  const worker=new BrowserWorker(resources);t.after(()=>worker.node.terminate());
  worker.postMessage({type:'inflate-resource',id:1,url:asset('large-stall'),bytes:300*MiB});
  await until(()=>worker.notices.some(n=>n.kind==='fetch'&&n.url===asset('large-stall')));
  worker.postMessage({type:'inflate-resource',id:2,url:asset('over-budget'),bytes:220*MiB});await until(()=>worker.messages.some(m=>m.id===2));
  assert.equal(worker.messages.find(m=>m.id===2).type,'resource-error');assert(!worker.notices.some(n=>n.url===asset('over-budget')));
  worker.postMessage({type:'cancel-resource',id:1});await until(()=>worker.messages.some(m=>m.id===1&&m.name==='AbortError'));
  worker.postMessage({type:'inflate-resource',id:3,url:asset('recovery'),bytes:4});await until(()=>worker.messages.some(m=>m.id===3));assert.deepEqual(Buffer.from(worker.messages.find(m=>m.id===3).buffer),Buffer.from([0,17,254,255]));
  for(let i=0;i<9;i++)worker.postMessage({type:'inflate-resource',id:10+i,url:asset('parallel-'+i),bytes:1});
  await until(()=>worker.messages.some(m=>m.id===18));assert.equal(worker.messages.find(m=>m.id===18).type,'resource-error');assert.equal(worker.notices.filter(n=>n.kind==='fetch'&&n.url.includes('parallel-')).length,8);
  for(let i=0;i<8;i++)worker.postMessage({type:'cancel-resource',id:10+i});await until(()=>worker.messages.filter(m=>m.id>=10&&m.name==='AbortError').length===8);
});

test('shared worker format rejects malformed requests before fetch and propagates streaming abort',async()=>{
  assert.equal(MAX_CS2_RESOURCE_BYTES,512*1024*1024);assert.doesNotThrow(()=>validateResourceRequest(asset('large-valid'),300*1024*1024));
  let fetches=0;for(const [url,bytes]of [['/assets/cs2-optimized/../escape.gz',1],[asset('query')+'?x=1',1],['https://other.test/assets/cs2-optimized/file.gz',1],[asset('zero'),0],[asset('large'),MAX_CS2_RESOURCE_BYTES+1]])await assert.rejects(fetchInflatedResource({url,bytes},{fetchResource:()=>{fetches++;throw Error('Validation ran too late');}}));assert.equal(fetches,0);
  const already=new AbortController();already.abort();await assert.rejects(fetchInflatedResource({url:asset('already'),bytes:8},{signal:already.signal,fetchResource:()=>{fetches++;}}),e=>e.name==='AbortError');assert.equal(fetches,0);
  const controller=new AbortController();let cancelled=false,started;const seen=new Promise(resolve=>started=resolve),body=new ReadableStream({start(c){c.enqueue(Uint8Array.from([31,139]));},cancel(){cancelled=true;}});
  const pending=fetchInflatedResource({url:asset('stream-abort'),bytes:8},{signal:controller.signal,fetchResource:async(_url,options)=>{assert.equal(options.signal,controller.signal);started();return new Response(body);}}),rejected=assert.rejects(pending,e=>e.name==='AbortError');await seen;controller.abort();await rejected;assert.equal(cancelled,true);
});
