import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.mjs';
import {COLLISION_VERSION,movePlayer,traceMovement,bodyHeight} from '../public/movement.js';
import {RULES} from '../public/config.js';
import {collides,trace,SPAWN_POINTS,supportHeight} from '../public/map.js';
import {slideMove,edgeFrictionMultiplier} from '../public/movement-collision.js';
import {reconcileMovement} from '../public/prediction.js';
import {flatSlowdownPose} from './fixtures/hit-slowdown-cases.mjs';
import {DOWNHILL_CASES,slopeStart} from './downhill-fixtures.mjs';

const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const clear=p=>assert.equal(collides(p.x,p.z,RULES.radius,p.y,bodyHeight(p)),false);
const endAt=(a,b,f)=>({x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,z:a.z+(b.z-a.z)*f});
const free=(a,b)=>({fraction:1,startSolid:false,end:{...b},normal:[0,0,0]});
const probe=(p,others=[])=>edgeFrictionMultiplier(p,bodyHeight(p),(a,b)=>traceMovement(a,b,bodyHeight(p),others,p,true));

for(const airborne of [false,true])test(`wall slide preserves tangent and vertical travel, airborne=${airborne}`,()=>{
 const wall=(a,b)=>{const f=b.x<0?a.x/(a.x-b.x):1;return {...free(a,b),fraction:f,end:endAt(a,b,f),normal:[1,0,0]};};
 const r=slideMove({x:1,y:0,z:0},[-3,2,4],1,wall,{airborne});
 near(r.pos.x,0);near(r.pos.y,2);near(r.pos.z,4);assert.deepEqual(r.velocity,[0,2,4]);
});
test('two-plane wedge retains motion along the intersection instead of stopping',()=>{
 let n=0;const normals=[[1,0,0],[-.5,Math.sqrt(.75),0]];
 const r=slideMove({x:0,y:0,z:0},[-1,-1,3],1,(a,b)=>{if(n===2)return free(a,b);const fraction=n===0?.25:0,normal=normals[n++];return {fraction,startSolid:false,end:endAt(a,b,fraction),normal};});
 near(r.velocity[0],0);near(r.velocity[1],0);near(r.velocity[2],2.25);near(r.pos.z,2.4375);
});
test('three obstructing planes stop a trapped body without reversal',()=>{
 let n=0;const normals=[[1,0,0],[0,1,0],[0,0,-1]];
 const r=slideMove({x:0,y:0,z:0},[-1,-1,3],1,(a,b)=>{if(n===3)return free(a,b);const fraction=n===0?.25:0,normal=normals[n++];return {fraction,startSolid:false,end:endAt(a,b,fraction),normal};});
 assert.deepEqual(r.velocity,[0,0,0]);assert.equal(n,3);
});
test('solid-start and repeated obstructions terminate with finite positions',()=>{
 const start={x:1,y:2,z:3};const stuck=slideMove(start,[1,2,3],1,(a,b)=>({...free(a,b),fraction:0,startSolid:true}));
 assert.deepEqual(stuck.pos,start);assert.deepEqual(stuck.velocity,[0,0,0]);let calls=0;
 const r=slideMove(start,[-10,-10,10],1,(a,b)=>{calls++;return {fraction:.01,startSolid:false,end:endAt(a,b,.01),normal:[1,0,0]};});
 assert.ok(calls<=4);assert.ok(Object.values(r.pos).every(Number.isFinite));
});

test('rising across a box rim uses the clear diagonal path and retains horizontal speed',()=>{
 const p=flatSlowdownPose({vx:6.25,vy:6,grounded:false});p.y+=1.795;const original={...p},box=flatSlowdownPose({id:'box',x:p.x+.85});
 const end={...p,x:p.x+p.vx/120,y:p.y+(p.vy-RULES.gravity/240)/120};assert.equal(traceMovement(p,end,bodyHeight(p),[box],p).fraction,1);
 const old={...p,collisionVersion:0};movePlayer(old,{},1/120,[box]);assert.equal(old.vx,0);
 movePlayer(p,{},1/120,[box]);near(p.vx,6.25);near(p.x,original.x+6.25/120);near(p.y,end.y);clear(p);
});
test('Dust2 CT crate rim no longer cancels momentum while the feet rise above its top',()=>{
 const p=flatSlowdownPose({x:18.85,y:-.005,z:-58.8,vx:-6.25,vy:6,grounded:false});
 const old={...p,collisionVersion:0};movePlayer(old,{},1/120);assert.equal(old.vx,0);
 movePlayer(p,{},1/120);near(p.vx,-6.25);near(p.x,18.85-6.25/120);assert.ok(p.y>0);clear(p);
});
test('low ceiling corner is a side impact, rather than a false head impact',()=>{
 const p=flatSlowdownPose({vx:6.25,vy:6,grounded:false}),ceiling=flatSlowdownPose({id:'corner',x:p.x+.84,y:p.y+RULES.bodyHeight+.01});
 const old={...p,collisionVersion:0};movePlayer(old,{},1/120,[ceiling]);assert.equal(old.vy,0);assert.equal(old.grounded,true);
 movePlayer(p,{},1/120,[ceiling]);near(p.vx,0);near(p.vy,6-RULES.gravity/120);assert.equal(p.grounded,false);assert.ok(p.y>old.y+.04);clear(p);
});
for(const hz of [30,60,120,144])test(`partial headroom permits a low step; excessive steps remain blocked, ${hz}Hz`,()=>{
 const p=flatSlowdownPose({vx:6.25}),floor=p.y,step=flatSlowdownPose({id:'step',x:p.x+.84,y:floor-1.6}),ceiling=flatSlowdownPose({id:'ceiling',y:floor+2.1});
 const old={...p,collisionVersion:0};movePlayer(old,{},1/hz,[step,ceiling]);assert.equal(old.vx,0);
 for(let i=0;i<Math.ceil(hz*.08);i++){movePlayer(p,{s:1},1/hz,[step,ceiling]);clear(p);}
 assert.ok(p.x>old.x+.01);near(p.y-floor,.2001,1e-6);assert.equal(p.grounded,true);assert.equal(p.groundPlayer,'step');
 const blocked=flatSlowdownPose({vx:6.25}),high={...step,y:floor-1.25};movePlayer(blocked,{},1/hz,[high]);assert.equal(blocked.vx,0);near(blocked.y,floor,1e-6);
});
for(const crouch of [false,true])test(`edge friction starts at a supported ledge over a deep drop, crouch=${crouch}`,()=>{
 const box=flatSlowdownPose({id:'platform'}),inner=flatSlowdownPose({x:box.x+.2,y:box.y+RULES.bodyHeight+.0001,vx:6.25,crouch});
 const edge={...inner,x:box.x+.6};clear(inner);clear(edge);assert.equal(probe(inner,[box]),1);assert.equal(probe(edge,[box]),2);
 const old={...edge,collisionVersion:0},before=edge.vx;movePlayer(old,{crouch},1/120,[box]);movePlayer(edge,{crouch},1/120,[box]);
 assert.equal(edge.grounded,true);near(old.vx,before*(1-RULES.friction/120));near(edge.vx,before*(1-2*RULES.friction/120));
});
test('edge probe retains normal friction above flat ground and low steps, including existing hull overlap',()=>{
 const p=flatSlowdownPose({vx:6.25});assert.equal(probe(p),1);
 const step=flatSlowdownPose({id:'low-step',y:p.y-1.6});Object.assign(p,{x:step.x+.6,y:step.y+RULES.bodyHeight+.0001});assert.equal(probe(p,[step]),1);
 // A strict probe must report the existing platform overlap; movement itself must allow separation.
 const platform=flatSlowdownPose({id:'platform'}),a={...p,x:platform.x,y:platform.y+.2},b={...a,x:a.x+.1};
 assert.equal(traceMovement(a,b,bodyHeight(p),[platform],p,true).startSolid,true);
 assert.equal(traceMovement(a,b,bodyHeight(p),[platform],p).fraction,1);
});
test('Dust2 96-unit crate edge gets extra friction while its inner surface does not',()=>{
 const inner=flatSlowdownPose({x:11.6,y:2.40078125,z:-37.3,vz:-6.25}),edge={...inner,z:-37.8};
 for(const p of [inner,edge]){clear(p);const support=trace(p,{...p,y:p.y-.04},bodyHeight(p));assert.equal(support.normal[1],1);assert.ok(support.fraction<1);}
 assert.equal(probe(inner),1);assert.equal(probe(edge),2);movePlayer(edge,{},1/120);assert.equal(edge.grounded,true);near(edge.vz,-6.25*(1-2*RULES.friction/120));
});
test('Dust2 upper CT crate ledge above a nearby lower crate does not brake early',()=>{
 const p=flatSlowdownPose({x:16.2,y:1.0007812499999997,z:-59.2,vx:6.25});clear(p);assert.equal(probe(p),1);
});
test('airborne ledge departure does not apply ground edge friction or change jump impulse',()=>{
 const box=flatSlowdownPose({id:'platform'}),p=flatSlowdownPose({x:box.x+.6,y:box.y+RULES.bodyHeight+.0001,vx:6.25}),old={...p,collisionVersion:0};
 movePlayer(p,{jump:true},1/120,[box]);movePlayer(old,{jump:true},1/120,[box]);for(const k of ['x','y','z','vx','vy','vz','jumpFatigue'])near(p[k],old[k]);assert.equal(p.grounded,false);
});
for(const route of DOWNHILL_CASES)test(`continuous slope has no added edge drag: ${route.name}`,()=>{
 const p={...flatSlowdownPose(),...slopeStart(route),vx:route.direction[0]*6.25,vz:route.direction[1]*6.25};
 for(let i=0;i<60;i++){assert.equal(probe(p),1);movePlayer(p,{f:1,yaw:p.yaw},1/60);clear(p);}
});
for(const hz of [30,60,120,144])test(`wall grazing jump and repeated landings remain outside solids, ${hz}Hz`,()=>{
 const p=flatSlowdownPose({x:18.9,y:-1.5,z:-58.8,yaw:Math.PI/2});
 for(let i=0;i<hz*3;i++){movePlayer(p,{f:1,s:.35,yaw:p.yaw,jump:i%Math.ceil(hz/30)===0,crouch:i%hz>hz*.15},1/hz);clear(p);assert.ok([p.x,p.y,p.z,p.vx,p.vy,p.vz].every(Number.isFinite));assert.ok(Math.hypot(p.vx,p.vz)<7.6);}
});
test('all 40 Dust2 spawns stay outside solids across four wheel-jump / wall-grazing headings',()=>{
 for(const points of Object.values(SPAWN_POINTS))for(const spawn of points)for(let heading=0;heading<4;heading++){
  const yaw=heading*Math.PI/2,p=flatSlowdownPose({x:spawn.x,y:supportHeight(spawn.x,spawn.z,spawn.y+.1),z:spawn.z,yaw});
  for(let frame=0;frame<180;frame++){
   movePlayer(p,{f:1,s:.35,yaw,jump:frame%4===0,crouch:frame%50>10&&frame%50<35},1/60);clear(p);
   assert.ok([p.x,p.y,p.z,p.vx,p.vy,p.vz].every(Number.isFinite));
  }
 }
});
for(const route of DOWNHILL_CASES)test(`falling onto a slope settles without an upward launch: ${route.name}`,()=>{
 const p={...flatSlowdownPose(),...slopeStart(route)};p.y+=.15;p.vy=-6;p.vx=route.direction[0]*6.25;p.vz=route.direction[1]*6.25;let landed=false;
 for(let i=0;i<35;i++){movePlayer(p,{f:1,yaw:p.yaw},1/120);clear(p);if(p.grounded){landed=true;assert.equal(p.vy,0);}else if(landed)assert.ok(p.vy<=0);}
 assert.equal(landed,true);
});
test('server collision capability and authoritative/replayed crate motion agree',()=>{
 const g=new Game(),p=g.add('local','Collision regression','CT');g.begin();g.phase='live';g.time=10;g.endAt=1000;Object.assign(p,flatSlowdownPose({id:'local',x:18.85,y:-.005,z:-58.8,vx:-6.25,vy:6,grounded:false}));
 const snapshot=g.snapshot(p.id);assert.equal(snapshot.collisionVersion,COLLISION_VERSION);const me=snapshot.players.find(p=>p.id==='local');me.collisionVersion=snapshot.collisionVersion;
 const commands=Array.from({length:12},(_,i)=>({seq:i+1,round:g.round,input:{f:1,yaw:Math.PI/2,pitch:0,crouch:i>=5}}));
 const predicted=reconcileMovement(me,commands,g.round).player;g.inputBatch(p.id,commands.map(c=>({...c.input,seq:c.seq,round:c.round})));for(const _ of commands)g.step();
 for(const k of ['x','y','z','vx','vy','vz','grounded','crouch','jumpFatigue'])assert.equal(predicted[k],p[k],k);clear(p);
});
