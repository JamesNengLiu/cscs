import test from 'node:test';
import assert from 'node:assert/strict';
import {createMovementPredictionClock,authoritativeMovementTick,restorePredictionTicks,replayMovementTimeline,alignAcknowledgedMovementEdge,MAX_MOVEMENT_REPLAY_TICKS} from '../public/cs2-movement-timeline.js';
import {orderedInputCommands,buildInputBatch} from '../public/cs2-input-protocol.js';
import {fixtureWorld,fixtureGame} from './cs2-game-fixture.mjs';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';

const DT=1/60;
const world=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE});
const input=(patch={})=>({...world.movement.blankInput(),...patch});
const player=(patch={})=>({id:'timeline',alive:true,weapon:'knife',x:0,y:5,z:0,vx:2,vy:3,vz:-3,yaw:0,pitch:0,grounded:false,jumpHeld:false,jumpFatigue:0,duckAmount:0,duckElapsed:0,ducking:false,crouch:false,velocityModifier:1,hitSlowdownVersion:1,collisionVersion:1,jumpFatigueVersion:1,movementTimelineVersion:1,movementTick:10,...patch});
const command=(seq,predictionTick,patch={})=>({seq,round:1,predictionTick,input:input(patch)});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const motion=p=>Object.fromEntries(['x','y','z','vx','vy','vz','grounded','jumpHeld','jumpFatigue','duckAmount','duckElapsed','crouch'].map(key=>[key,p[key]]));

test('CS2 private movement clock reanchors on spawn/menu and remains compatible with older servers',()=>{
 const clock=createMovementPredictionClock();assert.equal(clock.next(),null);
 clock.reset(player());assert.equal(clock.next(),11);assert.equal(clock.next(),12);
 assert.equal(clock.observe(player({movementTick:11})),12,'Late authority must not move local time backwards');
 assert.equal(clock.observe(player({movementTick:20})),20);assert.equal(clock.next(),21);
 clock.reset(player({movementTick:0}));assert.equal(clock.next(),1);
 clock.reset({});assert.equal(clock.next(),null);
 for(const value of [-1,NaN,Infinity,1.5,'2'])assert.equal(authoritativeMovementTick(player({movementTick:value})),null);
 assert.equal(authoritativeMovementTick(player({movementTimelineVersion:99})),null);
});

test('CS2 pending samples retain private tick identity after ordering, without changing wire or action payloads',()=>{
 const raw=[command(2,12,{fire:true}),command(1,11),command(2,99),{...command(1,900),round:0}];
 const ordered=restorePredictionTicks(orderedInputCommands(raw,1),raw);
 assert.deepEqual(ordered.map(c=>[c.seq,c.predictionTick]),[[1,11],[2,12]]);
 const wire=buildInputBatch(ordered,1);assert.deepEqual(wire,buildInputBatch(raw,1));
 assert.ok(wire.commands.every(c=>!Object.hasOwn(c,'predictionTick')));
 assert.equal(wire.commands[1].fire,true);
 const sameSeq=[{...command(1,800),round:0},command(1,11)];
 assert.equal(restorePredictionTicks(orderedInputCommands(sameSeq,1),sameSeq)[0].predictionTick,11);
});

test('CS2 an authority idle physics step covers time without acknowledging or losing a pending shot',()=>{
 const before=player(),c=command(1,11,{fire:true}),predicted={...before},authority={...before,ackInputSeq:0};
 world.movement.movePlayer(predicted,c.input,DT,[]);
 world.movement.movePlayer(authority,input(),DT,[]);authority.movementTick=11;
 const old={...authority};world.movement.movePlayer(old,c.input,DT,[]);assert.ok(distance(old,predicted)>.04,'The old replay really repeats gravity/velocity time');
 const result=replayMovementTimeline(authority,[c],world.movement.movePlayer,[],{targetTick:11});
 assert.deepEqual(motion(result.player),motion(predicted));
 assert.equal(result.timeline.replayedTicks,0);assert.equal(result.timeline.coveredCommands,1);
 assert.equal(result.pending[0],c,'Physics coverage must not delete the shot command or advance its ACK');
 assert.equal(result.player.ackInputSeq,0);assert.equal(buildInputBatch(result.pending,1).commands[0].fire,true);
});

test('CS2 no-gap movement and jump/stance traces remain bit-for-bit identical',()=>{
 const authority=player({y:.0005,grounded:true,vx:0,vy:0,vz:0,movementTick:0}),expected={...authority},commands=[];
 for(let n=1;n<=120;n++){
  const c=command(n,n,{f:n<90?1:0,s:n%40<20?1:-1,yaw:n*.021,jump:n===12||n===78,crouch:n>=45&&n<=60,walk:n>95});
  commands.push(c);world.movement.movePlayer(expected,c.input,DT,[]);
 }
 const result=replayMovementTimeline(authority,commands,world.movement.movePlayer,[],{targetTick:120});
 assert.deepEqual(motion(result.player),motion(expected));assert.equal(result.timeline.replayedTicks,120);assert.equal(result.timeline.neutralTicks,0);
});

test('CS2 replay consumes one physical step per future slot and fills missing slots without manufacturing a jump edge',()=>{
 const authority=player({jumpHeld:true,movementTick:10}),pending=[command(1,12,{jump:true})],seen=[];
 const result=replayMovementTimeline(authority,pending,(p,i,dt)=>{seen.push({input:{...i},dt,jumpHeld:p.jumpHeld});world.movement.movePlayer(p,i,dt,[]);},[],{targetTick:12});
 assert.equal(seen.length,2);assert.equal(seen[0].input.jump,false);assert.equal(seen[1].jumpHeld,true);
 assert.equal(result.timeline.neutralTicks,1);assert.equal(result.player.movementTick,12);
});

test('CS2 unknown/malformed private ticks fall back to existing ordered prediction, never to network-provided time',()=>{
 for(const commands of [[{seq:1,round:1,input:input({f:1})}],[command(1,12),command(2,11)],[command(1,11),command(2,11)]]){
  const authority=player(),expected={...authority};for(const c of commands)world.movement.movePlayer(expected,c.input,DT,[]);
  const result=replayMovementTimeline(authority,commands,world.movement.movePlayer);
  assert.deepEqual(motion(result.player),motion(expected));assert.equal(result.timeline.version,0);
 }
 const authority=player({movementTimelineVersion:undefined}),c=command(1,11),expected={...authority};world.movement.movePlayer(expected,c.input,DT,[]);
 assert.deepEqual(motion(replayMovementTimeline(authority,[c],world.movement.movePlayer).player),motion(expected));
});

test('CS2 replay horizon remains bounded when private history is stale or corrupt',()=>{
 const authority=player(),c=command(1,Number.MAX_SAFE_INTEGER);let steps=0;
 const result=replayMovementTimeline(authority,[c],()=>steps++,[],{targetTick:Number.MAX_SAFE_INTEGER});
 assert.equal(steps,MAX_MOVEMENT_REPLAY_TICKS);assert.equal(result.timeline.bounded,true);
 assert.equal(result.pending[0],c);
});

test('CS2 future sampling still uses current controls after an idle reconciliation instead of accumulating old-input delay',()=>{
 const clock=createMovementPredictionClock(),initial=player(),c=command(1,11),authority={...initial};clock.reset(initial);assert.equal(clock.next(),11);
 world.movement.movePlayer(authority,input(),DT,[]);authority.movementTick=11;
 clock.observe(authority);const result=replayMovementTimeline(authority,[c],world.movement.movePlayer,[],{targetTick:clock.tick});
 const immediate=command(2,clock.next(),{f:1,s:-1,yaw:.4}),expected={...authority};world.movement.movePlayer(result.player,immediate.input,DT,[]);world.movement.movePlayer(expected,immediate.input,DT,[]);
 assert.equal(immediate.predictionTick,12);assert.deepEqual(motion(result.player),motion(expected));
 assert.equal(result.pending.length,1,'Older commands stay available for weapon ordering, without delaying fresh local movement');
});

for(const [name,patch,authorityPatch]of [
 ['jump press',{jump:true},{y:.0005,grounded:true,vx:0,vy:0,vz:0,jumpHeld:false}],
 ['wheel release',{jump:false},{y:1,grounded:false,jumpHeld:true}],
 ['crouch press',{crouch:true},{y:.0005,grounded:true,ducking:false}],
 ['stand release',{crouch:false},{y:.0005,grounded:true,crouch:true,ducking:false,duckAmount:1}],
 ['walk press',{walk:true},{walk:false}],
])test(`CS2 an unacknowledged ${name} survives an already elapsed authority slot`,()=>{
 const authority=player({...authorityPatch,movementTick:11}),c=command(1,11,patch),expected={...authority};
 world.movement.movePlayer(expected,c.input,DT,[]);
 const actual=replayMovementTimeline(authority,[c],world.movement.movePlayer,[],{targetTick:11});
 assert.equal(actual.timeline.strategy,'edge-replay');assert.deepEqual(motion(actual.player),motion(expected));assert.equal(actual.pending[0].seq,c.seq);assert.equal(actual.pending[0].input,c.input);
 if(name==='jump press'){assert.equal(actual.player.grounded,false);assert.ok(actual.player.vy>0);}
 if(name==='wheel release')assert.equal(actual.player.jumpHeld,false);
});

test('CS2 a fully completed real crouch retains its held state and predicts a covered stand release',()=>{
 const authority=player({y:.0005,grounded:true,vx:0,vy:0,vz:0,movementTick:11});
 for(let n=0;n<30;n++)world.movement.movePlayer(authority,input({crouch:true}),DT,[]);
 assert.equal(authority.crouch,true);assert.equal(authority.ducking,false);
 const held=replayMovementTimeline(authority,[command(1,11,{crouch:true})],world.movement.movePlayer,[],{targetTick:11});
 assert.equal(held.timeline.strategy,'physical-time');assert.equal(held.player.crouch,true);
 const release=replayMovementTimeline(authority,[command(1,11,{crouch:false})],world.movement.movePlayer,[],{targetTick:11});
 assert.equal(release.timeline.strategy,'edge-replay');assert.equal(release.player.crouch,false);assert.equal(release.player.duckAmount,0);
});

test('CS2 a delayed wheel press/release is not cancelled or applied twice after real ACKs arrive',()=>{
 const {g,t,world:w}=fixtureGame({world:fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),weaponProfile:'cs2'});
 const press={seq:1,round:g.round,predictionTick:1,input:input({jump:true})},release={seq:2,round:g.round,predictionTick:2,input:input()};
 const before={...t},predicted={...before};w.movement.movePlayer(predicted,press.input,DT,[]);g.step();
 let result=replayMovementTimeline({...t},[press],w.movement.movePlayer,[],{targetTick:1});
 assert.deepEqual(motion(result.player),motion(predicted));assert.equal(result.player.grounded,false);
 g.inputBatch(t.id,[press]);g.step();
 const expected={...t};w.movement.movePlayer(expected,release.input,DT,[]);
 result=replayMovementTimeline({...t},[release],w.movement.movePlayer,[],{targetTick:2});
 assert.deepEqual(motion(result.player),motion(expected));assert.equal(result.player.jumpHeld,false);
 const fatigue=result.player.jumpFatigue;
 g.inputBatch(t.id,[release]);g.step();result=replayMovementTimeline({...t},[],w.movement.movePlayer,[],{targetTick:t.movementTick});
 assert.equal(result.player.jumpHeld,false);assert.equal(result.player.grounded,false);assert.ok(result.player.jumpFatigue<=fatigue+1e-9,'Real ACK must not start a second jump/fatigue cycle');
});

test('CS2 edge protection exits without discarding the next airborne sample or accumulating tick offset',()=>{
 const {g,t,world:w}=fixtureGame({world:fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),weaponProfile:'cs2'}),clock=createMovementPredictionClock();
 clock.reset(t);
 let commands=[],local={...t};
 const sample=jump=>{const c={seq:commands.length+1,round:g.round,predictionTick:clock.next(),input:input({jump})};w.movement.movePlayer(local,c.input,DT,[]);commands.push(c);return c;};
 const press=sample(true);g.step();
 let result=replayMovementTimeline({...t},commands,w.movement.movePlayer,[],{targetTick:clock.observe(t)});local=result.player;commands=result.pending;clock.observe(local);
 assert.equal(commands[0].predictionTick,2);assert.equal(clock.tick,2);
 const repeated=replayMovementTimeline({...t},commands,w.movement.movePlayer,[],{targetTick:clock.tick});
 assert.equal(repeated.player.movementTick,2);assert.deepEqual(motion(repeated.player),motion(local),'Duplicate authority cannot add another phase shift');
 const release=sample(false);g.inputBatch(t.id,[press]);g.step();
 result=replayMovementTimeline({...t},commands.filter(c=>c.seq>t.ackInputSeq),w.movement.movePlayer,[],{targetTick:clock.observe(t)});local=result.player;commands=result.pending;clock.observe(local);
 const next={seq:3,round:g.round,predictionTick:clock.next(),input:input()};w.movement.movePlayer(local,next.input,DT,[]);commands.push(next);const prior={...local};
 g.inputBatch(t.id,[release]);g.step();
 result=replayMovementTimeline({...t},commands.filter(c=>c.seq>t.ackInputSeq),w.movement.movePlayer,[],{targetTick:clock.observe(t)});
 assert.equal(result.timeline.strategy,'physical-time');assert.deepEqual(motion(result.player),motion(prior));assert.equal(result.pending[0].seq,3);
});

test('CS2 the first snapshot can already ACK a late jump without erasing its following held sample',()=>{
 const authority=player({y:.0005,grounded:true,vx:0,vy:0,vz:0,movementTick:3,ackInputSeq:2,movementEdgeSeq:2,movementEdgeTick:4});
 world.movement.movePlayer(authority,input({jump:true}),DT,[]);authority.movementTick=4;
 const sampled=[command(2,3,{jump:true}),command(3,4,{jump:true})],prior={...authority};world.movement.movePlayer(prior,sampled[1].input,DT,[]);
 const unaligned=replayMovementTimeline(authority,[sampled[1]],world.movement.movePlayer,[],{targetTick:4});
 assert.ok(distance(unaligned.player,prior)>.1,'The unanchored same-level case must reproduce the original regression');
 const aligned=alignAcknowledgedMovementEdge(authority,sampled,1),pending=restorePredictionTicks(orderedInputCommands(aligned,1,2),aligned),clock=createMovementPredictionClock();clock.reset(authority);
 const result=replayMovementTimeline(authority,pending,world.movement.movePlayer,[],{targetTick:clock.tick});clock.observe(result.player);
 assert.deepEqual(motion(result.player),motion(prior));assert.equal(result.pending[0].predictionTick,5);assert.equal(clock.next(),6);
 assert.deepEqual(alignAcknowledgedMovementEdge(authority,aligned,1),aligned,'A repeated edge anchor must be idempotent');
 assert.deepEqual(buildInputBatch(aligned,1),buildInputBatch(sampled,1),'Retiming must not rewrite wire input/shot ordering');
});

test('CS2 edge anchors cannot cross rounds, come from future ACKs, or rewind already established private labels',()=>{
 const samples=[command(1,11),command(2,12)],authority=player({movementTick:12,ackInputSeq:1,movementEdgeSeq:1,movementEdgeTick:12});
 assert.equal(alignAcknowledgedMovementEdge(authority,samples,2),samples);
 assert.equal(alignAcknowledgedMovementEdge({...authority,ackInputSeq:0},samples,1),samples);
 assert.equal(alignAcknowledgedMovementEdge({...authority,movementEdgeTick:13},samples,1),samples);
 const future=[command(1,20),command(2,21)];assert.deepEqual(alignAcknowledgedMovementEdge(authority,future,1),future);
});

test('CS2 late AWP shot remains behind its real input barrier when physics has advanced during a gap',()=>{
 const {g,t,ct,world:w}=fixtureGame({world:fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),weaponProfile:'cs2'});
 ct.hp=1000;
 t.money=16000;g.buy(t.id,'awp');g.equip(t.id,'knife');g.equip(t.id,'awp');t.nextAttackAt=0;t.nextShotAt=0;t.zoom=40;
 const ammo=t.ammo,actions=[];g.inputBatch(t.id,[{seq:1,round:g.round,input:input()}]);g.step();g.step();
 assert.equal(t.ackInputSeq,1);assert.equal(t.movementTick,2);
 const fire={seq:2,round:g.round,predictionTick:2,input:input({fire:true})};
 const predicted=replayMovementTimeline({...t},[fire],w.movement.movePlayer,[],{targetTick:2});
 assert.equal(predicted.pending.length,1);assert.equal(predicted.timeline.replayedTicks,0);
 g.queueInputAction(t.id,{seq:2,round:g.round},valid=>{actions.push(valid);g.equip(t.id,'knife');});
 g.step();assert.equal(t.weapon,'awp');assert.equal(actions.length,0);assert.equal(t.ammo,ammo);
 g.inputBatch(t.id,buildInputBatch(predicted.pending,g.round,t.ackInputSeq).commands);g.step();
 const shots=g.events.filter(e=>e.type==='shot'&&e.id===t.id&&e.weapon==='awp');
 assert.equal(new Set(shots.map(e=>e.shotId)).size,1,'Penetration segments retain the same single shot identity');
 assert.equal(t.inventory.awp.ammo,ammo-1);assert.ok(ct.hp<1000);assert.equal(t.weapon,'knife');assert.deepEqual(actions,[true]);
});
