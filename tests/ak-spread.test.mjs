import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {sourcePlayerSpread} from '../public/source-spread.js';
import {spreadDirection,resetWeapon,updateWeapon} from '../public/weapons.js';
import {consumeGunShot} from '../public/gun-state.js';import {GUNS} from '../public/arsenal.js';import {supportHeight} from '../public/shared.js';
const near=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
// Independent C++ output from fixed ReGameDLL util.cpp, stored as a digest of
// 256 pairs of little-endian float32 values. No reference source is vendored.
test('all 256 shared spread seeds match the independently compiled source reference',()=>{
 const bytes=Buffer.alloc(256*8);for(let seed=0;seed<256;seed++){const {x,y}=sourcePlayerSpread(seed);bytes.writeFloatLE(x,seed*8);bytes.writeFloatLE(y,seed*8+4);}
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'13bc010fe6e1b417c648642118abad9a4fe1458287bfbd73a4571310474b5a3f');
});
test('player spread preserves adjacent-seed correlation and the reference outer tails',()=>{
 const pairs=Array.from({length:256},(_,seed)=>sourcePlayerSpread(seed)),mean=pairs.reduce((s,p)=>s+p.x,0)/256;
 near(mean,.03884577751159668);near(Math.sqrt(pairs.reduce((s,p)=>s+(p.x-mean)**2,0)/256),.4427140362068957);
 near(Math.sqrt(pairs.reduce((s,p)=>s+p.x*p.x+p.y*p.y,0)/256),.6284977522395463);assert.equal(pairs.filter(p=>p.x*p.x+p.y*p.y>1).length,12);
 assert.deepEqual(sourcePlayerSpread(0xffffffff),sourcePlayerSpread(255));assert.deepEqual(sourcePlayerSpread(0x100000000),sourcePlayerSpread(0));
});
for(const yaw of [0,.7,Math.PI/2,Math.PI])for(const pitch of [-.6,0,.6])test(`AK world spread is in the orthonormal camera plane: yaw ${yaw}, pitch ${pitch}`,()=>{
 const seed=42,offset=sourcePlayerSpread(seed),spread=.034375,values=[seed/0x100000000,.1,.9,.7];let at=0;
 const actual=spreadDirection({yaw,pitch,spread},()=>values[at++],'player'),expected=new THREE.Vector3(offset.x*spread,offset.y*spread,-1).applyEuler(new THREE.Euler(pitch,yaw,0,'YXZ')).normalize();
 near(actual.x,expected.x);near(actual.y,expected.y);near(actual.z,expected.z);assert.equal(at,4);
});
test('the legacy fallback sampler and draw count remain unchanged',()=>{
 const values=[.2,.6,.8,.1],yaw=.4,pitch=-.3,spread=.05;let at=0;
 const actual=spreadDirection({yaw,pitch,spread},()=>values[at++]),expected=new THREE.Vector3((.2+.6-1)*spread,(.8+.1-1)*spread,-1).applyEuler(new THREE.Euler(pitch,yaw,0,'YXZ')).normalize();
 near(actual.x,expected.x);near(actual.y,expected.y);near(actual.z,expected.z);assert.equal(at,4);
});
test('AK firing uses the reference sample without changing accuracy or recoil state',()=>{
 const p={weapon:'ak47',alive:true,ammo:30,reserve:0,x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),grounded:true,vx:0,vy:0,vz:0,yaw:0,pitch:0,lastShot:-100,nextAttackAt:0,recoilSeed:123,input:{fire:true}};resetWeapon(p);
 const original=structuredClone(p);let calls=0;const shot=consumeGunShot(p,10,false,()=>{calls++;return .5;});assert.ok(shot);assert.equal(calls,4);near(shot.spread,.0055);near(p.accuracy,.355);near(p.recoilPitch,Math.PI/180);assert.equal(p.ammo,29);assert.equal(p.shotsFired,1);assert.equal(p.yaw,original.yaw);assert.equal(p.pitch,original.pitch);
 const offset=sourcePlayerSpread(0);near(shot.direction.x/-shot.direction.z,offset.x*shot.spread);near(shot.direction.y/-shot.direction.z,offset.y*shot.spread);
});
test('an entire AK magazine retains the existing floating accuracy curve and firing interval',()=>{
 const p={weapon:'ak47',alive:true,ammo:30,reserve:0,x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),grounded:true,vx:0,vy:0,vz:0,yaw:0,pitch:0,lastShot:-100,nextAttackAt:0,recoilSeed:123,input:{fire:true}},rows=[];resetWeapon(p);
 for(let tick=0;tick<240&&p.ammo>0;tick++){const now=10+tick/60;updateWeapon(p,1/60,now);const shot=consumeGunShot(p,now,false,()=>.5);if(shot){rows.push({time:now,spread:shot.spread});near(shot.spread,.0275*(rows.length===1?.2:Math.min((rows.length-1)**3/200+.35,1.25)));}p.fireHeld=true;}
 assert.equal(rows.length,30);near(rows.at(-1).spread,.034375);assert.ok(Math.abs(rows.at(-1).time-rows[0].time-29*GUNS.ak47.interval)<1/60+1e-7);
});
