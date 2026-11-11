import {MAX_CS2_RESOURCE_BYTES,resourceAbortReason,validateResourceRequest} from './cs2-resource-format.js';

const defaultWorker=()=>new Worker(new URL('./cs2-resource-worker.js',import.meta.url),{type:'module',name:'cs2-map-resources'});

// One worker per map lifetime. Existing texture-stream callers retain their
// request priority/cache and GPU upload budget; this lane only returns bytes.
// timeoutMs is a stall limit, not a total-duration limit: worker progress
// reports restart it only while decoded bytes advance. A stalled job fails
// alone. Only a worker that does not acknowledge the
// cancellation is replaced, and only repeated replacement closes the lane.
export function createCS2ResourceLoader({signal,workerFactory=defaultWorker,capacity=32,concurrency=8,maxActiveBytes=MAX_CS2_RESOURCE_BYTES,timeoutMs=45000,maxWorkerRestarts=3}={}){
 if(!Number.isInteger(capacity)||capacity<1||capacity>64||!Number.isInteger(concurrency)||concurrency<1||concurrency>8||!Number.isSafeInteger(maxActiveBytes)||maxActiveBytes<1||maxActiveBytes>MAX_CS2_RESOURCE_BYTES||!Number.isFinite(timeoutMs)||timeoutMs<1||!Number.isInteger(maxWorkerRestarts)||maxWorkerRestarts<0||maxWorkerRestarts>8)throw new RangeError('Invalid CS2 resource queue limits');
 const queue=[],active=new Map();let worker=null,serial=0,activeBytes=0,closed=false,failure=null,restartsSinceSuccess=0;
 const totals={jobs:0,completed:0,failed:0,cancelled:0,timedOut:0,workerRestarts:0,peakPending:0,peakActive:0,transferredBytes:0,workerReadWallMs:0,peakWorkerReadWallMs:0};
 const graceMs=Math.min(timeoutMs,5000);
 function settle(job,error,buffer){
  if(job.settled)return;job.settled=true;job.signal?.removeEventListener('abort',job.onAbort);
  if(error){if(error.name==='AbortError')totals.cancelled++;else totals.failed++;job.reject(error);}
  else{totals.completed++;job.resolve(buffer);}
 }
 function release(job){clearTimeout(job.timer);job.timer=null;active.delete(job.id);activeBytes-=job.bytes;}
 function watch(job){clearTimeout(job.timer);job.timer=setTimeout(()=>stalled(job),timeoutMs);}
 // The stalled job fails on its own. Its slot and bytes stay reserved until
 // the worker acknowledges the cancellation, exactly like a caller abort.
 function stalled(job){
  if(closed||!active.has(job.id))return;if(!job.settled){totals.timedOut++;settle(job,Error('CS2 resource worker timed out'));}
  try{worker.postMessage({type:'cancel-resource',id:job.id});}catch(error){fail(error);return;}
  job.timer=setTimeout(()=>{if(!closed&&active.has(job.id))restartWorker(Error('CS2 resource worker did not acknowledge cancellation'));},graceMs);
 }
 // Replace an unresponsive worker. Its active jobs are lost and rejected;
 // queued and later jobs continue in a fresh worker.
 function restartWorker(reason){
  if(closed)return;if(restartsSinceSuccess>=maxWorkerRestarts){fail(reason);return;}
  restartsSinceSuccess++;totals.workerRestarts++;try{worker?.terminate();}catch{}worker=null;
  for(const job of active.values()){clearTimeout(job.timer);job.timer=null;settle(job,reason);}active.clear();activeBytes=0;pump();
 }
 function close(reason){
  if(closed)return;closed=true;signal?.removeEventListener('abort',onLifetimeAbort);
  try{worker?.terminate();}catch{}worker=null;
  for(const job of active.values()){clearTimeout(job.timer);settle(job,reason);}active.clear();activeBytes=0;
  for(const job of queue.splice(0))settle(job,reason);
 }
 function fail(reason){failure=String(reason?.message||reason||'CS2 resource worker failed').slice(0,256);close(reason instanceof Error?reason:Error(failure));}
 function ensureWorker(){
  if(worker||closed)return;
  const current=workerFactory();if(closed){current.terminate();return;}worker=current;
  current.addEventListener('message',event=>{
   if(closed||worker!==current)return;const m=event.data,job=active.get(m?.id);if(!job)return;
   if(m.type==='resource-progress'){if(!job.settled&&Number.isSafeInteger(m.received)&&m.received>job.received&&m.received<=job.bytes){job.received=m.received;watch(job);}return;}
   if(m.type==='resource-error'){
    const error=m.name==='AbortError'?new DOMException(String(m.message||'CS2 resource cancelled').slice(0,256),'AbortError'):Error(String(m.message||'CS2 resource rejected').slice(0,256));
    release(job);settle(job,error);pump();return;
   }
   if(m.type!=='inflated-resource'||!(m.buffer instanceof ArrayBuffer)||m.buffer.byteLength!==job.bytes||!Number.isFinite(m.workerReadWallMs)||m.workerReadWallMs<0){fail(Error('Invalid CS2 resource worker reply'));return;}
   release(job);
   restartsSinceSuccess=0;
   if(!job.settled){totals.transferredBytes+=m.buffer.byteLength;totals.workerReadWallMs+=m.workerReadWallMs;totals.peakWorkerReadWallMs=Math.max(totals.peakWorkerReadWallMs,m.workerReadWallMs);settle(job,null,m.buffer);}
   pump();
  });
  current.addEventListener('error',event=>{event.preventDefault?.();if(worker===current&&!closed)fail(Error(event.message||'CS2 resource worker failed'));});
  current.addEventListener('messageerror',()=>{if(worker===current&&!closed)fail(Error('CS2 resource worker message decode failed'));});
 }
 function pump(){
  if(closed||!queue.length)return;
  try{ensureWorker();while(!closed&&queue.length&&active.size<concurrency&&queue[0].bytes<=maxActiveBytes-activeBytes){
   const job=queue.shift();active.set(job.id,job);activeBytes+=job.bytes;totals.peakActive=Math.max(totals.peakActive,active.size);
   watch(job);
   worker.postMessage({type:'inflate-resource',id:job.id,url:job.url,bytes:job.bytes});
  }}catch(error){fail(error);}
 }
 function cancel(job){
  if(job.settled)return;settle(job,resourceAbortReason(job.signal));
  const index=queue.indexOf(job);if(index>=0){queue.splice(index,1);pump();return;}
  // An aborted active job keeps its stall watch: an unresponsive worker must
  // still be detected so the reserved slot cannot leak forever.
  // Keep the active byte/slot budget until its worker completion acknowledges
  // cancellation; a slow abort must not permit unbounded overlapping decodes.
  if(active.has(job.id))try{worker.postMessage({type:'cancel-resource',id:job.id});}catch(error){fail(error);}
 }
 const onLifetimeAbort=()=>close(resourceAbortReason(signal));
 signal?.addEventListener('abort',onLifetimeAbort,{once:true});if(signal?.aborted)onLifetimeAbort();
 return{
  load(url,bytes,{signal:jobSignal}={}){
   try{validateResourceRequest(url,bytes);if(bytes>maxActiveBytes)throw new RangeError('CS2 resource exceeds active byte budget');}catch(error){return Promise.reject(error);}
   if(closed)return Promise.reject(signal?.aborted?resourceAbortReason(signal):Error(failure||'CS2 resource loader disposed'));
   if(jobSignal?.aborted)return Promise.reject(resourceAbortReason(jobSignal));
   if(active.size+queue.length>=capacity)return Promise.reject(Error('CS2 resource queue full'));
   return new Promise((resolve,reject)=>{
    const job={id:++serial,url,bytes,signal:jobSignal,resolve,reject,settled:false,timer:null,onAbort:null,received:0};job.onAbort=()=>cancel(job);
    queue.push(job);totals.jobs++;totals.peakPending=Math.max(totals.peakPending,active.size+queue.length);
    jobSignal?.addEventListener('abort',job.onAbort,{once:true});if(jobSignal?.aborted){cancel(job);return;}pump();
   });
  },
  dispose:reason=>close(reason instanceof Error?reason:new DOMException('CS2 resource loader disposed','AbortError')),
  diagnostics:()=>({...totals,mode:'worker-only',mainThreadInflateJobs:0,capacity,concurrency,maxActiveBytes,activeBytes,active:active.size,queued:queue.length,workerAvailable:!!worker,disposed:closed,failure,timeoutMs,scope:'Fetch, gzip decoding and byte assembly run in one worker; buffers are transferred. workerReadWallMs includes stream input waiting, not measured CPU time. timeoutMs limits time without progress, not total duration.'}),
 };
}
