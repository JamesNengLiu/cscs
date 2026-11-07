// Map-owned dynamic indices replace the complete drawn prefix. Re-specifying
// the bound buffer's storage lets the driver retire in-flight data; its handle,
// VAO binding, native index type and actual draw count remain unchanged.
export function createMapIndexUploadManager({gl,signal,canvas=gl?.canvas}={}){
 if(!gl||typeof gl.bufferData!=='function'||typeof gl.bufferSubData!=='function')throw new TypeError('Map index uploads require a GL context');
 const original=gl.bufferSubData,descriptor=Object.getOwnPropertyDescriptor(gl,'bufferSubData');
 const subData=original.bind(gl),bufferData=gl.bufferData.bind(gl);
 let registered=new WeakMap(),closed=false;
 function upload(target,offset,source,sourceOffset,count){
  if(!closed&&arguments.length===5&&target===gl.ELEMENT_ARRAY_BUFFER&&offset===0&&sourceOffset===0){
   const entry=source&&typeof source==='object'?registered.get(source):null;
   if(entry&&entry.usage===gl.DYNAMIC_DRAW&&source.byteLength===entry.bytes&&source.length===entry.length&&Number.isSafeInteger(count)&&count>0&&count<=entry.length){
    bufferData(target,entry.bytes,entry.usage);
   }
  }
  return subData.apply(undefined,arguments);
 }
 const onAbort=()=>close(),onContextLost=()=>close();
 function close(){
  if(closed)return false;closed=true;registered=new WeakMap();
  signal?.removeEventListener('abort',onAbort);canvas?.removeEventListener('webglcontextlost',onContextLost);
  // A later diagnostic wrapper may still call upload. Leave that wrapper in
  // place; the closed flag turns this retained function into a pure pass-through.
  if(gl.bufferSubData===upload){if(descriptor)Object.defineProperty(gl,'bufferSubData',descriptor);else delete gl.bufferSubData;}
  return true;
 }
 function register(indices,{usage=gl.DYNAMIC_DRAW}={}){
  if(closed)return false;
  if(!(indices instanceof Uint16Array||indices instanceof Uint32Array)||indices.length<1)throw new TypeError('Map index uploads require nonempty Uint16/Uint32 storage');
  registered.set(indices,{bytes:indices.byteLength,length:indices.length,usage});return true;
 }
 if(signal?.aborted)closed=true;
 else{
  gl.bufferSubData=upload;
  try{signal?.addEventListener('abort',onAbort,{once:true});canvas?.addEventListener('webglcontextlost',onContextLost,{once:true});if(signal?.aborted)close();}
  catch(error){close();throw error;}
 }
 return{register,close};
}
