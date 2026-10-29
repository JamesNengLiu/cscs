import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Game} from '../game.mjs';
import {playerHitboxes,rayPlayer,hitboxDiagnostics} from '../hitboxes.mjs';
import {penetrationExit,materialAt,bulletProperties} from '../ballistics.mjs';
import {GUNS} from '../public/arsenal.js';
import {SPAWN_POINTS,supportHeight,movePlayer,eyeHeight} from '../public/shared.js';
import {createCrosshair} from '../public/crosshair.js';
const close=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} vs ${b}`);
const pose=()=>{const s=SPAWN_POINTS.T[0];return {...s,id:'p',alive:true,weapon:'ak47',y:supportHeight(s.x,s.z,s.y+.1),yaw:0,pitch:0,vx:0,vy:0,vz:0,lastShot:-100,grounded:true};};
test('bone hitboxes follow the same original pose evaluator, and cosmetic appearance does not alter combat',()=>{
  assert.equal(hitboxDiagnostics().source,'original-canonical-bone-hitboxes');assert.equal(hitboxDiagnostics().boxes,21);
  const p=pose();const boxes=playerHitboxes(p,1),head=boxes.find(b=>b.group==='head');
  const center=new THREE.Vector3(...head.min.map((n,i)=>(n+head.max[i])/2)).applyMatrix4(new THREE.Matrix4().fromArray(head.inverse).invert());
  const hit=rayPlayer({x:center.x,y:center.y,z:center.z+3},{x:0,y:0,z:-1},p,1);assert.equal(hit.hitgroup,'head');assert.ok(hit.distance>2.7&&hit.distance<3);
  assert.deepEqual(playerHitboxes({...p,character:'terror_trump'},1),boxes);
  assert.notDeepEqual(playerHitboxes({...p,yaw:Math.PI/2},1),boxes);assert.notDeepEqual(playerHitboxes({...p,crouch:true},1),boxes);
});
test('bounded penetration exits thin cover but never skips across thick or disconnected solids',()=>{
  const o={x:0,y:0,z:0},d={x:1,y:0,z:0},wall=width=>(p=>({startSolid:p.x>=0&&p.x<width}));
  assert.ok(penetrationExit(o,d,39,'wood',wall(.7)).x>.7);
  assert.equal(penetrationExit(o,d,39,'metal',wall(.7)),null);
  assert.equal(penetrationExit(o,d,39,'wood',wall(1.5)),null);
  assert.equal(penetrationExit(o,d,39,'wood',()=>({startSolid:false})),null);
  assert.ok(bulletProperties(GUNS.awp).hits>bulletProperties(GUNS.glock18).hits);
});
test('original Dust2 crate texture is classified as wood rather than a universal concrete surface',()=>{
  assert.equal(materialAt({x:-36.8,y:.8,z:-65.6},[-1,0,0],1),'wood');
});
test('a rifle can hit two aligned players in the original map, with reduced damage after the first body',()=>{
  const g=new Game({random:()=>.5}),t=g.add('t','t','T'),a=g.add('a','a','CT'),b=g.add('b','b','CT');g.begin();g.phase='live';g.endAt=1000;g.buy('t','ak47');g.time=2;
  for(const [p,z] of [[t,22],[a,19],[b,17]])Object.assign(p,{x:-18.4,z,y:supportHeight(-18.4,z,3.3),yaw:0,pitch:0,hp:1000,vx:0,vy:0,vz:0});
  assert.equal(g.shoot(t),true);assert.ok(a.hp<1000);assert.ok(b.hp<1000);assert.ok(1000-b.hp<1000-a.hp);
});
test('taking a rifle hit produces integer health damage, movement slowdown and unprotected view punch',()=>{
  const g=new Game(),t=g.add('t','t','T'),ct=g.add('ct','ct','CT');g.begin();g.phase='live';ct.armour=0;ct.vx=2;
  const damage=g.damage(ct,20.8,t,{kind:'ak47',hitgroup:'chest',armourRatio:1.55});assert.equal(damage,20);assert.equal(ct.hp,80);assert.equal(ct.velocityModifier,.65);assert.ok(ct.recoilPitch>0);
  ct.armour=100;ct.hp=100;g.damage(ct,65,t,{kind:'knife',hitgroup:'chest',armourRatio:1.7});assert.equal(ct.hp,45);
});
test('player bodies block forward travel and provide a stable jumpable support',()=>{
  const p=pose(),q={...pose(),id:'q',z:p.z+2};p.yaw=Math.PI;
  for(let i=0;i<60;i++)movePlayer(p,{f:1,yaw:Math.PI},1/60,[q]);assert.ok(q.z-p.z>=.799);
  const top={...q,id:'top',y:q.y+1.8+.01,vy:-1};movePlayer(top,{},1/60,[q]);assert.equal(top.grounded,true);assert.equal(top.groundPlayer,'q');
  movePlayer(top,{jump:true},1/60,[q]);assert.ok(top.vy>0);assert.equal(top.grounded,false);
});
test('ground duck interpolates the view before switching hulls while airborne duck remains immediate',()=>{
  const p=pose(),before=eyeHeight(p);movePlayer(p,{crouch:true},.1);assert.equal(p.crouch,undefined);assert.ok(eyeHeight(p)<before&&eyeHeight(p)>.75);
  for(let i=0;i<4;i++)movePlayer(p,{crouch:true},.1);assert.equal(p.crouch,true);close(eyeHeight(p),.75);
});
test('crosshair opening depends on shots rather than spread, and predicted confirmation is not counted twice',()=>{
  const x=createCrosshair(),p={...pose(),shotsFired:0};const base=x.update(p,0);p.spread=999;close(x.update(p,0),base);
  x.shot();const opened=x.update(p,0);assert.ok(opened>base);p.shotsFired=1;close(x.update(p,0),opened);
  for(let i=0;i<200;i++)x.update(p,1/60);close(x.update(p,0),base);
});
test('death switches the authoritative original pose from aiming to a death sequence',async()=>{
  const {hitboxAnimation}=await import('../hitboxes.mjs');const p=pose();p.alive=false;p.diedAt=1;
  const animation=hitboxAnimation(p,1.1);assert.match(animation.playerSequence,/death|die|head/);assert.ok(animation.playerFrame>0);
});
