import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {createCS2ResourceLoader} from '../public/cs2-resource-loader.js';

const url=id=>`/assets/cs2-optimized/${id}.bin.gz`;
const observe=promise=>promise.then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason}));
const turn=()=>new Promise(setImmediate);

class FakeWorker{
  posts=[];listeners=new Map();inflight=new Map();terminated=0;peakCount=0;peakBytes=0;
  constructor(onPost){this.onPost=onPost;}
  addEventListener(type,listener){const values=this.listeners.get(type)||new Set();values.add(listener);this.listeners.set(type,values);}
  removeEventListener(type,listener){this.listeners.get(type)?.delete(listener);}
  emit(type,data){const event=type==='message'?{data}:data;this['on'+type]?.(event);for(const listener of this.listeners.get(type)||[])listener(event);}
  postMessage(message,transfer){
    this.posts.push({message,transfer});
    if(message.type==='inflate-resource'){
      this.inflight.set(message.id,message);
      this.peakCount=Math.max(this.peakCount,this.inflight.size);
      this.peakBytes=Math.max(this.peakBytes,[...this.inflight.values()].reduce((s,m)=>s+m.bytes,0));
    }
    this.onPost?.(message,this);
  }
  get jobs(){return this.posts.filter(p=>p.message.type==='inflate-resource').map(p=>p.message);}
  success(id=this.inflight.keys().next().value,buffer){
    const request=this.inflight.get(id);assert(request,'Expected an actual inflight job');this.inflight.delete(id);
    buffer??=Uint8Array.from({length:request.bytes},(_,i)=>i%251).buffer;
    const delivered=structuredClone({type:'inflated-resource',id,buffer,workerReadWallMs:.75},{transfer:[buffer]});
    this.emit('message',delivered);return delivered.buffer;
  }
  failure(id=this.inflight.keys().next().value,{name='Error',message='gzip bytes rejected'}={}){
    assert(this.inflight.has(id));this.inflight.delete(id);this.emit('message',{type:'resource-error',id,name,message});
  }
  terminate(){this.terminated++;this.inflight.clear();}
}

function fixture(t,options={},onPost){
  const workers=[],mainFetches=[];t.mock.method(globalThis,'fetch',async(...args)=>{mainFetches.push(args);throw Error('Main-thread fetch is forbidden in this test');});
  const loader=createCS2ResourceLoader({...options,workerFactory:()=>{const worker=new FakeWorker(onPost);workers.push(worker);return worker;}});
  t.after(()=>loader.dispose());return{loader,workers,mainFetches,get worker(){return workers[0];}};
}

test('resource loader uses one module worker and returns exact transferred bytes without main fetch',async t=>{
  const workers=[],mainFetches=[],old=Object.getOwnPropertyDescriptor(globalThis,'Worker');
  class Worker extends FakeWorker{constructor(workerURL,options){super();this.url=workerURL;this.options=options;workers.push(this);}}
  Object.defineProperty(globalThis,'Worker',{value:Worker,configurable:true,writable:true});
  t.after(()=>{if(old)Object.defineProperty(globalThis,'Worker',old);else delete globalThis.Worker;});
  t.mock.method(globalThis,'fetch',async(...args)=>{mainFetches.push(args);throw Error('No main-thread fetch');});
  const loader=createCS2ResourceLoader({concurrency:2});t.after(()=>loader.dispose());
  const first=loader.load(url('one'),17),second=loader.load(url('two'),9);
  assert.equal(workers.length,1);const worker=workers[0];
  assert.equal(worker.options.type,'module');assert.equal(worker.options.name,'cs2-map-resources');assert.match(String(worker.url),/cs2-resource-worker\.js$/);
  assert.equal(worker.jobs.length,2);const [a,b]=worker.jobs;
  assert.deepEqual(Object.keys(a).sort(),['bytes','id','type','url']);assert.equal(a.url,url('one'));assert.equal(a.bytes,17);
  worker.success(b.id);worker.success(a.id);
  assert.deepEqual(new Uint8Array(await first),Uint8Array.from({length:17},(_,i)=>i));
  assert.deepEqual(new Uint8Array(await second),Uint8Array.from({length:9},(_,i)=>i));
  assert.equal(mainFetches.length,0);loader.dispose();assert.equal(worker.terminated,1);
});

test('capacity and concurrent jobs remain bounded while out-of-order replies settle the correct promises',async t=>{
  const f=fixture(t,{capacity:4,concurrency:2}),promises=[11,12,13,14].map((bytes,i)=>observe(f.loader.load(url('queue-'+i),bytes)));
  const excess=await observe(f.loader.load(url('excess'),1));assert.equal(excess.status,'rejected');assert.equal(f.worker.jobs.length,2);
  const [a,b]=f.worker.jobs;f.worker.success(b.id);assert.equal(f.worker.jobs.length,3);const c=f.worker.jobs[2];f.worker.success(a.id);assert.equal(f.worker.jobs.length,4);
  const d=f.worker.jobs[3];f.worker.success(d.id);f.worker.success(c.id);
  const results=await Promise.all(promises);assert.deepEqual(results.map(r=>r.value.byteLength),[11,12,13,14]);assert.equal(f.workers.length,1);assert.equal(f.worker.peakCount,2);assert.equal(f.mainFetches.length,0);
});

test('active byte reservations gate work independently of available concurrent slots',async t=>{
  const f=fixture(t,{capacity:4,concurrency:3,maxActiveBytes:10}),promises=[6,6,4].map((bytes,i)=>observe(f.loader.load(url('budget-'+i),bytes)));
  assert(f.worker.peakBytes<=10);assert(f.worker.peakCount<=3);
  while(f.worker.inflight.size)f.worker.success(f.worker.inflight.keys().next().value);
  const results=await Promise.all(promises);assert(results.every(r=>r.status==='fulfilled'));assert(f.worker.peakBytes<=10);assert.equal(f.worker.jobs.length,3);
});

test('queued cancellation never posts work and removes its listener',async t=>{
  const f=fixture(t,{capacity:3,concurrency:1}),signal=new AbortController(),first=observe(f.loader.load(url('active'),8)),cancelled=observe(f.loader.load(url('queued-cancel'),8,{signal:signal.signal})),third=observe(f.loader.load(url('after-cancel'),8));
  signal.abort();const result=await cancelled;assert.equal(result.status,'rejected');assert.equal(result.reason.name,'AbortError');assert.equal(getEventListeners(signal.signal,'abort').length,0);
  f.worker.success();assert.equal(f.worker.jobs.length,2);assert.equal(f.worker.jobs[1].url,url('after-cancel'));f.worker.success();assert.equal((await first).status,'fulfilled');assert.equal((await third).status,'fulfilled');
});

test('active cancellation rejects immediately but retains physical slots until cancellation acknowledgement',async t=>{
  const f=fixture(t,{capacity:3,concurrency:1,maxActiveBytes:8}),controller=new AbortController(),cancelled=observe(f.loader.load(url('cancel-active'),8,{signal:controller.signal})),next=observe(f.loader.load(url('next'),8));
  const id=f.worker.jobs[0].id;controller.abort();assert.equal((await cancelled).reason.name,'AbortError');assert.equal(f.worker.jobs.length,1,'A cancelled but unacknowledged fetch still occupies its physical slot');
  assert(f.worker.posts.some(p=>p.message.type==='cancel-resource'&&p.message.id===id));
  f.worker.failure(id,{name:'AbortError',message:'Worker cancellation acknowledged'});assert.equal(f.worker.jobs.length,2);f.worker.success();assert.equal((await next).status,'fulfilled');assert.equal(getEventListeners(controller.signal,'abort').length,0);
});

test('late success of an aborted active job releases its reservation without fulfilling it or another job',async t=>{
  const f=fixture(t,{capacity:3,concurrency:1}),controller=new AbortController(),cancelled=observe(f.loader.load(url('late'),7,{signal:controller.signal})),next=observe(f.loader.load(url('waiting'),9));
  const id=f.worker.jobs[0].id;controller.abort();assert.equal((await cancelled).status,'rejected');f.worker.success(id);assert.equal(f.worker.jobs.length,2);const nextId=f.worker.jobs[1].id;
  f.worker.emit('message',{type:'inflated-resource',id,buffer:new ArrayBuffer(7),workerReadWallMs:1});assert(f.worker.inflight.has(nextId));f.worker.success(nextId);assert.equal((await next).value.byteLength,9);
});

test('one corrupt gzip job rejects independently while queued work continues in the same worker',async t=>{
  const f=fixture(t,{capacity:3,concurrency:1}),bad=observe(f.loader.load(url('bad'),13)),good=observe(f.loader.load(url('good'),14));
  f.worker.failure(undefined,{message:'Invalid gzip payload'});const error=await bad;assert.equal(error.status,'rejected');assert.match(error.reason.message,/gzip/);assert.equal(f.worker.terminated,0);assert.equal(f.worker.jobs.length,2);f.worker.success();assert.equal((await good).status,'fulfilled');assert.equal(f.mainFetches.length,0);
});

test('transport failures and invalid success payloads close the lane and reject all pending jobs without retry',async t=>{
  for(const kind of ['error','messageerror','invalid'])await t.test(kind,async t=>{
    const f=fixture(t,{capacity:3,concurrency:1}),a=observe(f.loader.load(url(kind+'-active'),8)),b=observe(f.loader.load(url(kind+'-queued'),8));
    if(kind==='error')f.worker.emit('error',{message:'worker lane failed',preventDefault(){}});
    else if(kind==='messageerror')f.worker.emit('messageerror',{});
    else f.worker.emit('message',{type:'inflated-resource',id:f.worker.jobs[0].id,buffer:new ArrayBuffer(7),workerReadWallMs:0});
    assert.equal((await a).status,'rejected');assert.equal((await b).status,'rejected');assert.equal(f.worker.terminated,1);
    assert.equal((await observe(f.loader.load(url('no-retry'),8))).status,'rejected');assert.equal(f.workers.length,1);assert.equal(f.mainFetches.length,0);
  });
});

test('post failure and worker construction failure never retry fetch or inflation on the main thread',async t=>{
  const f=fixture(t,{},message=>{if(message.type==='inflate-resource')throw Error('post failed');});
  assert.equal((await observe(f.loader.load(url('post-failed'),8))).status,'rejected');assert.equal(f.worker.terminated,1);assert.equal(f.mainFetches.length,0);
  let constructed=0;const loader=createCS2ResourceLoader({workerFactory:()=>{constructed++;throw Error('Worker unavailable');}});t.after(()=>loader.dispose());
  assert.equal((await observe(loader.load(url('construct-failed'),8))).status,'rejected');assert.equal(constructed,1);assert.equal(f.mainFetches.length,0);
});

test('a timed-out active fetch closes all queued work and never returns late bytes',async t=>{
  const f=fixture(t,{capacity:3,concurrency:1,timeoutMs:10}),a=observe(f.loader.load(url('timeout'),8)),b=observe(f.loader.load(url('timeout-queued'),8));
  const results=await Promise.all([a,b]);assert(results.every(r=>r.status==='rejected'));assert.equal(f.worker.terminated,1);assert.equal(f.worker.jobs.length,1);assert.equal(f.mainFetches.length,0);
});

test('global abort and repeated disposal terminate once and clean active and queued listeners',async t=>{
  const controller=new AbortController(),job=new AbortController(),f=fixture(t,{signal:controller.signal,concurrency:1}),a=observe(f.loader.load(url('global-active'),8,{signal:job.signal})),b=observe(f.loader.load(url('global-queued'),8));
  controller.abort();assert.equal((await a).status,'rejected');assert.equal((await b).status,'rejected');f.loader.dispose();f.loader.dispose();
  assert.equal(f.worker.terminated,1);assert.equal(getEventListeners(controller.signal,'abort').length,0);assert.equal(getEventListeners(job.signal,'abort').length,0);assert.equal(f.mainFetches.length,0);
});

test('a lifetime abort during worker construction terminates the returned worker without posting work',async t=>{
  const controller=new AbortController(),worker=new FakeWorker();
  const loader=createCS2ResourceLoader({signal:controller.signal,workerFactory:()=>{controller.abort();return worker;}});t.after(()=>loader.dispose());
  const result=await observe(loader.load(url('construction-abort'),8));assert.equal(result.status,'rejected');assert.equal(result.reason.name,'AbortError');
  assert.equal(worker.terminated,1);assert.equal(worker.jobs.length,0);assert.equal(getEventListeners(controller.signal,'abort').length,0);
});

test('the declared active budget supports resources larger than256MiB without allocating fixture payloads',async t=>{
  const MiB=1024*1024,f=fixture(t,{concurrency:2}),first=observe(f.loader.load(url('large'),300*MiB)),second=observe(f.loader.load(url('large-queued'),220*MiB));
  assert.equal(f.worker.jobs.length,1);assert.equal(f.worker.jobs[0].bytes,300*MiB);assert.equal(f.loader.diagnostics().activeBytes,300*MiB);
  assert.equal(f.loader.diagnostics().queued,1);f.loader.dispose();assert.equal((await first).status,'rejected');assert.equal((await second).status,'rejected');
  assert.equal(f.loader.diagnostics().activeBytes,0);
});

test('invalid requests and already-aborted jobs perform no worker work',async t=>{
  const f=fixture(t),aborted=new AbortController();aborted.abort();
  for(const [value,bytes]of [['/assets/cs2-physics/physics.json.gz',1],['https://other.test/assets/cs2-optimized/x.gz',1],[url('../escape'),1],[url('query')+'?x=1',1],[url('hash')+'#x',1],[url('zero'),0],[url('float'),1.5],[url('huge'),513*1024*1024]])assert.equal((await observe(f.loader.load(value,bytes))).status,'rejected',String(value));
  assert.equal((await observe(f.loader.load(url('aborted'),1,{signal:aborted.signal}))).reason.name,'AbortError');assert.equal(f.workers.flatMap(w=>w.jobs).length,0);assert.equal(f.mainFetches.length,0);await turn();
});
