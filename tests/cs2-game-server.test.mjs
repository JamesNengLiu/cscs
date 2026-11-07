import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {createExperimentalServer} from '../cs2-server.mjs';
import {GRENADE_PROTOCOL} from '../public/cs2-grenade-intent.js';
import {fixtureWorld,testHitboxes} from './cs2-game-fixture.mjs';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {CS2_WEAPON_PROFILE} from '../public/cs2-weapon-profile.js';

async function peer(url){
 const ws=new WebSocket(url),messages=[],waiters=[];
 let closed=null;
 ws.on('message',b=>{const m=JSON.parse(b.toString());messages.push(m);for(const w of [...waiters])w();});
 ws.on('close',(code,reason)=>{closed={code,reason:reason.toString()};for(const w of [...waiters])w();});
 ws.on('error',()=>{});
 const wait=predicate=>new Promise((resolve,reject)=>{
  let timer;const wake=()=>{const value=predicate();if(!value)return;clearTimeout(timer);waiters.splice(waiters.indexOf(wake),1);resolve(value);};
  timer=setTimeout(()=>{waiters.splice(waiters.indexOf(wake),1);reject(Error('network fixture timeout'));},2000);waiters.push(wake);wake();
 });
 await wait(()=>messages.find(m=>m.type==='hello'));
 return{ws,messages,next:type=>wait(()=>messages.find(m=>m.type===type)),closed:()=>wait(()=>closed),send:m=>ws.send(JSON.stringify(m)),close:()=>{ws.terminate();}};
}
async function fixture(t){const server=await createExperimentalServer({world:fixtureWorld(),autoTick:false,gameOptions:{hitboxes:testHitboxes,random:()=>.5}});t.after(()=>server.close());return{server,url:`ws://127.0.0.1:${server.address().port}`,http:`http://127.0.0.1:${server.address().port}`,contract:server.world.contract};}
test('isolated server rejects join before asset readiness and never allocates a game player',async t=>{
 const f=await fixture(t),p=await peer(f.url);p.send({type:'join',name:'A',team:'T',worldContract:f.contract});const error=await p.next('error');assert.equal(error.code,'ASSETS_NOT_READY');assert.equal((await p.closed()).code,1008);assert.equal(f.server.game.players.size,0);
});
test('both ready and join compare complete map collision and rules contract',async t=>{
 const f=await fixture(t);
 for(const stage of ['assetReady','join']){
  const p=await peer(f.url);if(stage==='join'){p.send({type:'assetReady',worldContract:f.contract});await p.next('assetReadyAck');}
  p.send({type:stage,name:'A',team:'T',worldContract:{...f.contract,collisionSHA256:'b'.repeat(64)}});
  assert.equal((await p.next('error')).code,'WORLD_CONTRACT_MISMATCH');assert.equal((await p.closed()).code,1008);assert.equal(f.server.game.players.size,0);
 }
});
test('ten ready clients share one authority, get private inventory and cannot fake hit results',async t=>{
 const f=await fixture(t),clients=[];t.after(()=>clients.forEach(p=>p.close()));
 for(let i=0;i<10;i++){
  const p=await peer(f.url);clients.push(p);const hello=await p.next('hello');assert.equal(hello.experimental,true);assert.deepEqual(hello.worldContract,f.contract);
  p.send({type:'assetReady',worldContract:f.contract});const ready=await p.next('assetReadyAck');assert.equal(ready.experimental,true);assert.equal(ready.ok,true);
  p.send({type:'join',name:'P'+i,team:i<5?'T':'CT',grenadeProtocol:GRENADE_PROTOCOL,worldContract:f.contract});const joined=await p.next('joined');assert.equal(joined.experimental,true);assert.deepEqual(joined.worldContract,f.contract);
 }
 assert.equal(f.server.game.players.size,10);f.server.step();f.server.broadcastState();
 const id=clients[0].messages.find(m=>m.type==='joined').id,state=await clients[0].next('state');assert.equal(state.experimental,true);assert.deepEqual(state.worldContract,f.contract);assert.ok(state.players.find(p=>p.id===id).inventory);assert.equal(state.players.find(p=>p.id!==id)?.inventory,undefined);
 const victim=[...f.server.game.players.values()][5];clients[0].send({type:'damage',id:victim.id,amount:10000});clients[0].send({type:'hit',target:victim.id});await new Promise(resolve=>setImmediate(resolve));assert.equal(victim.hp,100);
});
test('config and health identify only the experiment and static addons stay inside their root',async t=>{
 const f=await fixture(t);const config=await (await fetch(f.http+'/experimental-config')).json(),health=await (await fetch(f.http+'/health')).json();assert.deepEqual(config.worldContract,f.contract);assert.equal(health.version,'cs2-experimental-v1');assert.equal(health.experimental,true);
 assert.equal((await fetch(f.http+'/')).status,200);assert.equal((await fetch(f.http+'/vendor/three-addons/loaders/GLTFLoader.js')).status,200);assert.equal((await fetch(f.http+'/vendor/three-addons/%2e%2e%2f%2e%2e%2fpackage.json')).status,403);
});
test('CS2 rules reject a legacy movement world and require the authoritative weapon profile during readiness',async t=>{
 await assert.rejects(()=>createExperimentalServer({world:fixtureWorld(),gameOptions:{weaponProfile:'cs2'}}),/same world contract/);
 const server=await createExperimentalServer({world:fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),gameOptions:{weaponProfile:'cs2',hitboxes:testHitboxes},autoTick:false});t.after(()=>server.close());
 const url=`ws://127.0.0.1:${server.address().port}`,wrong=await peer(url);wrong.send({type:'assetReady',worldContract:server.world.contract,weaponProfileId:'legacy-cs16-v1'});assert.match((await wrong.next('error')).message,/weapon profile mismatch/);assert.equal((await wrong.closed()).code,1008);
 const p=await peer(url);t.after(()=>p.close());const hello=await p.next('hello');assert.equal(hello.weaponProfileId,CS2_WEAPON_PROFILE.id);assert.equal(hello.movementProfileId,CS2_MOVEMENT_PROFILE.id);
 p.send({type:'assetReady',worldContract:server.world.contract,weaponProfileId:CS2_WEAPON_PROFILE.id});await p.next('assetReadyAck');p.send({type:'join',name:'CS2',team:'T',worldContract:server.world.contract,weaponProfileId:CS2_WEAPON_PROFILE.id});await p.next('joined');const state=await p.next('state');assert.equal(state.weaponProfileId,CS2_WEAPON_PROFILE.id);assert.equal(state.movementProfileId,CS2_MOVEMENT_PROFILE.id);
});
