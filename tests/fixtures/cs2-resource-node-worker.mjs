// Real worker_threads adapter for the production browser resource worker.
// All inputs are small in-memory gzip fixtures; no server or native assets.
import {parentPort,workerData,isMainThread} from 'node:worker_threads';

const resources=workerData.resources||{},pending=[];let ready=false;
const notice=(kind,data)=>parentPort.postMessage({__cs2ResourceFixture:true,kind,...data});
if(workerData.throwDecompressionConstructor)globalThis.DecompressionStream=class{constructor(){throw Error('Fixture decoder construction failure');}};
globalThis.fetch=async(url,{signal}={})=>{
  notice('fetch',{url,isMainThread,hasSignal:!!signal});
  signal?.addEventListener('abort',()=>notice('fetch-signal-aborted',{url}),{once:true});
  const spec=resources[url];if(!spec)return new Response('Missing fixture',{status:404});
  if(spec.mode==='fetch-stall')return new Promise((_resolve,reject)=>{
    const abort=()=>{notice('aborted',{url});reject(signal.reason||new DOMException('Cancelled','AbortError'));};
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  });
  if(spec.status)return new Response('Fixture error',{status:spec.status});
  const bytes=Buffer.from(spec.gzip,'base64'),chunkBytes=spec.chunkBytes||11;let offset=0;
  const body=new ReadableStream({pull(controller){if(offset===bytes.length){controller.close();return;}const next=Math.min(bytes.length,offset+chunkBytes);controller.enqueue(bytes.subarray(offset,next));offset=next;},cancel(){notice('stream-cancel',{url});}});
  return new Response(body);
};
globalThis.postMessage=(message,transfer)=>{
  const buffers=(transfer||[]).filter(value=>value instanceof ArrayBuffer),before=buffers.map(b=>b.byteLength);
  parentPort.postMessage(message,transfer);
  if(buffers.length)notice('transfer',{id:message.id,count:buffers.length,before,after:buffers.map(b=>b.byteLength)});
};
parentPort.on('message',data=>{if(ready)globalThis.onmessage({data});else pending.push(data);});
await import('../../public/cs2-resource-worker.js');ready=true;for(const data of pending)globalThis.onmessage({data});
