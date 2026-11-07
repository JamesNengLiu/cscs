import {createExperimentalWorld,PINNED_CS2_MAP_SHA1} from '../public/cs2-world.js';
import {metersPointToSource} from '../public/experimental-world-contract.js';
import {createCS2Game} from '../cs2-game.mjs';
import {rayBox} from '../public/math.js';
export function box(id,min,max,channels=['player','bullet','grenade','audio'],extra={}){const vertices=[];for(const x of [min[0],max[0]])for(const y of [min[1],max[1]])for(const z of [min[2],max[2]])vertices.push(x,y,z);return{id,type:'hull',vertices,channels,planes:[[1,0,0,max[0]],[-1,0,0,-min[0]],[0,1,0,max[1]],[0,-1,0,-min[1]],[0,0,1,max[2]],[0,0,-1,-min[2]]],...extra};}
export function fixtureWorld({walls=[],movementProfile}={}){
 const spawn=(x,z)=>({position:[x,.02,z],sourceOrigin:metersPointToSource({x,y:.02,z}),sourceAngles:[0,0,0],sourceId:`start-${x}-${z}`});
 const data={schema:'cs2-physics-v1',units:'metres',source:{mapSHA1:PINNED_CS2_MAP_SHA1},materials:[{name:'concrete',hash:'12345678'}],shapes:[box('floor',[-40,-2,-40],[40,0,40]),...walls],spawns:{T:Array.from({length:5},(_,i)=>spawn(i*2,4)),CT:Array.from({length:5},(_,i)=>spawn(i*2,-4))},triggers:[{id:'site-a',kind:'bombsite',name:'A',team:null,shapes:[box('site-volume',[-2,-1,2],[10,3,7],[])]},{id:'buy-t',kind:'buyzone',name:null,team:'T',shapes:[box('buy-t-volume',[-2,-1,2],[10,3,7],[])]},{id:'buy-ct',kind:'buyzone',name:null,team:'CT',shapes:[box('buy-ct-volume',[-2,-1,-7],[10,3,-2],[])]}]};
 return createExperimentalWorld(data,{packageManifest:{schema:'cs2-physics-package-v1',mapSHA1:PINNED_CS2_MAP_SHA1,sha256:'a'.repeat(64)},renderManifest:{source:{mapSHA1:PINNED_CS2_MAP_SHA1}},verifiedPhysicsSHA256:'a'.repeat(64),movementProfile});
}
export const testHitboxes={rayPlayer:(o,d,p)=>({distance:rayBox(o,d,{x1:p.x-.3,x2:p.x+.3,y1:p.y,y2:p.y+(p.crouch?.9:1.8),z1:p.z-.3,z2:p.z+.3}),hitgroup:'chest'}),hitboxAnimation:()=>({}),hitboxDiagnostics:()=>({source:'deterministic-fixture'})};
export function fixtureGame(options={}){const world=options.world||fixtureWorld(),g=createCS2Game(world,{random:()=>.5,audioRandom:()=>.5,hitboxes:testHitboxes,...options});const t=g.add('t','T','T'),ct=g.add('ct','CT','CT');g.begin();g.phase='live';g.endAt=200;return{g,t,ct,world};}
export const ticks=(g,n)=>{for(let i=0;i<n;i++)g.step();};
