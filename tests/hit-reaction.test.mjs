import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from '../game.mjs';
import {HIT_REACTION,hitboxAnimation,playerHitboxes} from '../hitboxes.mjs';
import {createLagCompensation} from '../lag-compensation.mjs';
import {createSnapshotBuffer} from '../public/snapshot-buffer.js';

const rig=JSON.parse(readFileSync(new URL('../public/assets/players/urban/model.json',import.meta.url),'utf8'));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const target=(head=false)=>({id:'target',alive:true,playedRound:1,x:0,y:0,z:-6,yaw:0,gaitYaw:0,pitch:0,weapon:'m4a1',vx:0,vy:0,vz:0,grounded:true,crouch:false,gaitDistance:0,lastShot:-100,flinchAt:10,flinchHead:head});
function combat(){
 const g=new Game({random:()=>.5,audioRandom:()=>.5}),a=g.add('attacker','A','T'),p=g.add('target','B','CT');g.begin();g.phase='live';g.time=10;p.hp=10000;return {g,a,p};
}

for(const head of [false,true])test(`${head?'head':'body'} reaction lasts one third longer and plays the same pose curve at 75% speed`,()=>{
 const p=target(head),saved=structuredClone(p),name=head?'head_flinch':'gut_flinch',sequence=rig.sequences.find(s=>s.name===name);
 near(HIT_REACTION.duration,.16*4/3);
 for(const age of [0,.01,.02,.08,.159,.17,.2,.2132]){
  const animation=hitboxAnimation(p,10+age);assert.equal(animation.playerSequence,name);
  near(animation.playerAnimationTime,age*.75);near(animation.playerFrame,Math.min(age*.75*sequence.fps,sequence.frames-1));
 }
 assert.notEqual(hitboxAnimation(p,10+.2135).playerSequence,name);
 assert.notEqual(hitboxAnimation(p,9.99).playerSequence,name);assert.deepEqual(p,saved);
});

for(const head of [false,true])test(`${head?'head':'body'} repeated hits cannot restart the stretched reaction before its new deadline`,()=>{
 const {g,a,p}=combat();for(const age of [0,.08,.16,.2]){g.time=10+age;g.damage(p,1,a,{kind:'mp5navy',hitgroup:head?'head':'chest'});assert.equal(p.flinchAt,10);assert.equal(p.flinchHead,head);}
 g.time=10+.214;g.damage(p,1,a,{kind:'mp5navy',hitgroup:head?'head':'chest'});assert.equal(p.flinchAt,g.time);assert.equal(p.hp,9995);
});

test('a head hit still supersedes a body reaction in the added 53ms; body hits wait for the head reaction',()=>{
 const {g,a,p}=combat();g.damage(p,1,a,{kind:'mp5navy',hitgroup:'chest'});g.time=10.18;g.damage(p,1,a,{kind:'ak47',hitgroup:'head'});
 assert.equal(p.flinchAt,10.18);assert.equal(p.flinchHead,true);g.time=10.38;g.damage(p,1,a,{kind:'mp5navy',hitgroup:'chest'});assert.equal(p.flinchAt,10.18);assert.equal(p.flinchHead,true);
 g.time=10.395;g.damage(p,1,a,{kind:'mp5navy',hitgroup:'chest'});assert.equal(p.flinchAt,g.time);assert.equal(p.flinchHead,false);
});

for(const head of [false,true])test(`${head?'head':'body'} extended reaction uses identical displayed and historical bone hitboxes`,()=>{
 const p=target(head),history=createLagCompensation(),buffer=createSnapshotBuffer({minDelayMs:0,maxDelayMs:0,clockSlewMsPerSecond:0});
 for(const time of [10.17,10.21]){history.record({time,round:1,players:[p]});buffer.push({time,round:1,players:[{...p,...hitboxAnimation(p,time)}]},time*1000);}
 const visible=buffer.sample(p.id,10190),historical=history.pose(p.id,10.19,1);assert.equal(visible.playerSequence,head?'head_flinch':'gut_flinch');near(visible.playerAnimationTime,.19*.75);
 const a=playerHitboxes(visible,10.19),b=playerHitboxes(historical,10.19);assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)for(let j=0;j<16;j++)near(a[i].inverse[j],b[i].inverse[j]);
});

test('death overrides the stretched reaction and reload/shoot timing resumes unchanged afterward',()=>{
 const p={...target(true),reloadAt:12,reloadStartedAt:9};assert.equal(hitboxAnimation(p,10.2).playerSequence,'head_flinch');assert.equal(hitboxAnimation(p,10.214).playerSequence,'ref_reload_carbine');near(hitboxAnimation(p,10.214).playerAnimationTime,1.214);
 p.reloadAt=0;p.lastShot=10.19;assert.equal(hitboxAnimation(p,10.214).playerSequence,'ref_shoot_carbine');near(hitboxAnimation(p,10.214).playerAnimationTime,.024);
 p.alive=false;p.diedAt=10.1;assert.doesNotMatch(hitboxAnimation(p,10.2).playerSequence,/flinch/);
});
