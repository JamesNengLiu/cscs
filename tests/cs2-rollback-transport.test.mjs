import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixtureWorld,testHitboxes} from './cs2-game-fixture.mjs';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {CS2_WEAPON_PROFILE} from '../public/cs2-weapon-profile.js';
import {createCS2Game} from '../cs2-game.mjs';
import {GameConnection} from '../public/cs2-game-connection.js';
import {applyScopeAwareAction} from '../cs2-scope-actions.mjs';
import {INPUT_DT,MAX_INPUT_QUEUE,MAX_INPUT_BATCH,MAX_INPUT_AGE_TICKS,INPUT_REORDER_TICKS,buildInputBatch} from '../public/cs2-input-protocol.js';
import {createReassembler} from '../public/cs2-net-wire.js';
import {createPresentationClock} from '../public/cs2-presentation-clock.js';
import {createTerrainCameraResponse,CS2_TERRAIN_CAMERA} from '../public/cs2-terrain-camera.js';

function fixture(){
 const original=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),calls=new Map();
 const world={...original,movement:{...original.movement,movePlayer(p,...args){calls.set(p.id,(calls.get(p.id)||0)+1);return original.movement.movePlayer(p,...args);}}};
 const g=createCS2Game(world,{weaponProfile:CS2_WEAPON_PROFILE,hitboxes:testHitboxes,random:()=>.5,audioRandom:()=>.5}),p=g.add('main','Main','T'),q=g.add('target','Target','CT');
 g.begin();g.phase='live';g.time=10;g.endAt=g.buyEndAt=1000;q.hp=10000;p.money=16000;return{g,p,q,calls};
}
const command=(f,seq,patch={})=>({seq,round:f.g.round,f:0,s:0,yaw:0,pitch:0,fire:false,jump:false,crouch:false,walk:false,use:false,...patch});
const shots=f=>f.g.events.filter(e=>e.type==='shot'&&e.id===f.p.id);
function step(f){const before=f.calls.get(f.p.id)||0,tick=f.p.movementTick,at=f.g.time,applied=f.p.appliedInputCommands;f.g.step();assert.equal((f.calls.get(f.p.id)||0)-before,1,'Exactly one primary physics call per authority tick');assert.equal(f.p.movementTick,tick+1);assert.ok(Math.abs(f.g.time-at-INPUT_DT)<1e-12);assert.ok(f.p.appliedInputCommands-applied<=1);assert.equal(f.p.ackInputSeq,f.p.appliedInputCommands+f.p.skippedInputCommands);}
function awp(f){f.g.buy(f.p.id,'awp');f.g.equip(f.p.id,'knife');f.g.equip(f.p.id,'awp');f.p.nextAttackAt=f.p.nextShotAt=0;f.p.yaw=f.p.pitch=0;f.p.zoom=40;}

// Real GameConnection reliable envelopes, with its original ordered queue.
// This does not instantiate a connection, listen, or emulate a WebTransport API.
function reliableWire(blockFirst=false){
 const writes=[];let release;const gate=new Promise(resolve=>release=resolve);
 const wire=Object.assign(Object.create(GameConnection.prototype),{readyState:1,closed:false,transport:'webtransport',actionSequence:0,controlQueue:Promise.resolve(),bufferedAmount:0,control:{async write(bytes){writes.push(JSON.parse(new TextDecoder().decode(bytes)));if(blockFirst&&writes.length===1)await gate;}}});
 return{wire,writes,release};
}
function deliver(f,m,acks=[]){
 if(m.type==='inputCritical'||m.type==='inputBatch')return f.g.inputBatch(f.p.id,m.commands);
 if(m.type==='input')return f.g.input(f.p.id,m.input);
 return applyScopeAwareAction(f.g,f.p.id,m,{onAck:a=>acks.push(a)});
}

for(const recoveryBeforeSwitch of [false,true])test(`CS2 reliable recovery duplicates retain scoped AWP fire and Q/Q (${recoveryBeforeSwitch?'recovery before Q':'recovery after Q'})`,async()=>{
 const ordinary=fixture(),f=fixture();awp(ordinary);awp(f);const fire=command(f,1,{fire:true}),baseline=command(ordinary,1,{fire:true});ordinary.g.inputBatch(ordinary.p.id,[baseline]);step(ordinary);
 const {wire,writes,release}=reliableWire(true),acks=[];
 wire.send({type:'inputCritical',round:f.g.round,commands:[fire]});
 const recovery=()=>wire.send({type:'inputCritical',round:f.g.round,commands:[fire]});
 if(recoveryBeforeSwitch)recovery();
 for(let seq=1;seq<=2;seq++)wire.send({type:'equip',weapon:'last',round:f.g.round,switchSeq:seq,scopeSeq:seq,afterInputSeq:1,commands:[fire]});
 if(!recoveryBeforeSwitch)recovery();
 await Promise.resolve();assert.equal(writes.length,1,'Recovery/equip cannot overtake a blocked critical write');release();await wire.controlQueue;
 assert.deepEqual(writes.map(m=>m.actionSeq),[1,2,3,4],'Every reliable packet uses a new globally ordered envelope');
 assert.deepEqual(writes.filter(m=>m.type==='equip').map(m=>m.switchSeq),[1,2]);
 for(const m of writes)deliver(f,m,acks);assert.equal(f.p.ackInputSeq,0,'Network receipt never acknowledges or simulates movement');assert.equal(f.p.movementTick,0);step(f);
 const segments=shots(f).length;assert.equal(segments,shots(ordinary).length,'Penetration segments must match the unmodified shot');assert.equal(new Set(shots(f).map(e=>e.shotId)).size,1);assert.equal(f.p.ammo,4);assert.equal(f.p.inventory.awp.ammo,4);assert.equal(f.q.hp,ordinary.q.hp);assert.equal(f.p.weapon,'awp');assert.equal(f.p.previousWeapon,'knife');assert.equal(f.p.zoom,90);assert.equal(f.p.resumeZoomAt,0);assert.equal(acks.length,2);
 for(const key of ['recoilPitch','recoilYaw','cs2RecoilPitchVelocity','cs2RecoilYawVelocity','cs2PunchVersion'])assert.equal(f.p[key],ordinary.p[key],key+' must preserve the original firing state');
 assert.equal(f.g.inputBatch(f.p.id,[fire,fire]),0);step(f);assert.equal(shots(f).length,segments);assert.equal(f.p.ammo,4);
});

test('CS2 delayed reliable/UDP copies cannot rewrite an applied jump edge or manufacture another jump',async()=>{
 const f=fixture();f.g.equip(f.p.id,'knife');const jump=command(f,1,{jump:true}),opposite=command(f,1,{jump:false,f:-1});
 f.g.inputBatch(f.p.id,[jump]);step(f);assert.equal(f.p.jumpHeld,true);assert.equal(f.p.grounded,false);const firstEdge=f.p.movementEdgeTick;
 const {wire,writes}=reliableWire();wire.send({type:'inputCritical',round:f.g.round,commands:[opposite,jump]});await wire.controlQueue;for(const m of writes)assert.equal(deliver(f,m),0);
 step(f);assert.equal(f.p.jumpHeld,true);assert.equal(f.p.movementEdgeTick,firstEdge);assert.equal(f.p.appliedInputCommands,1);
 // Stay within the fixture floor and wait until the original jump has landed.
 for(let i=0;i<100;i++)step(f);assert.equal(f.p.grounded,true);
 f.g.inputBatch(f.p.id,[command(f,2,{jump:true})]);step(f);assert.equal(f.p.vy,0,'Loss/redundancy is not a fresh jump press');
 f.g.inputBatch(f.p.id,[command(f,3),command(f,4,{jump:true})]);step(f);step(f);assert.ok(f.p.vy>0);assert.ok(f.p.movementEdgeTick>firstEdge);
});

test('CS2 menu cancellation retires queued recovery edges before ACK and rejects their later copies',async()=>{
 const f=fixture();awp(f);const fireJump=command(f,1,{fire:true,jump:true,f:1}),move=command(f,2,{f:1});f.g.inputBatch(f.p.id,[fireJump,move]);
 f.g.input(f.p.id,{round:f.g.round,cancelThroughSeq:3,f:0,s:0,yaw:0,pitch:0});assert.equal(f.p.ackInputSeq,0);
 const {wire,writes}=reliableWire();wire.send({type:'inputCritical',round:f.g.round,commands:[fireJump,move,command(f,3,{fire:true,jump:true})]});await wire.controlQueue;for(const m of writes)assert.equal(deliver(f,m),0);
 step(f);assert.equal(f.p.ackInputSeq,3);assert.equal(f.p.skippedInputCommands,3);assert.equal(f.p.appliedInputCommands,0);assert.equal(f.p.jumpHeld,false);assert.equal(f.p.fireHeld,false);assert.equal(f.p.ammo,5);assert.equal(shots(f).length,0);
 f.g.inputBatch(f.p.id,[command(f,4)]);step(f);assert.equal(f.p.ackInputSeq,4);assert.equal(f.p.appliedInputCommands,1);
});

test('CS2 queued old-round reliable recovery cannot move or fire after a fresh round',async()=>{
 const f=fixture();awp(f);const old=command(f,1,{fire:true,jump:true,f:1}),{wire,writes,release}=reliableWire(true);wire.send({type:'inputCritical',round:f.g.round,commands:[old]});await Promise.resolve();f.g.begin();f.g.phase='live';f.g.endAt=1000;release();await wire.controlQueue;
 for(const m of writes)assert.equal(deliver(f,m),0);step(f);assert.equal(f.p.ackInputSeq,0);assert.equal(f.p.appliedInputCommands,0);assert.equal(f.p.skippedInputCommands,0);assert.equal(f.p.jumpHeld,false);assert.equal(f.p.fireHeld,false);assert.equal(shots(f).length,0);
});

test('CS2 recovery receipt preserves 32/batch, 128/window and stale-prefix budgets without catch-up physics',async()=>{
 const f=fixture();f.g.equip(f.p.id,'knife');const {wire,writes}=reliableWire(),commands=Array.from({length:MAX_INPUT_QUEUE},(_,i)=>command(f,i+1,{f:1,yaw:Math.PI/2}));
 for(let i=0;i<commands.length;i+=MAX_INPUT_BATCH)wire.send({type:'inputCritical',round:f.g.round,commands:commands.slice(i,i+MAX_INPUT_BATCH)});await wire.controlQueue;
 for(const m of writes)assert.equal(deliver(f,m),MAX_INPUT_BATCH);assert.equal(f.p.ackInputSeq,0);assert.equal(f.p.movementTick,0);assert.equal(f.g.inputBatch(f.p.id,[command(f,MAX_INPUT_QUEUE+1)]),0);
 for(let i=0;i<=MAX_INPUT_AGE_TICKS;i++)step(f);
 assert.equal(f.p.ackInputSeq,MAX_INPUT_QUEUE);assert.equal(f.p.appliedInputCommands,MAX_INPUT_AGE_TICKS);assert.equal(f.p.skippedInputCommands,MAX_INPUT_QUEUE-MAX_INPUT_AGE_TICKS);assert.equal(f.p.movementTick,MAX_INPUT_AGE_TICKS+1);
 for(const m of writes)assert.equal(deliver(f,m),0);step(f);assert.equal(f.p.appliedInputCommands,MAX_INPUT_AGE_TICKS);
 // A genuine next sequence after the retired window remains eligible.
 f.g.inputBatch(f.p.id,[command(f,MAX_INPUT_QUEUE+1)]);step(f);assert.equal(f.p.ackInputSeq,MAX_INPUT_QUEUE+1);
});

test('CS2 missing-prefix recovery keeps the original bounded reorder wait and first-copy semantics',()=>{
 const f=fixture(),late=command(f,3,{f:1});f.g.inputBatch(f.p.id,[late]);
 for(let i=0;i<INPUT_REORDER_TICKS;i++){step(f);assert.equal(f.p.ackInputSeq,0);}
 step(f);assert.equal(f.p.ackInputSeq,3);assert.equal(f.p.skippedInputCommands,2);assert.equal(f.p.appliedInputCommands,1);
 assert.equal(f.g.inputBatch(f.p.id,[command(f,1,{jump:true}),command(f,2,{fire:true}),command(f,3,{f:-1})]),0);step(f);assert.equal(f.p.ackInputSeq,3);assert.equal(f.p.jumpHeld,false);assert.equal(f.p.input.fire,false);
});

test('CS2 real pending datagram writer recovers alongside 60Hz authority without swallowing fire/Q/Q',async()=>{
 const f=fixture(),ordinary=fixture();awp(f);awp(ordinary);const writes=[],acks=[],assembler=createReassembler(),history=[];
 let releaseWriter,blockedAt=null,releasedAt=null,firstWrite=true,seq=0,timer,watchdog,releaseTimer;
 const blocked=new Promise(resolve=>releaseWriter=()=>{releasedAt=performance.now();resolve();});
 const wire=Object.assign(Object.create(GameConnection.prototype),{readyState:1,closed:false,transport:'webtransport',actionSequence:0,controlQueue:Promise.resolve(),bufferedAmount:0,sequence:0,datagramBusy:false,latestInput:null,latestPing:null,counters:{sentDatagrams:0,coalescedInputs:0},pendingTimeline:[],wt:{datagrams:{maxDatagramSize:1000},close(){}},control:{async write(bytes){const m=JSON.parse(new TextDecoder().decode(bytes));writes.push(m);deliver(f,m,acks);}},datagrams:{async write(bytes){if(firstWrite){firstWrite=false;blockedAt=performance.now();await blocked;}const m=assembler.push(bytes);if(m)deliver(f,m);}}});
 try{
  const done=new Promise((resolve,reject)=>{
   watchdog=setTimeout(()=>reject(Error('Pending-writer recovery did not drain')),3000);
   timer=setInterval(()=>{try{
    if(seq<12){seq++;const c=command(f,seq,{fire:seq===7});history.push(c);ordinary.g.inputBatch(ordinary.p.id,[command(ordinary,seq,{fire:seq===7})]);wire.trackInputHistory([c],f.g.round,f.p.ackInputSeq);
     if(seq===7){wire.send({type:'inputCritical',round:f.g.round,commands:[c]});for(let n=1;n<=2;n++)wire.send({type:'equip',weapon:'last',round:f.g.round,switchSeq:n,scopeSeq:n,afterInputSeq:7,commands:buildInputBatch(history,f.g.round,f.p.ackInputSeq).commands});}
     wire.send(buildInputBatch(history,f.g.round,f.p.ackInputSeq));
    }
    step(f);step(ordinary);wire.observeInputAck(f.g.round,f.p.ackInputSeq);
    if(seq===12&&f.p.ackInputSeq>=12&&f.p.weapon==='awp'&&acks.length===2)resolve();
   }catch(error){reject(error);}},1000/60);
   releaseTimer=setTimeout(()=>releaseWriter(),180);
  });
  await done;clearInterval(timer);await wire.controlQueue;
  assert.ok(releasedAt-blockedAt>=100,'Use an actual unresolved writer promise, not a forged old timestamp');
  const repair=writes.filter(m=>m.type==='inputCritical'&&m.commands.length&&m.commands.every(c=>!c.fire));assert.ok(repair.length>0,'The real native-writer guard must activate the repair lane');
  assert.ok(writes.every((m,i)=>i===0||m.actionSeq>writes[i-1].actionSeq),'Recovery shares globally increasing reliable action order');assert.deepEqual(writes.filter(m=>m.type==='equip').map(m=>m.switchSeq),[1,2]);
  assert.equal(new Set(shots(f).map(e=>e.shotId)).size,1);assert.equal(f.p.ammo,4);assert.equal(f.p.weapon,'awp');assert.equal(f.p.zoom,90);assert.equal(f.p.resumeZoomAt,0);assert.equal(f.q.hp,ordinary.q.hp);assert.equal(acks.every(a=>a.ok),true);assert.equal(f.p.skippedInputCommands,0);
  assert.ok(repair.every(m=>m.commands.length<=MAX_INPUT_BATCH&&!m.commands.some(c=>Object.hasOwn(c,'predictionTick'))));
 }finally{clearInterval(timer);clearTimeout(watchdog);clearTimeout(releaseTimer);releaseWriter?.();wire.finish();}
});

test('CS2 queued automatic recovery is invalidated by a menu watermark before its reliable write',async()=>{
 const f=fixture();f.g.equip(f.p.id,'knife');const {wire,writes,release}=reliableWire(true);Object.assign(wire,{pendingTimeline:[],counters:{sentDatagrams:0,coalescedInputs:0},sequence:0,datagramBusy:false,latestInput:null,latestPing:null,wt:{datagrams:{maxDatagramSize:1000},close(){}}});
 let releaseDatagram;const gate=new Promise(resolve=>releaseDatagram=resolve);wire.datagrams={write:()=>gate};
 try{
  wire.send({type:'inputCritical',round:f.g.round,commands:[command(f,1)]});await Promise.resolve();wire.send({type:'inputBatch',commands:[command(f,2,{jump:true,f:1})]});
  await new Promise(resolve=>setTimeout(resolve,105));wire.send({type:'inputBatch',commands:[command(f,3,{jump:true,f:1})]});assert.ok(wire.inputRecoveryPending,'A repair must really be queued behind the blocked critical packet');
  wire.cancelInputRecovery(f.g.round,3);wire.send({type:'input',input:{round:f.g.round,cancelThroughSeq:3,f:0,s:0,fire:false,jump:false,crouch:false,walk:false,use:false,yaw:0,pitch:0}});release();await wire.controlQueue;
  assert.deepEqual(writes.map(m=>m.type),['inputCritical','input'],'Canceled repair is filtered before native reliable write');for(const m of writes)deliver(f,m);step(f);assert.equal(f.p.ackInputSeq,3);assert.equal(f.p.skippedInputCommands,3);assert.equal(f.p.appliedInputCommands,0);assert.equal(f.p.jumpHeld,false);
 }finally{release();releaseDatagram?.();wire.finish();await wire.controlQueue;}
});

test('CS2 ACK-stall recovery with a fast writer preserves fire/Q/Q while input datagrams and state ACKs are withheld',async()=>{
 const f=fixture(),ordinary=fixture();awp(f);awp(ordinary);const writes=[],acks=[],assembler=createReassembler(),history=[];let seq=0,clientAck=0,timer,watchdog,dropped=0;
 const began=performance.now(),wire=Object.assign(Object.create(GameConnection.prototype),{readyState:1,closed:false,transport:'webtransport',actionSequence:0,controlQueue:Promise.resolve(),bufferedAmount:0,sequence:0,datagramBusy:false,latestInput:null,latestPing:null,counters:{sentDatagrams:0,coalescedInputs:0},pendingTimeline:[],wt:{datagrams:{maxDatagramSize:1000},close(){}},control:{async write(bytes){const m=JSON.parse(new TextDecoder().decode(bytes));writes.push(m);deliver(f,m,acks);}},datagrams:{async write(bytes){if(performance.now()-began<280){dropped++;return;}const m=assembler.push(bytes);if(m)deliver(f,m);}}});
 try{
  await new Promise((resolve,reject)=>{watchdog=setTimeout(()=>reject(Error('Fast-writer ACK-stall case did not drain')),3000);timer=setInterval(()=>{try{
   if(seq<20){seq++;const c=command(f,seq,{fire:seq===14});history.push(c);ordinary.g.inputBatch(ordinary.p.id,[command(ordinary,seq,{fire:seq===14})]);wire.trackInputHistory([c],f.g.round,clientAck);
    if(seq===14){wire.send({type:'inputCritical',round:f.g.round,commands:[c]});for(let n=1;n<=2;n++)wire.send({type:'equip',weapon:'last',round:f.g.round,switchSeq:n,scopeSeq:n,afterInputSeq:14,commands:buildInputBatch(history,f.g.round,clientAck).commands});}
    wire.send(buildInputBatch(history,f.g.round,clientAck));
   }
   step(f);step(ordinary);if(performance.now()-began>=350){clientAck=f.p.ackInputSeq;wire.observeInputAck(f.g.round,clientAck);}
   // Same production frame ordering: recovery is considered only after
   // original critical/weapon actions have been submitted for this frame.
   wire.recoverInputHistory();
   if(seq===20&&f.p.ackInputSeq>=20&&acks.length===2&&f.p.weapon==='awp')resolve();
  }catch(error){reject(error);}},1000/60);});clearInterval(timer);await wire.controlQueue;
  assert.ok(dropped>0);assert.equal(wire.inputRecoveryWrites.writerTriggeredJobs,0,'Every native datagram write resolved promptly');assert.ok(wire.inputRecoveryWrites.ackStallProbeJobs>0,'ACK stagnation must activate actual reliable redundancy');
  assert.ok(writes.every((m,i)=>i===0||m.actionSeq>writes[i-1].actionSeq));assert.deepEqual(writes.filter(m=>m.type==='equip').map(m=>m.switchSeq),[1,2]);assert.ok(acks.every(a=>a.ok));assert.equal(new Set(shots(f).map(e=>e.shotId)).size,1);assert.equal(f.p.ammo,4);assert.equal(f.q.hp,ordinary.q.hp);assert.equal(f.p.weapon,'awp');assert.equal(f.p.zoom,90);assert.equal(f.p.skippedInputCommands,0);
 }finally{clearInterval(timer);clearTimeout(watchdog);wire.finish();}
});

test('CS2 queued ACK-only probe cannot revive canceled fire/jump edges with no writer stall',async()=>{
 const f=fixture();awp(f);const {wire,writes,release}=reliableWire(true);Object.assign(wire,{pendingTimeline:[],counters:{sentDatagrams:0,coalescedInputs:0},sequence:0,datagramBusy:false,latestInput:null,latestPing:null,wt:{datagrams:{maxDatagramSize:1000},close(){}},datagrams:{write:()=>Promise.resolve()}});
 try{
  wire.send({type:'inputCritical',round:f.g.round,commands:[command(f,1)]});await Promise.resolve();const history=Array.from({length:12},(_,i)=>command(f,i+2,{jump:true,fire:true}));wire.trackInputHistory(history,f.g.round,0);wire.send(buildInputBatch(history,f.g.round,0));await new Promise(resolve=>setTimeout(resolve,205));
  assert.equal(wire.datagramWriteStartedAt,null);assert.ok(wire.recoverInputHistory());assert.ok(wire.inputRecoveryPending);assert.equal(wire.inputRecoveryWrites.writerTriggeredJobs,0);assert.equal(wire.inputRecoveryWrites.ackStallProbeJobs,1);
  wire.cancelInputRecovery(f.g.round,13);wire.send({type:'input',input:{round:f.g.round,cancelThroughSeq:13,f:0,s:0,fire:false,jump:false,crouch:false,walk:false,use:false,yaw:0,pitch:0}});release();await wire.controlQueue;
  assert.deepEqual(writes.map(m=>m.type),['inputCritical','input']);for(const m of writes)deliver(f,m);step(f);assert.equal(f.p.ackInputSeq,13);assert.equal(f.p.skippedInputCommands,13);assert.equal(f.p.appliedInputCommands,0);assert.equal(f.p.ammo,5);assert.equal(f.p.jumpHeld,false);assert.equal(shots(f).length,0);
 }finally{release();wire.finish();await wire.controlQueue;}
});

test('CS2 camera/correction metadata cannot move the authoritative bullet origin or change its hit',()=>{
 const a=fixture(),b=fixture();awp(a);awp(b);const plain=command(a,1,{fire:true}),fake=command(b,1,{fire:true,cameraPosition:{x:100,y:100,z:100},visualCorrection:{x:8,y:3,z:-8},origin:{x:-100,y:100,z:0},x:100,y:100,z:100});
 a.g.inputBatch(a.p.id,[plain]);b.g.inputBatch(b.p.id,[fake]);step(a);step(b);
 assert.equal(b.q.hp,a.q.hp);assert.equal(b.p.ammo,a.p.ammo);assert.deepEqual(shots(b).map(e=>({from:e.from,to:e.to,hit:e.hit,spread:e.spread,recoilPitch:e.recoilPitch,recoilYaw:e.recoilYaw})),shots(a).map(e=>({from:e.from,to:e.to,hit:e.hit,spread:e.spread,recoilPitch:e.recoilPitch,recoilYaw:e.recoilYaw})));
});

test('CS2 ordinary small rebases keep the independent completed-step interpolation trajectory',async()=>{
 const f=fixture(),m=f.g.world.movement,rules=m.rules,source=(await readFile(new URL('../public/cs2-player-camera.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'').replace('export function createPlayerCamera','function createPlayerCamera');
 const create=new Function('RULES','eyeHeight','movePlayer','maxMoveSpeed','trace','createPresentationClock','createTerrainCameraResponse','CS2_TERRAIN_CAMERA',source+'\nreturn createPlayerCamera;')(rules,m.eyeHeight,m.movePlayer,m.maxMoveSpeed,(a,b)=>({fraction:1,startSolid:false,end:{...b}}),createPresentationClock,createTerrainCameraResponse,CS2_TERRAIN_CAMERA);
 const camera=create({mode:'baseline',stablePresentation:false,terrainSmoothing:false}),p={...f.p,x:0,y:0,z:0,vx:6.35,vy:0,vz:0,grounded:true,crouch:false,ducking:false,duckAmount:0};camera.reset(p);
 let accumulator=0,prior=0,current=0,offset=0;
 for(let frame=1;frame<=300;frame++){
  const dt=1/75;accumulator+=dt;while(accumulator>=INPUT_DT){prior=current;p.x+=6.35*INPUT_DT;current=p.x;camera.push(p,{f:1,yaw:-Math.PI/2},[]);accumulator-=INPUT_DT;}
  if(frame%90===0){const before={...p},delta=frame%180===0?.03:-.03;p.x+=delta;prior+=delta;current+=delta;offset-=delta;camera.rebase(before,p,{maxDistance:.5});}
  offset*=Math.exp(-16*dt);const saved=structuredClone(p);camera.update(p,{fractionSeconds:accumulator,dt,frameTimeMs:frame*1000/75,correction:{x:offset,y:0,z:0}});assert.deepEqual(p,saved);
  const expected=prior+(current-prior)*(accumulator/INPUT_DT)+offset;assert.ok(Math.abs(camera.position.x-expected)<1e-10,'Small-error camera arithmetic must retain the original completed-step interpolation');assert.ok(Math.abs(camera.position.y-m.eyeHeight(p))<1e-10);assert.equal(camera.position.z,0);
 }
});
