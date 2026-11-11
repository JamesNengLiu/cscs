// Deterministic, tick-driven client/authority pair on the real game kernel and
// the real reconciliation code. No sockets, timers or browser APIs.
// Mirrors the sampling and reconcile order of public/cs2-client.js.
import {fixtureGame,fixtureWorld} from '../cs2-game-fixture.mjs';
import {CS2_MOVEMENT_PROFILE} from '../../public/cs2-movement-profile.js';
import {createMovementPredictionClock,reconcileMovementTimeline} from '../../public/cs2-movement-timeline.js';
import {orderedInputCommands,buildInputBatch,MAX_INPUT_QUEUE,INPUT_BACKLOG_LIMIT,sameHeldInput,INPUT_DT} from '../../public/cs2-input-protocol.js';

// uplink(tick) returns the arrival tick of a batch sent at `tick`, or null when it is lost.
export function runPredictionLatency({ticks=240,script,uplink=tick=>tick+3,downlink=3,snapshotEvery=2}={}){
 const world=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),{g,t}=fixtureGame({world,weaponProfile:'cs2'}),move=world.movement.movePlayer;
 const snapshot=()=>{const s=g.snapshot(t.id);return JSON.parse(JSON.stringify({round:s.round,me:s.players.find(p=>p.id===t.id),players:s.players}));};
 const clock=createMovementPredictionClock();let local=snapshot().me,pending=[],seq=0,lastApplied=0;clock.reset(local);
 const toServer=[],toClient=[],truth=new Map(),predicted=new Map(),timelines=[],queueDepth=[];
 for(let tick=0;tick<ticks;tick++){
  while(toClient.length&&toClient[0].at<=tick){
   const m=toClient.shift().m,before=local;
   const result=reconcileMovementTimeline(m.me,pending,m.round,move,m.players,{clock,dt:INPUT_DT,maxPending:MAX_INPUT_QUEUE,order:orderedInputCommands,backlogLimit:INPUT_BACKLOG_LIMIT,sameInput:sameHeldInput});
   clock.observe(result.player);
   timelines.push({tick,...result.timeline,pending:result.pending.length,correction:Math.hypot(before.x-result.player.x,before.y-result.player.y,before.z-result.player.z),speed:Math.hypot(result.player.vx,result.player.vz),authoritySpeed:Math.hypot(m.me.vx,m.me.vz)});
   local=result.player;pending=result.pending;
  }
  const command={seq:++seq,round:g.round,input:{...world.movement.blankInput(),...script(tick)}},label=clock.next();
  if(label!==null)command.predictionTick=label;
  move(local,command.input,INPUT_DT,[]);if(label!==null)local.movementTick=clock.tick;pending.push(command);
  predicted.set(seq,{x:local.x,y:local.y,z:local.z,tick});
  const at=uplink(tick);if(at!==null)toServer.push({at,commands:buildInputBatch(pending,g.round,0).commands});
  toServer.sort((a,b)=>a.at-b.at);while(toServer.length&&toServer[0].at<=tick)g.inputBatch(t.id,toServer.shift().commands);
  g.step();const stateNow=snapshot();queueDepth.push(stateNow.me.inputBacklog);
  if(t.lastAppliedInputSeq!==lastApplied){lastApplied=t.lastAppliedInputSeq;truth.set(lastApplied,{x:t.x,y:t.y,z:t.z,tick});}
  if(tick%snapshotEvery===0)toClient.push({at:tick+downlink,m:stateNow});
 }
 // Error of sample n: the client's pose right after sampling it against the
 // authority's pose right after really executing it. delay is in ticks.
 const samples=[];for(const [n,p] of predicted){const s=truth.get(n);if(s)samples.push({seq:n,tick:p.tick,error:Math.hypot(p.x-s.x,p.y-s.y,p.z-s.z),delay:s.tick-p.tick});}
 return {samples,timelines,queueDepth,player:t};
}
