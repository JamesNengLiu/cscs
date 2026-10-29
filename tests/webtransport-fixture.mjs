import assert from 'node:assert/strict';
import {SPAWN_POINTS} from '../public/shared.js';
assert.equal(process.env.HOST,'127.0.0.1');assert.ok(process.send,'IPC-only loopback fixture');
const {game}=await import('../server.mjs');
process.on('message',message=>{
  if(message.type==='start'){game.begin();game.phase='live';game.endAt=game.time+300;game.buyEndAt=game.time+300;process.send({type:'started',round:game.round});}
  if(message.type==='finish'){game.finish('CT','fixture');process.send({type:'finished'});}
  if(message.type==='grenade-setup'){
    const p=[...game.players.values()].find(p=>p.team==='T');Object.assign(p,SPAWN_POINTS.T[0],{vx:0,vy:0,vz:0});game.buy(p.id,'hegrenade');game.equip(p.id,'hegrenade');
    process.send({type:'grenade-ready',id:p.id});
  }
  if(message.type==='grenade-state'){
    const p=[...game.players.values()].find(p=>p.team==='T');
    process.send({type:'grenade-state',phase:p.grenadePhase,startedAt:p.grenadeStartedAt,remaining:p.grenades.hegrenade,
      actionId:p.grenadeActionId,ack:p.grenadeAckSeq,projectiles:game.projectiles.map(q=>({actionId:q.actionId,ownerId:q.ownerId}))});
  }
});
