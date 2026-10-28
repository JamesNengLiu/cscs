import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Game} from '../game.mjs';
import {GUNS} from '../public/arsenal.js';
import {direction,trace,supportHeight} from '../public/shared.js';
import {createShotEffects,SHOT_FX_LIMITS} from '../public/shot-effects.js';

const point={x:-18.4,y:4.8,z:16.4};
const impact=(normal={x:0,y:0,z:1})=>({type:'shot',hit:false,impact:{position:{...point},normal}});
const seed=()=>{let n=17;return()=>((n=Math.imul(n,1664525)+1013904223>>>0)/4294967296);};
function match(weapon='glock18'){
  const g=new Game({random:()=>.5}),p=g.add('t','T','T');g.begin();
  if(weapon!==p.weapon)g.buy(p.id,weapon);
  g.time=1;return {g,p};
}
const place=(p,z=22)=>Object.assign(p,{x:-18.4,y:supportHeight(-18.4,z,3.3),z,yaw:0,pitch:0});

test('shot impacts: wall and floor hits contain their surface normal, empty range has no impact',()=>{
  const {g,p}=match();place(p);
  const wall=g.targetRay(p,direction(0,0),100);
  assert.ok(wall.impact);assert.ok(wall.impact.normal.z>.9);
  assert.ok(Math.abs(Math.hypot(...Object.values(wall.impact.normal))-1)<1e-6);
  assert.deepEqual(wall.impact.position,wall.to);
  const beyond=trace(wall.to,{...wall.to,z:wall.to.z-.02});
  assert.equal(beyond.startSolid,false);assert.ok(beyond.fraction<1);
  assert.equal(g.targetRay(p,direction(0,0),1).impact,null);
  assert.ok(g.targetRay(p,{x:0,y:-1,z:0},10).impact.normal.y>.99);
});

test('shot impacts: hitting a player or their shield never creates a wall decal',()=>{
  for(const shield of [false,true]){
    const {g,p}=match(),ct=g.add('ct','CT','CT');g.phase='live';g.buyEndAt=1000;
    if(shield)g.buy(ct.id,'shield');
    place(p);place(ct,19);ct.yaw=Math.PI;ct.shieldRaised=shield;
    assert.equal(g.shoot(p),true);
    const e=g.events.findLast(e=>e.type==='shot');
    assert.equal(e.impact,null);assert.equal(e.hit,!shield);
    if(shield)assert.equal(ct.hp,100);
  }
});

test('shot impacts: every shotgun pellet reports its own surface hit',()=>{
  const {g,p}=match('m3');place(p);assert.equal(g.shoot(p),true);
  const shots=g.events.filter(e=>e.type==='shot');assert.equal(shots.length,GUNS.m3.pellets);
  for(const e of shots){assert.ok(e.impact);assert.deepEqual(e.impact.position,e.to);assert.equal(e.hit,false);}
});

test('shot impacts: lag-compensated targets suppress wall decals while shot identity and wall normals survive',()=>{
  const {g,p}=match(),ct=g.add('ct','CT','CT');g.phase='live';place(p);place(ct,19);
  const historical={...ct};ct.x+=5;
  g.lagComp={targetTime:()=>g.time-.1,pose:()=>historical};
  assert.equal(g.shoot(p),true);
  const hit=g.events.findLast(e=>e.type==='shot');
  assert.equal(hit.hit,true);assert.equal(hit.impact,null);assert.ok(hit.shotId);
  assert.equal(hit.round,g.round);assert.ok(Math.abs(hit.rewindMs-100)<1e-6);
  g.lagComp.pose=()=>ct;g.time+=.3;
  assert.equal(g.shoot(p),true);
  const wall=g.events.findLast(e=>e.type==='shot');
  assert.equal(wall.hit,false);assert.ok(wall.impact);assert.ok(wall.impact.normal.z>.9);
  assert.notEqual(wall.shotId,hit.shotId);assert.ok(Math.abs(wall.rewindMs-100)<1e-6);
});

test('shot effects: decals follow arbitrary surface normals and stay fixed as the camera moves',()=>{
  for(const n of [{x:0,y:0,z:1},{x:0,y:1,z:0},{x:1,y:0,z:0},{x:0,y:Math.SQRT1_2,z:Math.SQRT1_2}]){
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),fx=createShotEffects(THREE,scene,{random:()=>0});
    assert.equal(fx.add(impact(n),1),true);
    const mesh=scene.getObjectByName('bullet-hole-0'),matrix=new THREE.Matrix4();mesh.getMatrixAt(0,matrix);
    const position=new THREE.Vector3(),q=new THREE.Quaternion(),scale=new THREE.Vector3();matrix.decompose(position,q,scale);
    assert.ok(new THREE.Vector3(0,0,1).applyQuaternion(q).distanceTo(new THREE.Vector3(n.x,n.y,n.z))<1e-6);
    assert.ok(position.distanceTo(new THREE.Vector3(point.x,point.y,point.z).addScaledVector(new THREE.Vector3(n.x,n.y,n.z),.0015))<1e-5);
    const before=matrix.clone();camera.position.set(100,30,-50);camera.rotation.set(.5,1,0);fx.update(1.07);
    mesh.getMatrixAt(0,matrix);assert.deepEqual(matrix.elements,before.elements);
    assert.equal(mesh.parent,scene);assert.equal(mesh.material.depthTest,true);assert.equal(mesh.material.depthWrite,false);
    assert.equal(mesh.material.polygonOffset,true);fx.dispose();
  }
});

test('shot effects: varied procedural crater textures use transparent edges and a dark opaque center',()=>{
  const scene=new THREE.Scene(),fx=createShotEffects(THREE,scene),textures=scene.children.filter(o=>o.name.startsWith('bullet-hole')).map(o=>o.material.map);
  assert.equal(textures.length,4);
  assert.equal(new Set(textures.map(t=>Buffer.from(t.image.data).toString('base64'))).size,4);
  for(const t of textures){const {data,width}=t.image,center=((width/2)*width+width/2)*4;
    assert.equal(data[3],0);assert.ok(data[center]<25);assert.ok(data[center+3]>240);
  }
  fx.dispose();
});

test('shot effects: malformed events, player hits and misses cannot leave floating holes',()=>{
  const scene=new THREE.Scene(),fx=createShotEffects(THREE,scene);
  for(const e of [{},{hit:false,to:point},{...impact(),hit:true},impact({x:0,y:0,z:0}),impact({x:NaN,y:0,z:1}),impact({x:1e308,y:0,z:0}),{impact:{position:{x:Infinity,y:0,z:0},normal:{x:0,y:1,z:0}}}])assert.equal(fx.add(e,1),false);
  assert.equal(fx.info().decals,0);assert.equal(fx.info().dust,0);fx.dispose();
});

test('shot effects: sustained fire reuses bounded batches and creates no line objects',()=>{
  const scene=new THREE.Scene(),fx=createShotEffects(THREE,scene,{random:seed()});
  for(let i=0;i<3000;i++)fx.add(impact(),1+i/10000);
  assert.equal(fx.info().decals,SHOT_FX_LIMITS.decals);assert.equal(fx.info().dust,SHOT_FX_LIMITS.dust);
  assert.equal(scene.children.length,SHOT_FX_LIMITS.variants+1);
  assert.equal(new Set(scene.children.map(o=>o.geometry)).size,2);
  scene.traverse(o=>assert.equal(Boolean(o.isLine),false));assert.equal(fx.info().tracers,0);
  fx.update(2);assert.equal(fx.info().dust,0);assert.equal(fx.info().decals,SHOT_FX_LIMITS.decals);
  fx.dispose();assert.equal(scene.children.length,0);
});

test('shot effects: dust is brief, settled holes render on demand, and lifetime/round cleanup works',()=>{
  const scene=new THREE.Scene(),fx=createShotEffects(THREE,scene,{random:()=>0});fx.add(impact(),1);
  assert.equal(fx.update(1.08),true);assert.ok(fx.info().dust>0);
  fx.update(1.2);assert.equal(fx.info().dust,0);assert.equal(fx.info().decals,1);
  assert.equal(fx.update(2),false);
  assert.equal(fx.update(62),true);assert.equal(fx.info().decals,0);assert.ok(scene.children.every(o=>!o.visible));
  fx.add(impact(),63);fx.clear();assert.equal(fx.info().decals,0);assert.equal(fx.info().dust,0);
  fx.add(impact(),64);assert.equal(fx.info().decals,1);fx.dispose();fx.dispose();
  assert.equal(scene.children.length,0);assert.equal(fx.add(impact(),65),false);
});
