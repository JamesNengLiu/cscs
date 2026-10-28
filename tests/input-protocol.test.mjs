import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.mjs';
import {blankInput,movePlayer,RULES,collides,isGrounded} from '../public/shared.js';
import {reconcileMovement,MAX_PENDING_COMMANDS} from '../public/prediction.js';
import {MOVEMENT_SYNC,INPUT_DT,MAX_INPUT_QUEUE,MAX_INPUT_BATCH,MAX_INPUT_AGE_TICKS,INPUT_REORDER_TICKS,INPUT_REDUNDANCY,normalizeInputCommand,orderedInputCommands,buildInputBatch} from '../public/input-protocol.js';
import {DOWNHILL_CASES,slopeStart} from './downhill-fixtures.mjs';

function match(){const g=new Game({random:()=>.5});g.add('t','T','T');g.add('ct','CT','CT');g.begin();g.phase='live';g.endAt=1000;const p=g.players.get('t');Object.assign(p,slopeStart(DOWNHILL_CASES[0]));return {g,p};}
const command=(g,seq,input={})=>({seq,round:g.round,input:{...blankInput(),...input}});
const pose=p=>Object.fromEntries(['x','y','z','vx','vy','vz','yaw','pitch','grounded','jumpHeld','crouch','moving'].map(k=>[k,p[k]]));
const step=(g,n=1)=>{for(let i=0;i<n;i++)g.step();};

test('protocol: normalizes flat/wrapped commands, requires exact rounds and safe sequences, sanitizes intent',()=>{
  const wrapped={seq:1,round:2,input:{f:99,s:-99,jump:true,fire:1,dt:100,x:999,yaw:NaN}};
  const c=normalizeInputCommand(wrapped,2);assert.equal(c.input.f,1);assert.equal(c.input.s,-1);assert.equal(c.input.jump,true);assert.equal(c.input.fire,false);assert.equal(c.input.yaw,0);assert.equal(c.input.dt,undefined);assert.equal(c.input.x,undefined);
  assert.deepEqual(normalizeInputCommand({seq:1,round:2,...c.input},2),c);
  for(const raw of [null,[],{seq:0,round:2},{seq:-1,round:2},{seq:1.1,round:2},{seq:'1',round:2},{seq:Infinity,round:2},{seq:2147483648,round:2},{seq:1,round:1},{seq:1},{seq:1,round:2,input:null}])assert.equal(normalizeInputCommand(raw,2),null);
});
test('protocol: bounded sorted replay deduplicates first copy and never replays old rounds or ACKed slots',()=>{
  const {g,p}=match(),a={...p,ackInputSeq:1},input={f:1,yaw:p.yaw};
  const commands=[command(g,3,input),command(g,2,input),command(g,3,{f:-1}),command(g,1),{...command(g,4),round:g.round-1},command(g,2.5)];
  const expected={...a};movePlayer(expected,normalizeInputCommand(commands[1],g.round).input,INPUT_DT);movePlayer(expected,normalizeInputCommand(commands[0],g.round).input,INPUT_DT);
  const result=reconcileMovement(a,commands,g.round);assert.deepEqual(result.pending.map(c=>c.seq),[2,3]);assert.deepEqual(result.player,expected);assert.equal(a.x,p.x);
  const many=Array.from({length:1000},(_,i)=>command(g,i+1,input));assert.ok(reconcileMovement({...p,ackInputSeq:0},many,g.round).pending.length<=MAX_PENDING_COMMANDS);
  assert.deepEqual(reconcileMovement({...p,playedRound:g.round+1},commands,g.round).pending,[]);
});
test('protocol: UDP batch builder repeats bounded newest unacked commands without mutating history',()=>{
  const commands=Array.from({length:20},(_,i)=>({seq:i+1,round:3,input:{f:1,dt:100}}));const before=structuredClone(commands);
  const batch=buildInputBatch(commands,3,4);assert.equal(batch.type,'inputBatch');assert.equal(batch.commands.length,INPUT_REDUNDANCY);assert.deepEqual(batch.commands.map(c=>c.seq),[13,14,15,16,17,18,19,20]);assert.equal(batch.commands[0].dt,undefined);assert.equal(batch.commands[0].input,undefined);assert.deepEqual(commands,before);
  assert.deepEqual(orderedInputCommands(null,3),[]);
});
test('queue: receipt does not ACK or overwrite applied intent; duplicates cannot rewrite release/jump/fire',()=>{
  const {g,p}=match(),yaw=p.yaw;
  assert.equal(g.inputBatch('t',[command(g,2,{yaw}),command(g,1,{f:1,yaw,jump:true,fire:true})]),2);
  assert.equal(g.inputBatch('t',[command(g,1,{f:-1}),command(g,2,{fire:true})]),0);
  assert.equal(p.ackInputSeq,0);assert.equal(p.input.f,0);g.step();assert.equal(p.ackInputSeq,1);assert.equal(p.input.f,1);assert.equal(p.jumpHeld,true);assert.equal(p.fireHeld,true);
  g.step();assert.equal(p.ackInputSeq,2);assert.equal(p.input.f,0);assert.equal(p.jumpHeld,false);assert.equal(p.fireHeld,false);assert.equal(p.appliedInputCommands,2);assert.equal(p.skippedInputCommands,0);
});
test('queue: reordered lower sequence received after a higher sequence remains eligible',()=>{
  const {g,p}=match();g.input('t',{seq:2,round:g.round,f:-1});g.step();assert.equal(p.ackInputSeq,0);
  g.input('t',{seq:1,round:g.round,f:1});g.step();assert.equal(p.ackInputSeq,1);assert.equal(p.input.f,1);g.step();assert.equal(p.ackInputSeq,2);assert.equal(p.input.f,-1);
});
test('queue: missing sequence waits a short bounded interval then is explicitly skipped, never simulated',()=>{
  const {g,p}=match();g.inputBatch('t',[command(g,3,{f:1,yaw:p.yaw})]);
  step(g,INPUT_REORDER_TICKS);assert.equal(p.ackInputSeq,0);g.step();assert.equal(p.ackInputSeq,3);assert.equal(p.appliedInputCommands,1);assert.equal(p.skippedInputCommands,2);assert.equal(p.lastAppliedInputSeq,3);
  assert.equal(g.inputBatch('t',[command(g,1,{jump:true}),command(g,2,{fire:true})]),0);g.step();assert.equal(p.ackInputSeq,3);assert.equal(p.input.fire,false);
});
test('queue: stale backlog is skipped with a bounded age rather than accelerating to catch up',()=>{
  const {g,p}=match(),commands=Array.from({length:MAX_INPUT_QUEUE},(_,i)=>command(g,i+1,{f:1,yaw:p.yaw}));
  for(let i=0;i<commands.length;i+=MAX_INPUT_BATCH)g.inputBatch('t',commands.slice(i,i+MAX_INPUT_BATCH));
  step(g,MAX_INPUT_AGE_TICKS+1);assert.equal(p.ackInputSeq,MAX_INPUT_QUEUE);assert.equal(p.appliedInputCommands,MAX_INPUT_AGE_TICKS);assert.equal(p.skippedInputCommands,MAX_INPUT_QUEUE-MAX_INPUT_AGE_TICKS);assert.equal(p.input.f,0);
  assert.equal(g.inputBatch('t',commands),0);
});
test('queue: per-batch cap, per-player window and duplicate flood stay bounded without changing ACK on receipt',()=>{
  const {g,p}=match();assert.equal(g.inputBatch('t',Array.from({length:1000},(_,i)=>command(g,i+1))),MAX_INPUT_BATCH);
  assert.equal(g.inputBatch('t',[command(g,MAX_INPUT_QUEUE+1),command(g,2147483647)]),0);
  for(let i=0;i<100;i++)assert.equal(g.inputBatch('t',[command(g,1,{f:-1})]),0);
  assert.equal(p.ackInputSeq,0);g.step();assert.equal(p.ackInputSeq,1);assert.equal(p.appliedInputCommands,1);
  assert.equal(g.inputBatch('missing',[command(g,1)]),0);assert.equal(g.inputBatch('t',null),0);
});
test('queue: old rounds cannot move, cancel or ACK the new round; reset clears queued edges and counters',()=>{
  const {g,p}=match(),oldRound=g.round;g.inputBatch('t',[command(g,1,{f:1,jump:true,fire:true})]);g.begin();g.phase='live';g.endAt=1000;
  assert.equal(g.inputBatch('t',[{seq:1,round:oldRound,f:1}]),0);assert.equal(g.input('t',{round:oldRound,f:0}),false);g.step();assert.equal(p.ackInputSeq,0);assert.equal(p.appliedInputCommands,0);assert.equal(p.skippedInputCommands,0);assert.equal(p.lastInputSeq,0);assert.equal(p.jumpHeld,false);assert.equal(p.fireHeld,false);
  g.inputBatch('t',[command(g,1,{walk:true})]);g.step();assert.equal(p.ackInputSeq,1);
});
test('queue: idle sequenced loss uses neutral on the next tick and does not replay held movement',()=>{
  const {g,p}=match(),yaw=p.yaw;g.inputBatch('t',[command(g,1,{f:1,yaw,jump:true,fire:true})]);g.step();const expected={...p};
  movePlayer(expected,{...blankInput(),yaw,pitch:p.pitch},INPUT_DT);expected.jumpHeld=true;g.step();assert.deepEqual(pose(p),pose(expected));assert.equal(p.input.f,0);assert.equal(p.input.fire,false);assert.equal(p.fireHeld,true);assert.equal(p.jumpHeld,true);assert.equal(p.ackInputSeq,1);
  const before={...p};g.inputBatch('t',[command(g,2,{f:1,yaw})]);g.step();movePlayer(before,normalizeInputCommand(command(g,2,{f:1,yaw}),g.round).input,INPUT_DT);assert.deepEqual(pose(p),pose(before));assert.equal(p.appliedInputCommands,2);
});
test('queue: menu neutral immediately clears backlog, ignores redundant cancelled copies, ACKs skip on tick',()=>{
  const {g,p}=match();g.inputBatch('t',[command(g,1,{f:1,jump:true,fire:true}),command(g,2,{f:1,fire:true})]);
  assert.equal(g.input('t',{...blankInput(),round:g.round,yaw:p.yaw}),true);assert.equal(p.input.f,0);assert.equal(p.fireHeld,false);assert.equal(p.ackInputSeq,0);assert.equal(g.inputBatch('t',[command(g,2,{f:1})]),0);
  g.step();assert.equal(p.ackInputSeq,2);assert.equal(p.skippedInputCommands,2);assert.equal(p.appliedInputCommands,0);assert.equal(p.input.fire,false);
  g.inputBatch('t',[command(g,3,{f:-1})]);g.step();assert.equal(p.ackInputSeq,3);assert.equal(p.input.f,-1);
});
test('queue: explicit neutral cancellation watermark also rejects previously unseen delayed datagrams',()=>{
  const {g,p}=match();g.inputBatch('t',[command(g,1,{f:1})]);g.step();
  g.input('t',{...blankInput(),round:g.round,cancelThroughSeq:4});assert.equal(p.ackInputSeq,1);
  assert.equal(g.inputBatch('t',[command(g,2,{fire:true}),command(g,3,{jump:true}),command(g,4,{f:1})]),0);
  g.step();assert.equal(p.ackInputSeq,4);assert.equal(p.skippedInputCommands,3);assert.equal(p.appliedInputCommands,1);
  g.inputBatch('t',[command(g,5,{f:-1})]);g.step();assert.equal(p.ackInputSeq,5);assert.equal(p.input.f,-1);
  g.input('t',{...blankInput(),round:g.round,cancelThroughSeq:2147483647});g.step();assert.equal(p.ackInputSeq,5);
});
test('queue: idle loss does not manufacture jump or semiautomatic fire press edges',()=>{
  const {g,p}=match();let shots=0;g.shoot=()=>{shots++;return true;};
  g.inputBatch('t',[command(g,1,{yaw:p.yaw,jump:true,fire:true})]);g.step();assert.equal(shots,1);step(g,80);assert.equal(isGrounded(p),true);assert.equal(shots,1);
  g.inputBatch('t',[command(g,2,{yaw:p.yaw,jump:true,fire:true})]);g.step();assert.equal(shots,1);assert.equal(p.vy,0);
  g.inputBatch('t',[command(g,3,{yaw:p.yaw}),command(g,4,{yaw:p.yaw,jump:true,fire:true})]);step(g,2);assert.equal(shots,2);assert.ok(p.vy>0);
});
test('legacy: unsequenced intent retains only a short grace, menu releases immediately, no sequence ACK is invented',()=>{
  const {g,p}=match();g.input('t',{f:1,yaw:p.yaw,fire:true});g.step();assert.equal(p.input.f,1);assert.equal(p.fireHeld,true);step(g,12);assert.equal(p.input.f,0);assert.equal(p.fireHeld,false);assert.equal(p.ackInputSeq,0);
  g.input('t',{f:1});g.input('t',blankInput());assert.equal(p.input.f,0);g.step();assert.equal(p.input.f,0);
  assert.equal(g.input('t',null),false);assert.equal(g.input('t',{input:null}),false);
});
test('queue: legacy sequenced wrapper is accepted, but batches require round and nonneutral legacy cannot bypass queue',()=>{
  const {g,p}=match();assert.equal(g.input('t',{seq:1,input:{f:1,yaw:p.yaw}}),true);assert.equal(g.inputBatch('t',[{seq:2,f:1}]),0);assert.equal(g.input('t',{f:-1}),false);g.step();assert.equal(p.ackInputSeq,1);assert.equal(p.input.f,1);
});
test('queue: two players have independent command queues and ACKs; disconnect/rejoin clears private state',()=>{
  const {g,p}=match(),ct=g.players.get('ct');g.inputBatch('t',[command(g,1,{f:1})]);g.inputBatch('ct',[command(g,2,{f:-1})]);g.step();assert.equal(p.ackInputSeq,1);assert.equal(ct.ackInputSeq,0);
  g.remove('ct');g.add('ct','new CT','CT');const next=g.players.get('ct');next.alive=true;g.step();assert.equal(next.ackInputSeq,0);assert.equal(next.input.f,0);
});
test('queue: authoritative step is always one 60Hz tick, ignores payload dt/position and arbitrary caller dt',()=>{
  const {g,p}=match(),other=match(),yaw=p.yaw;
  const inputs=Array.from({length:100},(_,i)=>({seq:i+1,round:g.round,f:1,yaw,dt:100,x:1e9,y:1e9,z:1e9}));
  for(let i=0;i<inputs.length;i+=MAX_INPUT_BATCH)g.inputBatch('t',inputs.slice(i,i+MAX_INPUT_BATCH));
  const start={...p},time=g.time;g.step(100);other.g.inputBatch('t',[command(other.g,1,{f:1,yaw})]);other.g.step();
  assert.equal(g.time-time,INPUT_DT);assert.equal(g.serverTick,1);assert.equal(p.ackInputSeq,1);assert.deepEqual(pose(p),pose(other.p));assert.ok(Math.hypot(p.x-start.x,p.z-start.z)<=RULES.speed*INPUT_DT+1e-9);
  for(let i=0;i<20;i++){const before={...p};g.step(0);assert.ok(Math.hypot(p.x-before.x,p.z-before.z)<=RULES.speed*INPUT_DT+1e-9);}assert.equal(p.appliedInputCommands,21);
});
test('snapshot: publishes protocol, tick and applied/skipped counters, never leaks queue or internal state',()=>{
  const {g,p}=match();g.inputBatch('t',[command(g,1,{f:1})]);
  for(const viewer of [null,'t','ct']){const s=g.snapshot(viewer);assert.equal(s.movementSync,MOVEMENT_SYNC);assert.equal(s.serverTick,0);const player=s.players.find(a=>a.id===p.id);assert.equal(player.ackInputSeq,0);for(const key of ['input','lastInput','lastInputSeq','queue','inputs','receivedTick','skipThrough','gapSince','sequenced'])assert.equal(Object.hasOwn(player,key),false,key);assert.ok(!JSON.stringify(s).includes('receivedTick'));}
  g.step();const s=g.snapshot('t');assert.equal(s.serverTick,1);assert.equal(s.players.find(a=>a.id==='t').appliedInputCommands,1);
});

for(const c of DOWNHILL_CASES)for(const mode of [{},{walk:true},{crouch:true}])test(`real BSP slope command/replay consistency: ${c.name} ${JSON.stringify(mode)}`,()=>{
  const {g,p}=match();Object.assign(p,slopeStart(c,mode.crouch));const input={...blankInput(),f:1,yaw:p.yaw,...mode};let pending=[];
  for(let base=1;base<=84;base+=4){
    const authoritative=g.snapshot('t').players.find(a=>a.id==='t');const batch=Array.from({length:4},(_,i)=>command(g,base+i,input));pending.push(...batch);
    const predicted=reconcileMovement(authoritative,[...pending].reverse(),g.round);g.inputBatch('t',[batch[2],batch[0],batch[3],batch[1],batch[0]]);step(g,4);
    assert.deepEqual(pose(p),pose(predicted.player));assert.equal(p.ackInputSeq,base+3);assert.equal(p.skippedInputCommands,0);assert.equal(collides(p.x,p.z,RULES.radius,p.y,p.crouch?RULES.crouchHeight:RULES.bodyHeight),false);assert.equal(isGrounded(p),true);
    pending=reconcileMovement(g.snapshot('t').players.find(a=>a.id==='t'),pending,g.round).pending;assert.equal(pending.length,0);
  }
});

test('deterministic UDP loss/reorder/duplication/bursts: redundant history drains without edge loss or acceleration',()=>{
  const {g,p}=match(),yaw=p.yaw,history=[],packets=[];const total=90;let maximumPending=0,observedRelease=false,observedJump=false,observedFire=false;
  for(let tick=1;tick<=total+12;tick++){
    if(tick<=total){history.push(command(g,tick,{f:tick===45?0:1,yaw,jump:tick===20,fire:tick===30}));if(tick%7!==0){const payload=buildInputBatch(history.filter(c=>c.seq>p.ackInputSeq),g.round,p.ackInputSeq);packets.push({at:tick+[2,0,1,0][tick%4],payload});if(tick%5===0)packets.push({at:tick+3,payload});}}
    const due=packets.filter(packet=>packet.at<=tick).reverse();for(const packet of due){g.inputBatch('t',packet.payload.commands);packets.splice(packets.indexOf(packet),1);}
    const before={...p};g.step();assert.ok(Math.hypot(p.x-before.x,p.z-before.z)<=RULES.speed*INPUT_DT+1e-9);
    observedJump||=p.lastAppliedInputSeq===20&&p.input.jump;observedFire||=p.lastAppliedInputSeq===30&&p.input.fire;observedRelease||=p.lastAppliedInputSeq===45&&p.input.f===0;
    const unacked=history.filter(c=>c.seq>p.ackInputSeq);maximumPending=Math.max(maximumPending,unacked.length);const predicted=reconcileMovement(g.snapshot('t').players.find(a=>a.id==='t'),unacked,g.round);assert.ok(Number.isFinite(predicted.player.y));
  }
  assert.equal(p.ackInputSeq,total);assert.equal(p.appliedInputCommands,total);assert.equal(p.skippedInputCommands,0);assert.equal(observedJump,true);assert.equal(observedFire,true);assert.equal(observedRelease,true);assert.ok(maximumPending<12);assert.equal(p.input.f,0);
});
