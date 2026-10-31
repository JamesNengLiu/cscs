import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import * as THREE from 'three';
import {createLocomotionState,stepLocomotion,validLocomotion,copyLocomotion,interpolateLocomotion,locomotionOrigin} from '../public/player-locomotion.js';
import {createBonePose} from '../public/bone-pose.js';import {Game} from '../game.mjs';import {playerHitboxes,hitboxAnimation} from '../hitboxes.mjs';
import {movePlayer,supportHeight} from '../public/shared.js';import {createLagCompensation} from '../lag-compensation.mjs';import {createSnapshotBuffer} from '../public/snapshot-buffer.js';
import {locomotionTrace} from './fixtures/locomotion-scenarios.mjs';import {auditTrace} from './fixtures/locomotion-audit.mjs';
const rig=JSON.parse(readFileSync(new URL('../public/assets/players/urban/model.json',import.meta.url))),find=n=>rig.sequences.find(s=>s.name===n);
const p0=()=>({id:'p',alive:true,playedRound:1,weapon:'ak47',x:0,y:0,z:0,yaw:0,gaitYaw:0,pitch:0,vx:0,vy:0,vz:0,grounded:true,crouch:false,duckAmount:0,gaitDistance:.4,lastShot:-100,playerSequence:'ref_aim_ak47',playerGroundSequence:'ref_aim_ak47',playerFrame:0});
const pack=(patch={})=>({version:1,duck:0,move:0,walk:0,air:0,airTime:0,origin:.9,...patch});
const close=(a,b,epsilon=1e-9)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} != ${b}`);
const matrices=(pose,p)=>{pose.pose(find(p.playerSequence),p.playerFrame,p);return pose.matrices.map(m=>m.elements.slice());};
test('locomotion state is bounded, copied and never changes physics/input/gun state',()=>{
 const p={...p0(),input:{f:1},ammo:30,recoilPitch:.2},before=structuredClone(p),state=createLocomotionState(p);const result=stepLocomotion(state,{...p,vx:6},1/60);assert.deepEqual(p,before);assert.ok(validLocomotion(result.pose));assert.ok(result.pose.move>0&&result.pose.move<1);const saved={...result.pose};stepLocomotion(state,{...p,vx:6},1);assert.deepEqual(result.pose,saved);assert.ok(validLocomotion(stepLocomotion(state,{...p,vx:6},NaN).pose));
});
test('ground crouch follows physical duck progress; blocked unduck remains crouched',()=>{
 const p=p0(),state=createLocomotionState(p);for(let i=1;i<=24;i++){p.duckAmount=(i/24)**2*(3-2*i/24);const r=stepLocomotion(state,p,1/60);close(r.pose.duck,p.duckAmount);}
 p.crouch=true;p.duckAmount=0;assert.equal(stepLocomotion(state,p,1/60).pose.duck,1);
 p.crouch=false;const rise=stepLocomotion(state,p,1/60).pose;assert.ok(rise.duck>0&&rise.duck<1);for(let i=0;i<10;i++)stepLocomotion(state,p,1/60);assert.equal(state.duck,0);close(state.origin,.9);
});
test('airborne hull crouch shifts are cancelled at the model origin without changing player position',()=>{
 const p={...p0(),grounded:false,airTime:.2},state=createLocomotionState(p),center=p.y+state.origin;p.crouch=true;p.y+=.45;const r=stepLocomotion(state,p,1/60);close(p.y+r.pose.origin,center);assert.ok(r.pose.duck>0&&r.pose.duck<1);assert.equal(p.y,.45);p.crouch=false;p.y-=.45;close(p.y+stepLocomotion(state,p,1/60).pose.origin,center);
});
test('landing preserves jump phase until its blend finishes; immediate next jump does not reset the legs',()=>{
 const p={...p0(),grounded:false,airTime:.6},state=createLocomotionState(p);p.grounded=true;p.airTime=0;const land=stepLocomotion(state,p,1/60).pose;assert.ok(land.air>0&&land.air<1);assert.equal(land.airTime,.6);
 p.grounded=false;p.airTime=1/60;const jump=stepLocomotion(state,p,1/60).pose;assert.ok(jump.airTime>.4);assert.ok(jump.air>land.air);
 p.grounded=true;for(let i=0;i<10;i++)stepLocomotion(state,p,1/60);assert.equal(state.air,0);assert.equal(state.airTime,0);
});
test('teleport reinitializes presentation and spawn removes the previous life state',()=>{
 const p=p0(),state=createLocomotionState(p);const r=stepLocomotion(state,{...p,x:100,crouch:true},1/60);assert.equal(r.pose.duck,1);assert.equal(r.pose.origin,.45);
 const g=new Game(),q=g.add('p','P','T');g.begin();g.step();assert.ok(q.playerLocomotion);g.begin();assert.equal(q.playerLocomotion,undefined);
});
for(const [name,patch]of [['idle',{}],['running',{move:1}],['crouched',{duck:1,origin:.45}],['crouch running',{duck:1,move:1,origin:.45}],['airborne',{air:1,airTime:.3}]])test(`stable ${name} ends at the imported original pose`,()=>{
 const p=p0();if(patch.duck===1){p.crouch=true;p.playerSequence='crouch_aim_ak47';}if(patch.move===1)p.playerGaitSequence=p.crouch?'crouchrun':'run';if(patch.air===1){p.grounded=false;p.playerSequence='jump';p.playerFrame=9;p.playerGaitSequence='jump';p.playerGaitFrame=9;}
 const legacy=matrices(createBonePose(THREE,rig),p),current=matrices(createBonePose(THREE,rig),{...p,playerLocomotion:pack(patch)});for(let i=0;i<legacy.length;i++)for(let j=0;j<16;j++)close(current[i][j],legacy[i][j],1e-8);
});
test('firing/reloading/flinching retain their upper action and identical moving legs',()=>{
 const p={...p0(),playerLocomotion:pack({move:.6,duck:.4,origin:.72})},a=createBonePose(THREE,rig),foot=rig.bones.findIndex(b=>b.name==='Bip01 L Foot'),hand=rig.bones.findIndex(b=>b.name==='Bip01 R Hand');const idle=matrices(a,p);
 for(const name of ['ref_shoot_ak47','ref_reload_ak47','gut_flinch']){const action=matrices(a,{...p,playerSequence:name,playerFrame:2});assert.deepEqual(action[foot],idle[foot]);assert.notDeepEqual(action[hand],idle[hand]);}
});
test('layered bones keep rigid transforms and work with every local character rig',()=>{
 for(const name of 'terror leet arctic guerilla urban gsg9 sas gign terror_trump leet_trump arctic_trump guerilla_trump'.split(' ')){
  const data=JSON.parse(readFileSync(new URL('../public/assets/players/'+name+'/model.json',import.meta.url))),a=createBonePose(THREE,data);a.pose(data.sequences.find(s=>s.name==='ref_aim_ak47'),0,{...p0(),playerLocomotion:pack({move:.6,duck:.4,walk:.3,air:.2,airTime:.3,origin:.72})});assert.equal(a.blendInfo(),'shared locomotion layers');for(const m of a.matrices){assert.ok(m.elements.every(Number.isFinite));close(m.determinant(),1,1e-8);}
 }
});
test('unsupported/malformed metadata keeps the legacy pose and origin',()=>{
 const p=p0(),a=createBonePose(THREE,rig),expected=matrices(a,p);for(const bad of [{},{...pack(),version:2},{...pack(),air:NaN},{...pack(),duck:2}]){assert.deepEqual(matrices(a,{...p,playerLocomotion:bad}),expected);assert.equal(locomotionOrigin({...p,playerLocomotion:bad}),.9);}
});
test('history and rendered snapshot interpolate the same stance/gait/landing state and bone hitboxes',()=>{
 const h=createLagCompensation(),b=createSnapshotBuffer({minDelayMs:0,maxDelayMs:0,clockSlewMsPerSecond:0}),base={...p0(),x:0,z:0};
 for(const [time,patch]of [[1,{duck:.2,move:.6,air:.7,airTime:.4,origin:.81}],[1.1,{duck:.7,move:.2,air:.2,airTime:.4,origin:.585}]]){const p={...base,playerLocomotion:pack(patch)};h.record({time,round:1,players:[p]});b.push({time,round:1,players:[{...p,...hitboxAnimation(p,time)}]},time*1000);p.playerLocomotion.duck=0;}
 const visible=b.sample('p',1050),historic=h.pose('p',1.05,1);assert.deepEqual(visible.playerLocomotion,historic.playerLocomotion);assert.ok(historic.playerLocomotion.duck>.4);const a=playerHitboxes(visible,1.05),c=playerHitboxes(historic,1.05);for(let i=0;i<a.length;i++)for(let j=0;j<16;j++)close(a[i].inverse[j],c[i].inverse[j],1e-8);
 const p={...base,playerLocomotion:pack()},first=playerHitboxes(p,1);p.playerLocomotion.duck=.5;assert.notDeepEqual(playerHitboxes(p,1),first);assert.equal(interpolateLocomotion(undefined,pack(),.5),undefined);
});
test('actual game motion remains equal to the unchanged standalone movement solver',()=>{
 const g=new Game({random:()=>.5}),p=g.add('p','P','T');g.begin();g.phase='live';g.endAt=1000;Object.assign(p,{x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),vx:0,vy:0,vz:0});let expected={...p};
 for(let i=0;i<120;i++){const input={f:i<50?1:0,crouch:i>=15&&i<65,jump:i%20===0,yaw:0,pitch:0};g.input(p.id,input);movePlayer(expected,input,1/60,[expected]);g.step();for(const k of ['x','y','z','vx','vy','vz','crouch','duckAmount','grounded','gaitDistance','gaitYaw','jumpFatigue'])assert.equal(p[k],expected[k],k+' at '+i);}
});
for(const [name,kind,limit]of [['start-stop','start',.13],['start-stop','stop',.10],['crouch-rise','crouch',.04],['crouch-rise','rise',.1],['jump-land','land',.25],['repeat-jump','land',.25]])test(`${name} ${kind} has no large one-frame foot snap`,()=>{
 const events=auditTrace(locomotionTrace(name)).events.filter(e=>e.kind===kind);assert.ok(events.length);for(const e of events)for(const bone of ['Bip01 L Foot','Bip01 R Foot'])assert.ok(e.delta[bone]<limit,`${name} ${bone}: ${e.delta[bone]}`);
});

test('snapshot sampling at 30/60/144 FPS preserves the same phase at the same playback time',()=>{
 const values=[];for(const fps of [30,60,144]){
  const b=createSnapshotBuffer({minDelayMs:0,maxDelayMs:0,clockSlewMsPerSecond:0}),p=p0();
  for(const [time,duck,air]of [[1,.1,.9],[1.2,.9,.1]])b.push({time,round:1,players:[{...p,playerLocomotion:pack({duck,air,airTime:.4,origin:.9-.45*duck}),...hitboxAnimation(p,time)}]},time*1000);
  let previous=0,result;for(let frame=0;frame<=fps/6;frame++){result=b.sample('p',1000+frame*1000/fps);assert.ok(result.playerLocomotion.duck>=previous);previous=result.playerLocomotion.duck;assert.ok(validLocomotion(result.playerLocomotion));}
  values.push(result.playerLocomotion);
 }
 for(const k of ['duck','air','origin'])for(const value of values)close(value[k],values[0][k],1e-9);
});
test('published snapshots detach locomotion metadata; landing is fully planted within 100 ms',()=>{
 const g=new Game(),p=g.add('p','P','T');g.begin();g.step();const snap=g.snapshot(p.id).players[0];snap.playerLocomotion.duck=.7;assert.notEqual(p.playerLocomotion.duck,.7);
 const q={...p0(),grounded:false,airTime:.4},state=createLocomotionState(q);q.grounded=true;for(let i=0;i<6;i++)stepLocomotion(state,q,1/60);assert.equal(state.air,0);
});

test('locomotion publication keeps only bounded scalar fields and detaches its source',()=>{
 const source={...pack(),unrelated:new Array(1000).fill('ignored')},copy=copyLocomotion(source);assert.deepEqual(Object.keys(copy),['version','duck','move','walk','air','airTime','origin']);source.duck=.9;assert.equal(copy.duck,0);assert.equal(copyLocomotion({version:1}),undefined);
});

for(const [weapon,action]of [['ak47','reload'],['ak47','shoot'],['knife','idle'],['m249','idle']])test(`actual rendered ${weapon} ${action} bones match rewind across a stance-clip boundary`,()=>{
 const h=createLagCompensation(),b=createSnapshotBuffer({minDelayMs:0,maxDelayMs:0,clockSlewMsPerSecond:0});
 for(const [time,crouch,duck]of [[1,false,.95],[1+1/30,true,1]]){const p={...p0(),weapon,crouch,reloadAt:action==='reload'?4:0,reloadStartedAt:0,lastShot:action==='shoot'?.98:-100,playerLocomotion:pack({duck,origin:.9-.45*duck})};h.record({time,round:1,players:[p]});b.push({time,round:1,players:[{...p,...hitboxAnimation(p,time)}]},time*1000);}
 const time=1+1/60,p=b.sample('p',time*1000),historic=h.pose('p',time,1),pose=createBonePose(THREE,rig);pose.pose(find(p.playerSequence),p.playerFrame,p);
 const root=new THREE.Matrix4().set(0,-1/40,0,0,0,0,1/40,locomotionOrigin(p),-1/40,0,0,0,0,0,0,1),expected=playerHitboxes(historic,time);
 for(let i=0;i<rig.hitboxes.length;i++){const inverse=new THREE.Matrix4().multiplyMatrices(root,pose.matrices[rig.hitboxes[i].bone]).invert().elements;for(let j=0;j<16;j++)close(inverse[j],expected[i].inverse[j],1e-8);}
});

test('ten-player pose metadata remains within real datagram limits and survives reordered fragments',async()=>{
 const {encodeDatagrams,createReassembler,MAX_MESSAGE_BYTES}=await import('../public/net-wire.js'),g=new Game({random:()=>.5});for(let i=0;i<10;i++)g.add('p'+i,'P'+i,i<5?'T':'CT');g.begin();g.phase='live';g.endAt=1000;g.step();const snapshot=g.snapshot('p0'),packets=encodeDatagrams(snapshot,{sequence:1,maxSize:1000});assert.ok(Buffer.byteLength(JSON.stringify(snapshot))<MAX_MESSAGE_BYTES);assert.ok(packets.every(p=>p.byteLength<=1000));const assembler=createReassembler();let decoded;for(const packet of packets.toReversed())decoded=assembler.push(packet)||decoded;assert.ok(decoded);for(let i=0;i<10;i++){assert.ok(validLocomotion(decoded.players[i].playerLocomotion));assert.deepEqual(decoded.players[i].playerLocomotion,snapshot.players[i].playerLocomotion);}
});
