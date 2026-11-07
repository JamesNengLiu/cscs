import test from 'node:test';import assert from 'node:assert/strict';
import {createWalkCamera} from '../public/cs2-walk-camera.js';
import {createMovement} from '../public/cs2-movement.js';
import {createCollisionWorld} from '../public/cs2-collision.js';
import * as oldWorld from '../public/map.js';
import {cameraCases,cameraTrace} from './fixtures/camera-ab-cases.mjs';

const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const movement=createMovement(oldWorld);
for(const hz of [60,75,144])for(const scenario of cameraCases)test(`experimental baseline camera keeps the verified ${scenario.name} interpolation at ${hz} Hz`,()=>{
 const old=cameraTrace(scenario,hz,'baseline'),adapted=cameraTrace(scenario,hz,'baseline',{factory:()=>createWalkCamera({world:oldWorld,movement})});
 assert.equal(adapted.physicsHash,old.physicsHash);assert.equal(adapted.renderHash,old.renderHash);
});

function box(id,min,max){const vertices=[];for(const x of [min[0],max[0]])for(const y of [min[1],max[1]])for(const z of [min[2],max[2]])vertices.push(x,y,z);return{id,type:'hull',vertices,planes:[[1,0,0,max[0]],[-1,0,0,-min[0]],[0,1,0,max[1]],[0,-1,0,-min[1]],[0,0,1,max[2]],[0,0,-1,-min[2]]]};}
test('stair smoothing uses the new point trace so the eye cannot rise through a low ceiling',()=>{
 const world=createCollisionWorld({schema:'cs2-physics-v1',units:'metres',shapes:[box('floor',[-10,-2,-10],[10,0,10]),box('step',[-10,0,-2],[-.4,.45,2]),box('roof',[0,1,-2],[3,1.2,2])]}),movement=createMovement(world),camera=createWalkCamera({world,movement});
 const before={x:-.4001,y:.4505,z:0,crouch:true,grounded:true},after={x:.0001,y:.0005,z:0,crouch:true,grounded:true};
 for(const p of [before,after])assert.equal(world.collides(p.x,p.z,movement.rules.radius,p.y,movement.bodyHeight(p)),false);
 camera.reset(before);camera.push(after);camera.update(after,{fractionSeconds:movement.fixedDt});
 assert.ok(camera.position.y<1);assert.ok(camera.position.y>.75);assert.equal(world.trace(camera.position,camera.position,0,{channel:'player'}).startSolid,false);assert.equal(camera.diagnostics().pointClamps,1);
});
test('continuous slopes are interpolated without classifying them as discrete stairs',()=>{
 const world={trace:(a,b)=>({fraction:1,startSolid:false,end:{...b}})},camera=createWalkCamera({world,movement});
 const p={x:0,y:0,z:0,grounded:true};camera.reset(p);
 for(let i=1;i<=30;i++){Object.assign(p,{x:i*.1,y:i*.05});camera.push(p);camera.update(p,{fractionSeconds:movement.fixedDt});near(camera.position.y,p.y+movement.eyeHeight(p));}
 near(camera.diagnostics().stepOffset,0);
});
test('camera interpolation never changes physics, input, fatigue, ammo or timers, and probes player-only geometry',()=>{
 const calls=[],world={trace(a,b,height,options){calls.push(options);return{fraction:1,startSolid:false,end:{...b}};}},camera=createWalkCamera({world,movement});
 const p={x:1,y:2,z:3,grounded:true,vx:5,vy:0,vz:0,ammo:30,jumpFatigue:300,nextShotAt:99};camera.reset(p);p.x+=.1;camera.push(p);const saved={...p};
 for(let i=0;i<75;i++)camera.update(p,{fractionSeconds:(i%5)/300,dt:1/75});assert.deepEqual(p,saved);assert.ok(calls.every(o=>o.channel==='player'&&o.radius===0));
 camera.reset({...p,x:20});near(camera.position.x,20);camera.update({...p,x:20},{fractionSeconds:99});near(camera.position.x,20);
});
