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

// Keep timeout/replacement races deterministic without sleeping through the
// loader's grace period. Track every reservation timer, including cancelled jobs.
function controlledTimers(t){
  let now=0,serial=0;const timers=new Map();
  t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{const id=++serial;timers.set(id,{at:now+delay,callback:()=>callback(...args)});return id;});
  t.mock.method(globalThis,'clearTimeout',id=>timers.delete(id));
  return{
    get pending(){return timers.size;},
    deadlines:()=>[...timers.values()].map(value=>value.at).sort((a,b)=>a-b),
    tick(ms){const end=now+ms;for(;;){const next=[...timers].filter(([,value])=>value.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next)break;const [id,value]=next;timers.delete(id);now=value.at;value.callback();}now=end;},
  };
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

const cancels=worker=>worker.posts.filter(p=>p.message.type==='cancel-resource').map(p=>p.message.id);

test('a stalled active fetch fails alone; queued work continues in the same worker once the cancellation is acknowledged',async t=>{
  const clock=controlledTimers(t),f=fixture(t,{capacity:3,concurrency:1,timeoutMs:20}),a=observe(f.loader.load(url('stalled'),8)),b=observe(f.loader.load(url('queued'),8));
  clock.tick(20);
  const first=await a;assert.equal(first.status,'rejected');assert.match(first.reason.message,/timed out/);assert.notEqual(first.reason.name,'AbortError');
  const id=f.worker.jobs[0].id;assert.deepEqual(cancels(f.worker),[id],'The stalled job is cancelled in the worker');
  assert.equal(f.worker.terminated,0,'One stalled job must not close the lane');assert.equal(f.worker.jobs.length,1,'Its slot stays reserved until the worker acknowledges');assert.equal(f.loader.diagnostics().active,1);
  f.worker.failure(id,{name:'AbortError',message:'cancelled'});assert.equal(f.worker.jobs.length,2);f.worker.success();assert.equal((await b).status,'fulfilled');
  const late=observe(f.loader.load(url('later'),8));f.worker.success();assert.equal((await late).status,'fulfilled','Later requests still load after a stall');
  const d=f.loader.diagnostics();assert.equal(d.timedOut,1);assert.equal(d.workerRestarts,0);assert.equal(d.disposed,false);assert.equal(d.failure,null);assert.equal(f.workers.length,1);assert.equal(f.mainFetches.length,0);
});

test('worker progress keeps a slow transfer alive beyond the stall limit and late bytes of a stalled job are never delivered',async t=>{
  const clock=controlledTimers(t),f=fixture(t,{capacity:3,concurrency:1,timeoutMs:40}),slow=observe(f.loader.load(url('slow'),8));let settled=false;void slow.then(()=>{settled=true;});
  const id=f.worker.jobs[0].id;
  for(let i=1;i<=4;i++){clock.tick(25);f.worker.emit('message',{type:'resource-progress',id,received:i});assert.equal(settled,false,'Progress restarts the stall limit');}
  for(const received of [0,9,1.5,'2'])f.worker.emit('message',{type:'resource-progress',id,received});
  f.worker.success(id);assert.equal((await slow).status,'fulfilled');assert.equal(f.loader.diagnostics().timedOut,0);
  const stalled=observe(f.loader.load(url('stalled-late'),8)),stalledId=f.worker.jobs[1].id;clock.tick(40);assert.equal((await stalled).status,'rejected');
  f.worker.emit('message',{type:'resource-progress',id:stalledId,received:4});
  const buffer=f.worker.success(stalledId);assert.equal(buffer.byteLength,8);assert.equal(f.loader.diagnostics().completed,1,'A late success only releases the reservation');assert.equal(f.loader.diagnostics().active,0);
});

test('a worker that ignores the cancellation is replaced; queued and later jobs continue; repeated replacement closes the lane',async t=>{
  const clock=controlledTimers(t),f=fixture(t,{capacity:4,concurrency:1,timeoutMs:15,maxWorkerRestarts:2}),a=observe(f.loader.load(url('hung'),8)),b=observe(f.loader.load(url('next'),8));
  clock.tick(15);assert.equal((await a).status,'rejected');clock.tick(15);
  assert.equal(f.workers.length,2,'An unresponsive worker is replaced');assert.equal(f.workers[0].terminated,1);assert.equal(f.loader.diagnostics().workerRestarts,1);
  assert.equal(f.workers[1].jobs.length,1,'The queued job is posted to the fresh worker');f.workers[1].success();assert.equal((await b).status,'fulfilled');
  // A completed job proves the lane works again and restores the full restart budget.
  for(let round=0;round<2;round++){const hung=observe(f.loader.load(url('hung-'+round),8));clock.tick(15);assert.equal((await hung).status,'rejected');clock.tick(15);}
  assert.equal(f.loader.diagnostics().workerRestarts,3);assert.equal(f.loader.diagnostics().disposed,false);
  const last=observe(f.loader.load(url('hung-last'),8));clock.tick(15);assert.equal((await last).status,'rejected');clock.tick(15);
  assert.equal(f.loader.diagnostics().disposed,true,'Replacement is bounded');assert.equal((await observe(f.loader.load(url('closed'),8))).status,'rejected');assert.equal(f.mainFetches.length,0);
  assert.equal(clock.pending,0);
});

test('concurrent restart retains budgets, resumes queued work and rejects stale worker replies across both cancellation paths',async t=>{
  for(const mode of ['caller-abort','stall-timeout'])await t.test(mode,async t=>{
    const clock=controlledTimers(t),f=fixture(t,{capacity:4,concurrency:2,maxActiveBytes:16,timeoutMs:20,maxWorkerRestarts:2});
    const signals=Array.from({length:4},()=>new AbortController());
    const pending=[8,8,6,10].map((bytes,index)=>observe(f.loader.load(url('restart-'+index),bytes,{signal:signals[index].signal})));
    const old=f.worker,[lost,healthy]=old.jobs;assert.equal(old.peakBytes,16);assert.equal(old.jobs.length,2);
    assert.equal((await observe(f.loader.load(url('over-capacity'),1))).status,'rejected');
    clock.tick(5);if(mode==='caller-abort')signals[0].abort();
    clock.tick(10);old.emit('message',{type:'resource-progress',id:healthy.id,received:1});
    clock.tick(10);old.emit('message',{type:'resource-progress',id:healthy.id,received:2});
    const first=await pending[0];assert.equal(first.status,'rejected');
    if(mode==='caller-abort')assert.equal(first.reason.name,'AbortError');else assert.match(first.reason.message,/timed out/);
    assert.equal(f.loader.diagnostics().activeBytes,16,'Unacknowledged cancellation retains its physical byte reservation');
    assert.equal(old.jobs.length,2,'Queued work cannot overtake the reserved cancelled slot');
    clock.tick(14);assert.equal(f.workers.length,1);assert.equal(clock.pending,2);
    clock.tick(1);const fresh=f.workers[1];assert(fresh,'The worker is replaced when its cancellation grace expires');
    assert.equal(old.terminated,1);assert.equal(fresh.jobs.length,2);assert.deepEqual(fresh.jobs.map(job=>job.bytes),[6,10]);
    assert.equal((await pending[1]).status,'rejected','Terminating a worker also rejects its other active requests');
    assert.equal(f.loader.diagnostics().activeBytes,16);assert.equal(fresh.peakBytes,16);assert.equal(clock.pending,2);
    assert(signals.slice(0,2).every(controller=>getEventListeners(controller.signal,'abort').length===0));
    const [a,b]=fresh.jobs,deadlines=clock.deadlines();
    for(const id of [lost.id,a.id]){
      old.emit('message',{type:'resource-progress',id,received:5});
      old.emit('message',{type:'inflated-resource',id,buffer:new ArrayBuffer(a.bytes),workerReadWallMs:1});
      old.emit('message',{type:'resource-error',id,message:'old worker failure'});
    }
    old.emit('error',{message:'late old worker error',preventDefault(){}});old.emit('messageerror',{});
    assert.deepEqual(clock.deadlines(),deadlines,'Even an old worker reply spoofing a new task id cannot change its deadline');
    assert.equal(f.loader.diagnostics().completed,0);assert.equal(f.loader.diagnostics().activeBytes,16);assert.equal(f.loader.diagnostics().disposed,false);
    fresh.success(b.id);assert.equal(f.loader.diagnostics().activeBytes,6);assert.equal(clock.pending,1);
    fresh.success(a.id);assert.deepEqual((await Promise.all(pending.slice(2))).map(result=>result.value.byteLength),[6,10]);
    assert.equal(clock.pending,0);assert.equal(f.loader.diagnostics().activeBytes,0);assert.equal(f.loader.diagnostics().active,0);assert.equal(f.loader.diagnostics().queued,0);
    assert(signals.every(controller=>getEventListeners(controller.signal,'abort').length===0));assert.equal(f.mainFetches.length,0);
    f.loader.dispose();f.loader.dispose();clock.tick(1000);assert.equal(fresh.terminated,1);assert.equal(f.workers.length,2);assert.equal(clock.pending,0);
  });
});

test('only increasing decoded bytes extend a stall deadline and settled progress cannot postpone cancellation grace',async t=>{
  const clock=controlledTimers(t),f=fixture(t,{capacity:2,concurrency:1,timeoutMs:20}),stalled=observe(f.loader.load(url('repeating-progress'),8)),queued=observe(f.loader.load(url('after-repeating'),8));
  const id=f.worker.jobs[0].id;clock.tick(5);f.worker.emit('message',{type:'resource-progress',id,received:4});
  assert.deepEqual(clock.deadlines(),[25],'Real decoded progress grants a new stall window');
  for(const received of [4,3,0,9,1.5,'5']){clock.tick(3);f.worker.emit('message',{type:'resource-progress',id,received});assert.deepEqual(clock.deadlines(),[25]);}
  clock.tick(1);assert.equal(f.loader.diagnostics().timedOut,0);clock.tick(1);assert.match((await stalled).reason.message,/timed out/);
  assert.deepEqual(clock.deadlines(),[45]);clock.tick(10);f.worker.emit('message',{type:'resource-progress',id,received:6});
  assert.deepEqual(clock.deadlines(),[45],'Progress after rejection must not replace the cancellation grace timer');
  clock.tick(10);assert.equal(f.workers.length,2);assert.equal(f.worker.terminated,1);f.workers[1].success();assert.equal((await queued).status,'fulfilled');
  assert.equal(clock.pending,0);assert.equal(f.loader.diagnostics().timedOut,1);assert.equal(f.loader.diagnostics().workerRestarts,1);assert.equal(f.loader.diagnostics().activeBytes,0);assert.equal(f.mainFetches.length,0);
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
