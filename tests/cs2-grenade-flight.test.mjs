import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrenadeFlight,GRENADE_FLIGHT_LIMITS} from '../cs2-grenade-flight.mjs';
import {fixtureWorld,box} from './cs2-game-fixture.mjs';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {CS2_GRENADE_PROFILE} from '../public/cs2-grenade-profile.js';
import {createGrenadeRuntime} from '../cs2-grenades.mjs';
const near=(a,b,e=1e-10)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
const clear=(_a,b)=>({fraction:1,end:{...b},normal:[0,0,0],startSolid:false});
const projectile=extra=>({x:0,y:10,z:0,vx:0,vy:0,vz:0,bounces:0,ownerId:'owner',...extra});
const solver=options=>createGrenadeFlight({sweep:clear,trace:clear,gravity:0,maxSpeed:100,...options});
function plane(axis,coordinate,normal){return(a,b)=>{if(normal*(a[axis]-coordinate)<-1e-9)return{fraction:0,startSolid:true,normal:[0,0,0]};const delta=b[axis]-a[axis];if(delta*normal>=0||normal*(b[axis]-coordinate)>=0)return clear(a,b);const n=[0,0,0];n[['x','y','z'].indexOf(axis)]=normal;return{fraction:(coordinate-a[axis])/delta,startSolid:false,normal:n};};}

test('free flight integrates constant gravity exactly and is independent of caller partition',()=>{
 const gravity=320*.0254,run=steps=>{const p=projectile({vx:2,vy:4,vz:-3,y:100}),f=solver({gravity});for(const dt of steps)assert.equal(f.step(p,dt),true);return p;};
 const a=run(Array(128).fill(1/128)),b=run(Array(60).fill(1/60));
 for(const p of [a,b]){near(p.x,2);near(p.z,-3);near(p.y,104-gravity/2);near(p.vy,4-gravity);assert.equal(p.bounces,0);}
});
test('wall bounce consumes the remainder and reports the contact position before continuing',()=>{
 const p=projectile({vx:10}),contacts=[],f=solver({sweep:plane('x',1,-1)});
 assert.equal(f.step(p,.2,[],q=>contacts.push({x:q.x,y:q.y,z:q.z})),true);near(p.x,.55);near(p.vx,-4.5);assert.equal(p.bounces,1);assert.deepEqual(contacts,[{x:1,y:10,z:0}]);
});
test('collision remainder does not apply gravity again within its half-step',()=>{
 const p=projectile({vx:10,vy:1}),f=solver({gravity:8,sweep:plane('x',1,-1)});assert.equal(f.step(p,.2),true);
 near(p.vx,-4.5);near(p.vy,-.27);near(p.x,.55);near(p.y,10.02-.027); // first chord half then reflected velocity half
});
test('ceiling apex with an already separating end velocity still consumes its swept remainder',()=>{
 const ceiling=plane('y',1,-1),p=projectile({y:.998,vy:.15}),f=solver({gravity:2,sweep:ceiling});assert.equal(f.step(p,.1),true);near(p.y,.997);near(p.vy,-.05);assert.equal(p.bounces,0);
});
test('narrow corridor performs multiple reflections without discarding ordinary wall remainder',()=>{
 let calls=0;const left=plane('x',-.1,1),right=plane('x',.1,-1),sweep=(a,b)=>{calls++;return b.x>a.x?right(a,b):left(a,b);},p=projectile({vx:20}),f=solver({sweep,maxContacts:4});assert.equal(f.step(p,.1),true);
 assert.equal(p.bounces,3);assert.equal(calls,4);near(p.vx,-1.8225);assert.ok(p.x>-.1&&p.x<.1);
});
test('corner zero-progress terminates, preserves the grenade and permits later separation',()=>{
 let calls=0;const p=projectile({x:0,z:0,vx:-2,vz:-2}),sweep=(a,b)=>{calls++;if(b.x<0)return{fraction:0,normal:[1,0,0],startSolid:false};if(b.z<0)return{fraction:0,normal:[0,0,1],startSolid:false};return clear(a,b);},f=solver({sweep});
 assert.equal(f.step(p,.1),true);assert.equal(calls,2);assert.equal(p.bounces,2);assert.ok(p.vx>0&&p.vz>0);assert.equal(f.step(p,.1),true);assert.ok(p.x>0&&p.z>0);
});
test('per-half-step contact budget is hard bounded without a lifetime bounce kill',()=>{
 let calls=0;const p=projectile({vx:2,bounces:20}),f=solver({sweep:(a,b)=>{calls++;return{fraction:.01,normal:b.x>a.x?[-1,0,0]:[1,0,0],startSolid:false};},maxContacts:4,restSpeed:0});assert.equal(f.step(p,.1),true);assert.equal(calls,4);assert.equal(p.bounces,24);assert.notEqual(p.vx,0);assert.ok(calls<=GRENADE_FLIGHT_LIMITS.maxContacts);
});
test('static floor settles by speed and wakes when its support disappears',()=>{
 let present=true;const floor=plane('y',0,1),trace=(a,b)=>present?floor(a,b):clear(a,b),p=projectile({y:.1,vy:-1}),f=solver({sweep:trace,trace,restSpeed:.508});assert.equal(f.step(p,.2),true);assert.equal(p.resting,true);assert.equal(p.grounded,true);near(p.y,0);
 assert.equal(f.step(p,.1),true);assert.equal(p.resting,true);present=false;p.vy=-1;assert.equal(f.step(p,.1),true);assert.equal(p.resting,false);assert.ok(p.y<0);
});
test('low speed touching an airborne wall does not create a static resting grenade',()=>{
 const p=projectile({vx:.2}),f=solver({sweep:plane('x',.01,-1),restSpeed:.508});assert.equal(f.step(p,.1),true);assert.equal(p.resting,undefined);assert.equal(p.grounded,false);assert.ok(p.vx<0);assert.ok(p.x<.01);
});
test('body contact never becomes permanent static resting support',()=>{
 const floor=plane('y',0,1),p=projectile({y:.01,vy:-.2}),f=solver({sweep:(a,b)=>({...floor(a,b),body:true}),trace:floor});assert.equal(f.step(p,.1),true);assert.notEqual(p.resting,true);assert.equal(p.groundBody,true);
 const free=solver();assert.equal(free.step(p,.1),true);assert.equal(p.groundBody,false);
});
test('normal validation and scalar limits cannot introduce non-finite trajectory state',()=>{
 for(const normal of [[0,0,0],[NaN,1,0],[Infinity,0,0],null]){const p=projectile({vx:1}),f=solver({sweep:()=>({fraction:.5,normal,startSolid:false})});assert.equal(f.step(p,.1),false);assert.ok(['x','y','z','vx','vy','vz'].every(k=>Number.isFinite(p[k])));}
 const p=projectile({vx:1000,vy:-1000}),f=solver({maxSpeed:50});assert.equal(f.step(p,.1),true);assert.ok(Math.hypot(p.vx,p.vy,p.vz)<=50+1e-12);
 for(const dt of [NaN,Infinity,-1,.251])assert.equal(f.step(projectile(),dt),false);
});
test('normal magnitude is normalized before restitution, never increasing energy',()=>{
 const p=projectile({vx:10,vy:2}),f=solver({sweep:(a,b)=>{const h=plane('x',.2,-1)(a,b);return h.fraction<1?{...h,normal:[-4,0,0]}:h;}}),before=Math.hypot(p.vx,p.vy);assert.equal(f.step(p,.1),true);near(Math.hypot(p.vx,p.vy),before*.45);near(p.vx,-4.5);
});
test('additional steep high-energy damping is floor-only and leaves shallow impacts unchanged',()=>{
 const floor=plane('y',0,1),p=projectile({y:.1,vy:-20}),f=solver({sweep:floor,floorDampingSpeed:10});assert.equal(f.step(p,.1),true);near(p.vy,4.5);
 const wall=projectile({vx:20}),w=solver({sweep:plane('x',.1,-1),floorDampingSpeed:10});assert.equal(w.step(wall,.1),true);near(wall.vx,-9);
 const shallow=projectile({y:.01,vx:20,vy:-1});assert.equal(f.step(shallow,.1),true);near(shallow.vx,9);near(shallow.vy,.45);
});
test('first-half floor damping uses full-tick gravity while reflecting its own half-step velocity',()=>{
 const floor=plane('y',0,1),f=solver({gravity:4,sweep:floor,floorDampingSpeed:10,simulationStep:.1}),first=projectile({y:.1,vy:-9.3}),second=projectile({y:.1,vy:-9.3,flightHalfPhase:1});
 assert.equal(f.step(first,.1),true);assert.equal(f.step(second,.1),true);near(first.vy,9.7*.45*.5);near(second.vy,9.7*.45);
});
test('half-pair phase advances only on actual full half-steps, never on a final fuse fraction',()=>{
 const p=projectile(),f=solver();assert.equal(f.step(p,1/128),true);assert.equal(p.flightHalfPhase,1);assert.equal(f.step(p,.001),true);assert.equal(p.flightHalfPhase,1);assert.equal(f.step(p,1/128),true);assert.equal(p.flightHalfPhase,0);assert.equal(f.step(p,0),true);assert.equal(p.flightHalfPhase,0);
});
test('component stop epsilon is applied before the restitution multiply',()=>{
 const p=projectile({vx:1,vy:.002}),f=solver({sweep:plane('x',.01,-1),componentStopEpsilon:.00254});assert.equal(f.step(p,.1),true);near(p.vx,-.45);assert.equal(p.vy,0);
});
test('contact slop adds only the part not supplied by the world tracer',()=>{
 const p=projectile({vx:10}),f=solver({sweep:plane('x',1,-1),contactSlop:.001,traceSkin:.0005});let contact;assert.equal(f.step(p,.2,[],q=>contact=q.x),true);near(contact,.9995);
});
test('real Source 2 hull sweep prevents tunnelling and preserves finite reflected flight',()=>{
 const world=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE,walls:[box('thin',[1,0,-1],[1.001,4,1])]}),trace=(a,b)=>world.collision.trace(a,b,0,{radius:.0508,channel:'grenade'}),p=projectile({y:1,vx:50}),f=solver({sweep:trace,trace,gravity:320*.0254,maxSpeed:50});assert.equal(f.step(p,1/128),true);assert.equal(f.step(p,1/128),true);assert.equal(f.step(p,1/128),true);assert.ok(p.x<.9492);assert.ok(p.vx<0);assert.equal(p.bounces,1);assert.equal(trace(p,p).startSolid,false);
});
function rawGame(projectile,players=[]){return{time:0,projectiles:[projectile],smokes:[],players:new Map(players.map(p=>[p.id,p])),events:[],emit(e){this.events.push(e);},damage(){}};}
function rawProjectile(extra={}){return{id:'test-grenade',ownerId:'owner',team:'T',kind:'smokegrenade',x:0,y:10,z:0,vx:0,vy:0,vz:0,bornAt:0,detonateAt:1.5,simulatedAt:0,grounded:false,resting:false,bounces:0,nextThinkAt:.1,...extra};}
function nativeRuntime(world=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),profile=CS2_GRENADE_PROFILE){return{world,runtime:createGrenadeRuntime(world,{profile})};}

test('timed grenades integrate the fractional final half-step to the actual fuse endpoint',()=>{
 const profile={...CS2_GRENADE_PROFILE,fuseSeconds:.02},q=rawProjectile({kind:'hegrenade',vx:1,detonateAt:.02}),{runtime}=nativeRuntime(undefined,profile),g=rawGame(q);g.time=.04;runtime.stepGrenades(g,.04);assert.equal(g.projectiles.length,0);const e=g.events.find(e=>e.type==='explosion');assert.ok(e);near(e.x,.02);near(e.y,10-(800*.0254*.4)*.02**2/2);near(q.simulatedAt,.02);
});
test('smoke does not detonate at its airborne low-speed apex or while resting on a moving body',()=>{
 for(const extra of [{vy:0},{vy:0,resting:true,grounded:true,groundBody:true}]){const q=rawProjectile(extra),{runtime}=nativeRuntime(),g=rawGame(q);g.time=2;runtime.stepGrenades(g,1/60);assert.equal(g.events.filter(e=>e.type==='explosion').length,0);assert.equal(g.projectiles.length,1);assert.equal(q.resting,false);}
});
test('resting smoke uses its first eligible think without the legacy extra queued interval',()=>{
 const q=rawProjectile({y:.0508+.00079375,resting:true,grounded:true,simulatedAt:1.49,nextThinkAt:1.5}),{runtime}=nativeRuntime(),g=rawGame(q);g.time=1.5;runtime.stepGrenades(g,1/60);assert.equal(g.events.filter(e=>e.type==='explosion').length,0);g.time=1.51;runtime.stepGrenades(g,1/60);assert.equal(g.events.filter(e=>e.type==='explosion').length,1);assert.equal(g.smokes.length,1);
});
test('high vertical smoke flight survives the old ten-second cap and reaches a legal rest',()=>{
 const world=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE,walls:[box('far-tall',[30,0,30],[31,100,31])]}),{runtime}=nativeRuntime(world),q=rawProjectile({y:2,vy:1300*.0254}),g=rawGame(q);let survivedTen=false;
 for(let i=1;i<=1200&&g.projectiles.length;i++){g.time=i/60;runtime.stepGrenades(g,1/60);if(i===600)survivedTen=g.projectiles.length===1;}
 assert.equal(survivedTen,true);assert.equal(g.events.filter(e=>e.type==='explosion').length,1);assert.ok(g.time>10&&g.time<20);assert.equal(g.smokes.length,1);assert.ok(q.resting);
});
test('stalled callers cannot create unbounded half-step or collision work',()=>{
 const original=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE});let queries=0;const world={...original,collision:{...original.collision,trace(...args){queries++;return original.collision.trace(...args);}}},q=rawProjectile({vx:.2}),{runtime}=nativeRuntime(world),g=rawGame(q);g.time=.25;runtime.stepGrenades(g,.25);assert.equal(g.projectiles.length,1);assert.ok(queries<=runtime.simulation.maxSteps+2);
 queries=0;g.time=10;runtime.stepGrenades(g,10);assert.equal(g.projectiles.length,1);assert.ok(queries<=runtime.simulation.maxSteps+2);assert.ok(q.simulatedAt<=g.time+1e-9);
});
test('neither total bounce count nor wall contacts can trigger HE before its fuse',()=>{
 const q=rawProjectile({kind:'hegrenade',bounces:100,vx:1}),{runtime}=nativeRuntime(),g=rawGame(q);for(let i=1;i<=60;i++){g.time=i/60;runtime.stepGrenades(g,1/60);}assert.equal(g.events.filter(e=>e.type==='explosion').length,0);assert.equal(g.projectiles.length,1);assert.ok(q.vx>0);assert.ok(q.bounces>=100);
});
test('an overlapping player cannot silently consume a newly committed projectile',()=>{
 const {world,runtime}=nativeRuntime(),player={id:'overlap',team:'CT',alive:true,x:0,y:0,z:0,crouch:false},q=rawProjectile({y:world.movement.eyeHeight(player)*.7,vx:1}),g=rawGame(q,[player]);g.time=1/60;runtime.stepGrenades(g,1/60);assert.equal(g.projectiles.length,1);assert.ok(q.x>0);assert.equal(g.events.filter(e=>e.type==='explosion').length,0);
});
test('continuous player collision includes grenade radius instead of only its centre line',()=>{
 const {world,runtime}=nativeRuntime(),player={id:'other',team:'CT',alive:true,x:2,y:0,z:0,crouch:false},q=rawProjectile({y:1,z:world.movement.rules.radius+.025,vx:30}),g=rawGame(q,[player]);for(let i=1;i<=5;i++){g.time=i/60;runtime.stepGrenades(g,1/60);}assert.equal(g.projectiles.length,1);assert.ok(q.bounces>0);assert.ok(q.vx<0);assert.ok(q.x<player.x);
});
