export const MAX_CS2_RESOURCE_BYTES=512*1024*1024;

export function validateResourceRequest(url,bytes){
 if(typeof url!=='string'||!/^\/assets\/(?:cs2-optimized\/|cs2-textured\/textures\/)(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+\.gz$/i.test(url)||url.split('/').some(part=>part==='.'||part==='..'))throw new TypeError('Invalid CS2 resource path');
 if(!Number.isSafeInteger(bytes)||bytes<1||bytes>MAX_CS2_RESOURCE_BYTES)throw new RangeError('Invalid CS2 resource byte budget');
}

export function resourceAbortReason(signal){
 return signal?.reason instanceof Error?signal.reason:new DOMException(typeof signal?.reason==='string'?signal.reason:'CS2 resource loading cancelled','AbortError');
}

// Called only in the dedicated resource worker. Read into the declared-size
// buffer there, so neither gzip work nor chunk assembly occupies the game loop.
// onProgress(receivedBytes) reports decoded progress so the owner can tell a
// slow but live transfer from a stalled one.
export async function fetchInflatedResource({url,bytes},{signal,fetchResource=globalThis.fetch,onProgress}={}){
 validateResourceRequest(url,bytes);
 const active=()=>{if(signal?.aborted)throw resourceAbortReason(signal);};active();
 const response=await fetchResource(url,{signal});active();
 if(!response.ok||!response.body)throw Error('CS2 resource download failed');
 const started=performance.now(),reader=response.body.pipeThrough(new DecompressionStream('gzip'),{signal}).getReader();
 try{
  const output=new Uint8Array(bytes);let offset=0;
  for(;;){active();const {value,done}=await reader.read();active();if(done)break;
   if(!(value instanceof Uint8Array)||value.byteLength>bytes-offset)throw Error('CS2 resource decoded length mismatch');
   output.set(value,offset);offset+=value.byteLength;onProgress?.(offset);
  }
  if(offset!==bytes)throw Error('CS2 resource decoded length mismatch');
  return{buffer:output.buffer,workerReadWallMs:performance.now()-started};
 }catch(error){try{await reader.cancel(error);}catch{}throw error;}
 finally{reader.releaseLock();}
}
