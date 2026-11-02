import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from '../game.mjs';
import {movePlayer,RULES} from '../public/shared.js';
import {hitRecoveryProfile,recoveryRate} from '../public/hit-recovery.js';
import {reconcileMovement} from '../public/prediction.js';
import {createPlayerCamera} from '../public/player-camera.js';
import {cameraCases,cameraTrace} from './fixtures/camera-ab-cases.mjs';
import {flatSlowdownPose,slowdownColumns} from './fixtures/hit-slowdown-cases.mjs';
import {RECOVERY_WEAPONS,recoveryTrace,referenceRecovery100} from './fixtures/hit-recovery-cases.mjs';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/hit-recovery-baseline.json',import.meta.url)));
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
for(const row of baseline.rows)test(`A preserves old movement exactly: ${row.weapon} ${row.modifier} ${row.mode}`,()=>{
 assert.equal(recoveryTrace(row).hash,row.hash);
});
test('profiles are room configuration with safe legacy fallback and fixed rates',()=>{
 assert.equal(hitRecoveryProfile().name,'baseline');assert.equal(hitRecoveryProfile('reference100').perSecond,1);assert.equal(recoveryRate({}),.6);assert.equal(recoveryRate({hitRecoveryVersion:1}),1);assert.equal(recoveryRate({hitRecoveryVersion:99}),.6);assert.ok(Object.isFrozen(hitRecoveryProfile()));for(const name of ['invalid','toString',null])assert.throws(()=>new Game({hitRecovery:name}),/HIT_RECOVERY_PROFILE/);
});
for(const [profile,modifier,seconds]of [['baseline',.5,50/60],['baseline',.65,35/60],['reference100',.5,.5],['reference100',.65,.35]])test(`${profile} modifier ${modifier} restores at the declared grounded time`,()=>{
 const trace=recoveryTrace({profile,modifier});near(trace.summary.modifierRestoredAt,seconds);
 for(const row of trace.rows)near(row.modifier,Math.min(1,modifier+row.time*hitRecoveryProfile(profile).perSecond));
});
for(const hz of [30,60,100,120,144,240])test(`B recovery clock is time-based at ${hz} update Hz`,()=>{
 const p=flatSlowdownPose({velocityModifier:.5,hitRecoveryVersion:1});let restored=null;for(let n=1;n<=hz;n++){movePlayer(p,{},1/hz);if(restored===null&&p.velocityModifier===1)restored=n/hz;}assert.ok(Math.abs(restored-.5)<=1/hz+1e-9);assert.equal(p.velocityModifier,1);
});
for(const weapon of RECOVERY_WEAPONS)test(`B preserves unhit physics and retains the weapon max speed: ${weapon}`,()=>{
 for(const mode of ['run','stop','strafe','crouch','jump'])assert.equal(recoveryTrace({weapon,modifier:1,mode,profile:'reference100'}).hash,recoveryTrace({weapon,modifier:1,mode}).hash);
 const a=recoveryTrace({weapon}),b=recoveryTrace({weapon,profile:'reference100'});assert.equal(a.summary.maxSpeedSource,b.summary.maxSpeedSource);assert.ok(b.summary.recovered95<a.summary.recovered95);near(b.rows.at(-1).speed,b.summary.maxSpeedSource/40);
});
test('the reference modifier clock agrees at aligned 100 Hz sample times; damping is intentionally separate',()=>{
 for(const modifier of [.5,.65]){const b=recoveryTrace({modifier,profile:'reference100'}),r=referenceRecovery100(modifier);near(b.summary.modifierRestoredAt,r.summary.modifierRestoredAt);for(const row of b.rows.filter(x=>[.1,.2,.3,.4,.5,.6,1].some(t=>Math.abs(x.time-t)<1e-9)))near(row.modifier,r.rows.find(q=>Math.abs(q.time-row.time)<1e-9).modifier);assert.ok(b.summary.minimumSpeedSource>r.summary.minimumSpeedSource,'rate-only candidate must not silently switch to 100Hz damping');}
});
test('takeoff still applies exactly one full command before the cap, with no airborne recovery',()=>{
 for(const [version,rate]of [[0,.6],[1,1]]){
  const p=flatSlowdownPose({vx:6.25,velocityModifier:.5,hitRecoveryVersion:version});movePlayer(p,{jump:true},1/60);near(p.velocityModifier,.5+rate/60);near(p.vx,6.25*(.5+rate/60));const saved={vx:p.vx,mod:p.velocityModifier};movePlayer(p,{},1/60);near(p.velocityModifier,saved.mod);near(p.vx,saved.vx);
  const capped=flatSlowdownPose({vx:20,velocityModifier:.65,hitRecoveryVersion:version});movePlayer(capped,{jump:true},1/60);near(capped.vx,6);
 }
});
test('blocked takeoff does not double-charge recovery through contact substeps',()=>{
 const p=flatSlowdownPose({velocityModifier:.5,hitRecoveryVersion:1}),ceiling=flatSlowdownPose({id:'ceiling',y:p.y+RULES.bodyHeight+.015});movePlayer(p,{jump:true},1/60,[ceiling]);assert.equal(p.grounded,true);near(p.velocityModifier,.5+1/60);
});
test('airborne hit modifier stays frozen in B and vertical jump/fatigue tracks remain identical to A',()=>{
 const air=flatSlowdownPose({y:flatSlowdownPose().y+2,vy:3,vx:6.25,grounded:false,velocityModifier:.5,hitRecoveryVersion:1});for(let i=0;i<15;i++)movePlayer(air,{},1/60);assert.equal(air.velocityModifier,.5);assert.equal(air.vx,6.25);
 const a=flatSlowdownPose({velocityModifier:.5,hitRecoveryVersion:0}),b={...a,hitRecoveryVersion:1};for(let n=0;n<90;n++){movePlayer(a,{jump:n===0},1/60);movePlayer(b,{jump:n===0},1/60);for(const k of ['y','vy','grounded','crouch','jumpFatigue','jumpHeld','landedSpeed'])assert.equal(a[k],b[k],k+' at '+n);}
});
test('small/large hit values, speed gates, damage, knockback and hit recoil are identical across profiles',()=>{
 function hit(profile,{kind='ak47',vx=6,vy=0,crouch=false,hitgroup='chest'}={}){const g=new Game({random:()=>.5,audioRandom:()=>.5,hitRecovery:profile}),p=g.add('p','Target','CT'),a=g.add('a','Attacker','T');g.begin();g.time=10;Object.assign(p,flatSlowdownPose({id:'p',hp:1000,vx,vy,crouch}));Object.assign(a,flatSlowdownPose({id:'a',x:p.x-3}));g.damage(p,10,a,{kind,hitgroup});return {vx:p.vx,vy:p.vy,vz:p.vz,modifier:p.velocityModifier,hp:p.hp,armour:p.armour,recoil:p.recoilPitch,flinch:p.flinchAt};}
 for(const options of [{},{vx:7.5},{vx:7.6},{vx:4.5,vy:6},{kind:'mp5navy'},{kind:'awp'},{kind:'m4a1',hitgroup:'legs'},{crouch:true}])assert.deepEqual(hit('baseline',options),hit('reference100',options));
});
test('room capability, spawn and client reconciliation agree; input cannot select another profile',()=>{
 for(const profile of ['baseline','reference100']){
  const g=new Game({hitRecovery:profile}),p=g.add('p','Local','T');g.begin();g.phase='live';g.endAt=1000;Object.assign(p,flatSlowdownPose({id:'p',vx:6.25,velocityModifier:.5}));const s=g.snapshot(p.id);assert.equal(s.hitRecoveryVersion,hitRecoveryProfile(profile).version);assert.equal(s.players[0].hitRecoveryVersion,s.hitRecoveryVersion);
  const commands=Array.from({length:30},(_,n)=>({seq:n+1,round:g.round,input:{f:1,yaw:0,pitch:0,jump:n===0,hitRecoveryVersion:99}}));const predicted=reconcileMovement(s.players[0],commands,g.round).player;g.inputBatch(p.id,commands.map(c=>({seq:c.seq,round:c.round,...c.input})));for(let n=0;n<30;n++)g.step();for(const k of slowdownColumns){if(typeof p[k]==='number')near(p[k],predicted[k]);else assert.equal(p[k],predicted[k],k);}assert.equal(p.hitRecoveryVersion,s.hitRecoveryVersion);g.spawn(p);assert.equal(p.hitRecoveryVersion,s.hitRecoveryVersion);assert.equal(p.velocityModifier,1);
 }
});
test('B A/B-camera previews never mutate recovery, ammunition or authoritative movement',()=>{
 const p=flatSlowdownPose({velocityModifier:.5,vz:-6.25,hitRecoveryVersion:1,ammo:30}),saved=structuredClone(p);for(const mode of ['baseline','responsive']){const c=createPlayerCamera({mode});c.reset(p);c.push(p,{f:1,yaw:0});for(let i=0;i<50;i++)c.update(p,{fractionSeconds:1/144,dt:1/144});assert.deepEqual(p,saved);}
});

for(const hz of [60,120,144,240])test(`B keeps all unhit crate/ramp/wheel trajectories exact with both cameras at ${hz}Hz`,()=>{
 const saved=JSON.parse(readFileSync(new URL('./fixtures/camera-ab-baseline.json',import.meta.url)));
 for(const spec of cameraCases){const b={...spec,start:{...spec.start,hitRecoveryVersion:1}},old=saved.rows.find(r=>r.name===spec.name&&r.hz===hz);const aTrace=cameraTrace(b,hz,'baseline'),bTrace=cameraTrace(b,hz,'responsive'),control=cameraTrace(spec,hz,'responsive');assert.equal(aTrace.physicsHash,old.physicsHash);assert.equal(aTrace.renderHash,old.renderHash);assert.equal(bTrace.physicsHash,old.physicsHash);assert.equal(bTrace.renderHash,control.renderHash);assert.equal(bTrace.solids,0);}
});
