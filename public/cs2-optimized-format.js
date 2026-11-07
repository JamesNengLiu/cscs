export async function decodeOptimizedMap(manifest,buffer){
 const fail=why=>{throw Error('优化地图包无效：'+why);};if(manifest?.format!=='cs2-map-optimized-v1'||buffer.byteLength!==manifest.geometry.bytes)fail('格式或长度');
 const groups=manifest.geometry.groups;if(!Array.isArray(groups)||groups.length<1||groups.length>2000)fail('材质批次');const spans=[],decoded=[];let vertices=0,triangles=0,last=performance.now();
 const yieldTask=async()=>{if(performance.now()-last>3){await(globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(r=>setTimeout(r,0)));last=performance.now();}};
 for(const group of groups){const d={};for(const [key,Type,width]of [['position',Float32Array,3],['normal',Int16Array,3],['tangent',Int16Array,4],['uv',Float32Array,2],['uv1',Float32Array,2],['blend',Uint8Array,4],['color',Uint8Array,3],['index',Uint32Array,0]]){
   const s=group[key];if(!s||!Number.isSafeInteger(s.offset)||!Number.isSafeInteger(s.length)||s.offset<0||s.length<1||s.offset%Type.BYTES_PER_ELEMENT||s.offset+s.length*Type.BYTES_PER_ELEMENT>buffer.byteLength)fail('属性范围');if(width&&s.length!==group.vertices*width)fail('属性数量');spans.push([s.offset,s.offset+s.length*Type.BYTES_PER_ELEMENT]);d[key]=new Type(buffer,s.offset,s.length);
  }
  if(!manifest.materials[group.material]||!['ambient','lightmap'].includes(group.mode)||d.index.length%3)fail('材质/索引');
  for(let i=0;i<d.index.length;i++){if(d.index[i]>=group.vertices)fail('索引越界');if(i%65536===65535)await yieldTask();}
  for(const key of ['position','uv','uv1'])for(let i=0;i<d[key].length;i++){if(!Number.isFinite(d[key][i]))fail('非有限属性');if(i%65536===65535)await yieldTask();}
  if(!Array.isArray(group.parts)||!group.parts.length||group.parts.length>50000)fail('可见性分区数量');
  let cursor=0;for(const part of group.parts){if(part.start!==cursor||part.count<=0||part.count%3||!manifest.visibility.lists[part.visibility])fail('可见性分区');if(!['min','max'].every(key=>Array.isArray(part.bounds?.[key])&&part.bounds[key].length===3&&part.bounds[key].every(Number.isFinite))||part.bounds.min.some((v,k)=>v>part.bounds.max[k]))fail('分区边界');cursor+=part.count;}if(cursor!==d.index.length)fail('分区覆盖');
  vertices+=group.vertices;triangles+=d.index.length/3;decoded.push(d);await yieldTask();
 }
 spans.sort((a,b)=>a[0]-b[0]);if(spans.some((s,i)=>i&&s[0]<spans[i-1][1]))fail('重叠');if(vertices!==manifest.geometry.vertices||triangles!==manifest.geometry.triangles)fail('总量');return decoded;
}
export function createWorkingIndices(vertices,length){if(!Number.isSafeInteger(vertices)||vertices<1||!Number.isSafeInteger(length)||length<1)throw Error('Invalid index capacity');return vertices<=65536?new Uint16Array(length):new Uint32Array(length);}
