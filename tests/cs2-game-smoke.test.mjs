import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {CS2_GRENADE_PROFILE} from '../public/cs2-grenade-profile.js';
import {createGrenadeRuntime} from '../cs2-grenades.mjs';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {createSmokeVolume,smokeDensity,smokeEnvelope,applySmokeShot,applySmokeExplosion,pruneSmokeFields,SMOKE_FIELD_VERSION,SMOKE_FIELD_LIMITS} from '../public/cs2-smoke-field.js';
import {createSmokeRenderer} from '../public/cs2-smoke-renderer.js';
import {fixtureWorld,fixtureGame} from './cs2-game-fixture.mjs';
const volume=(patch={})=>createSmokeVolume({id:'smoke',x:0,y:0,z:0,bornAt:0,endAt:18,...patch});
const center={x:0,y:1.44,z:0};
test('smoke field has bounded lifetime, gradual expansion, spatial density and fade',()=>{
 const v=volume();assert.equal(v.fieldVersion,SMOKE_FIELD_VERSION);assert.equal(smokeEnvelope(v,0),0);assert.equal(smokeEnvelope(v,1),1);assert.equal(smokeEnvelope(v,18),0);assert.equal(smokeEnvelope(v,17),.5);assert.ok(smokeDensity(v,center,1)>.99);assert.equal(smokeDensity(v,{x:10,y:1,z:0},1),0);assert.equal(volume({radius:100}),null);assert.equal(volume({endAt:1000}),null);
});
test('bullet holes are confirmed, idempotent, short lived, bounded and do not erase the volume',()=>{
 const v=volume(),smokes=[v],event={shotId:'shot',from:{x:0,y:1.44,z:-6},to:{x:0,y:1.44,z:6}};
 assert.equal(applySmokeShot(smokes,event,1),1);assert.equal(applySmokeShot(smokes,event,1),0);assert.equal(smokeDensity(v,center,1),0);assert.ok(smokeDensity(v,{...center,x:1},1)>.9);assert.ok(smokeDensity(v,center,1.4)>.99);assert.equal(v.endAt,18);
 for(let i=0;i<20;i++)applySmokeShot(smokes,{...event,shotId:'shot'+i},1);assert.equal(v.holes.length,4);pruneSmokeFields(smokes,2);assert.equal(v.holes.length,0);assert.equal(applySmokeShot(smokes,{from:{x:NaN,y:0,z:0},to:center},2),0);
});
test('HE temporarily clears density while flash, remote blasts and expired pulses do not',()=>{
 const v=volume(),smokes=[v],event={kind:'hegrenade',id:'blast',...center};const before=smokeDensity(v,center,2);assert.equal(applySmokeExplosion(smokes,{...event,kind:'flashbang'},2),0);assert.equal(applySmokeExplosion(smokes,{...event,x:100},2),0);assert.equal(applySmokeExplosion(smokes,event,2),1);assert.equal(applySmokeExplosion(smokes,event,2),0);assert.ok(smokeDensity(v,center,2.6)<before*.01);assert.ok(smokeDensity(v,center,3.3)>.99);assert.equal(v.endAt,18);
});
test('CS2 throw uses pinned 750 SU/s and explicit candidates with inherited velocity',()=>{
 const w=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),runtime=createGrenadeRuntime(w,{profile:CS2_GRENADE_PROFILE}),p={id:'t',team:'T',alive:true,...w.resolveSpawn('T'),vx:0,vy:0,vz:0,yaw:0,pitch:0};
 const a=runtime.createGrenade(p,'smokegrenade',0),b=runtime.createGrenade({...p,vx:4},'smokegrenade',0);assert.ok(a);assert.ok(Math.abs(Math.hypot(a.vx,a.vy,a.vz)-750*.9*.0254)<1e-8);assert.ok(Math.abs(b.vx-a.vx-5)<1e-8);assert.equal(a.detonateAt,1.5);assert.ok(CS2_GRENADE_PROFILE.candidateFields.includes('elasticity'));assert.ok(CS2_GRENADE_PROFILE.verifiedFields.includes('weapons.throwVelocity'));
});
test('native smoke detonation creates synchronized fields, shot/HE updates preserve authority state',()=>{
 const {g,t,world}=fixtureGame({world:fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),weaponProfile:'cs2'}),runtime=createGrenadeRuntime(world,{profile:CS2_GRENADE_PROFILE});
 const grenade=runtime.createGrenade({...t,yaw:0},'smokegrenade',0);g.time=2;g.projectiles=[{...grenade,x:0,y:.051,z:0,vx:0,vy:0,vz:0,grounded:true,resting:true,detonationQueued:true,nextThinkAt:0,detonateAt:1}];runtime.stepGrenades(g,.02);assert.equal(g.smokes.length,1);assert.equal(g.smokes[0].fieldVersion,SMOKE_FIELD_VERSION);assert.equal(g.smokes[0].endAt,20);
 g.emit({type:'shot',shotId:'through',from:{x:0,y:1.4,z:-8},to:{x:0,y:1.4,z:8}});assert.equal(g.smokes[0].holes.length,1);g.emit({type:'explosion',kind:'hegrenade',id:'he',x:0,y:1.4,z:0});assert.equal(g.smokes[0].clears.length,1);const snapshot=g.snapshot(t.id);assert.equal(snapshot.smokes[0].holes.length,1);snapshot.smokes[0].holes[0].from.x=999;assert.equal(g.smokes[0].holes[0].from.x,0);
});
test('maximum smoke field serialization stays bounded without rounding gameplay positions',()=>{
 const smokes=Array.from({length:32},(_,i)=>volume({id:'grenade-12345678-1234-1234-1234-'+String(i).padStart(12,'0'),x:10.123456789,y:1.123456789,z:.123456789}));
 for(let n=0;n<4;n++)applySmokeShot(smokes,{shotId:'100:12345678-1234-1234-1234-123456789012:12345678:100.123456789'+n,from:{x:10.123456789,y:1.123456789,z:-100.123456789},to:{x:10.123456789,y:1.123456789,z:100.123456789}},1.123456789);
 for(let n=0;n<2;n++)applySmokeExplosion(smokes,{kind:'hegrenade',id:'grenade-12345678-1234-1234-1234-'+n,x:10.123456789,y:1.123456789,z:.123456789},1.123456789);
 assert.ok(Buffer.byteLength(JSON.stringify(smokes))<40*1024);assert.equal(smokes[0].x,10.123456789);assert.equal(smokes[0].holes[0].from.x,10.123);assert.equal(smokes[0].holes.length,4);assert.equal(smokes[0].clears.length,2);
});
test('volumetric renderer does no draw without smoke, allocates depth once, bounds work and restores renderer state',()=>{
 const calls=[],r={autoClear:false,initRenderTarget:()=>{},compile:()=>calls.push('compile'),getDrawingBufferSize:v=>v.set(800,600),getRenderTarget:()=>null,setRenderTarget:t=>calls.push(t?'target':'screen'),getScissorTest:()=>true,setScissorTest:()=>{},getViewport:v=>v.set(1,2,800,600),getCurrentViewport:v=>v.set(1,2,800,600),getScissor:v=>v.set(3,4,500,400),setViewport:()=>{},setScissor:()=>{},render:()=>calls.push('draw')};const camera=new THREE.PerspectiveCamera(75,4/3,.1,100);camera.position.set(0,1.5,10);camera.lookAt(0,1.5,0);const smoke=createSmokeRenderer(THREE,{renderer:r,scene:new THREE.Scene(),camera});
 assert.equal(smoke.render(1),false);assert.deepEqual(calls,[]);smoke.prewarm();assert.equal(smoke.diagnostics().depthTexture,true);assert.equal(smoke.diagnostics().width,800);const v=Array.from({length:8},(_,i)=>volume({id:'s'+i,x:i*.1}));smoke.sync({smokes:v});assert.equal(smoke.render(1),true);assert.equal(calls.filter(x=>x==='draw').length,2);assert.equal(smoke.diagnostics().visibleVolumes,8);assert.equal(smoke.diagnostics().detailedVolumes,4);assert.equal(smoke.diagnostics().degradedVolumes,4);assert.equal(smoke.diagnostics().droppedVolumes,0);assert.equal(smoke.diagnostics().samples,SMOKE_FIELD_LIMITS.samples);assert.equal(r.autoClear,false);assert.equal(smoke.resize(800,600),false);smoke.dispose();assert.equal(smoke.render(2),false);assert.equal(smoke.diagnostics().disposed,true);
});
