import test from 'node:test';import assert from 'node:assert/strict';
import {createExperimentalWorld,PINNED_CS2_MAP_SHA1} from '../public/cs2-world.js';
import {metersPointToSource} from '../public/experimental-world-contract.js';

function box(id,min,max,channels=['player','bullet','grenade','audio']){const vertices=[];for(const x of [min[0],max[0]])for(const y of [min[1],max[1]])for(const z of [min[2],max[2]])vertices.push(x,y,z);return{id,type:'hull',vertices,channels,planes:[[1,0,0,max[0]],[-1,0,0,-min[0]],[0,1,0,max[1]],[0,-1,0,-min[1]],[0,0,1,max[2]],[0,0,-1,-min[2]]]};}
const spawn=(x=0,y=.02,z=0)=>({position:[x,y,z],sourceOrigin:metersPointToSource({x,y,z}),sourceAngles:[0,0,0],sourceId:'authored-start'});
function fixture(){const data={schema:'cs2-physics-v1',units:'metres',source:{mapSHA1:PINNED_CS2_MAP_SHA1,coordinateMapping:'(SourceY,SourceZ,SourceX)*.0254'},materials:[],shapes:[box('floor',[-20,-2,-20],[20,0,20])],spawns:{T:[spawn()],CT:[spawn(4)]},triggers:[{id:'site-a',kind:'bombsite',name:'A',team:null,materials:[],shapes:[box('site-a-volume',[-2,-1,-2],[2,2,2],[])]},{id:'buy-t',kind:'buyzone',name:null,team:'T',materials:[],shapes:[box('buy-t-volume',[-2,-1,-2],[2,2,2],[])]},{id:'buy-ct',kind:'buyzone',name:null,team:'CT',materials:[],shapes:[box('buy-ct-volume',[2,-1,-2],[6,2,2],[])]}]};return{data,packageManifest:{schema:'cs2-physics-package-v1',mapSHA1:PINNED_CS2_MAP_SHA1,sha256:'a'.repeat(64)},renderManifest:{source:{mapSHA1:PINNED_CS2_MAP_SHA1}}};}
const build=f=>createExperimentalWorld(f.data,f);
test('new world composes collision, transitional movement and strict render/physics identity',()=>{
 const f=fixture(),w=build(f);assert.equal(w.contract.sourceSHA1,PINNED_CS2_MAP_SHA1);assert.equal(w.contract.collisionSHA256,'a'.repeat(64));assert.equal(w.movement.fixedDt,1/60);assert.equal(w.integrityVerified,false);
 assert.equal(createExperimentalWorld(f.data,{...f,verifiedPhysicsSHA256:'a'.repeat(64)}).integrityVerified,true);
 for(const mutate of [f=>f.renderManifest.source.mapSHA1='b'.repeat(40),f=>f.packageManifest.mapSHA1='c'.repeat(40),f=>f.data.source.coordinateMapping='legacy-XZY/40',f=>f.packageManifest.sha256='bad',f=>f.packageManifest.shapes=0]){const f=fixture();mutate(f);assert.throws(()=>build(f),/mismatch|Invalid/);}
 assert.throws(()=>createExperimentalWorld(f.data,{...f,verifiedPhysicsSHA256:'b'.repeat(64)}),/integrity mismatch/);
});
test('authored trigger volumes answer sites and team buyzones without blocking movement or bullet rays',()=>{
 const w=build(fixture()),p=w.resolveSpawn('T');assert.equal(w.siteAt(p).name,'A');assert.equal(w.buyZoneAt(p,'T'),true);assert.equal(w.buyZoneAt(p,'CT'),false);assert.equal(w.buyZoneAt({...p,x:4},'CT'),true);assert.equal(w.siteAt({...p,x:9}),null);assert.equal(w.buyZoneAt(p,'spectator'),false);
 assert.equal(w.collision.trace({x:-3,y:1,z:0},{x:3,y:1,z:0}).fraction,1);
 const f=fixture();f.data.triggers[0].shapes[0].channels=['player'];assert.throws(()=>build(f),/Trigger must not join/);
});
test('safe spawn keeps authored horizontal placement, checks the real body and reports its adjustment',()=>{
 const f=fixture(),w=build(f),p=w.resolveSpawn('T');assert.equal(p.x,0);assert.equal(p.z,0);assert.ok(Math.abs(p.y-.0005)<1e-7);assert.equal(p.grounded,true);assert.equal(p.support.shape,'floor');assert.deepEqual(p.anchor,{x:0,y:.02,z:0});assert.ok(p.adjustment.y<0);assert.equal(w.collision.collides(p.x,p.z,w.movement.rules.radius,p.y,w.movement.bodyHeight(p)),false);
 assert.throws(()=>w.resolveSpawn('CT',99),/Invalid experimental spawn/);assert.throws(()=>w.resolveSpawn('legacy'),/Invalid experimental spawn/);assert.ok(Object.isFrozen(w.spawns.T[0].position));
 const changed=fixture();changed.data.spawns.T[0].position[0]+=.1;assert.throws(()=>build(changed),/coordinate mismatch/);
});
test('a tiny original feet overlap may lift out of its own floor, while a roof cannot be crossed',()=>{
 const f=fixture();f.data.spawns.T=[spawn(0,-.02,0)];const p=build(f).resolveSpawn('T');assert.ok(p.adjustment.probeLift>0);assert.ok(p.y>=0&&p.y<.001);
 const roof=fixture();roof.data.shapes.push(box('roof',[-1,.2,-1],[1,.3,1]));assert.throws(()=>build(roof).resolveSpawn('T'),/No safe authored/);
});
test('slope spawn uses body sweep support rather than placing the feet at the centre-point floor',()=>{
 const f=fixture();f.data.shapes.push({id:'slope',type:'hull',vertices:[-4,-1,-2,4,-1,-2,4,4,-2,-4,0,-2,-4,-1,2,4,-1,2,4,4,2,-4,0,2],planes:[[-1,0,0,4],[1,0,0,4],[0,-1,0,1],[-.5,1,0,2],[0,0,1,2],[0,0,-1,2]]});f.data.spawns.T=[spawn(0,2.0005,0)];const w=build(f),p=w.resolveSpawn('T');assert.ok(p.y>2.2);assert.equal(w.collision.collides(p.x,p.z,.4,p.y,1.8),false);assert.ok(p.adjustment.probeLift>=.3);
});
test('voids, excessive falls and low ceilings fail explicitly rather than use legacy or fake floor fallbacks',()=>{
 const f=fixture();f.data.shapes=[];assert.throws(()=>build(f).resolveSpawn('T'),/No safe authored/);
 const deep=fixture();deep.data.shapes=[box('deep-floor',[-20,-5,-20],[20,-3,20])];assert.throws(()=>build(deep).resolveSpawn('T'),/No safe authored/);
 const low=fixture();low.data.shapes.push(box('low-roof',[-1,1.3,-1],[1,1.5,1]));const w=build(low);assert.throws(()=>w.resolveSpawn('T'),/No safe authored/);assert.equal(w.resolveSpawn('T',0,{crouch:true}).crouch,true);
});
