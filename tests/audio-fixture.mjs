// Parent-IPC-only test commands. Never imported by the production server.
import assert from 'node:assert/strict';
import {SPAWN_POINTS,blankInput} from '../public/shared.js';
assert.equal(process.env.HOST,'127.0.0.1');assert.ok(process.send);
const {game}=await import('../server.mjs');
process.on('message',({type})=>{try{
  if(type==='layout'){
    game.begin();game.phase='live';game.endAt=game.time+300;game.buyEndAt=game.time+300;
    const viewer=[...game.players.values()].find(p=>p.team==='T'),enemy=[...game.players.values()].find(p=>p.team==='CT');
    assert.ok(viewer&&enemy);Object.assign(viewer,SPAWN_POINTS.CT[1],{vx:0,vy:0,vz:0,input:blankInput()});
    Object.assign(enemy,SPAWN_POINTS.CT[0],{vx:0,vy:0,vz:0,input:blankInput()});game.equip(viewer.id,'knife');
    process.send({ok:true,type,viewer:{x:viewer.x,y:viewer.y,z:viewer.z},enemy:{x:enemy.x,y:enemy.y,z:enemy.z}});
  }else throw Error('Unknown fixture command');
}catch(error){process.send({error:error.message});}});
