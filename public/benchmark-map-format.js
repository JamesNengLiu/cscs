// Isolated benchmark binary validation. No gameplay dependencies or side effects.
function* decodeSteps(manifest,buffer){
 const fail=message=>{throw new Error('地图验证包无效：'+message);};
 if(manifest?.format!=='cs2-map-benchmark-v1'||!(buffer instanceof ArrayBuffer)||buffer.byteLength!==manifest.geometry?.bytes)fail('格式或长度不匹配');
 const chunks=manifest.geometry.chunks;if(!Array.isArray(chunks)||!chunks.length||chunks.length>10000)fail('分区数量');
 let triangles=0,vertices=0;const spans=[];
 const view=(spec,Type)=>{if(!spec||!Number.isSafeInteger(spec.offset)||spec.offset<0||!Number.isSafeInteger(spec.length)||spec.length<=0||spec.offset%Type.BYTES_PER_ELEMENT||spec.offset+spec.length*Type.BYTES_PER_ELEMENT>buffer.byteLength)fail('缓冲区范围');spans.push([spec.offset,spec.offset+spec.length*Type.BYTES_PER_ELEMENT]);return new Type(buffer,spec.offset,spec.length);};
 const decoded=[];
 for(const c of chunks){const position=view(c.position,Float32Array),normal=view(c.normal,Int16Array),color=view(c.color,Uint8Array),index=view(c.index,Uint32Array);if(position.length%3||normal.length!==position.length||color.length!==position.length||index.length%3)fail('顶点/索引数量');const count=position.length/3;
  for(let at=0;at<index.length;at++){if(index[at]>=count)fail('顶点或索引值');if(at%16384===16383)yield;}
  for(let at=0;at<position.length;at++){if(!Number.isFinite(position[at]))fail('顶点或索引值');if(at%16384===16383)yield;}
  triangles+=index.length/3;vertices+=count;decoded.push({position,normal,color,index});yield;
 }
 spans.sort((a,b)=>a[0]-b[0]);if(spans.some((s,i)=>i&&s[0]<spans[i-1][1]))fail('属性缓冲区重叠');
 if(triangles!==manifest.geometry.triangles||vertices!==manifest.geometry.vertices)fail('总量不匹配');return decoded;
}
export function decodeBenchmarkMap(manifest,buffer){const steps=decodeSteps(manifest,buffer);let result;do{result=steps.next();}while(!result.done);return result.value;}
export async function decodeBenchmarkMapAsync(manifest,buffer,{maxSliceMs=3,yieldTask=()=>globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(resolve=>setTimeout(resolve,0))}={}){
 const steps=decodeSteps(manifest,buffer);let since=performance.now();for(;;){const result=steps.next();if(result.done)return result.value;if(performance.now()-since>=maxSliceMs){await yieldTask();since=performance.now();}}
}
