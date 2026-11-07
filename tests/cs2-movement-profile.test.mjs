import test from 'node:test';
import assert from 'node:assert/strict';
import {CS2_MOVEMENT_PROFILE as profile} from '../public/cs2-movement-profile.js';
import {LEGACY_METER_MOVEMENT_PROFILE,createMovement} from '../public/cs2-movement.js';
import {CS2_WEAPON_PROFILE} from '../public/cs2-weapon-profile.js';
import {createCollisionWorld,compileCollisionData} from '../public/cs2-collision.js';
import {createExperimentalWorld,PINNED_CS2_MAP_SHA1} from '../public/cs2-world.js';
import {assertWorldCompatible} from '../public/experimental-world-contract.js';

function box(id,min,max){const vertices=[];for(const x of [min[0],max[0]])for(const y of [min[1],max[1]])for(const z of [min[2],max[2]])vertices.push(x,y,z);return{id,type:'hull',vertices,planes:[[1,0,0,max[0]],[-1,0,0,-min[0]],[0,1,0,max[1]],[0,-1,0,-min[1]],[0,0,1,max[2]],[0,0,-1,-min[2]]]};}
const floor=()=>box('floor',[-100,-3,-100],[100,0,100]);
const pose=(patch={})=>({id:'profile-player',alive:true,weapon:'knife',x:0,y:.0005,z:0,vx:0,vy:0,vz:0,yaw:0,pitch:0,crouch:false,grounded:true,velocityModifier:1,jumpFatigue:0,...patch});
function fixture(shapes=[floor()],compiled=false){const data={schema:'cs2-physics-v1',units:'metres',shapes},world=createCollisionWorld(compiled?compileCollisionData(data):data,{radius:profile.rules.radius,bodyHeight:profile.rules.bodyHeight,crouchHeight:profile.rules.crouchHeight}),movement=createMovement(world,{profile,rules:profile.rules,weapons:profile.weapons,rulesVersion:profile.id});return{world,movement};}
const clear=(world,movement,p)=>assert.equal(world.collides(p.x,p.z,movement.rules.radius,p.y,movement.bodyHeight(p)),false,'body must not overlap the world');

test('the CS2 experiment uses one extracted weapon-speed table, metre units and honest candidate boundaries',()=>{
 const {movement}=fixture();assert.equal(profile.weapons,CS2_WEAPON_PROFILE.weapons);assert.equal(profile.geometryMetresPerSourceUnit,.0254);assert.equal(profile.rules.radius,16*.0254);assert.equal(profile.rules.bodyHeight,72*.0254);assert.equal(movement.eyeHeight({crouch:false}),64*.0254);assert.equal(movement.eyeHeight({crouch:true}),46*.0254);
 assert.equal(movement.maxMoveSpeed({weapon:'ak47'}),215*.0254);assert.equal(movement.maxMoveSpeed({weapon:'awp',zoom:90}),200*.0254);assert.equal(movement.maxMoveSpeed({weapon:'awp',zoom:40}),100*.0254);assert.equal(movement.maxMoveSpeed({weapon:'knife'}),250*.0254);
 assert.match(profile.scope,/candidate.*not retail 1:1/);assert.ok(profile.candidateFields.includes('jumpSpeed'));assert.ok(profile.verifiedFields.includes('weapons.maxSpeed'));assert.ok(Object.isFrozen(profile.rules));assert.equal(LEGACY_METER_MOVEMENT_PROFILE.rules.radius,.4);assert.equal(LEGACY_METER_MOVEMENT_PROFILE.rules.crouchHeight,.9);
});

test('fixed60Hz client prediction exactly replays authority through a narrow corridor, stairs, ramp and wheel pulses',()=>{
 const ramp={id:'ramp',type:'hull',vertices:[4,0,-2,4,0,2,8,0,-2,8,0,2,8,1,-2,8,1,2],planes:[[-1,0,0,-4],[1,0,0,8],[0,-1,0,0],[0,0,-1,2],[0,0,1,2],[-.25,1,0,-1]]},shapes=[floor(),ramp,box('upper',[8,0,-2],[15,1,2]),box('wall-n',[-5,0,-1.1],[3,4,-.42]),box('wall-s',[-5,0,.42],[3,4,1.1])],authority=fixture(shapes),prediction=fixture(shapes,true),a=pose({x:-3}),b=structuredClone(a);
 for(let k=0;k<720;k++){const input={s:k<180?1:k<360?-1:k<540?1:-1,yaw:0,jump:k>360&&k%8===0,crouch:k%120>90};authority.movement.step(a,input);prediction.movement.movePlayer(b,input,1/60);assert.deepEqual(a,b,'prediction mismatch '+k);clear(authority.world,authority.movement,a);assert.ok([a.x,a.y,a.z,a.vx,a.vy,a.vz].every(Number.isFinite));}
 assert.equal(authority.movement.fixedDt,1/60);
});

test('the native-sized duck hull enters a low corridor and cannot stand through the roof',()=>{
 const {world,movement}=fixture([floor(),box('roof',[1,1.5,-2],[9,1.8,2])]),p=pose();for(let k=0;k<45;k++)movement.step(p,{s:1});assert.ok(p.x<.594);
 for(let k=0;k<70;k++){movement.step(p,{s:1,crouch:true});clear(world,movement,p);}assert.ok(p.x>1);assert.equal(p.crouch,true);
 for(let k=0;k<20;k++){movement.step(p,{});clear(world,movement,p);assert.equal(p.crouch,true);}assert.ok(p.y+movement.bodyHeight(p)<1.5);
});

test('18-source-unit candidate step limit permits low stairs and rejects a taller wall',()=>{
 for(const height of [.44,.51]){const {world,movement}=fixture([floor(),box('step',[1,0,-2],[4,height,2])]),p=pose();for(let k=0;k<60;k++){movement.step(p,{s:1});clear(world,movement,p);}if(height<profile.rules.stepHeight)assert.ok(p.x>4.4);else assert.ok(p.x<.594);}
});

test('jump then crouch clears the candidate crate rim without repeated held-jump impulses',()=>{
 const {world,movement}=fixture([floor(),box('crate',[2,0,-2],[5,1.55,2])]),p=pose({vx:6.35});let landed=false;for(let k=0;k<75;k++){movement.step(p,{s:1,jump:k===0,crouch:k>=6});clear(world,movement,p);if(p.grounded&&p.y>1.5)landed=true;}assert.equal(landed,true);
 const flat=fixture(),q=pose();let jumps=0,high=q.y;for(let k=0;k<120;k++){const before=q.grounded;flat.movement.step(q,{jump:true});clear(flat.world,flat.movement,q);high=Math.max(high,q.y);if(before&&!q.grounded&&q.vy>0)jumps++;}assert.equal(jumps,1);assert.ok(high>1.3&&high<1.5);assert.equal(q.grounded,true);
});

test('world contracts distinguish the opted-in CS2 profile and retain the legacy fallback',()=>{
 const data={schema:'cs2-physics-v1',units:'metres',source:{mapSHA1:PINNED_CS2_MAP_SHA1},shapes:[floor()],spawns:{T:[{position:[0,0,0],sourceOrigin:[0,0,0],sourceAngles:[0,0,0]}],CT:[{position:[4,0,0],sourceOrigin:[0,4/.0254,0],sourceAngles:[0,0,0]}]}};
 const options={packageManifest:{schema:'cs2-physics-package-v1',mapSHA1:PINNED_CS2_MAP_SHA1,sha256:'a'.repeat(64)},renderManifest:{source:{mapSHA1:PINNED_CS2_MAP_SHA1}}},legacy=createExperimentalWorld(data,options),native=createExperimentalWorld(data,{...options,movementProfile:profile});
 assert.equal(legacy.contract.rulesVersion,LEGACY_METER_MOVEMENT_PROFILE.id);assert.equal(native.contract.rulesVersion,profile.id);assert.equal(native.movementProfile.weapons,CS2_WEAPON_PROFILE.weapons);assert.equal(native.movement.bodyHeight({crouch:true}),54*.0254);assert.equal(native.resolveSpawn('T').grounded,true);assert.throws(()=>assertWorldCompatible(legacy.contract,native.contract),/rulesVersion/);assert.throws(()=>createExperimentalWorld(data,{...options,movementProfile:{}}),/movement profile/);
});
