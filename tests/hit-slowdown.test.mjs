import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {Game} from '../game.mjs';import {movePlayer,HIT_SLOWDOWN_VERSION,RULES} from '../public/shared.js';import {reconcileMovement} from '../public/prediction.js';
import {flatSlowdownPose,slowdownColumns,slowdownCases,slowdownCaseTrace} from './fixtures/hit-slowdown-cases.mjs';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/hit-slowdown-baseline.json',import.meta.url))),near=(a,b,e=1e-10)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
function match(patch={}){const g=new Game({random:()=>.5,audioRandom:()=>.5}),victim=g.add('victim','Victim','CT'),attacker=g.add('attacker','Attacker','T');g.begin();g.phase='live';g.time=10;g.endAt=1000;Object.assign(victim,flatSlowdownPose({hp:1000,...patch}));Object.assign(attacker,flatSlowdownPose({id:'attacker',x:victim.x-3}));return {g,victim,attacker};}
for(const [label,vector,eligible]of [
 ['below horizontal threshold',{vx:7.499,vy:0,vz:0},true],['at horizontal threshold',{vx:7.5,vy:0,vz:0},false],['above horizontal threshold',{vx:7.501,vy:0,vz:0},false],
 ['at diagonal threshold',{vx:4.5,vy:0,vz:6},false],['at combined vertical threshold',{vx:4.5,vy:6,vz:0},false],['below combined threshold',{vx:4.499,vy:6,vz:0},true],
])test(`large flinch uses pre-impact three-axis speed: ${label}`,()=>{
 const {g,victim:p,attacker:a}=match({...vector,velocityModifier:.43}),before={vx:p.vx,vy:p.vy,vz:p.vz};g.damage(p,10,a,{kind:'ak47',hitgroup:'chest'});
 assert.equal(p.velocityModifier,eligible?.65:.43);if(!eligible)for(const k of ['vx','vy','vz'])assert.equal(p[k],before[k]);else assert.ok(p.vx>before.vx);
 assert.equal(p.hp,990);near(p.recoilPitch,Math.PI/180);assert.equal(p.flinchAt,g.time);assert.ok(g.events.some(e=>e.type==='damage'&&e.id===p.id));
});
test('high-speed large hits preserve both an absent modifier and an existing stronger modifier',()=>{
 for(const velocityModifier of [1,.5])for(const kind of ['ak47','m4a1','awp']){const {g,victim:p,attacker:a}=match({vx:8,velocityModifier});g.damage(p,1,a,{kind,hitgroup:'chest'});assert.equal(p.velocityModifier,velocityModifier);assert.equal(p.vx,8);}
});
for(const [kind,patch]of [['mp5navy',{}],['usp',{}],['ak47',{crouch:true}],['m4a1',{hitgroup:'legs'}]])test(`${kind} small-flinch path retains its existing .5 tagging without a speed gate`,()=>{
 const {g,victim:p,attacker:a}=match({vx:8,velocityModifier:1,...patch});g.damage(p,1,a,{kind,hitgroup:patch.hitgroup||'chest'});assert.equal(p.velocityModifier,.5);assert.equal(p.vx,8);
});
test('takeoff applies one complete 60 Hz tagging step before the jump, with no extra air recovery',()=>{
 const p=flatSlowdownPose({vx:6.25,velocityModifier:.5}),control=flatSlowdownPose({vx:6.25});movePlayer(p,{jump:true,yaw:0},1/60);movePlayer(control,{jump:true,yaw:0},1/60);
 near(p.vx,6.25*.51);near(p.velocityModifier,.51);assert.equal(p.grounded,false);assert.equal(p.jumpHeld,true);assert.equal(p.vy,control.vy);assert.equal(p.y,control.y);assert.equal(p.jumpFatigue,control.jumpFatigue);
 movePlayer(p,{jump:false,yaw:0},1/60);near(p.vx,6.25*.51);near(p.velocityModifier,.51);
});
test('takeoff tagging happens before the existing bunny-hop speed cap',()=>{
 const p=flatSlowdownPose({vx:9,velocityModifier:.65});movePlayer(p,{jump:true},1/60);near(p.vx,9*.66);assert.equal(p.grounded,false);
});
test('ceiling-blocked takeoff cannot charge tagging twice through collision substeps',()=>{
 const p=flatSlowdownPose({velocityModifier:.5}),ceiling=flatSlowdownPose({id:'ceiling',y:p.y+RULES.bodyHeight+.015});
 movePlayer(p,{jump:true},1/60,[ceiling]);assert.equal(p.grounded,true);near(p.velocityModifier,.51);
});
test('already airborne targets retain existing horizontal momentum and frozen recovery',()=>{
 const p=flatSlowdownPose({y:flatSlowdownPose().y+1,vy:3,vx:6.25,grounded:false,velocityModifier:.5});movePlayer(p,{jump:true},1/60);assert.equal(p.velocityModifier,.5);assert.equal(p.vx,6.25);assert.equal(p.grounded,false);
});
test('tagged vertical jump keeps its original height, gravity, fatigue and landing tick',()=>{
 const a=flatSlowdownPose({velocityModifier:.5}),b=flatSlowdownPose();for(let i=0;i<60;i++){const input={jump:i===0};movePlayer(a,input,1/60);movePlayer(b,input,1/60);for(const k of ['y','vy','grounded','jumpFatigue','jumpHeld'])assert.equal(a[k],b[k],k+' at '+i);}
});
for(const profile of baseline.groundProfiles)test(`grounded ${profile.modifier} recovery and travel remain exactly equal to the saved baseline`,()=>{
 const p=flatSlowdownPose({velocityModifier:profile.modifier,vz:-6.25});let recovered=null;for(let tick=1;tick<=60;tick++){movePlayer(p,{f:1,yaw:0},1/60);if(recovered===null&&p.velocityModifier===1)recovered=tick;const expected=profile.rows.find(r=>r.tick===tick);if(expected)assert.deepEqual(slowdownColumns.map(k=>p[k]===0?0:p[k]??null),expected.values);}
 assert.equal(recovered,profile.recoveryTick);
});
for(const fixture of slowdownCases)test(`unchanged full movement trajectory: ${fixture.name}`,()=>{
 const expected=baseline.cases.find(c=>c.name===fixture.name),rows=slowdownCaseTrace(movePlayer,fixture);assert.equal(rows.length,expected.frames);assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),expected.sha256);
});
test('new snapshots advertise the shared rule; old-server prediction keeps legacy jump behavior',()=>{
 const {g}=match();assert.equal(g.snapshot('victim').hitSlowdownVersion,HIT_SLOWDOWN_VERSION);const modern=flatSlowdownPose({vx:6.25,velocityModifier:.5,hitSlowdownVersion:1}),legacy=flatSlowdownPose({vx:6.25,velocityModifier:.5,hitSlowdownVersion:0});
 movePlayer(modern,{jump:true},1/60);movePlayer(legacy,{jump:true},1/60);near(modern.vx,6.25*.51);assert.equal(legacy.vx,6.25);assert.equal(legacy.velocityModifier,.5);
});
test('authoritative input processing and client reconciliation agree after a tagged takeoff',()=>{
 const {g,victim:p,attacker:a}=match({vx:6.25});g.damage(p,1,a,{kind:'usp',hitgroup:'chest'});const authoritative=g.snapshot(p.id).players.find(p=>p.id==='victim');authoritative.hitSlowdownVersion=1;
 const commands=Array.from({length:10},(_,i)=>({seq:i+1,round:g.round,input:{f:1,yaw:0,pitch:0,jump:i===0}}));const predicted=reconcileMovement(authoritative,commands,g.round,[a]).player;
 g.inputBatch(p.id,commands.map(c=>({seq:c.seq,round:c.round,...c.input})));for(let i=0;i<10;i++)g.step();for(const k of slowdownColumns)assert.equal(predicted[k],p[k],k);
});
