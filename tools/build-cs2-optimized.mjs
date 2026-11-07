// Repack the verified textured benchmark; preserve every vertex, triangle, UV
// and material. Original generated packages stay intact as the control.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';import assert from 'node:assert/strict';import {gzipSync,gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {decodeTexturedMap} from '../public/cs2-textured-format.js';
import {createWorldVisibility} from '../public/cs2-visibility.js';
const sourceDir='public/assets/cs2-textured',out='public/assets/cs2-optimized';await mkdir(out,{recursive:true});
const original=JSON.parse(await readFile(path.join(sourceDir,'map.json'),'utf8')),packed=gunzipSync(await readFile(path.join(sourceDir,original.geometry.file))),buffer=packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength),decoded=await decodeTexturedMap(original,buffer);
const visArg=process.argv.indexOf('--visibility-dir'),visDir=visArg<0?'.local/cs2/optimized':process.argv[visArg+1];
const visMeta=JSON.parse(await readFile(path.join(visDir,'visibility.json'),'utf8')),visBytes=await readFile(path.join(visDir,'visibility.bin')),vis=createWorldVisibility(visMeta,visBytes.buffer.slice(visBytes.byteOffset,visBytes.byteOffset+visBytes.byteLength));
const schema=[['position',Float32Array,3],['normal',Int16Array,3],['tangent',Int16Array,4],['uv',Float32Array,2],['uv1',Float32Array,2],['blend',Uint8Array,4],['color',Uint8Array,3]];
const groups=new Map();for(let i=0;i<decoded.length;i++){const c=original.geometry.chunks[i],key=c.material+':'+c.mode;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);}
const blobs=[],batches=[];let offset=0;
const clusterLists=[],clusterIds=new Map();
function clusterList(lo,hi){const list=vis.boxClusters(lo,hi),key=list.join(',');if(!clusterIds.has(key)){clusterIds.set(key,clusterLists.length);clusterLists.push(list);}return clusterIds.get(key);}
const append=array=>{const pad=(4-offset%4)%4;if(pad){blobs.push(Buffer.alloc(pad));offset+=pad;}const b=Buffer.from(array.buffer,array.byteOffset,array.byteLength),spec={offset,length:array.length};blobs.push(b);offset+=b.length;return spec;};
let queryAt=performance.now();
for(const [key,list]of groups){
 const material=original.materials[original.geometry.chunks[list[0]].material],flags=material.IntParams;
 const masked=[1,2].includes(flags.F_ALPHA_TEST)||material.alphaMode==='MASK',transparent=!masked&&(flags.F_TRANSLUCENT===1||material.alphaMode==='BLEND');
 const vertices=list.reduce((s,i)=>s+decoded[i].position.length/3,0),indexCount=list.reduce((s,i)=>s+decoded[i].index.length,0),attributes={};
 for(const [name,Type,width]of schema){const a=new Type(vertices*width);let cursor=0;for(const i of list){a.set(decoded[i][name],cursor);cursor+=decoded[i][name].length;}attributes[name]=append(a);}
 const indices=new Uint32Array(indexCount),parts=[],cells=new Map();let vertexOffset=0,indexOffset=0;
 for(const i of list){const d=decoded[i];
  for(let at=0;at<d.index.length;at+=3){const center=[0,0,0];for(let k=0;k<3;k++)for(let axis=0;axis<3;axis++)center[axis]+=d.position[d.index[at+k]*3+axis]/3;
   const cellKey=transparent?'original:'+i:center.map(x=>Math.floor(x/4)).join(':');let cell=cells.get(cellKey);if(!cell){cell={ids:[],min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};cells.set(cellKey,cell);}
   for(let k=0;k<3;k++){const id=d.index[at+k];cell.ids.push(id+vertexOffset);for(let axis=0;axis<3;axis++){const value=d.position[id*3+axis];cell.min[axis]=Math.min(cell.min[axis],value);cell.max[axis]=Math.max(cell.max[axis],value);}}
  }vertexOffset+=d.position.length/3;
 }
 for(const cell of cells.values()){
  indices.set(cell.ids,indexOffset);parts.push({start:indexOffset,count:cell.ids.length,bounds:{min:cell.min,max:cell.max},visibility:clusterList(cell.min,cell.max)});indexOffset+=cell.ids.length;
 }
 const first=original.geometry.chunks[list[0]];batches.push({key,material:first.material,mode:first.mode,vertices,...attributes,index:append(indices),parts});
}
const binary=Buffer.concat(blobs),compressed=gzipSync(binary,{level:9});
const manifest={...original,format:'cs2-map-optimized-v1',geometry:{...original.geometry,file:'map.bin.gz',bytes:binary.length,downloadBytes:compressed.length,sha256:createHash('sha256').update(binary).digest('hex'),batches:batches.length,chunks:undefined,groups:batches},visibility:{...visMeta,file:'visibility.bin.gz',downloadBytes:0,lists:clusterLists},optimization:{sourceGeometrySHA256:original.geometry.sha256,cellMetres:4,method:'Exact attribute concatenation by material/lighting mode; source PVS conservative 4m bounds; no triangle/position/UV simplification',sourceChunks:decoded.length}};
const compressedVis=gzipSync(visBytes,{level:9});manifest.visibility.downloadBytes=compressedVis.length;
await writeFile(path.join(out,'map.bin.gz'),compressed);await writeFile(path.join(out,'visibility.bin.gz'),compressedVis);await writeFile(path.join(out,'map.json'),JSON.stringify(manifest));
const rows=[];for(const team of ['T','CT']){const s=original.spawns.find(s=>s.team===team),eye=s.position.map((v,i)=>v+(i===1?1.65:0)),row=vis.row(eye);let count=0,triangles=0;for(const batch of batches)for(const part of batch.parts)if(vis.visible(row,clusterLists[part.visibility])){count++;triangles+=part.count/3;}rows.push({team,hasPVS:!!row,visibleParts:count,triangles});}
assert.equal(batches.reduce((s,b)=>s+b.index.length/3,0),original.geometry.triangles);
console.log(JSON.stringify({batches:batches.length,parts:batches.reduce((s,b)=>s+b.parts.length,0),bytes:binary.length,compressedBytes:compressed.length,visibilityBytes:compressedVis.length,seconds:(performance.now()-queryAt)/1000,views:rows}));
