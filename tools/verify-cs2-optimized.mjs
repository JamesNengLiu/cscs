import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {gunzipSync} from 'node:zlib';
import {decodeTexturedMap} from '../public/cs2-textured-format.js';import {decodeOptimizedMap} from '../public/cs2-optimized-format.js';
const old=JSON.parse(await readFile('public/assets/cs2-textured/map.json','utf8')),current=JSON.parse(await readFile('public/assets/cs2-optimized/map.json','utf8'));
const load=async file=>{const b=gunzipSync(await readFile(file));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const [a,b]=await Promise.all([decodeTexturedMap(old,await load('public/assets/cs2-textured/'+old.geometry.file)),decodeOptimizedMap(current,await load('public/assets/cs2-optimized/'+current.geometry.file))]);
assert.deepEqual(current.source,old.source);assert.deepEqual(current.geometry.bounds,old.geometry.bounds);assert.deepEqual(current.materials,old.materials);assert.equal(current.geometry.triangles,old.geometry.triangles);
const byKey=new Map();old.geometry.chunks.forEach((c,i)=>{const key=c.material+':'+c.mode;if(!byKey.has(key))byKey.set(key,[]);byKey.get(key).push(i);});let verified=0;
const byteView=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
for(let i=0;i<b.length;i++){const g=current.geometry.groups[i],parts=byKey.get(g.key);assert.ok(parts);assert.ok(g.vertices<2**21);
 for(const key of ['position','normal','tangent','uv','uv1','blend','color']){let cursor=0;for(const part of parts){const src=byteView(a[part][key]),dst=byteView(b[i][key]).subarray(cursor,cursor+src.length);assert.ok(src.equals(dst),'Changed authored '+key);cursor+=src.length;}assert.equal(cursor,b[i][key].byteLength);}
 const count=b[i].index.length/3,expected=new BigUint64Array(count),actual=new BigUint64Array(count);let at=0,base=0;
 const signature=(x,y,z)=>BigInt(x)|(BigInt(y)<<21n)|(BigInt(z)<<42n);
 for(const part of parts){const ids=a[part].index;for(let k=0;k<ids.length;k+=3)expected[at++]=signature(ids[k]+base,ids[k+1]+base,ids[k+2]+base);assert.ok(a[part].baked.every(x=>x===0));base+=a[part].position.length/3;}
 for(let k=0;k<b[i].index.length;k+=3)actual[k/3]=signature(b[i].index[k],b[i].index[k+1],b[i].index[k+2]);
 expected.sort();actual.sort();assert.ok(byteView(expected).equals(byteView(actual)),'Missing, duplicated or rewound triangle');verified+=count;
}
const native=JSON.parse(await readFile('public/assets/cs2-textured/textures.json','utf8')),tiers=JSON.parse(await readFile('public/assets/cs2-optimized/textures.json','utf8'));
let mipChains=0;for(const [name,tier]of Object.entries(tiers.textures)){const ref=native.textures[name];assert.equal(tier.full.sha256,ref.sha256);assert.equal(tier.full.format,ref.format);assert.deepEqual(tier.full.mips,ref.mips);const raw=gunzipSync(await readFile('public/assets/cs2-textured/'+ref.file)),preview=gunzipSync(await readFile('public/assets/cs2-optimized/'+tier.preview.file));const first=ref.mips.find(m=>m.sourceLevel===tier.preview.mips[0].sourceLevel);assert.ok(raw.subarray(first.offset).equals(preview),'Preview is not the authored mip tail');mipChains++;}
console.log(JSON.stringify({exactTriangleCoverage:verified,exactPositionNormalTangentUVBlendColor:true,materialsUnchanged:true,boundsUnchanged:true,authoredNativeMipChains:mipChains}));
