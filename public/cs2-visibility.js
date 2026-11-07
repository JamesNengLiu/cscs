// Source 2 VXVS mask-octree queries; independent JS implementation of the public
// layout described by ValveResourceFormat/Blocks/VoxelVisibility.cs (MIT).
// https://github.com/ValveResourceFormat/ValveResourceFormat
// Unknown/outside/solid positions always fall back to all-visible.
export function createWorldVisibility(meta,buffer){
 if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==meta.bytes||meta.clusterCount!==4096||meta.bytesPerRow!==512)throw Error('Invalid visibility header');
 function block(name,Type,width=1){const spec=meta[name];if(!spec||!Number.isInteger(spec.offset)||!Number.isInteger(spec.count)||spec.offset<0||spec.count<0||spec.offset%Type.BYTES_PER_ELEMENT||spec.offset+spec.count*width*Type.BYTES_PER_ELEMENT>buffer.byteLength)throw Error('Invalid visibility block');return new Type(buffer,spec.offset,spec.count*width);}
 const nodes=block('m_NodeBlock',Uint32Array,2),regions=block('m_RegionBlock',Uint32Array,2),masks=block('m_MasksBlock',Uint32Array,2),lists=block('m_EnclosedClusterListBlock',Uint32Array,2),clusters=block('m_EnclosedClustersBlock',Uint16Array),pvs=block('m_nVisBlocks',Uint8Array);
 if(pvs.length<4096*512||nodes.length<2)throw Error('Incomplete visibility table');
 const visited=new Uint8Array(nodes.length/2),stack=[0];
 while(stack.length){const i=stack.pop();if(i>=visited.length||visited[i])throw Error('Invalid visibility tree');visited[i]=1;const first=nodes[i*2],second=nodes[i*2+1],offset=first>>>1;
  if(first&1){if(offset+(second&255)>regions.length/2)throw Error('Invalid visibility leaf');}else for(let k=0;k<8;k++)stack.push(offset+k);
 }
 for(let i=0;i<regions.length;i+=2)if((regions[i+1]>>>8)>=masks.length/2||(regions[i]&0x7fff)>=4096)throw Error('Invalid visibility region');
 const toSource=p=>[p[2]/.0254,p[0]/.0254,p[1]/.0254];
 const axisMasks=Array.from({length:3},(_,axis)=>Array.from({length:16},(_,cells)=>{let lo=0,hi=0;for(let bit=0;bit<64;bit++){const cell=(bit>>([0,2,4][axis]))&3;if(cells&(1<<cell)){if(bit<32)lo|=1<<bit;else hi|=1<<(bit-32);}}return[lo,hi];}));
 function leaf(point){let lo=meta.min.slice(),hi=meta.max.slice(),id=0;if(point.some((v,k)=>v<lo[k]||v>hi[k]))return null;
  for(let depth=0;depth<32;depth++){const a=nodes[id*2],b=nodes[id*2+1];if(a&1)return{id,lo,hi,start:a>>>1,count:b&255};let octant=0;for(let k=0;k<3;k++){const mid=(lo[k]+hi[k])/2;if(point[k]>mid){octant|=1<<k;lo[k]=mid;}else hi[k]=mid;}id=(a>>>1)+octant;}
  throw Error('Visibility tree depth exceeded');
 }
 function row(world){if(world.length!==3||!world.every(Number.isFinite))return null;const point=toSource(world),node=leaf(point);if(!node)return null;const cells=point.map((v,k)=>Math.max(0,Math.min(3,Math.ceil((v-node.lo[k])*4/(node.hi[k]-node.lo[k]))-1))),bit=cells[0]+4*cells[1]+16*cells[2],word=bit>>>5,mask=(1<<(bit&31))>>>0,ids=[];
  for(let i=node.start;i<node.start+node.count;i++){const at=(regions[i*2+1]>>>8)*2;if((masks[at+word]&mask)!==0)ids.push(regions[i*2]&0x7fff);}
  if(!ids.length)return null;const output=new Uint8Array(512);for(const id of ids)for(let k=0;k<512;k++)output[k]|=pvs[id*512+k];return output;
 }
 function boxClusters(worldMin,worldMax){const a=toSource(worldMin),b=toSource(worldMax),lo=a.map((v,k)=>Math.min(v,b[k])-1/32),hi=a.map((v,k)=>Math.max(v,b[k])+1/32),result=new Set();
  function walk(id,min,max){if(min.some((v,k)=>v>hi[k]||max[k]<lo[k]))return;const first=nodes[id*2],second=nodes[id*2+1],offset=first>>>1;
   if(!(first&1)){
    // Fully enclosed subtrees may use the compiler's conservative cluster list.
    const list=second>>>8;if(list!==0xffffff&&lo.every((v,k)=>v<=min[k]&&hi[k]>=max[k])){const start=lists[list*2],count=lists[list*2+1];if(start+count>clusters.length)throw Error('Invalid enclosed clusters');for(let k=start;k<start+count;k++)result.add(clusters[k]);return;}
    for(let oct=0;oct<8;oct++){const l=min.slice(),h=max.slice();for(let k=0;k<3;k++){const mid=(min[k]+max[k])/2;if(oct&(1<<k))l[k]=mid;else h[k]=mid;}walk(offset+oct,l,h);}return;
   }
   let low=-1,high=-1;const size=(max[0]-min[0])/4;
   for(let axis=0;axis<3;axis++){let cells=0;for(let k=0;k<4;k++)if(min[axis]+k*size<hi[axis]&&lo[axis]<min[axis]+(k+1)*size)cells|=1<<k;low&=axisMasks[axis][cells][0];high&=axisMasks[axis][cells][1];}
   for(let i=offset;i<offset+(second&255);i++){const at=(regions[i*2+1]>>>8)*2;if(((low&masks[at])|(high&masks[at+1]))!==0)result.add(regions[i*2]&0x7fff);}
  }
  walk(0,meta.min,meta.max);return [...result].sort((a,b)=>a-b);
 }
 return{row,boxClusters,toSource,visible:(row,list)=>!row||!list.length||list.some(id=>(row[id>>>3]&(1<<(id&7)))!==0),clusterCount:4096};
}
