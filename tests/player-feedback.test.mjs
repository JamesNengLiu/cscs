import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {Game} from '../game.mjs';
import {supportHeight,eyeHeight,movePlayer} from '../public/shared.js';
import {playerHitboxes,hitboxAnimation} from '../hitboxes.mjs';
import {createBonePose} from '../public/bone-pose.js';
import {createPlayerHitEffects,PLAYER_HIT_LIMITS,playerHitSound} from '../public/player-hit-effects.js';
import {createLagCompensation} from '../lag-compensation.mjs';
function match({armour=0,helmet=false,friendly=false,shield=false}={}){
  const g=new Game({random:()=>.5}),p=g.add('attacker','Attacker','T'),q=g.add('target','Target',friendly?'T':'CT');g.begin();g.phase='live';g.time=10;g.endAt=1000;g.buy(p.id,'ak47');
  for(const [a,z] of [[p,22],[q,18]])Object.assign(a,{x:-18.4,z,y:supportHeight(-18.4,z,3.3),yaw:0,pitch:0,vx:0,vy:0,vz:0,grounded:true,hp:10000,armour:0,lastShot:-100});
  Object.assign(q,{armour,helmet,shield,shieldRaised:shield,yaw:shield?Math.PI:0});p.nextAttackAt=0;g.events=[];return {g,p,q};
}
function fire(fixture,group='chest'){
  const {g,p,q}=fixture,box=playerHitboxes(q,g.time).find(b=>b.group===group);
  const point=new THREE.Vector3(...box.min.map((x,i)=>(x+box.max[i])/2)).applyMatrix4(new THREE.Matrix4().fromArray(box.inverse).invert());
  const dx=point.x-p.x,dz=point.z-p.z;p.yaw=Math.atan2(-dx,-dz);p.pitch=Math.atan2(point.y+(group==='head'?.05:0)-p.y-eyeHeight(p),Math.hypot(dx,dz));
  assert.equal(g.shoot(p),true);return g.events.find(e=>e.type==='shot'&&e.hitImpact);
}
for(const [name,settings,group,effect] of [['flesh',{},'chest','blood'],['helmet',{armour:100,helmet:true},'head','helmet'],['vest',{armour:100},'chest','armour'],['uncovered legs',{armour:100},'legs','blood'],['shield',{shield:true},'chest','shield']])test(`confirmed ${name} hit has source-style feedback at the real bone trace`,()=>{
  const f=match(settings),shot=fire(f,group);assert.ok(shot,`${name} generated a hit impact`);assert.equal(shot.hitImpact.effect,effect);assert.equal(shot.hitImpact.targetId,f.q.id);
  assert.ok(Math.hypot(shot.hitImpact.direction.x,shot.hitImpact.direction.y,shot.hitImpact.direction.z)>.99);
  for(const k of ['x','y','z'])assert.ok(Math.abs(shot.hitImpact.position[k]-f.q[k]-shot.hitImpact.offset[k])<1e-8);
  for(const key of ['health','hp','damage','armour'])assert.equal(Object.hasOwn(shot.hitImpact,key),false);
  if(effect==='shield')assert.equal(f.q.hp,10000);else{assert.ok(f.q.hp<10000);assert.equal(f.q.flinchAt,f.g.time);}
});
test('friendly-fire rejection and a miss produce no player hit feedback',()=>{
  const f=match({friendly:true});assert.equal(fire(f),undefined);assert.equal(f.q.hp,10000);
  const m=match();m.p.yaw=Math.PI;m.p.pitch=0;assert.equal(m.g.shoot(m.p),true);assert.equal(m.g.events.some(e=>e.hitImpact),false);
});
test('hit effects anchor to the visible delayed target, deduplicate a shotgun volley and expire',()=>{
  const shot=fire(match()),scene=new THREE.Scene(),fx=createPlayerHitEffects(THREE,scene,{random:()=>.5});
  const at=fx.add(shot,1,{x:4,y:2,z:3});assert.ok(at);for(const k of ['x','y','z'])assert.equal(at[k],({x:4,y:2,z:3})[k]+shot.hitImpact.offset[k]);
  assert.equal(fx.add(shot,1),null);assert.equal(fx.info().accepted,1);assert.equal(fx.info().blood,12);
  fx.update(1.05,new THREE.Quaternion());assert.equal(scene.children[0].visible,true);assert.equal(fx.info().batches,1);
  fx.update(30);assert.equal(fx.info().active,0);assert.equal(scene.children[0].visible,false);fx.dispose();assert.equal(scene.children.length,0);
});
test('hit effects remain bounded under sustained fire, reject malformed events and clear on a new round',()=>{
  const scene=new THREE.Scene(),fx=createPlayerHitEffects(THREE,scene,{random:()=>.5}),shot=fire(match());
  shot.hitImpact.wall={position:{...shot.hitImpact.position},normal:{x:0,y:0,z:1}};
  for(let i=0;i<1200;i++)fx.add({...shot,shotId:String(i)},1);
  assert.equal(fx.info().active,PLAYER_HIT_LIMITS.particles+PLAYER_HIT_LIMITS.marks);assert.equal(fx.info().batches,1);
  assert.equal(fx.add({...shot,hitImpact:{...shot.hitImpact,position:{x:NaN,y:0,z:0}}},1),null);
  for(const effect of ['unknown','toString','__proto__'])assert.equal(fx.add({...shot,hitImpact:{...shot.hitImpact,effect}},1),null);
  assert.equal(fx.add({...shot,hitImpact:{...shot.hitImpact,direction:{x:0,y:0,z:0}}},1),null);
  fx.clear();assert.equal(fx.info().active,0);fx.dispose();assert.equal(scene.children.length,0);
  assert.equal(playerHitSound('blood'),'player/bhit_flesh-1.wav');
});
test('gait phase advances with distance and keeps legs moving during shooting and flinching',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../public/assets/players/urban/model.json',import.meta.url))),find=name=>data.sequences.find(s=>s.name===name);
  const a=createBonePose(THREE,data),b=createBonePose(THREE,data),p={playerGaitSequence:'run',gaitDistance:.5};
  a.pose(find('ref_aim_ak47'),0,p);b.pose(find('ref_shoot_ak47'),1,p);
  const foot=data.bones.findIndex(b=>b.name==='Bip01 L Foot'),head=data.bones.findIndex(b=>b.name==='Bip01 Head');
  assert.deepEqual(a.matrices[foot].elements,b.matrices[foot].elements);assert.notDeepEqual(a.matrices[head].elements,b.matrices[head].elements);
  b.pose(find('gut_flinch'),1,p);assert.deepEqual(a.matrices[foot].elements,b.matrices[foot].elements);
  b.pose(find('gut_flinch'),1,{...p,gaitDistance:.65});assert.notDeepEqual(a.matrices[foot].elements,b.matrices[foot].elements);
  a.pose(find('jump'),9,{});b.pose(find('gut_flinch'),1,{playerGaitSequence:'jump',playerGaitFrame:9});
  assert.deepEqual(a.matrices[foot].elements,b.matrices[foot].elements,'airborne flinch keeps the jump leg pose');
});
test('shared movement, snapshot animation and historical hitboxes retain gait and airborne phase',()=>{
  const {g,p}=match(),input={f:1,yaw:0};for(let i=0;i<20;i++)movePlayer(p,input,1/60);
  assert.ok(p.gaitDistance>0);const animation=hitboxAnimation(p,g.time);assert.equal(animation.playerGaitSequence,'run');
  const old=playerHitboxes(p,g.time);p.gaitDistance+=.1;assert.notDeepEqual(playerHitboxes(p,g.time),old);
  movePlayer(p,{...input,jump:true},1/60);assert.ok(p.airTime>0);const jump=hitboxAnimation(p,g.time);assert.equal(jump.playerSequence,'jump');assert.ok(jump.playerFrame>0&&jump.playerFrame<10);
  const h=createLagCompensation(),q={...p,id:'q',playedRound:1};h.record({time:1,round:1,players:[q]});h.record({time:1.1,round:1,players:[{...q,gaitDistance:q.gaitDistance+1,airTime:q.airTime+.1}]});
  const historical=h.pose('q',1.05,1);assert.ok(Math.abs(historical.gaitDistance-q.gaitDistance-.5)<1e-8);assert.ok(Math.abs(historical.airTime-q.airTime-.05)<1e-8);
});

test('nine-blend player aiming maps pitch to vertical rows and torso yaw to columns',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../public/assets/players/urban/model.json',import.meta.url))),pose=createBonePose(THREE,data),s=data.sequences.find(s=>s.name==='ref_aim_carbine');
  const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/players/manifest.json',import.meta.url))),gun=JSON.parse(fs.readFileSync(new URL('../public/assets/players/'+manifest.weapons.m4a1.file,import.meta.url))),weapon=createBonePose(THREE,gun),map=gun.bones.map(b=>data.bones.findIndex(p=>p.name===b.name));
  const direction=p=>{pose.pose(s,0,p);weapon.pose(null,0,{},pose.matrices,map);return new THREE.Vector3().setFromMatrixPosition(weapon.matrices[11]).sub(new THREE.Vector3().setFromMatrixPosition(pose.matrices[26])).normalize();};
  const level=direction({pitch:0}),up=direction({pitch:Math.PI/6}),down=direction({pitch:-Math.PI/6}),left=direction({aimYaw:Math.PI/4});
  assert.ok(up.z>level.z+.2&&down.z<level.z-.1,'look-up/down changes source vertical direction');
  assert.ok(Math.abs(up.y)<.3&&Math.abs(down.y)<.3,'pitch must not turn the gun sideways');
  assert.ok(left.y>level.y+.3,'positive torso yaw turns left in source coordinates');
});
test('strafe gait faces travel while the torso retains aim, and backward gait reverses without turning away',()=>{
  const {p}=match();p.yaw=0;p.gaitYaw=null;
  for(let i=0;i<20;i++)movePlayer(p,{s:-1,yaw:0},1/60);
  assert.ok(Math.abs(p.gaitYaw-Math.PI/2)<.01);assert.equal(p.yaw,0);
  p.vx=p.vz=0;p.gaitYaw=null;p.gaitDistance=0;
  for(let i=0;i<20;i++)movePlayer(p,{f:-1,yaw:0},1/60);
  assert.ok(Math.abs(p.gaitYaw)<.01);assert.ok(p.gaitDistance<0);
});
test('weapon switching crossfades shared bone poses and preserves historical transition state',()=>{
  const {g,p}=match();g.time+=1;const original=hitboxAnimation(p,g.time),boxes=playerHitboxes(p,g.time);g.equip(p.id,2);
  const start=hitboxAnimation(p,g.time);assert.equal(start.playerPoseFromSequence,original.playerSequence);assert.equal(start.playerPoseBlend,0);
  const data=JSON.parse(fs.readFileSync(new URL('../public/assets/players/urban/model.json',import.meta.url))),a=createBonePose(THREE,data),b=createBonePose(THREE,data),state={...p,...start};
  a.pose(data.sequences.find(s=>s.name===original.playerSequence),original.playerFrame,p);b.pose(data.sequences.find(s=>s.name===start.playerSequence),start.playerFrame,state);
  for(let i=0;i<a.matrices.length;i++)for(let j=0;j<16;j++)assert.ok(Math.abs(a.matrices[i].elements[j]-b.matrices[i].elements[j])<1e-10,'switch begins at the exact previous pose');
  g.time+=.1;const mid=hitboxAnimation(p,g.time);assert.ok(Math.abs(mid.playerPoseBlend-.5)<1e-8);
  const midBoxes=playerHitboxes(p,g.time);assert.notDeepEqual(midBoxes,boxes);b.pose(data.sequences.find(s=>s.name===mid.playerSequence),mid.playerFrame,{...p,...mid});
  const middle=b.matrices.map(m=>m.elements.slice());assert.notDeepEqual(middle,a.matrices.map(m=>m.elements));
  g.time+=.11;const end=hitboxAnimation(p,g.time);assert.equal(end.playerPoseBlend,1);assert.equal(end.playerPoseFromSequence,null);b.pose(data.sequences.find(s=>s.name===end.playerSequence),end.playerFrame,{...p,...end});assert.notDeepEqual(middle,b.matrices.map(m=>m.elements));
  const h=createLagCompensation();h.record({time:g.time,round:g.round,players:[p]});const old=h.pose(p.id,g.time,g.round);assert.equal(old.poseFromSequence,p.poseFromSequence);assert.equal(old.poseChangedAt,p.poseChangedAt);
});
