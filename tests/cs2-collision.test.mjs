import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollisionWorld} from '../public/cs2-collision.js';
import {slideMove} from '../public/movement-collision.js';
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
const box=(id,min,max,extra={})=>({id,type:'hull',vertices:[min[0],min[1],min[2],max[0],min[1],min[2],max[0],min[1],max[2],min[0],min[1],max[2],min[0],max[1],min[2],max[0],max[1],min[2],max[0],max[1],max[2],min[0],max[1],max[2]],planes:[[1,0,0,max[0]],[-1,0,0,-min[0]],[0,1,0,max[1]],[0,-1,0,-min[1]],[0,0,1,max[2]],[0,0,-1,-min[2]]],...extra});
const world=(shapes,extra={})=>createCollisionWorld({schema:'cs2-physics-v1',units:'metres',shapes,...extra});
const floor=()=>box('floor',[-20,-1,-20],[20,0,20]);
const flat=()=>({id:'mesh-floor',type:'mesh',vertices:[-10,0,-10,10,0,-10,10,0,10,-10,0,10],indices:[0,2,1,0,3,2],twoSided:true});

for(const shape of ['hull','mesh'])test(`resting contact does not embed, snag tangential travel or block separation (${shape})`,()=>{
 const w=world([shape==='hull'?floor():flat()]);assert.equal(w.collides(0,0,.4,0,1.8),false);assert.equal(w.trace({x:0,y:0,z:0},{x:3,y:0,z:2},1.8).fraction,1);assert.equal(w.trace({x:0,y:0,z:0},{x:0,y:2,z:0},1.8).fraction,1);
 const hit=w.trace({x:0,y:.01,z:0},{x:0,y:-.1,z:0},1.8);assert.equal(hit.startSolid,false);near(hit.end.y,.0005);near(hit.normal[1],1);assert.equal(w.isGrounded({x:0,y:.0005,z:0,vy:0}),true);assert.equal(w.isGrounded({x:0,y:.0005,z:0,vy:1}),false);
});
test('continuous standing sweep hits a thin wall before crossing it at high speed',()=>{
 const w=world([floor(),box('thin',[2,0,-2],[2.001,4,2])]);const h=w.trace({x:0,y:.001,z:0},{x:100,y:.001,z:0},1.8);near(h.end.x,1.5995);assert.deepEqual(h.normal,[-1,0,0]);assert.equal(h.shape,'thin');assert.equal(h.startSolid,false);
 assert.equal(w.trace({x:1.6,y:.001,z:0},{x:0,y:.001,z:0},1.8).fraction,1);assert.equal(w.trace({x:1.6,y:.001,z:0},{x:1.6,y:.001,z:1},1.8).fraction,1);
});
test('hull interior is startSolid while contact and clear space are not',()=>{
 const w=world([box('wall',[0,0,0],[2,4,2])]);assert.equal(w.collides(1,1,.4,.1,1.8),true);assert.equal(w.collides(-.4,1,.4,.1,1.8),false);assert.equal(w.trace({x:1,y:1,z:1},{x:4,y:1,z:1}).startSolid,true);assert.equal(w.trace({x:-.1,y:1,z:1},{x:-.1,y:1,z:1}).startSolid,false);
});
test('convex/body edge bevel prevents a diamond-tip corner becoming an oversized blocker',()=>{
 const h={id:'diamond',type:'hull',vertices:[1,0,0,0,0,1,-1,0,0,0,0,-1,1,2,0,0,2,1,-1,2,0,0,2,-1],planes:[[1,0,1,1],[1,0,-1,1],[-1,0,1,1],[-1,0,-1,1],[0,1,0,2],[0,-1,0,0]]};const w=world([h]);assert.equal(w.collides(1.6,0,.4,.1,1.8),false);assert.equal(w.collides(1.2,0,.4,.1,1.8),true);const hit=w.trace({x:2,y:.1,z:0},{x:0,y:.1,z:0},1.8);near(hit.end.x,1.4005);near(hit.normal[0],1);
});
test('triangle body sweep uses edge axes and does not tunnel through a zero-thickness wall',()=>{
 const w=world([{id:'sheet',type:'mesh',vertices:[2,0,-2,2,4,-2,2,4,2,2,0,2],indices:[0,1,2,0,2,3]}]);const hit=w.trace({x:0,y:.1,z:0},{x:100,y:.1,z:0},1.8);near(hit.end.x,1.5995);near(hit.normal[0],-1);assert.equal(w.trace({x:0,y:.1,z:4},{x:100,y:.1,z:4},1.8).fraction,1);
});
test('body support on a ramp differs from the centre point and has the authored slope normal',()=>{
 const ramp={id:'ramp',type:'hull',vertices:[-4,-1,-2,4,-1,-2,4,4,-2,-4,0,-2,-4,-1,2,4,-1,2,4,4,2,-4,0,2],planes:[[-1,0,0,4],[1,0,0,4],[0,-1,0,1],[-.5,1,0,2],[0,0,1,2],[0,0,-1,2]]};const w=world([ramp]);const ray=w.findSupport(0,0,5),body=w.findSupport(0,0,5,{height:1.8,radius:.4});near(ray.end.y,2+.0005/Math.sqrt(.8));near(body.end.y,2.2+.0005/Math.sqrt(.8));near(body.normal[1],Math.sqrt(.8));assert.equal(w.collides(0,0,.4,body.end.y,1.8),false);assert.equal(w.collides(0,0,.4,2,1.8),true);
 const moved=slideMove(body.end,[2,0,0],.1,(a,b)=>w.trace(a,b,1.8),{airborne:false});assert.ok(moved.pos.x>0);assert.ok(moved.pos.y>body.end.y);assert.equal(w.collides(moved.pos.x,moved.pos.z,.4,moved.pos.y,1.8),false);
});
test('standing under a low ceiling is blocked while crouched body fits',()=>{
 const w=world([floor(),box('ceiling',[-2,1.4,-2],[2,1.6,2])]);assert.equal(w.collides(0,0,.4,.001,1.8),true);assert.equal(w.collides(0,0,.4,.001,.9),false);const up=w.trace({x:0,y:.001,z:0},{x:0,y:1,z:0},.9);near(up.end.y,.4995);near(up.normal[1],-1);
});
test('channel filters preserve player-clip, pass-bullet and grenade-only semantics',()=>{
 const w=world([box('clip',[1,0,-1],[1.1,3,1],{channels:['player']}),box('grenade',[2,0,-1],[2.1,3,1],{channels:['grenade']}),box('wall',[3,0,-1],[3.1,3,1],{channels:['player','bullet','grenade','audio']})]);const a={x:0,y:1,z:0},b={x:4,y:1,z:0};assert.equal(w.trace(a,b).shape,'wall');assert.equal(w.trace(a,b,0,{channel:'player'}).shape,'clip');assert.equal(w.trace(a,b,0,{channel:'grenade'}).shape,'grenade');assert.equal(w.trace(a,b,0,{channel:'audio'}).shape,'wall');
});
test('per-triangle surface labels and unresolved real hashes are returned without guessing',()=>{
 const mesh=flat();mesh.triangleMaterials=[0,1];mesh.material='default-concrete';const w=world([mesh],{materials:[{hash:'12345678',name:'stone'},{hash:'abcdef01',name:null}]});const a=w.raycast({x:5,y:1,z:0},{x:5,y:-1,z:0}),b=w.raycast({x:-5,y:1,z:0},{x:-5,y:-1,z:0});assert.equal(a.material,'stone');assert.equal(a.materialHash,'12345678');assert.equal(b.material,null);assert.equal(b.materialHash,'abcdef01');
});
test('single-sided point rays respect authored winding while conservative body sweep remains two-sided',()=>{
 const shape=flat();shape.twoSided=false;const w=world([shape]);assert.ok(w.raycast({x:0,y:1,z:0},{x:0,y:-1,z:0}).fraction<1);assert.equal(w.raycast({x:0,y:-1,z:0},{x:0,y:1,z:0}).fraction,1);assert.ok(w.trace({x:0,y:-2,z:0},{x:0,y:1,z:0},.9).fraction<1);
});
test('BVH limits local narrow-phase work rather than scanning the whole map',()=>{
 const shapes=[];for(let x=0;x<40;x++)for(let z=0;z<40;z++)shapes.push(box(x+':'+z,[x*4,0,z*4],[x*4+1,2,z*4+1]));const w=world(shapes);w.resetStats();w.raycast({x:-1,y:1,z:.5},{x:2,y:1,z:.5});const s=w.stats();assert.ok(s.narrowPhase<10,JSON.stringify(s));assert.ok(s.nodes<40,JSON.stringify(s));assert.ok(s.maxMs>=0);assert.equal(s.shapes,1600);
});
test('corrupt geometry, dimensions, material indices and unknown filters fail explicitly',()=>{
 assert.throws(()=>createCollisionWorld({schema:'bad',units:'metres',shapes:[]}),/world/);assert.throws(()=>world([{...flat(),indices:[0,1,999]}]),/indices/);assert.throws(()=>world([{...floor(),channels:['unknown']}]),/channels/);assert.throws(()=>world([{...flat(),triangleMaterials:[5,5]}],{materials:[]}),/materials/);const w=world([floor()]);assert.throws(()=>w.trace({x:NaN,y:1,z:0},{x:0,y:0,z:0}),/start/);assert.throws(()=>w.trace({x:0,y:1,z:0},{x:0,y:0,z:0},-1),/height/);assert.throws(()=>w.trace({x:0,y:1,z:0},{x:0,y:0,z:0},0,{radius:-1}),/radius/);
});
