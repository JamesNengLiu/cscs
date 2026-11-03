import assert from 'node:assert/strict';
import {SPAWN_POINTS,supportHeight,eyeHeight,blankInput} from '../public/shared.js';
import {playerHitboxes} from '../hitboxes.mjs';import * as THREE from 'three';
assert.equal(process.env.HOST,'127.0.0.1');assert.ok(process.send,'IPC-only loopback fixture');
const {game}=await import('../server.mjs');
process.on('message',message=>{
  if(message.type==='start'){game.begin();game.phase='live';game.endAt=game.time+300;game.buyEndAt=game.time+300;process.send({type:'started',round:game.round});}
  if(message.type==='finish'){game.finish('CT','fixture');process.send({type:'finished'});}
  if(message.type==='awp-setup'){
    const p=[...game.players.values()].find(p=>p.team==='T');Object.assign(p,SPAWN_POINTS.T[0],{vx:0,vy:0,vz:0,money:16000});game.buy(p.id,'awp');
    process.send({type:'awp-ready',id:p.id});
  }
  if(message.type==='awp-state'){const p=[...game.players.values()].find(p=>p.team==='T');process.send({type:'awp-state',zoom:p.zoom,weapon:p.weapon});}
  if(message.type==='awp-order-setup'){
    const p=[...game.players.values()].find(p=>p.team==='T'),q=[...game.players.values()].find(p=>p.team==='CT')||game.add('order-target','Target','CT');
    game.begin();game.phase='live';game.endAt=game.buyEndAt=game.time+300;Object.assign(p,SPAWN_POINTS.T[0],{money:16000});if(!p.inventory.awp)game.buy(p.id,'awp');else game.equip(p.id,'awp');
    for(const [a,z]of [[p,22],[q,19]])Object.assign(a,{x:-18.4,z,y:supportHeight(-18.4,z,3.3),vx:0,vy:0,vz:0,grounded:true,yaw:0,pitch:0,nextAttackAt:0,nextShotAt:0,lastShot:-100,hp:1000,armour:0,helmet:false,flinchAt:-100});p.zoom=40;
    const box=playerHitboxes(q,game.time).find(b=>b.group==='chest'),at=new THREE.Vector3(...box.min.map((x,i)=>(x+box.max[i])/2)).applyMatrix4(new THREE.Matrix4().fromArray(box.inverse).invert());p.yaw=Math.atan2(-(at.x-p.x),-(at.z-p.z));p.pitch=Math.atan2(at.y-p.y-eyeHeight(p),Math.hypot(at.x-p.x,at.z-p.z));
    // Keep the neutral legacy sample aligned until the first new-round batch;
    // otherwise the next tick restores spawn aim before broadcasting this pose.
    for(const a of [p,q])game.input(a.id,{...blankInput(),round:game.round,yaw:a.yaw,pitch:a.pitch});
    process.send({type:'awp-order-ready',round:game.round});
  }
  if(message.type==='awp-order-state'){const p=[...game.players.values()].find(p=>p.team==='T'),q=[...game.players.values()].find(p=>p.team==='CT');process.send({type:'awp-order-state',weapon:p.weapon,ammo:p.weapon==='awp'?p.ammo:p.inventory.awp.ammo,shots:p.shotsFired,zoom:p.zoom,resumeZoomAt:p.resumeZoomAt,targetHP:q.hp});}
  if(message.type==='grenade-setup'){
    const p=[...game.players.values()].find(p=>p.team==='T');Object.assign(p,SPAWN_POINTS.T[0],{vx:0,vy:0,vz:0});game.buy(p.id,'hegrenade');game.equip(p.id,'hegrenade');
    process.send({type:'grenade-ready',id:p.id,returnWeapon:p.primary||p.pistol||'knife'});
  }
  if(message.type==='grenade-state'){
    const p=[...game.players.values()].find(p=>p.team==='T');
    process.send({type:'grenade-state',phase:p.grenadePhase,startedAt:p.grenadeStartedAt,remaining:p.grenades.hegrenade,
      actionId:p.grenadeActionId,ack:p.grenadeAckSeq,projectiles:game.projectiles.map(q=>({actionId:q.actionId,ownerId:q.ownerId}))});
  }
});
