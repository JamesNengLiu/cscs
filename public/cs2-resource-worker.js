import {fetchInflatedResource,MAX_CS2_RESOURCE_BYTES} from './cs2-resource-format.js';

const jobs=new Map();let activeBytes=0;
globalThis.onmessage=event=>{
 const m=event.data;
 if(!m||!Number.isSafeInteger(m.id)||m.id<1)return;
 if(m.type==='cancel-resource'){jobs.get(m.id)?.abort();return;}
 if(m.type!=='inflate-resource')return;
 if(jobs.has(m.id)||jobs.size>=8||!Number.isSafeInteger(m.bytes)||m.bytes<1||m.bytes>MAX_CS2_RESOURCE_BYTES-activeBytes){
  globalThis.postMessage({type:'resource-error',id:m.id,name:'Error',message:'CS2 resource worker budget exceeded'});return;
 }
 const controller=new AbortController();jobs.set(m.id,controller);activeBytes+=m.bytes;
 void(async()=>{
  try{const result=await fetchInflatedResource(m,{signal:controller.signal});globalThis.postMessage({type:'inflated-resource',id:m.id,...result},[result.buffer]);}
  catch(error){globalThis.postMessage({type:'resource-error',id:m.id,name:error?.name==='AbortError'?'AbortError':'Error',message:String(error?.message||'CS2 resource decoding failed').slice(0,256)});}
  finally{controller.abort();jobs.delete(m.id);activeBytes-=m.bytes;}
 })();
};
