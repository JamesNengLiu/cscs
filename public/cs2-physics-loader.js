function abortReason(signal){return signal?.reason instanceof Error?signal.reason:new DOMException(typeof signal?.reason==='string'?signal.reason:'碰撞加载已取消','AbortError');}
function checkAbort(signal){if(signal?.aborted)throw abortReason(signal);}

export async function loadPhysicsPackage({progress=()=>{},load={},signal}={}){
 checkAbort(signal);
 const at=performance.now(),res=await fetch('/assets/cs2-physics/manifest.json',{signal});checkAbort(signal);if(!res.ok)throw Error('缺少真实碰撞数据，请先运行 tools/prepare-cs2-physics.py');
 const manifest=await res.json();checkAbort(signal);
 if(manifest.schema!=='cs2-physics-package-v1'||manifest.file!=='physics.json.gz'||!Number.isSafeInteger(manifest.bytes)||manifest.bytes<=0||manifest.bytes>128*1024*1024||!/^[a-f0-9]{64}$/.test(manifest.sha256))throw Error('碰撞资源清单无效');
 progress(`读取真实碰撞（${(manifest.downloadBytes/1048576).toFixed(1)} MiB）…`);
 checkAbort(signal);
 const response=await fetch('/assets/cs2-physics/'+manifest.file,{signal});checkAbort(signal);if(!response.ok||!response.body)throw Error('真实碰撞下载失败');
 const bytes=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'),{signal})).arrayBuffer();checkAbort(signal);if(bytes.byteLength!==manifest.bytes)throw Error('碰撞数据长度不匹配');
 const digestBytes=await crypto.subtle.digest('SHA-256',bytes);checkAbort(signal);
 const digest=Array.from(new Uint8Array(digestBytes),n=>n.toString(16).padStart(2,'0')).join('');if(digest!==manifest.sha256)throw Error('碰撞数据校验失败');
 load.physicsTransferAndVerifyMs=performance.now()-at;progress('后台解析真实碰撞数据…');
 checkAbort(signal);
 const worker=new Worker(new URL('./cs2-physics-worker.js',import.meta.url),{type:'module'}),started=performance.now();
 let terminated=false;
 const terminate=()=>{if(!terminated){terminated=true;worker.terminate();}};
 try{
  const result=await new Promise((resolve,reject)=>{
   let settled=false,timer=null;
   const cleanup=()=>{if(timer!==null)clearTimeout(timer);signal?.removeEventListener('abort',onAbort);worker.onmessage=worker.onerror=worker.onmessageerror=null;};
   const finish=(complete,value)=>{if(settled)return;settled=true;cleanup();terminate();complete(value);};
   const onAbort=()=>finish(reject,abortReason(signal));
   worker.onmessage=event=>event.data?.error?finish(reject,Error(event.data.error)):finish(resolve,event.data);
   worker.onerror=event=>{event.preventDefault?.();finish(reject,Error(event.message||'后台碰撞解析失败'));};
   worker.onmessageerror=()=>finish(reject,Error('后台碰撞消息解析失败'));
   signal?.addEventListener('abort',onAbort,{once:true});
   // Recheck after construction/listener registration: cancellation must not
   // post work to a worker created on the abort boundary.
   if(signal?.aborted){onAbort();return;}
   timer=setTimeout(()=>finish(reject,Error('碰撞解析超时')),45000);
   try{worker.postMessage({bytes},[bytes]);}catch(error){finish(reject,error);}
  });
  checkAbort(signal);
  load.physicsWorkerParseMs=result.parseMs;load.physicsWorkerCompileMs=result.compileMs??null;load.physicsCompiledBytes=result.compiledBytes??0;load.physicsWorkerRoundTripMs=performance.now()-started;load.physicsDecodedBytes=manifest.bytes;load.physicsDownloadBytes=manifest.downloadBytes;
  return{manifest,data:result.data,verifiedPhysicsSHA256:digest};
 }finally{terminate();}
}
