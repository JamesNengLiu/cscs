import test from 'node:test';
import assert from 'node:assert/strict';
import {createCS2InputRecovery} from '../public/cs2-input-recovery.js';
import {GameConnection} from '../public/cs2-game-connection.js';
import {buildInputBatch} from '../public/cs2-input-protocol.js';
import {createReassembler} from '../public/cs2-net-wire.js';
const command=(seq,patch={},round=1)=>({seq,round,input:{f:1,s:0,yaw:0,pitch:0,fire:false,jump:false,crouch:false,walk:false,use:false,...patch},predictionTick:seq+100,viewTime:12.5});
const copy=m=>JSON.parse(new TextDecoder().decode(m).trim());
function fixture({transport='webtransport',controlGate=null}={}){
 const packets=[],controls=[],wsMessages=[];let releaseData,block=true;
 const s=Object.create(GameConnection.prototype);Object.assign(s,{readyState:1,closed:false,transport,counters:{sentDatagrams:0,receivedDatagrams:0,coalescedInputs:0,staleStates:0,coalescedStates:0},sequence:0,actionSequence:0,latestInput:null,latestPing:null,datagramBusy:false,controlQueue:controlGate||Promise.resolve(),bufferedAmount:0,wt:{datagrams:{maxDatagramSize:1000},close(){}},datagrams:{write(bytes){packets.push(bytes.slice());if(block){block=false;return new Promise(resolve=>releaseData=resolve);}return Promise.resolve();}},control:{write(bytes){controls.push(copy(bytes));return Promise.resolve();}},ws:{bufferedAmount:0,send(value){wsMessages.push(JSON.parse(value));},close(){}},pendingState:null,pendingTimeline:[]});
 return{s,packets,controls,wsMessages,release:()=>releaseData?.(),stall(){s.datagramWriteStartedAt=performance.now()-100;},async flush(){await s.controlQueue;await Promise.resolve();},dispose(){s.close();releaseData?.();}};
}

test('first-copy immutable history strips private prediction ticks and observes reliable edge coverage',()=>{
 let time=0;const h=createCS2InputRecovery({now:()=>time}),a=command(1);h.track([a],1,0);a.input.f=0;a.input.fire=true;a.viewTime=99;h.track([command(1,{f:0,fire:true}),command(2,{jump:true})],1);h.noteReliable([command(2,{jump:true})],1);
 const p=h.plan();assert.deepEqual(p.commands.map(c=>c.seq),[1]);assert.equal(p.commands[0].f,1);assert.equal(p.commands[0].fire,false);assert.equal(p.commands[0].viewTime,12.5);assert.ok(!('input'in p.commands[0]));assert.ok(!('predictionTick'in p.commands[0]));
});
test('ACK purge, cancel watermark and old/new rounds prevent queued input resurrection',()=>{
 const h=createCS2InputRecovery({now:()=>0});h.track([command(1),command(2)],5,0); // wrong-round commands are rejected.
 assert.equal(h.diagnostics().commands,0);h.track([command(1,{},5),command(2,{},5)],5,0);const p=h.plan();assert.ok(h.commit(p));h.observeAck(5,1);assert.deepEqual(h.filter(p).map(c=>c.seq),[2]);h.cancel(5,2);assert.deepEqual(h.filter(p),[]);h.track([command(2,{},5)],5,0);assert.equal(h.diagnostics().commands,0);h.track([command(3,{},5)],5,2);assert.equal(h.diagnostics().commands,1);assert.equal(h.observeAck(4,1000),false);h.track([command(1,{},6)],6);assert.equal(h.ack,0);assert.equal(h.diagnostics().commands,1);assert.deepEqual(h.filter(p),[]);
});
test('age is first-observation age and expired duplicate sends never become fresh again',()=>{
 let time=0;const h=createCS2InputRecovery({now:()=>time});h.track([command(1,{fire:true})],1);time=400;h.track([command(1,{fire:true})],1);time=501;assert.equal(h.plan(),null);time=900;h.track([command(1,{fire:true})],1);assert.equal(h.plan(),null);assert.equal(h.diagnostics().expired,1);h.track([command(2)],1);assert.deepEqual(h.plan().commands.map(c=>c.seq),[2]);
});
test('history, rate, chunk and encoded-byte budgets stay finite without resending covered prefixes',()=>{
 let time=0;const h=createCS2InputRecovery({now:()=>time,maxPerSecond:2,maxBatch:32,maxBytes:512});h.track(Array.from({length:128},(_,i)=>command(i+1)),1);const first=h.plan();assert.ok(first.commands.length<=32);assert.ok(new TextEncoder().encode(JSON.stringify({type:'inputCritical',actionSeq:Number.MAX_SAFE_INTEGER,commands:first.commands})+'\n').length<=512);assert.ok(h.commit(first));assert.equal(h.commit(first),false);assert.equal(h.plan(),null);time=80;const second=h.plan();assert.ok(second);assert.ok(!second.commands.some(c=>first.commands.some(a=>a.seq===c.seq)));h.commit(second);time=160;assert.equal(h.plan(),null);h.track([command(129)],1);assert.equal(h.diagnostics().entries,128);time=1000;h.observeAck(1,128);h.track([command(130)],1,128);assert.deepEqual(h.plan().commands.map(c=>c.seq),[130]);
});
test('healthy QUIC writer and even slow ACK alone retain original latest-eight wire behavior',async()=>{
 const f=fixture();try{const commands=Array.from({length:20},(_,i)=>command(i+1));f.s.trackInputHistory(commands,1,0);f.s.send(buildInputBatch(commands,1,0));assert.equal(f.s.recoverInputHistory(),false);await f.flush();assert.equal(f.controls.length,0);assert.equal(f.s.actionSequence,0);assert.deepEqual(buildInputBatch(commands,1,0).commands.map(c=>c.seq),[13,14,15,16,17,18,19,20]);}finally{f.dispose();}
});
test('a genuinely pending writer repairs unacknowledged history once on the existing reliable FIFO',async()=>{
 const f=fixture();try{const commands=Array.from({length:10},(_,i)=>command(i+1));f.s.trackInputHistory(commands,1,0);f.s.send(buildInputBatch(commands,1,0));f.stall();assert.ok(f.s.recoverInputHistory());await f.flush();assert.equal(f.controls.length,1);assert.equal(f.controls[0].type,'inputCritical');assert.deepEqual(f.controls[0].commands.map(c=>c.seq),[1,2,3,4,5,6,7,8,9,10]);assert.ok(f.controls[0].commands.every(c=>!('predictionTick'in c)));assert.equal(f.s.recoverInputHistory(),false);assert.equal(f.s.bufferedAmount,0);assert.equal(f.s.inputRecoveryPending,null);f.s.observeInputAck(1,10);assert.equal(f.s.inputRecovery.diagnostics().commands,0);}finally{f.dispose();}
});
test('repair actionSeq is reserved before later fire and equip, never allocated at delayed write time',async()=>{
 const f=fixture();try{f.s.trackInputHistory([command(1)],1);f.s.send(buildInputBatch([command(1)],1));f.stall();f.s.send({type:'inputCritical',commands:[{seq:2,round:1,f:1,s:0,yaw:0,pitch:0,fire:true,jump:false,crouch:false,walk:false,use:false}]});f.s.send({type:'equip',weapon:'knife',round:1,afterInputSeq:2});await f.flush();assert.deepEqual(f.controls.map(c=>[c.type,c.actionSeq]),[['inputCritical',1],['inputCritical',2],['equip',3]]);assert.deepEqual(f.controls[0].commands.map(c=>c.seq),[1]);assert.equal(f.controls[1].commands[0].seq,2);assert.equal(f.controls[1].commands[0].fire,true);assert.equal(f.s.readyState,1);}finally{f.dispose();}
});
test('ACK, cancellation, round change and age are checked again when the repair reaches the writer',async t=>{
 for(const kind of ['ack','cancel','round','age','close'])await t.test(kind,async()=>{
  let release,time=0;const gate=new Promise(r=>release=r),f=fixture({controlGate:gate});f.s.inputRecovery=createCS2InputRecovery({now:()=>time});try{f.s.trackInputHistory([command(1,{fire:true})],1);f.s.send(buildInputBatch([command(1,{fire:true})],1));f.stall();assert.ok(f.s.recoverInputHistory());if(kind==='ack')f.s.observeInputAck(1,1);if(kind==='cancel')f.s.cancelInputRecovery(1,1);if(kind==='round')f.s.observeInputAck(2,0);if(kind==='age')time=501;if(kind==='close')f.s.close();release();await f.flush();assert.deepEqual(f.controls,[]);}finally{release();f.dispose();}
 });
});
test('one bounded repair slot cannot flood a blocked reliable lane or consume business admission bytes',async()=>{
 let release;const f=fixture({controlGate:new Promise(r=>release=r)});try{f.s.trackInputHistory(Array.from({length:30},(_,i)=>command(i+1)),1);f.s.send(buildInputBatch(Array.from({length:30},(_,i)=>command(i+1)),1));f.stall();assert.ok(f.s.recoverInputHistory());for(let i=0;i<100;i++)assert.equal(f.s.recoverInputHistory(),false);assert.ok(f.s.inputRecoveryBufferedBytes<=4096);assert.equal(f.s.inputRecovery.diagnostics().repairMessages,1);f.s.bufferedAmount=63000;f.s.send({type:'equip',weapon:'knife',round:1,afterInputSeq:30});assert.equal(f.s.readyState,1);assert.ok(f.s.bufferedAmount<65536);release();await f.flush();assert.equal(f.controls.at(-1).type,'equip');}finally{release();f.dispose();}
});
test('WS observation APIs do not add recovery messages or change the payload',async()=>{
 const f=fixture({transport:'websocket'});try{const commands=Array.from({length:20},(_,i)=>command(i+1)),m=buildInputBatch(commands,1);f.s.trackInputHistory(commands,1);f.s.datagramWriteStartedAt=performance.now()-1000;f.s.send(m);f.s.observeInputAck(1,10);f.s.cancelInputRecovery(1,20);await f.flush();assert.deepEqual(f.wsMessages,[m]);assert.deepEqual(f.controls,[]);assert.equal(f.s.actionSequence,0);}finally{f.dispose();}
});

test('invalid reliable observations do not mutate history or throw',()=>{
 const h=createCS2InputRecovery({now:()=>0});h.track([command(1)],1);for(const value of [null,undefined,{},'not-an-array',1])assert.doesNotThrow(()=>h.noteReliable(value,1));assert.deepEqual(h.plan().commands.map(c=>c.seq),[1]);
});
test('scope-aware action barrier commands are reliably covered without an extra recovery copy',async()=>{
 const f=fixture();try{const commands=Array.from({length:10},(_,i)=>command(i+1));f.s.trackInputHistory(commands,1);f.s.send(buildInputBatch(commands,1));f.stall();const action={type:'equip',weapon:'knife',round:1,afterInputSeq:10,commands:buildInputBatch(commands,1).commands};f.s.send(action);await f.flush();assert.deepEqual(f.controls.map(c=>c.type),['inputCritical','equip']);assert.deepEqual(f.controls[0].commands.map(c=>c.seq),[1,2]);assert.deepEqual(f.controls[1].commands.map(c=>c.seq),[3,4,5,6,7,8,9,10]);assert.equal(f.s.recoverInputHistory(),false);}finally{f.dispose();}
});
test('sustained batches proactively repair while the real writer promise is still pending',async()=>{
 const f=fixture(),commands=[];try{
  for(let seq=1;seq<=12;seq++){commands.push(command(seq));f.s.trackInputHistory([commands.at(-1)],1);f.s.send(buildInputBatch(commands,1));await new Promise(resolve=>setTimeout(resolve,17));}
  await f.flush();assert.equal(f.s.datagramBusy,true,'native datagram promise has not been released');assert.ok(f.controls.length>=1,'send(inputBatch), without any manual recover call, must repair a real80ms stall');assert.ok(f.controls.every(m=>m.type==='inputCritical'&&m.commands.length<=12));const seqs=f.controls.flatMap(m=>m.commands.map(c=>c.seq));assert.deepEqual(seqs.slice(0,4),[1,2,3,4]);assert.equal(new Set(seqs).size,seqs.length,'same unACKed prefix is not repeatedly sent');assert.ok(f.s.inputRecoveryWrites.completedWrites>=1);assert.ok(f.s.inputRecovery.diagnostics().entries<=128);assert.equal(f.s.readyState,1);
 }finally{f.dispose();}
});

test('ACK-progress clock changes only with a new round or strictly increasing ACK',()=>{
 let now=0;const h=createCS2InputRecovery({now:()=>now});h.track(Array.from({length:12},(_,i)=>command(i+1)),1,0);assert.equal(h.diagnostics().lastAckProgressAt,0);now=179;h.observeAck(1,0);assert.equal(h.ackStalled(),false);now=180;assert.equal(h.ackStalled(),true);h.noteReliable([],1);h.track([command(12)],1,0);assert.equal(h.diagnostics().lastAckProgressAt,0);now=220;h.observeAck(1,1);assert.equal(h.ackStalled(),false);assert.equal(h.diagnostics().lastAckProgressAt,220);now=300;h.observeAck(1,0);assert.equal(h.diagnostics().lastAckProgressAt,220);h.observeAck(2,0);assert.equal(h.diagnostics().lastAckProgressAt,300);assert.equal(h.ackStalled(),false);
});
test('slow but continuously progressing ACK and fast datagram writes cause no repair traffic',async()=>{
 const f=fixture();let now=0;f.s.inputRecovery=createCS2InputRecovery({now:()=>now});f.s.datagrams.write=bytes=>{f.packets.push(bytes.slice());return Promise.resolve();};try{
  f.s.observeInputAck(1,100);
  for(let tick=1;tick<=12;tick++){now=tick*100;f.s.observeInputAck(1,100+tick);const commands=Array.from({length:15},(_,i)=>command(101+tick+i));f.s.trackInputHistory(commands,1,100+tick);f.s.send(buildInputBatch(commands,1,100+tick));await new Promise(setImmediate);assert.ok(f.s.inputRecovery.diagnostics().highestMinusAck>8);assert.equal(f.s.recoverInputHistory(),false);}
  await f.flush();assert.deepEqual(f.controls,[]);assert.equal(f.s.actionSequence,0);
 }finally{f.dispose();}
});
test('fast datagrams plus ACK stagnation180ms can probe and ACK progress stops further probes',async()=>{
 const f=fixture();let now=0;f.s.inputRecovery=createCS2InputRecovery({now:()=>now});f.s.datagrams.write=bytes=>{f.packets.push(bytes.slice());return Promise.resolve();};try{
  const commands=Array.from({length:12},(_,i)=>command(i+1));f.s.trackInputHistory(commands,1,0);f.s.send(buildInputBatch(commands,1));await new Promise(setImmediate);assert.equal(f.s.datagramWriteStartedAt,null);now=179;assert.equal(f.s.recoverInputHistory(),false);now=180;assert.ok(f.s.recoverInputHistory());await f.flush();assert.equal(f.controls.length,1);assert.deepEqual(f.controls[0].commands.map(c=>c.seq),Array.from({length:12},(_,i)=>i+1));assert.equal(f.s.inputRecoveryWrites.ackStallProbeJobs,1);now=220;f.s.observeInputAck(1,1);f.s.trackInputHistory([command(13),command(14)],1,1);assert.equal(f.s.recoverInputHistory(),false);await f.flush();assert.equal(f.controls.length,1);
 }finally{f.dispose();}
});
test('queued ACK-only probe is retired on resumed progress and uncovered history remains retryable',async()=>{
 let release,now=0;const f=fixture({controlGate:new Promise(r=>release=r)});f.s.inputRecovery=createCS2InputRecovery({now:()=>now});f.s.datagrams.write=()=>Promise.resolve();try{
  f.s.trackInputHistory(Array.from({length:12},(_,i)=>command(i+1)),1);now=180;assert.ok(f.s.recoverInputHistory());now=181;f.s.observeInputAck(1,1);release();await f.flush();assert.deepEqual(f.controls,[]);assert.equal(f.s.inputRecovery.diagnostics().reliableCovered,0);now=361;assert.ok(f.s.recoverInputHistory());await f.flush();assert.equal(f.controls.length,1);assert.deepEqual(f.controls[0].commands.map(c=>c.seq),[2,3,4,5,6,7,8,9,10,11,12]);
 }finally{release();f.dispose();}
});
