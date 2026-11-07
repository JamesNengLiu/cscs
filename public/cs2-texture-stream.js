import * as THREE from '/vendor/three.module.js';
const FORMATS={1:THREE.RGBA_S3TC_DXT1_Format,2:THREE.RGBA_S3TC_DXT5_Format,19:THREE.RGB_BPTC_UNSIGNED_Format,20:THREE.RGBA_BPTC_Format,21:THREE.RED_GREEN_RGTC2_Format,27:THREE.RED_RGTC1_Format};
const pause=()=>globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(r=>setTimeout(r,0));
export async function createTextureStream({renderer,index,base,progress,inflate,now=()=>performance.now(),maxHighBytes=160*1048576}){
 if(typeof now!=='function'||!Number.isFinite(maxHighBytes)||maxHighBytes<0)throw Error('Invalid texture stream cache budget');
 const buffers=new Map(),entries=new Map(),names=new Map(),textures=new Map(),uploads=[],pending=new Map(),failures=[],fullVariants=new WeakSet();
 let disposed=false,downloadBytes=0,initialDownloadBytes=0,highWaterBytes=0,uploadedHigh=0,evictions=0,lastWanted=new Set(),uploadFrame=null,frameUploadSubmissions=0,uploadSubmissions=0,submittedTextureBytes=0;
 const keyFor=meta=>[meta.format,meta.faces||1,meta.mips[0].width,meta.mips[0].height,meta.sha256].join(':');
 function buffer(spec){const key=spec.file;if(!buffers.has(key)){downloadBytes+=spec.downloadBytes;buffers.set(key,inflate(base+spec.file).then(data=>{if(data.byteLength!==spec.bytes)throw Error('Texture tier size mismatch');return data;}).catch(error=>{buffers.delete(key);throw error;}));}return buffers.get(key);}
 const unique=new Map();for(const [name,tiers]of Object.entries(index.textures)){const key=keyFor(tiers.full);if(!entries.has(key))entries.set(key,{key,full:tiers.full,preview:tiers.preview,low:null,high:null,resident:false,variants:[],wantedAt:0});names.set(name,entries.get(key));unique.set(key,entries.get(key));}
 const queue=[...unique.values()];let complete=0;
 await Promise.all(Array.from({length:6},async()=>{for(;;){const entry=queue.shift();if(!entry)return;entry.low=await buffer(entry.preview);entry.resident=entry.full.sha256===entry.preview.sha256;complete++;if(complete%32===0)progress(`准备全图覆盖纹理 ${complete}/${unique.size}…`);await pause();}}));
 initialDownloadBytes=downloadBytes;
 function mipmaps(spec,data,face=null){return spec.mips.map(m=>({width:m.width,height:m.height,data:new Uint8Array(data,m.offset+(face===null?0:face*m.bytes/6),face===null?m.bytes:m.bytes/6)}));}
 function apply(t,entry,high){const spec=high?entry.full:entry.preview,data=high?entry.high:entry.low;
  // WebGL's immutable compressed storage cannot change dimensions in place.
  // Keep the JS texture identity/material bindings, release and recreate only
  // its GPU allocation when swapping authored mip tiers.
  if(t.image?.width!==spec.mips[0].width||t.image?.height!==spec.mips[0].height)t.dispose();
  if(spec.faces===6)t.image=Array.from({length:6},(_,face)=>({width:spec.mips[0].width,height:spec.mips[0].height,mipmaps:mipmaps(spec,data,face)}));
  else{t.image={width:spec.mips[0].width,height:spec.mips[0].height};t.mipmaps=mipmaps(spec,data);}
  t.minFilter=spec.mips.length>1?THREE.LinearMipmapLinearFilter:THREE.LinearFilter;t.needsUpdate=true;
 }
 function texture(name,{color=false,clamp=false,channel=0}={}){if(disposed)throw Error('Texture stream disposed');if(!name)return null;const entry=names.get(name);if(!entry)throw Error('Missing native tier '+name);const key=entry.key+'|'+color+'|'+clamp+'|'+channel;if(textures.has(key))return textures.get(key);
  const spec=entry.preview,format=FORMATS[spec.format];if(!format)throw Error('Unsupported native format');let t;
  if(spec.faces===6)t=new THREE.CompressedCubeTexture(Array.from({length:6},()=>({width:spec.mips[0].width,height:spec.mips[0].height,mipmaps:[]})),format);else t=new THREE.CompressedTexture([],spec.mips[0].width,spec.mips[0].height,format);
  t.name=name;t.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;t.wrapS=t.wrapT=clamp?THREE.ClampToEdgeWrapping:THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());t.channel=channel;entry.variants.push(t);apply(t,entry,false);if(entry.full.sha256===entry.preview.sha256)fullVariants.add(t);textures.set(key,t);
  // A variant created after an earlier promotion starts at the preview tier;
  // its high mips must use the same submission queue as existing variants.
  if(entry.high){cancelDemotion(entry);entry.resident=false;void request(entry).catch(()=>{});}return t;
 }
 function completeUpload(item){uploads.shift();const {entry,high}=item;if(high){entry.resident=true;uploadedHigh++;item.clearPending();item.resolve();}else{entry.high=null;entry.resident=entry.full.sha256===entry.preview.sha256;entry.demoting=false;buffers.delete(entry.full.file);evictions++;}}
 // A finite RAF timestamp shares one renderer.initTexture submission across
 // all calls in that frame, including preview demotions and material variants.
 // One submission can contain several native mip/face uploads. It is not a
 // GPU completion or elapsed-time budget. Loading calls omit the timestamp.
 function pump(frameTimeMs){if(disposed)return false;const measured=Number.isFinite(frameTimeMs);if(measured&&frameTimeMs!==uploadFrame){uploadFrame=frameTimeMs;frameUploadSubmissions=0;}
  while(uploads.length){const item=uploads[0],{entry,high}=item;while(item.cursor<entry.variants.length&&fullVariants.has(entry.variants[item.cursor])===high)item.cursor++;
   if(item.cursor===entry.variants.length){completeUpload(item);continue;}if(measured&&frameUploadSubmissions>=1)return false;
   const t=entry.variants[item.cursor++],wasHigh=fullVariants.has(t);if(measured)frameUploadSubmissions++;uploadSubmissions++;submittedTextureBytes+=(high?entry.full:entry.preview).bytes;
   // Publish the target tier before apply can synchronously emit dispose.
   // A listener requesting this entry must observe its pending demotion.
   try{if(high)fullVariants.add(t);else fullVariants.delete(t);apply(t,entry,high);if(disposed)return false;renderer.initTexture(t);}catch(error){if(wasHigh)fullVariants.add(t);else fullVariants.delete(t);if(uploads[0]===item)uploads.shift();entry.demoting=false;failures.push(error.message);item.clearPending?.();item.reject?.(error);return false;}
   // A synchronous texture listener may request a demoting entry again.
   // Do not complete/free a job that was canceled during initTexture.
   if(uploads[0]===item&&item.cursor===entry.variants.length)completeUpload(item);
   const bytes=[...entries.values()].reduce((sum,e)=>sum+(e.high?e.full.bytes:0),0);highWaterBytes=Math.max(highWaterBytes,bytes);return true;
  }return false;
 }
 const requests=[],inflight=new Set();
 function dispatch(){while(!disposed&&inflight.size<2&&requests.length){const job=requests.shift(),{entry,resolve,reject,clearPending}=job;inflight.add(job);void(async()=>{try{const high=await buffer(entry.full);if(disposed)return;entry.high=high;uploads.push({entry,resolve,reject,clearPending,high:true,cursor:0});}catch(error){if(disposed)return;failures.push(error.message);clearPending();reject(error);}finally{inflight.delete(job);dispatch();}})();}}
 function request(entry){if(disposed||entry.resident)return Promise.resolve();if(pending.has(entry.key))return pending.get(entry.key);const promise=new Promise((resolve,reject)=>requests.push({entry,resolve,reject,clearPending:()=>{if(pending.get(entry.key)===promise)pending.delete(entry.key);}}));pending.set(entry.key,promise);dispatch();return promise;}
 function cancelDemotion(entry){if(!entry.demoting)return;const i=uploads.findIndex(item=>item.entry===entry&&!item.high);if(i>=0)uploads.splice(i,1);entry.demoting=false;entry.resident=entry.variants.every(t=>fullVariants.has(t));}
 function wanted(materials){if(disposed)return Promise.resolve();const keys=new Set(),time=now();for(const material of materials)for(const name of Object.values(material.TextureParams)){const entry=names.get(name);if(entry){keys.add(entry.key);entry.wantedAt=time;}}
  lastWanted=keys;const jobs=[];for(const key of keys){const entry=entries.get(key);cancelDemotion(entry);jobs.push(request(entry));}requests.sort((a,b)=>Number(keys.has(b.entry.key))-Number(keys.has(a.entry.key)));return Promise.all(jobs);
 }
 function trim(){// Unseen high mips return to their authored preview tier.
  if(disposed)return;
  const time=now(),resident=[...entries.values()].reduce((s,e)=>s+(e.high?e.full.bytes:0),0);
  for(const entry of [...entries.values()].sort((a,b)=>a.wantedAt-b.wantedAt))if(entry.high&&!entry.demoting&&!pending.has(entry.key)&&!lastWanted.has(entry.key)&&time-entry.wantedAt>10000&&resident>maxHighBytes){entry.demoting=true;entry.resident=false;uploads.push({entry,high:false,cursor:0});break;}
 }
 function info(){const used=new Set(),high=new Set();let cpu=0,gpu=0;for(const e of entries.values()){if(e.low&&!used.has(e.low)){used.add(e.low);cpu+=e.low.byteLength;}if(e.high&&!used.has(e.high)){used.add(e.high);cpu+=e.high.byteLength;}for(const t of e.variants)gpu+=(fullVariants.has(t)?e.full:e.preview).bytes;if(e.high)high.add(e.key);}return{initialDownloadBytes,downloadBytes,textureBufferBytes:cpu,estimatedTextureGPUBytes:gpu,textures:textures.size,residentHigh:high.size,uploadedHigh,evictions,highWaterBytes,uploadSubmissions,submittedTextureBytes,uploadBudget:{maxSubmissionsPerFrame:1,frameTimeMs:uploadFrame,frameSubmissions:frameUploadSubmissions,scope:'Streamed tier changes only; renderer.initTexture calls, not native mip/face commands or GPU completion. Loading pumps omit the frame timestamp.'},remaining:requests.length+inflight.size+uploads.length,errors:failures.slice()};}
 return{texture,pump,wanted,trim,info,allTextures:()=>textures.values(),dispose(){if(disposed)return;disposed=true;for(const t of textures.values())t.dispose();for(const item of uploads)item.resolve?.();for(const item of requests)item.resolve();for(const item of inflight)item.resolve();inflight.clear();buffers.clear();entries.clear();names.clear();textures.clear();pending.clear();lastWanted.clear();uploads.splice(0);requests.splice(0);}};
}
