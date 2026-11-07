// Separate from the 1.0 map and simplified benchmark format.
function* steps(manifest, buffer) {
 const fail=reason=>{throw Error('贴图地图包无效：'+reason);};
 if(manifest?.format!=='cs2-map-textured-v1'||!(buffer instanceof ArrayBuffer)||buffer.byteLength!==manifest.geometry?.bytes)fail('格式或大小');
 const chunks=manifest.geometry.chunks;if(!Array.isArray(chunks)||chunks.length<1||chunks.length>10000)fail('分区');
 const spans=[],result=[];let vertices=0,triangles=0;
 function view(spec,Type){if(!spec||!Number.isSafeInteger(spec.offset)||spec.offset<0||!Number.isSafeInteger(spec.length)||spec.length<=0||spec.offset%Type.BYTES_PER_ELEMENT||spec.offset+spec.length*Type.BYTES_PER_ELEMENT>buffer.byteLength)fail('属性范围');spans.push([spec.offset,spec.offset+spec.length*Type.BYTES_PER_ELEMENT]);return new Type(buffer,spec.offset,spec.length);}
 for(const chunk of chunks){
  const d={};for(const [key,Type]of [['position',Float32Array],['normal',Int16Array],['tangent',Int16Array],['uv',Float32Array],['uv1',Float32Array],['blend',Uint8Array],['color',Uint8Array],['baked',Uint16Array],['index',Uint32Array]])d[key]=view(chunk[key],Type);
  const count=d.position.length/3;
  if(!Number.isInteger(count)||d.normal.length!==count*3||d.tangent.length!==count*4||d.uv.length!==count*2||d.uv1.length!==count*2||d.blend.length!==count*4||d.color.length!==count*3||d.baked.length!==count*3||d.index.length%3)fail('属性数量');
  if(!['lightmap','vertex','ambient'].includes(chunk.mode)||!Number.isInteger(chunk.material)||!manifest.materials?.[chunk.material])fail('材质或光照模式');
  for(let i=0;i<d.index.length;i++){if(d.index[i]>=count)fail('索引');if(i%16384===16383)yield;}
  for(const key of ['position','uv','uv1'])for(let i=0;i<d[key].length;i++){if(!Number.isFinite(d[key][i]))fail('非有限属性');if(i%16384===16383)yield;}
  vertices+=count;triangles+=d.index.length/3;result.push(d);yield;
 }
 spans.sort((a,b)=>a[0]-b[0]);if(spans.some((s,i)=>i&&s[0]<spans[i-1][1]))fail('属性重叠');
 if(vertices!==manifest.geometry.vertices||triangles!==manifest.geometry.triangles)fail('总量');return result;
}
export async function decodeTexturedMap(manifest,buffer,{yieldTask=()=>globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(r=>setTimeout(r,0))}={}){
 const iterator=steps(manifest,buffer);let at=performance.now();for(;;){const next=iterator.next();if(next.done)return next.value;if(performance.now()-at>=3){await yieldTask();at=performance.now();}}
}
