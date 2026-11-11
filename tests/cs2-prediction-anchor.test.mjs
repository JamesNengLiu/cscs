import test from 'node:test';
import assert from 'node:assert/strict';
import {createMovementPredictionClock,alignAppliedMovement,supportsAppliedMovementAnchor,markRetiredBacklog,replayMovementTimeline,reconcileMovementTimeline} from '../public/cs2-movement-timeline.js';
import {orderedInputCommands,INPUT_BACKLOG_LIMIT,sameHeldInput,INPUT_DT,MAX_INPUT_QUEUE,MAX_INPUT_SEQUENCE} from '../public/cs2-input-protocol.js';
import {WEAPON_ACTION_LIMIT} from '../public/cs2-weapon-action-order.js';
import {fixtureWorld,fixtureGame} from './cs2-game-fixture.mjs';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {runPredictionLatency} from './fixtures/cs2-prediction-latency.mjs';

const world=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),move=world.movement.movePlayer;
const input=(patch={})=>({...world.movement.blankInput(),...patch});
const authority=(patch={})=>({id:'anchor',alive:true,weapon:'knife',x:0,y:.0005,z:0,vx:0,vy:0,vz:0,yaw:0,pitch:0,grounded:true,jumpHeld:false,jumpFatigue:0,duckAmount:0,duckElapsed:0,ducking:false,crouch:false,velocityModifier:1,hitSlowdownVersion:1,collisionVersion:1,jumpFatigueVersion:1,movementTimelineVersion:1,movementTick:20,movementAppliedTick:20,lastAppliedInputSeq:5,ackInputSeq:5,...patch});
const command=(seq,predictionTick,patch={})=>({seq,round:1,predictionTick,input:input({f:1,...patch})});
const options={dt:INPUT_DT,maxPending:MAX_INPUT_QUEUE,order:orderedInputCommands,backlogLimit:INPUT_BACKLOG_LIMIT,sameInput:sameHeldInput};
const circle=tick=>Math.PI+tick*.01;
const quantile=(values,q)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor((sorted.length-1)*q)];};

test('an applied command re-labels pending samples forwards and backwards; a skipped ACK or unknown sample is not an anchor',()=>{
 const commands=[command(5,12),command(6,13),command(7,14),command(8,16)];
 const late=alignAppliedMovement(authority(),commands,1);
 assert.equal(late.anchored,true);assert.equal(late.shift,8);assert.deepEqual(late.commands.map(c=>c.predictionTick),[20,21,22,24],'A local gap between samples is preserved');assert.deepEqual(commands.map(c=>c.predictionTick),[12,13,14,16],'Input samples are never mutated');
 const early=alignAppliedMovement(authority({movementTick:9,movementAppliedTick:8}),commands,1);
 assert.equal(early.shift,-4);assert.deepEqual(early.commands.map(c=>c.predictionTick),[8,9,10,12],'A shorter authority queue moves labels back');
 const exact=alignAppliedMovement(authority({movementAppliedTick:12}),commands,1);assert.equal(exact.anchored,true);assert.equal(exact.shift,0);assert.equal(exact.commands,commands);
 const older=alignAppliedMovement(authority(),[command(4,3),...commands],1);assert.equal(older.commands[0].predictionTick,3,'Samples before the applied command keep their labels');
 for(const [name,patch,list,round] of [
  ['legacy authority without the applied tick',{movementAppliedTick:undefined},commands,1],
  ['never applied',{lastAppliedInputSeq:0,movementAppliedTick:0},commands,1],
  ['applied beyond the ACK',{lastAppliedInputSeq:9},commands,1],
  ['applied tick in the future',{movementAppliedTick:21},commands,1],
  ['other round',{},commands,2],
  ['sample no longer held locally',{lastAppliedInputSeq:3,ackInputSeq:5},commands,1],
  ['unlabelled sample',{},[{seq:5,round:1,input:input()},command(6,13)],1],
  ['old timeline version',{movementTimelineVersion:0},commands,1],
 ]){const result=alignAppliedMovement(authority(patch),list,round);assert.equal(result.anchored,false,name);assert.equal(result.shift,0,name);assert.equal(result.commands,list,name);}
 assert.equal(supportsAppliedMovementAnchor(authority()),true);assert.equal(supportsAppliedMovementAnchor(authority({movementAppliedTick:undefined})),false);
});

test('the prediction clock follows an anchor in both directions and is provisional again after every reset',()=>{
 const clock=createMovementPredictionClock();assert.equal(clock.anchored,false);assert.equal(clock.shift(3),null);assert.equal(clock.markAnchored(),false,'An unsynchronised clock cannot be anchored');
 clock.reset(authority({movementTick:10}));assert.equal(clock.next(),11);assert.equal(clock.next(),12);
 assert.equal(clock.shift(5),17);assert.equal(clock.next(),18);assert.equal(clock.shift(-4),14);assert.equal(clock.shift(-100),0);assert.equal(clock.shift(.5),0);assert.equal(clock.shift(NaN),0);
 assert.equal(clock.raise(9),9);assert.equal(clock.raise(4),9,'raise never rewinds');assert.equal(clock.raise(-1),9);
 assert.equal(clock.markAnchored(),true);assert.equal(clock.anchored,true);
 clock.reset(authority({movementTick:30}));assert.equal(clock.anchored,false,'Round, death, menu and blur resets start provisional');assert.equal(clock.tick,30);
});

test('provisional labels replay every pending sample in order instead of treating transport delay as elapsed time',()=>{
 const state=authority({movementTick:26,movementAppliedTick:0,lastAppliedInputSeq:0,ackInputSeq:0}),clock=createMovementPredictionClock();clock.reset(authority({movementTick:20}));
 const pending=[1,2,3,4,5].map(seq=>({seq,round:1,predictionTick:clock.next(),input:input({f:1})})),expected={...state};for(const c of pending)move(expected,c.input,INPUT_DT,[]);
 const stale=replayMovementTimeline(state,pending,move,[],{dt:INPUT_DT,targetTick:clock.tick});
 assert.equal(stale.timeline.coveredCommands,5,'Without an anchor every sample looks older than the authority tick');assert.equal(stale.timeline.replayedTicks,0);
 const result=reconcileMovementTimeline(state,pending,1,move,[],{...options,clock});
 assert.equal(result.timeline.strategy,'unanchored-replay');assert.equal(result.timeline.replayedTicks,5);assert.equal(result.timeline.coveredCommands,0);
 for(const key of ['x','y','z','vx','vz'])assert.equal(result.player[key],expected[key],key);
 assert.deepEqual(result.pending.map(c=>c.predictionTick),[27,28,29,30,31]);assert.equal(clock.tick,31);assert.equal(clock.next(),32,'The next sample continues the rebased schedule');assert.equal(clock.anchored,false);
 // The first applied command anchors the clock; replay then uses physical time.
 const acked=authority({movementTick:29,movementAppliedTick:29,lastAppliedInputSeq:2,ackInputSeq:2});
 const next=reconcileMovementTimeline(acked,[...result.pending,{seq:6,round:1,predictionTick:32,input:input({f:1})}],1,move,[],{...options,clock});
 assert.equal(clock.anchored,true);assert.equal(next.timeline.strategy,'physical-time');assert.equal(next.timeline.coveredCommands,0);assert.equal(next.timeline.neutralTicks,0);assert.deepEqual(next.pending.map(c=>[c.seq,c.predictionTick]),[[3,30],[4,31],[5,32],[6,33]]);assert.equal(clock.tick,33);
 // An older authority without the applied tick keeps the previous behaviour.
 const legacyClock=createMovementPredictionClock();legacyClock.reset(authority({movementTick:20,movementAppliedTick:undefined}));
 const legacy=reconcileMovementTimeline(authority({movementTick:26,movementAppliedTick:undefined,lastAppliedInputSeq:0,ackInputSeq:0}),pending.map((c,i)=>({...c,predictionTick:21+i})),1,move,[],{...options,clock:legacyClock});
 assert.equal(legacy.timeline.strategy,'physical-time');assert.equal(legacy.timeline.coveredCommands,5);
 assert.throws(()=>reconcileMovementTimeline(state,pending,1,move,[],{clock}),/ordering function/);
});

test('reconciliation without a clock keeps the caller-provided target tick and the wrong-round reset',()=>{
 const state=authority({movementTick:20}),pending=[command(6,21),command(7,22)],expected={...state};for(const c of pending)move(expected,c.input,INPUT_DT,[]);
 const result=reconcileMovementTimeline(state,pending,1,move,[],{...options,targetTick:22});
 assert.equal(result.timeline.strategy,'physical-time');assert.equal(result.timeline.predictedTick,22);for(const key of ['x','z','vx','vz'])assert.equal(result.player[key],expected[key]);
 const wrong=reconcileMovementTimeline({...state,playedRound:2},pending,1,move,[],{...options,clock:createMovementPredictionClock()});
 assert.equal(wrong.pending.length,0);assert.equal(wrong.timeline.replayedTicks,0);
 const earlier=authority({movementTick:9,movementAppliedTick:8}),history=[command(5,12),command(6,13),command(7,14)];
 const shifted=reconcileMovementTimeline(earlier,history,1,move,[],{...options,targetTick:14});
 assert.deepEqual(shifted.pending.map(c=>c.predictionTick),[9,10]);assert.equal(shifted.timeline.predictedTick,10);assert.equal(shifted.timeline.neutralTicks,0,'A stateless negative anchor shifts its target horizon too');
});

test('with transport delay local prediction matches the authority for held and changing input (regression: prediction switched off)',()=>{
 const script=tick=>tick<20?{yaw:circle(tick)}:tick<110?{f:1,yaw:circle(tick)}:tick<170?{s:1,yaw:circle(tick)}:{yaw:circle(tick)};
 for(const delay of [0,3,6]){
  const run=runPredictionLatency({ticks:240,script,uplink:tick=>tick+delay,downlink:delay});
  assert.ok(run.samples.length>220);
  assert.ok(Math.max(...run.samples.map(s=>s.error))<1e-9,'Predicted and authoritative poses must agree with '+delay+' ticks each way');
  const steady=run.timelines.slice(8);assert.ok(steady.every(t=>(t.coveredCommands||0)===0&&(t.neutralTicks||0)===0),'No pending sample is treated as already elapsed');
  if(delay)assert.ok(quantile(steady.map(t=>t.replayedTicks),.5)>=delay*2-1,'All in-flight samples are replayed');
  assert.ok(steady.every(t=>t.correction<1e-9),'No correction while the link is steady');
 }
});

test('labels follow a queue that became shorter instead of inserting idle steps on every reconciliation (regression: phantom neutral ticks)',()=>{
 // A 14 tick uplink burst deepens the authority queue, a jump edge is acknowledged at that depth, then a 20 tick outage shortens it.
 const script=tick=>tick<10?{yaw:Math.PI}:{f:1,yaw:circle(tick),jump:tick>=90&&tick<93};
 const run=runPredictionLatency({ticks:420,script,downlink:2,uplink:tick=>tick>=130&&tick<150?null:tick>=60&&tick<74?76:tick+2});
 const settled=run.timelines.filter(t=>t.tick>=220);assert.ok(settled.length>90);
 assert.ok(settled.every(t=>(t.neutralTicks||0)===0),'No idle step the authority never runs');
 assert.ok(settled.every(t=>Math.abs(t.speed/t.authoritySpeed-1)<.02),'Predicted speed matches the authority');
 assert.ok(settled.every(t=>t.correction<1e-6),'No recurring correction');
});

test('the authority retires redundant held input above the backlog limit with one physics step per tick and keeps every edge',()=>{
 const {g,t}=fixtureGame({world,weaponProfile:'cs2'}),held=patch=>({f:1,s:0,yaw:0,pitch:0,fire:false,jump:false,crouch:false,walk:false,use:false,...patch});
 const burst=Array.from({length:24},(_,i)=>({seq:i+1,round:g.round,input:held({jump:i===9||i===10,crouch:i>=16&&i<=18,s:i===21?1:0})}));
 assert.equal(g.inputBatch(t.id,burst.slice(0,24)),24);
 const applied=[];let jumps=0,previousJump=false,ticks=0;
 while(t.ackInputSeq<24&&ticks<40){const before=t.appliedInputCommands,tick=t.movementTick;g.step();ticks++;
  assert.equal(t.movementTick,tick+1,'Exactly one physics step per tick');assert.ok(t.appliedInputCommands-before<=1,'Never more than one simulated command per tick');
  assert.equal(t.ackInputSeq,t.appliedInputCommands+t.skippedInputCommands);
  if(t.appliedInputCommands>before){applied.push(t.lastAppliedInputSeq);assert.equal(t.movementAppliedTick,t.movementTick);if(t.jumpHeld&&!previousJump)jumps++;previousJump=t.jumpHeld;}
 }
 assert.equal(t.skippedInputCommands,7,'Only the redundant held samples of this burst are retired');assert.equal(ticks,24-7,'The burst drains faster than one command per tick');assert.equal(applied.length,17);
 for(const edge of [10,12,17,20,22,23])assert.ok(applied.includes(edge),'The first sample of every button or axis change is simulated: '+edge);
 assert.equal(jumps,1,'The jump press runs exactly once');assert.deepEqual(applied,[...applied].sort((a,b)=>a-b),'Order is preserved');
 // A queue at or below the limit is untouched.
 const shallow=fixtureGame({world,weaponProfile:'cs2'});shallow.g.inputBatch(shallow.t.id,Array.from({length:INPUT_BACKLOG_LIMIT+1},(_,i)=>({seq:i+1,round:shallow.g.round,input:held()})));
 for(let i=0;i<=INPUT_BACKLOG_LIMIT;i++)shallow.g.step();
 assert.equal(shallow.t.skippedInputCommands<=1,true);
 const exact=fixtureGame({world,weaponProfile:'cs2'});exact.g.inputBatch(exact.t.id,Array.from({length:INPUT_BACKLOG_LIMIT},(_,i)=>({seq:i+1,round:exact.g.round,input:held()})));
 for(let i=0;i<INPUT_BACKLOG_LIMIT;i++)exact.g.step();assert.equal(exact.t.skippedInputCommands,0);assert.equal(exact.t.appliedInputCommands,INPUT_BACKLOG_LIMIT);
});

test('a delivery interruption no longer becomes input delay for the rest of the life (regression: permanent backlog)',()=>{
 // 24 samples are withheld and then all delivered, as the reliable recovery lane does.
 const script=tick=>tick<10?{yaw:Math.PI}:{f:1,yaw:circle(tick),jump:tick===200};
 const run=runPredictionLatency({ticks:420,script,downlink:2,uplink:tick=>tick>=100&&tick<124?126:tick+2});
 const before=run.samples.filter(s=>s.tick>=60&&s.tick<95).map(s=>s.delay),after=run.samples.filter(s=>s.tick>=300).map(s=>s.delay);
 assert.ok(Math.max(...before)<=3);assert.ok(Math.max(...after)<=2+INPUT_BACKLOG_LIMIT,'Input delay returns to transport delay plus the bounded backlog: '+Math.max(...after));
 assert.ok(Math.max(...run.queueDepth.slice(100,130))>=20,'The interruption really queued a burst');assert.ok(Math.max(...run.queueDepth.slice(300))<=INPUT_BACKLOG_LIMIT);
 assert.ok(run.samples.some(s=>s.seq===201),'A later jump press is still simulated');
 const recovery=run.timelines.filter(t=>t.tick>=124&&t.tick<200);
 assert.ok(Math.max(...recovery.map(t=>t.correction))<.75,'The mirrored backlog rule avoids predicting the whole burst and stepping back per retired sample');
 assert.ok(run.timelines.filter(t=>t.tick>=220).every(t=>t.correction<1e-6));
 assert.ok(Math.max(...run.samples.filter(s=>s.tick>=300).map(s=>s.error))<1e-9);
});

test('the client mirror of the backlog rule marks without removing and never marks an edge',()=>{
 const held=command,pending=[held(6,21),held(7,22),held(8,23),held(9,24,{jump:true}),held(10,25,{jump:true}),held(11,26),held(12,27),held(13,28),held(14,29)];
 const marked=markRetiredBacklog(pending,{backlog:8,queuedSeqs:[6,7,8,9,10,11,12,13],limit:4,appliedInput:input({f:1}),same:sameHeldInput});
 assert.equal(marked.length,pending.length);assert.deepEqual(marked.map(c=>c.seq),pending.map(c=>c.seq));
 assert.deepEqual(marked.filter(c=>c.predictionRetired).map(c=>c.seq),[6],'Every simulated command also drains the finite known queue; in-flight14 is not queued');
 assert.equal(pending.some(c=>c.predictionRetired),false,'Input is not mutated');
 const again=markRetiredBacklog(marked,{backlog:4,limit:4,appliedInput:input({f:1}),same:sameHeldInput});assert.equal(again.some(c=>c.predictionRetired),false,'Marks are recomputed from the current depth');
 for(const bad of [{backlog:8,limit:4,same:sameHeldInput},{backlog:undefined,limit:4,appliedInput:input({f:1}),same:sameHeldInput},{backlog:8,limit:0,appliedInput:input({f:1}),same:sameHeldInput},{backlog:8,limit:4,appliedInput:input({f:1})}])assert.equal(markRetiredBacklog(pending,bad),pending);
 // A retired sample consumes no predicted step, and later samples run earlier.
 const state=authority({movementTick:20}),expected={...state};for(const c of marked)if(!c.predictionRetired)move(expected,c.input,INPUT_DT,[]);
 const result=replayMovementTimeline(state,marked,move,[],{dt:INPUT_DT,targetTick:29});
 assert.equal(result.timeline.retiredCommands,1);assert.equal(result.timeline.replayedTicks,8);assert.equal(result.timeline.neutralTicks,0);assert.equal(result.pending,marked);
 for(const key of ['x','y','z','vx','vy','vz'])assert.equal(result.player[key],expected[key],key);
});

test('applied tick and queue depth are private to the owning viewer and cannot be set by client input',()=>{
 const {g,t,ct}=fixtureGame({world,weaponProfile:'cs2'});
 g.inputBatch(t.id,[{seq:1,round:g.round,input:{f:1,movementAppliedTick:99,inputBacklog:99,movementTick:99}},{seq:2,round:g.round,input:{f:1}},{seq:3,round:g.round,input:{f:1}}]);g.step();
 const own=g.snapshot(t.id).players.find(p=>p.id===t.id),other=g.snapshot(ct.id).players.find(p=>p.id===t.id),spectator=g.snapshot().players.find(p=>p.id===t.id);
 assert.equal(own.lastAppliedInputSeq,1);assert.equal(own.movementAppliedTick,1);assert.equal(own.movementTick,1);assert.equal(own.inputBacklog,2);
 for(const key of ['movementAppliedTick','inputBacklog','movementTick','inputBacklogSeqs','inputBacklogProtected','inputBacklogAppliedInput'])assert.equal(Object.hasOwn(other,key),false,key+' must not leak to another player');
 assert.deepEqual(own.inputBacklogSeqs,[2,3]);assert.deepEqual(own.inputBacklogProtected,[]);assert.equal(own.inputBacklogAppliedInput.f,1);
 assert.equal(spectator.inputBacklog,2);
 g.step();g.step();g.step();assert.equal(t.movementAppliedTick,3,'An idle physics step does not move the applied pair');assert.equal(t.lastAppliedInputSeq,3);assert.equal(t.movementTick,4);
 g.begin();assert.equal(t.movementAppliedTick,0,'A new life starts without an anchor');
});

test('a queued action fence and a held automatic shot are never retired ahead of their combat',()=>{
 const {g,t,ct}=fixtureGame({world,weaponProfile:'cs2'});ct.hp=1000000;t.money=16000;g.buy(t.id,'ak47');g.equip(t.id,'ak47');t.nextAttackAt=0;
 const held=seq=>({seq,round:g.round,input:input({fire:true,yaw:0})});
 g.inputBatch(t.id,[held(1)]);g.step();
 const shots=()=>new Set(g.events.filter(e=>e.type==='shot'&&e.id===t.id).map(e=>e.shotId)).size;
 assert.equal(shots(),1);
 for(let i=0;i<12;i++)g.step();
 assert.equal(t.fireHeld,true,'An idle input gap preserves the real held trigger');
 g.inputBatch(t.id,Array.from({length:7},(_,i)=>held(i+2)));
 let switched=false;g.queueInputAction(t.id,{seq:2,round:g.round},allowed=>{assert.equal(allowed,true);switched=true;g.equip(t.id,'knife');});g.step();
 assert.equal(switched,true);assert.equal(t.lastAppliedInputSeq,2);assert.equal(t.skippedInputCommands,0);
 assert.equal(shots(),2,'The due held AK shot must execute before its Q fence');assert.equal(t.inventory.ak47.ammo,28);
});

test('an action fence and firing/use aim are meaningful history while pure movement may coalesce old look',()=>{
 const {g,t}=fixtureGame({world,weaponProfile:'cs2'});const held=(seq,yaw=0)=>({seq,round:g.round,input:input({f:1,yaw})});
 g.inputBatch(t.id,[held(1)]);g.step();g.inputBatch(t.id,Array.from({length:7},(_,i)=>held(i+2)));
 let appliedAtFence=null;g.queueInputAction(t.id,{seq:2,round:g.round},allowed=>{assert.equal(allowed,true);appliedAtFence=t.lastAppliedInputSeq;});g.step();
 assert.equal(appliedAtFence,2,'A plain movement sample that carries an action fence must run');
 for(const protectedButton of ['fire','use']){
  const f=fixtureGame({world,weaponProfile:'cs2'});f.g.inputBatch(f.t.id,[{seq:1,round:f.g.round,input:input({f:1,yaw:0,[protectedButton]:true})}]);f.g.step();
  f.g.inputBatch(f.t.id,Array.from({length:7},(_,i)=>({seq:i+2,round:f.g.round,input:input({f:1,yaw:(i+2)*.03,pitch:(i+2)*.001,[protectedButton]:true})})));
  const applied=[];while(f.t.ackInputSeq<8){f.g.step();applied.push(f.t.lastAppliedInputSeq);}
  assert.deepEqual(applied,[2,3,4,5,6,7,8]);assert.equal(f.t.skippedInputCommands,0,'Firing or use never loses an aim sample');
 }
});

test('a finite queued burst is mirrored exactly without pretending in-flight samples are queued',()=>{
 const {g,t}=fixtureGame({world,weaponProfile:'cs2'}),held=seq=>({seq,round:g.round,input:input({f:1,yaw:0})});
 g.inputBatch(t.id,[held(1)]);g.step();g.inputBatch(t.id,Array.from({length:8},(_,i)=>held(i+2)));
 const state=g.snapshot(t.id).players.find(p=>p.id===t.id),pending=Array.from({length:10},(_,i)=>({seq:i+2,round:g.round,predictionTick:i+2,input:input({f:1,yaw:0})}));
 const marked=markRetiredBacklog(pending,{backlog:state.inputBacklog,queuedSeqs:state.inputBacklogSeqs,protectedSeqs:state.inputBacklogProtected,limit:4,appliedInput:input({f:1,yaw:0}),same:sameHeldInput});
 const skipped=[];while(t.ackInputSeq<9){const before=t.ackInputSeq;g.step();if(t.skippedInputCommands)for(let seq=before+1;seq<t.lastAppliedInputSeq;seq++)skipped.push(seq);}
 assert.deepEqual(marked.filter(p=>p.predictionRetired).map(p=>p.seq),skipped);
 assert.deepEqual(skipped,[2,4]);assert.ok(marked.filter(p=>p.seq>9).every(p=>!p.predictionRetired),'In-flight10/11 are not server-queued evidence');
 const noProof=markRetiredBacklog(pending,{backlog:8,limit:4,appliedInput:input({f:1}),same:sameHeldInput});assert.equal(noProof.some(p=>p.predictionRetired),false,'A depth alone never invents a queued prefix');
 const unknownPrefix=markRetiredBacklog(pending,{backlog:8,queuedSeqs:[3,4,5,6,7,8,9,10],limit:4,appliedInput:input({f:1}),same:sameHeldInput});assert.equal(unknownPrefix.some(p=>p.predictionRetired),false,'A command still in flight before the known queue prevents guessing its schedule');
 const fenced=markRetiredBacklog(pending,{backlog:8,queuedSeqs:[2,3,4,5,6,7,8,9],protectedSeqs:[2],limit:4,appliedInput:input({f:1}),same:sameHeldInput});assert.equal(fenced[0].predictionRetired,undefined,'Owner action fences are also protected in the prediction mirror');
});

test('a trusted applied pair wins over the older seq-gap edge and both clock horizons stay coherent',()=>{
 const state=authority({movementTick:23,movementAppliedTick:23,lastAppliedInputSeq:10,ackInputSeq:10,movementEdgeSeq:5,movementEdgeTick:20,walk:true});
 const commands=Array.from({length:8},(_,i)=>command(i+5,i+20,{walk:true})),clock=createMovementPredictionClock();clock.reset(authority());clock.raise(27);
 const result=reconcileMovementTimeline(state,commands,1,move,[],{...options,clock});
 assert.equal(result.timeline.neutralTicks,0);assert.deepEqual(result.pending.map(c=>c.predictionTick),[24,25]);assert.equal(clock.tick,result.player.movementTick);
 const queued=authority({inputBacklog:8,inputBacklogSeqs:[6,7,8,9,10,11,12,13],inputBacklogProtected:[],inputBacklogAppliedInput:input({f:1})}),nextClock=createMovementPredictionClock();nextClock.reset(queued);
 const samples=[command(5,20),...Array.from({length:8},(_,i)=>command(i+6,nextClock.next()))];
 const r=reconcileMovementTimeline(queued,samples,1,move,[],{...options,clock:nextClock});
 assert.ok(r.timeline.retiredCommands>0);assert.equal(nextClock.tick,r.player.movementTick,'A75Hz frame without a physical sample still reports its actual pose tick');
 const lastLabel=r.pending.at(-1).predictionTick,newLabel=nextClock.next();assert.ok(newLabel>lastLabel,'The next immutable command label stays strictly ordered');assert.equal(nextClock.tick,r.player.movementTick+1,'One new movement sample advances exactly one physical tick');
});

test('owner queue evidence has true 128-sample and 16-fence bounds without leaking input extensions',()=>{
 const {g,t,ct}=fixtureGame({world,weaponProfile:'cs2'});
 g.inputBatch(t.id,[{seq:1,round:g.round,input:input({f:1,extra:'must not appear in applied intent'})}]);g.step();
 // A mature legal sequence window exercises maximum-width wire integers
 // without needing to simulate billions of prior ticks.
 const base=MAX_INPUT_SEQUENCE-MAX_INPUT_QUEUE;t.ackInputSeq=base;t.lastAppliedInputSeq=base;t.lastInputSeq=base;
 for(let offset=0;offset<MAX_INPUT_QUEUE;offset+=32)assert.equal(g.inputBatch(t.id,Array.from({length:32},(_,i)=>({seq:base+offset+i+1,round:g.round,input:input({f:1})}))),32);
 for(let i=1;i<=WEAPON_ACTION_LIMIT;i++)g.queueInputAction(t.id,{seq:base+i,round:g.round},()=>{});
 assert.throws(()=>g.queueInputAction(t.id,{seq:base+17,round:g.round},()=>{}),/queue full/);
 const own=g.snapshot(t.id).players.find(p=>p.id===t.id),other=g.snapshot(ct.id).players.find(p=>p.id===t.id);
 assert.equal(own.inputBacklog,128);assert.equal(own.inputBacklogSeqs.length,128);assert.equal(own.inputBacklogSeqs.at(-1),MAX_INPUT_SEQUENCE);assert.equal(own.inputBacklogProtected.length,16);
 assert.deepEqual(Object.keys(own.inputBacklogAppliedInput).sort(),Object.keys(world.movement.blankInput()).sort());
 const bytes=Buffer.byteLength(JSON.stringify({inputBacklog:own.inputBacklog,inputBacklogSeqs:own.inputBacklogSeqs,inputBacklogProtected:own.inputBacklogProtected,inputBacklogAppliedInput:own.inputBacklogAppliedInput}));
 assert.ok(bytes<2048,'Even maximum-width evidence stays below2KiB per owner snapshot: '+bytes);
 for(const key of ['inputBacklogSeqs','inputBacklogProtected','inputBacklogAppliedInput'])assert.equal(Object.hasOwn(other,key),false);
 const overflow={seq:MAX_INPUT_SEQUENCE+1,round:g.round,input:input({f:1})};assert.equal(g.inputBatch(t.id,[overflow]),0);
});
