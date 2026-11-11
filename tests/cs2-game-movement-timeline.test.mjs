import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtureGame,fixtureWorld} from './cs2-game-fixture.mjs';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';

function observedGame(){
 const source=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),calls=new Map();
 const world={...source,movement:{...source.movement,movePlayer(p,...args){calls.set(p.id,(calls.get(p.id)||0)+1);return source.movement.movePlayer(p,...args);}}};
 return {...fixtureGame({world,weaponProfile:'cs2'}),calls};
}
const command=(g,seq,input={})=>({seq,round:g.round,input:{f:1,s:0,yaw:0,pitch:0,...input}});

test('CS2 movement clock counts actual physics calls, including unnumbered airborne neutral steps',()=>{
 const {g,t,ct,calls}=observedGame();
 assert.equal(t.movementTick,0);assert.equal(t.movementTimelineVersion,1);
 Object.assign(t,{x:-15,y:3,z:12,grounded:false,vx:2,vy:0,vz:0});
 assert.equal(g.inputBatch(t.id,[command(g,1)]),1);g.step();
 assert.equal(t.ackInputSeq,1);assert.equal(t.appliedInputCommands,1);
 const y=t.y,vy=t.vy;
 g.step();
 assert.equal(t.ackInputSeq,1,'A physics-only step must not acknowledge a command or weapon barrier');
 assert.equal(t.lastAppliedInputSeq,1);assert.equal(t.appliedInputCommands,1);
 assert.ok(t.y<y);assert.ok(t.vy<vy,'Authoritative gravity must keep advancing in an input gap');
 assert.equal(t.movementTick,2);assert.equal(t.movementTick,calls.get(t.id));
 assert.equal(ct.movementTick,2);assert.equal(ct.movementTick,calls.get(ct.id));
 assert.equal(g.inputBatch(t.id,[command(g,2)]),1);g.step();
 assert.equal(t.ackInputSeq,2);assert.equal(t.appliedInputCommands,2);
 assert.equal(t.movementTick,3);assert.equal(t.movementTick,calls.get(t.id));
});

test('CS2 movement clock does not advance in countdown, after death, or on snapshot reads',()=>{
 const {g,t,ct,calls}=observedGame();
 g.phase='countdown';g.endAt=g.time+3;g.step();
 assert.equal(t.movementTick,0);assert.equal(ct.movementTick,0);assert.equal(calls.size,0);
 g.phase='live';t.alive=false;g.step();
 assert.equal(t.movementTick,0);assert.equal(calls.has(t.id),false);
 assert.equal(ct.movementTick,1);assert.equal(calls.get(ct.id),1);
 g.snapshot(t.id);g.snapshot(ct.id);g.snapshot();
 assert.equal(t.movementTick,0);assert.equal(ct.movementTick,1);
});

test('CS2 round spawn reanchors the movement clock without reusing the global server tick',()=>{
 const {g,t,ct}=observedGame();
 g.step();g.step();assert.equal(t.movementTick,2);assert.equal(ct.movementTick,2);
 const serverTick=g.serverTick,round=g.round;g.begin();
 assert.equal(g.round,round+1);assert.equal(g.serverTick,serverTick);
 for(const p of [t,ct]){assert.equal(p.movementTick,0);assert.equal(p.movementTimelineVersion,1);assert.equal(p.movementEdgeSeq,0);assert.equal(p.movementEdgeTick,0);assert.equal(p.ackInputSeq,0);}
 g.phase='live';g.endAt=g.time+10;g.step();
 assert.equal(t.movementTick,1);assert.equal(ct.movementTick,1);
});

test('CS2 menu cancellation keeps ACK cancellation and physics advancement as separate clocks',()=>{
 const {g,t,calls}=observedGame();
 assert.equal(g.inputBatch(t.id,[command(g,1),command(g,2),command(g,3)]),3);
 g.input(t.id,{round:g.round,cancelThroughSeq:3,f:0,s:0,yaw:0,pitch:0});
 assert.equal(t.ackInputSeq,0);assert.equal(t.movementTick,0);
 g.step();
 assert.equal(t.ackInputSeq,3);assert.equal(t.skippedInputCommands,3);assert.equal(t.appliedInputCommands,0);
 assert.equal(t.movementTick,1);assert.equal(calls.get(t.id),1);
});

test('CS2 movement timeline metadata is private to the snapshot viewer',()=>{
 const {g,t,ct}=observedGame();g.step();
 for(const viewer of [t,ct]){
  const snapshot=g.snapshot(viewer.id),own=snapshot.players.find(p=>p.id===viewer.id),remote=snapshot.players.find(p=>p.id!==viewer.id);
  assert.equal(own.movementTick,1);assert.equal(own.movementTimelineVersion,1);assert.equal(own.movementEdgeSeq,0);assert.equal(own.movementEdgeTick,0);
  for(const key of ['movementTick','movementTimelineVersion','movementEdgeSeq','movementEdgeTick'])assert.equal(Object.hasOwn(remote,key),false);
 }
 for(const p of g.snapshot('unknown-viewer').players)for(const key of ['movementTick','movementTimelineVersion','movementEdgeSeq','movementEdgeTick'])assert.equal(Object.hasOwn(p,key),false);
 for(const p of g.snapshot().players){assert.equal(p.movementTick,1);assert.equal(p.movementTimelineVersion,1);assert.equal(p.movementEdgeSeq,0);assert.equal(p.movementEdgeTick,0);}
 assert.equal(t.movementTick,1);assert.equal(ct.movementTick,1);
});

test('CS2 movement timeline cannot be advanced or versioned by client input metadata',()=>{
 const {g,t}=observedGame();
 const forged={...command(g,1),movementTick:100000,movementTimelineVersion:99,movementEdgeSeq:100000,movementEdgeTick:100000};
 forged.input={...forged.input,movementTick:100000,movementTimelineVersion:99,movementEdgeSeq:100000,movementEdgeTick:100000};
 assert.equal(g.inputBatch(t.id,[forged]),1);g.step();
 assert.equal(t.movementTick,1);assert.equal(t.movementTimelineVersion,1);assert.equal(t.movementEdgeSeq,0);assert.equal(t.movementEdgeTick,0);
 assert.equal(t.ackInputSeq,1);
 g.input(t.id,{round:g.round,f:0,s:0,movementTick:200000,movementTimelineVersion:98,movementEdgeSeq:200000,movementEdgeTick:200000});g.step();
 assert.equal(t.movementTick,2);assert.equal(t.movementTimelineVersion,1);assert.equal(t.movementEdgeSeq,0);assert.equal(t.movementEdgeTick,0);
});

test('CS2 real jump edges publish their consumed command and physical tick while neutral steps do not',()=>{
 const {g,t}=observedGame();
 g.step();assert.equal(t.movementTick,1);assert.equal(t.movementEdgeSeq,0);
 g.inputBatch(t.id,[command(g,1,{f:0,jump:true})]);g.step();
 assert.equal(t.grounded,false);assert.equal(t.jumpHeld,true);assert.equal(t.movementEdgeSeq,1);assert.equal(t.movementEdgeTick,2);
 g.step();assert.equal(t.jumpHeld,true);assert.equal(t.movementTick,3);assert.equal(t.movementEdgeSeq,1);assert.equal(t.movementEdgeTick,2);
 g.inputBatch(t.id,[command(g,2,{f:0,jump:true})]);g.step();
 assert.equal(t.movementEdgeSeq,1);assert.equal(t.movementEdgeTick,2,'A repeated held jump must not invent another edge');
 g.inputBatch(t.id,[command(g,3,{f:0,jump:false})]);g.step();
 assert.equal(t.jumpHeld,false);assert.equal(t.movementEdgeSeq,3);assert.equal(t.movementEdgeTick,5);
 g.step();assert.equal(t.movementEdgeSeq,3);assert.equal(t.movementEdgeTick,5);
});

test('CS2 real stance and walk changes anchor movement without counting idle releases as command edges',()=>{
 const {g,t}=observedGame();
 for(const [seq,input]of [[1,{f:0,crouch:true}],[2,{f:0,crouch:false}],[3,{f:0,walk:true}]]){
  g.inputBatch(t.id,[command(g,seq,input)]);g.step();
  assert.equal(t.movementEdgeSeq,seq);assert.equal(t.movementEdgeTick,t.movementTick);
 }
 const tick=t.movementEdgeTick;g.step();assert.equal(t.walk,false);assert.equal(t.movementEdgeSeq,3);assert.equal(t.movementEdgeTick,tick);
 g.inputBatch(t.id,[command(g,4,{f:0,walk:true})]);g.step();
 assert.equal(t.walk,true);assert.equal(t.movementEdgeSeq,4);assert.equal(t.movementEdgeTick,t.movementTick);
 g.begin();assert.equal(t.movementEdgeSeq,0);assert.equal(t.movementEdgeTick,0);
});

test('CS2 unsequenced legacy movement cannot manufacture a numbered movement edge',()=>{
 const {g,t}=observedGame();g.input(t.id,{jump:true,f:0,s:0,yaw:0,pitch:0});g.step();
 assert.equal(t.grounded,false);assert.equal(t.jumpHeld,true);assert.equal(t.movementTick,1);
 assert.equal(t.movementEdgeSeq,0);assert.equal(t.movementEdgeTick,0);assert.equal(t.ackInputSeq,0);
});
