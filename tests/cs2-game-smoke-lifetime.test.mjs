import test from 'node:test';import assert from 'node:assert/strict';
import {createGrenadeRuntime,GRENADE_LIMITS} from '../cs2-grenades.mjs';import {CS2_GRENADE_PROFILE} from '../public/cs2-grenade-profile.js';import {createSmokeVolume,smokeEnvelope,smokeDensity} from '../public/cs2-smoke-field.js';import {fixtureWorld} from './cs2-game-fixture.mjs';
const world=fixtureWorld(),runtime=createGrenadeRuntime(world);
function game(bornAt,duration=20,now=bornAt+.001,field=false){const smoke={id:'smoke',x:0,y:.1,z:0,bornAt,endAt:bornAt+duration,radius:4};return{time:now,players:new Map(),projectiles:[],smokes:[field?createSmokeVolume({...smoke,height:3.2}):smoke]};}
test('a real fractional 60 Hz clock exhibits a >20 ULP error; every one-hour clock sample survives the authority duration check',()=>{
 let accumulated=0,rejectedStrict=0,maxExcess=0,first=null,verified=0;
 for(let tick=0;tick<=3600*60;tick++){
  for(const bornAt of [accumulated,tick/60]){const lifetime=(bornAt+20)-bornAt,excess=lifetime-20;if(excess>0){rejectedStrict++;maxExcess=Math.max(maxExcess,excess);first||={tick,bornAt,lifetime};}
   // Verify all strict failures in the real filter, plus evenly spaced valid
   // samples: this checks authority semantics rather than only a new formula.
   if(excess>0||tick%600===0){const g=game(bornAt);runtime.stepGrenades(g,0);assert.equal(g.smokes.length,1,JSON.stringify({tick,bornAt,lifetime}));verified++;}
   assert.ok(lifetime<=GRENADE_LIMITS.smokeSeconds+1e-6);
  }
  accumulated+=1/60;
 }
 assert.ok(rejectedStrict>0);assert.equal(first.tick,723);assert.ok(first.lifetime>20);assert.ok(maxExcess<1e-9);assert.ok(verified>4000);
});
test('actual authority detonation at the problematic tick produces a legal smoke retained on the next update',()=>{
 const now=12.050000000000178,owner={id:'owner',team:'T',alive:true,...world.resolveSpawn('T'),vx:0,vy:0,vz:0},projectile=runtime.createGrenade(owner,'smokegrenade',now-2),events=[];assert.ok(projectile);
 Object.assign(projectile,{x:owner.x,y:owner.y,z:owner.z,vx:0,vy:0,vz:0,grounded:true,resting:true,simulatedAt:now-1/60,nextThinkAt:0,detonationQueued:true});
 const g={time:now,players:new Map([[owner.id,owner]]),projectiles:[projectile],smokes:[],emit:e=>events.push(e)};runtime.stepGrenades(g,1/60);assert.equal(events[0].type,'explosion');assert.equal(g.smokes.length,1);assert.ok(g.smokes[0].endAt-g.smokes[0].bornAt>20);g.time+=1/60;runtime.stepGrenades(g,1/60);assert.equal(g.smokes.length,1);g.time=g.smokes[0].endAt;runtime.stepGrenades(g,1/60);assert.equal(g.smokes.length,0);
});
test('duration tolerance never accepts 20.01s or the unrelated 28s fixture lifetime',()=>{
 for(const bornAt of [0,1/60,12.050000000000178,12.2,59.9833333333,600.0166666667,1800.0166666667,3599.9833333333])for(const duration of [20.01,28]){const g=game(bornAt,duration);runtime.stepGrenades(g,0);assert.equal(g.smokes.length,0,JSON.stringify({bornAt,duration}));}
});
test('a generated full 20s smoke remains alive to its exact deadline and expires at it',()=>{
 for(const bornAt of [0,12.050000000000178,12.2,1024.0333333333,3599.9833333333]){
  const g=game(bornAt),endAt=g.smokes[0].endAt;for(const elapsed of [.001,1,10,19,19.999999]){g.time=bornAt+elapsed;runtime.stepGrenades(g,0);assert.equal(g.smokes.length,1);assert.equal(g.smokes[0].endAt,endAt);}g.time=endAt;runtime.stepGrenades(g,0);assert.equal(g.smokes.length,0);
 }
});
test('field envelope keeps its original expansion/fade while native 18s generation stays below the 20s cap',()=>{
 assert.equal(CS2_GRENADE_PROFILE.smokeSeconds,18);const native=createGrenadeRuntime(world,{profile:CS2_GRENADE_PROFILE});
 for(const duration of [18,20]){const bornAt=12.050000000000178,g=game(bornAt,duration,bornAt+.001,true),v=g.smokes[0];native.stepGrenades(g,0);assert.equal(g.smokes.length,1);assert.equal(smokeEnvelope(v,bornAt),0);assert.equal(smokeEnvelope(v,bornAt+1),1);assert.ok(Math.abs(smokeEnvelope(v,v.endAt-1)-.5)<1e-12);assert.equal(smokeEnvelope(v,v.endAt),0);assert.ok(smokeDensity(v,{x:0,y:1.54,z:0},bornAt+1)>.99);g.time=v.endAt;native.stepGrenades(g,0);assert.equal(g.smokes.length,0);}
 let accumulated=0;for(let tick=0;tick<=3600*60;tick++){assert.ok((accumulated+18)-accumulated<=GRENADE_LIMITS.smokeSeconds);accumulated+=1/60;}
});
