import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollisionWorld,compileCollisionData} from '../public/cs2-collision.js';

const point=(x,y,z)=>({x,y,z});
const box=(id,min,max)=>({id,type:'hull',vertices:[min[0],min[1],min[2],max[0],min[1],min[2],max[0],min[1],max[2],min[0],min[1],max[2],min[0],max[1],min[2],max[0],max[1],min[2],max[0],max[1],max[2],min[0],max[1],max[2]],planes:[[1,0,0,max[0]],[-1,0,0,-min[0]],[0,1,0,max[1]],[0,-1,0,-min[1]],[0,0,1,max[2]],[0,0,-1,-min[2]]]});
const wall=(id,x,z=0)=>({id,type:'mesh',vertices:[x,0,z-2,x,3,z-2,x,3,z+2,x,0,z+2],indices:[0,1,2,0,2,3],twoSided:true});
const floor=id=>({id,type:'mesh',vertices:[0,0,-2,4,0,-2,4,0,2,0,0,2],indices:[0,2,1,0,3,2],twoSided:true});
const world=(shapes,compiled)=>{const data={schema:'cs2-physics-v1',units:'metres',shapes};return createCollisionWorld(compiled?compileCollisionData(data):data);};
const counters=w=>{const s=w.stats();return Object.fromEntries(['queries','nodes','candidates','narrowPhase'].map(k=>[k,s[k]]));};
// Explicit zero halfExtents retains the original broadphase while invoking
// the very same point narrow-phase, output, tie, startSolid and skin kernels.
function compared(w,a,b,channel='bullet'){
 w.resetStats();const reference=w.trace(a,b,0,{radius:0,halfExtents:[0,0,0],channel}),originalWork=counters(w);
 w.resetStats();const accelerated=w.trace(a,b,0,{radius:0,channel}),acceleratedWork=counters(w);
 assert.deepStrictEqual(accelerated,reference);
 return{hit:accelerated,originalWork,acceleratedWork};
}
function grid(){const shapes=[box('hull-off-ray',[5,1,10],[6,3,11])];for(let x=1;x<=20;x++)for(let z=1;z<=20;z++)shapes.push({id:`triangle-${x}-${z}`,type:'mesh',vertices:[x*2,0,z*2-.25,x*2,4,z*2-.25,x*2,2,z*2+.25],indices:[0,1,2],twoSided:true});return shapes;}

for(const compiled of [false,true]){
 const backend=compiled?'compiled':'raw';
 test(`${backend}: expanded hull planes keep grazing hits outside their vertex AABB`,()=>{
  const hull=box('expanded',[0,0,0],[1,1,1]);hull.planes=hull.planes.map(p=>[p[0],p[1],p[2],p[3]+.001]);
  // x+z=2.0005 never intersects the vertex box, but intersects this valid
  // authored plane volume. Unconditional node/primitive slabs would miss it.
  for(const shapes of [[hull],[hull,wall('mixed-leaf',4)]]){
   const w=world(shapes,compiled),r=compared(w,point(0,.5,2.0005),point(2.0005,.5,0));
   assert.equal(r.hit.shape,'expanded');assert.ok(r.hit.fraction<1);assert.equal(r.hit.startSolid,false);
  }
 });
 test(`${backend}: mixed trees reject distant triangles without reordering hulls or accepted hits`,()=>{
  const w=world(grid(),compiled),r=compared(w,point(0,2,0),point(42,2,42));
  assert.equal(r.hit.shape,'triangle-1-1');assert.ok(r.originalWork.candidates>=400);
  assert.ok(r.acceleratedWork.candidates<r.originalWork.candidates/5,JSON.stringify(r));
  assert.ok(r.acceleratedWork.narrowPhase<r.originalWork.narrowPhase/5);
 });
 test(`${backend}: equal-fraction normal priority, stable ties and first startSolid remain unchanged`,()=>{
  const w=world([wall('vertical',2),floor('floor-first'),floor('floor-second')],compiled);
  const r=compared(w,point(0,2,0),point(4,-2,0));assert.equal(r.hit.shape,'floor-first');assert.deepEqual(r.hit.normal,[0,1,0]);
  const solid=world([box('first',[-1,-1,-1],[2,2,2]),box('second',[-2,-2,-2],[1,1,1]),wall('far',8)],compiled);
  const s=compared(solid,point(0,.5,0),point(20,.5,1));assert.equal(s.hit.startSolid,true);assert.equal(s.hit.shape,'first');assert.equal(s.hit.fraction,0);
 });
 test(`${backend}: grazing triangle edges, near-parallel axes and segment endpoint tolerance match original collector`,()=>{
  const w=world([wall('sheet',4)],compiled),offsets=[-4e-7,-2e-7,-1e-8,-1e-10,0,1e-10,1e-8,2e-7,4e-7];
  for(const dy of offsets)for(const dz of offsets)for(const reverse of [false,true]){
   let a=point(0,3+dy,2+dz),b=point(8,3+dy+1e-14,2+dz-1e-14);if(reverse)[a,b]=[b,a];compared(w,a,b);
  }
  for(const dx of [-8e-9,-4e-9,-2e-9,0,2e-9,4e-9,8e-9])compared(w,point(0,1,0),point(4+dx,1,0));
  for(const a of [point(4,1,0),point(4+1e-9,1,0),point(0,0,0)])compared(w,a,{...a});
 });
 test(`${backend}: body, radius and explicit halfExtents queries retain broadphase work and output`,()=>{
  const w=world(grid(),compiled),a=point(0,2,0),b=point(42,2,42),fast=compared(w,a,b);
  for(const [height,options,referenceOptions]of [
   [1.8,{radius:.4},{radius:.4,halfExtents:[.4,.9,.4]}],
   [0,{radius:.4},{radius:.4,halfExtents:[.4,.4,.4]}],
   [0,{radius:0,halfExtents:[0,0,0]},{radius:0,halfExtents:[0,0,0]}]
  ]){
   w.resetStats();const hit=w.trace(a,b,height,options),work=counters(w);
   w.resetStats();assert.deepStrictEqual(hit,w.trace(a,b,height,referenceOptions));assert.deepStrictEqual(work,counters(w));
   assert.ok(work.candidates>fast.acceleratedWork.candidates*5);
  }
  w.resetStats();const intervals=w.rayIntervals(a,b,{channel:'bullet'}),work=counters(w);assert.ok(intervals.surfaces.length>0);assert.equal(work.candidates,fast.originalWork.candidates);
 });
 test(`${backend}: seeded mixed-world point rays match original collection across channels`,()=>{
  const shapes=grid();shapes[0].channels=['player'];shapes[1].channels=['grenade'];const w=world(shapes,compiled);
  let seed=0x51abbabe;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  for(let i=0;i<2000;i++){const a=point(random()*44-1,random()*6-1,random()*44-1),b=i%31===0?{...a}:point(random()*44-1,random()*6-1,random()*44-1);compared(w,a,b,['bullet','player','grenade','audio','all'][i%5]);}
 });
}
