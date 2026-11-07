import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMovement,LEGACY_METER_MOVEMENT_PROFILE} from '../public/cs2-movement.js';
import {movePlayer as oldMove} from '../public/movement.js';
import * as oldWorld from '../public/map.js';
import {RULES,WEAPONS} from '../public/config.js';
import {slowdownCases,slowdownCaseTrace,flatSlowdownPose,slowdownColumns} from './fixtures/hit-slowdown-cases.mjs';
import {createCollisionWorld} from '../public/cs2-collision.js';

const adapted=createMovement(oldWorld);
for(const scenario of slowdownCases)test(`injected world adapter preserves the existing trajectory: ${scenario.name}`,()=>{
 assert.deepEqual(slowdownCaseTrace(adapted.movePlayer,scenario),slowdownCaseTrace(oldMove,scenario));
});

test('the experimental module uses CPU-world injection instead of binding the old BSP module',()=>{
 const source=readFileSync(new URL('../public/cs2-movement.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/from\s+['"]\.\/(?:map|shared|movement)\.js['"]/);
 assert.equal(LEGACY_METER_MOVEMENT_PROFILE.ruleMetresPerLegacyUnit,.025);
 assert.equal(LEGACY_METER_MOVEMENT_PROFILE.geometryMetresPerSourceUnit,.0254);
 assert.match(LEGACY_METER_MOVEMENT_PROFILE.scope,/not CS2 numerical calibration/);
 assert.equal(adapted.rules.speed,RULES.speed);assert.equal(adapted.rules.jumpSpeed,RULES.jumpSpeed);
 assert.equal(adapted.maxMoveSpeed({weapon:'ak47'}),WEAPONS.ak47.maxSpeed/40);
 assert.equal(adapted.maxMoveSpeed({weapon:'awp',zoom:40}),150/40);
});

test('fixed-step replay is identical to explicit 60 Hz movement and does not mutate the legacy rules',()=>{
 const before=JSON.stringify(RULES),a=flatSlowdownPose(),b=structuredClone(a);
 for(let i=0;i<180;i++){const input={yaw:Math.PI/2,f:1,s:.15,jump:i%4===0,crouch:i%60>20};adapted.step(a,input);adapted.movePlayer(b,input,1/60);}
 for(const key of slowdownColumns)assert.equal(a[key],b[key],key);
 assert.equal(adapted.fixedDt,1/60);assert.equal(JSON.stringify(RULES),before);
 assert.throws(()=>adapted.movePlayer(a,{},NaN),/finite/);
 assert.throws(()=>adapted.step({...a,y:NaN},{}),/authored spawn/);
});
test('modified numerical tuning cannot advertise the unchanged legacy-metre rules version',()=>{
 assert.throws(()=>createMovement(oldWorld,{rules:{...RULES,gravity:10}}),/distinct rulesVersion/);
 const changed=createMovement(oldWorld,{rules:{...RULES,gravity:10},rulesVersion:'explicit-gravity-test-v1'});assert.equal(changed.profile.id,'explicit-gravity-test-v1');assert.equal(changed.rules.gravity,10);assert.equal(RULES.gravity,20);
});

test('all body probes use the injected player channel and configured radius',()=>{
 const calls=[],clear={trace(a,b,height,options){calls.push({height,options});return {fraction:1,startSolid:false,normal:[0,0,0],end:{...b}};},collides:()=>false,supportHeight:()=>0};
 const movement=createMovement(clear),p={...flatSlowdownPose(),x:0,y:1,z:0,vx:0,vy:0,vz:0,grounded:false};movement.step(p,{jump:true});
 assert.ok(calls.length>1);assert.ok(calls.every(c=>c.options.channel==='player'&&c.options.radius===RULES.radius));
 assert.throws(()=>createMovement({}),/collision world/);
});

function box(id,min,max){const vertices=[];for(const x of [min[0],max[0]])for(const y of [min[1],max[1]])for(const z of [min[2],max[2]])vertices.push(x,y,z);return{id,type:'hull',vertices,planes:[[1,0,0,max[0]],[-1,0,0,-min[0]],[0,1,0,max[1]],[0,-1,0,-min[1]],[0,0,1,max[2]],[0,0,-1,-min[2]]]};}
const floor=()=>box('floor',[-100,-3,-100],[100,0,100]);
const player=(patch={})=>({id:'walk',alive:true,weapon:'knife',x:0,y:.0005,z:0,vx:0,vy:0,vz:0,yaw:0,pitch:0,crouch:false,grounded:true,velocityModifier:1,jumpFatigue:0,...patch});
const clear=(world,movement,p)=>assert.equal(world.collides(p.x,p.z,movement.rules.radius,p.y,movement.bodyHeight(p)),false,`solid at ${p.x}, ${p.y}, ${p.z}`);

test('a real CPU hull corridor stops high-speed movement at a thin wall while preserving tangent motion',()=>{
 const world=createCollisionWorld({schema:'cs2-physics-v1',units:'metres',shapes:[floor(),box('thin-wall',[3,0,-10],[3.001,4,10])]}),movement=createMovement(world),p=player({vx:6.25,vz:2});
 for(let i=0;i<120;i++){movement.step(p,{s:1,f:-.3,yaw:0});clear(world,movement,p);}
 assert.ok(p.x>2.5&&p.x<2.6);assert.ok(p.z>1);assert.equal(p.grounded,true);
});

test('low stairs remain walkable and an above-limit step stays blocked',()=>{
 for(const height of [.3,.6]){
  const world=createCollisionWorld({schema:'cs2-physics-v1',units:'metres',shapes:[floor(),box('step',[1,0,-2],[3,height,2])]}),movement=createMovement(world),p=player();
  for(let i=0;i<70;i++){movement.step(p,{s:1,yaw:0});clear(world,movement,p);}
  if(height<movement.rules.stepHeight){assert.ok(p.x>3.5);assert.equal(p.grounded,true);}else{assert.ok(p.x<.601);assert.ok(p.y<.01);}
 }
});

test('partial headroom admits a .2m stair without lifting the head through a roof',()=>{
 const world=createCollisionWorld({schema:'cs2-physics-v1',units:'metres',shapes:[floor(),box('step',[1,0,-2],[5,.2,2]),box('roof',[-2,2.1,-2],[6,2.3,2])]}),movement=createMovement(world),p=player();
 for(let i=0;i<40;i++){movement.step(p,{s:1,yaw:0});clear(world,movement,p);assert.ok(p.y+movement.bodyHeight(p)<2.1);}
 assert.ok(p.x>1.5);assert.ok(Math.abs(p.y-.2005)<.002);assert.equal(p.grounded,true);
});

test('crouching enters a low passage and releasing crouch cannot stand inside its ceiling',()=>{
 const world=createCollisionWorld({schema:'cs2-physics-v1',units:'metres',shapes:[floor(),box('roof',[1,1.3,-2],[8,1.6,2])]}),movement=createMovement(world),p=player();
 for(let i=0;i<45;i++)movement.step(p,{s:1,yaw:0});assert.ok(p.x<.601);
 for(let i=0;i<65;i++){movement.step(p,{s:1,yaw:0,crouch:true});clear(world,movement,p);}
 assert.ok(p.x>1);assert.equal(p.crouch,true);
 for(let i=0;i<20;i++){movement.step(p,{});clear(world,movement,p);assert.equal(p.crouch,true);}
});

test('jump-then-duck reaches a higher crate without extra repeated jump impulses or ceiling penetration',()=>{
 const world=createCollisionWorld({schema:'cs2-physics-v1',units:'metres',shapes:[floor(),box('crate',[2,0,-2],[5,1.4,2])]}),movement=createMovement(world),p=player({vx:6.25});
 let landedOnCrate=false;
 for(let i=0;i<80;i++){movement.step(p,{s:1,yaw:0,jump:i===0,crouch:i>=6});clear(world,movement,p);if(p.grounded&&p.y>1.3)landedOnCrate=true;}
 assert.equal(landedOnCrate,true);
 const low=createCollisionWorld({schema:'cs2-physics-v1',units:'metres',shapes:[floor(),box('roof',[-5,2.2,-5],[5,2.5,5])]}),under=createMovement(low),q=player();let high=0,takeoffs=0;
 for(let i=0;i<120;i++){const grounded=q.grounded;under.step(q,{jump:true});clear(low,under,q);high=Math.max(high,q.y);if(grounded&&!q.grounded&&q.vy>0)takeoffs++;}
 assert.equal(takeoffs,1);assert.ok(high<.401);assert.equal(q.grounded,true);
});

test('continuous ramp ascent/descent and rolling jump pulses remain outside the new world solids',()=>{
 const ramp={id:'ramp',type:'hull',vertices:[1,0,-2,1,0,2,6,0,-2,6,0,2,6,1.25,-2,6,1.25,2],planes:[[-1,0,0,-1],[1,0,0,6],[0,-1,0,0],[0,0,-1,2],[0,0,1,2],[-.25,1,0,-.25]]};
 const world=createCollisionWorld({schema:'cs2-physics-v1',units:'metres',shapes:[floor(),ramp,box('upper',[6,0,-2],[20,1.25,2])]}),movement=createMovement(world),p=player();
 for(let i=0;i<100;i++){movement.step(p,{s:1,yaw:0});clear(world,movement,p);if(p.grounded)assert.equal(p.vy,0);}
 assert.ok(p.x>6);assert.ok(Math.abs(p.y-1.2505)<.002);
 for(let i=0;i<100;i++){movement.step(p,{s:-1,yaw:0,jump:i%4===0,crouch:i%30>8});clear(world,movement,p);assert.ok([p.x,p.y,p.z,p.vx,p.vy,p.vz].every(Number.isFinite));assert.ok(Math.hypot(p.vx,p.vz)<7.6);}
});
