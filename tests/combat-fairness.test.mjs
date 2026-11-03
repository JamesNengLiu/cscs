import test from 'node:test';import assert from 'node:assert/strict';
import {createLagCompensation} from '../lag-compensation.mjs';import {createSnapshotBuffer} from '../public/snapshot-buffer.js';import {buildInputBatch} from '../public/input-protocol.js';import {createDuel,aimAt} from './fixtures/fairness-cases.mjs';
import {applyScopeAwareAction} from '../scope-actions.mjs';import {blankInput} from '../public/shared.js';

for(const join of [['host','guest'],['guest','host']])for(const arrival of [['host','guest'],['guest','host']])for(const sequenced of [true,false])test(`${join.join('/')} join, ${arrival.join('/')} receipt, ${sequenced?'queued':'legacy'}: earlier input wins`,()=>{
 const {g,host,guest,command}=createDuel({join});for(const id of arrival){const c=command(id);if(sequenced)g.inputBatch(id,[c]);else {const {seq,...legacy}=c;g.input(id,legacy);}}g.step();
 const winner=host.alive?'host':guest.alive?'guest':'none';assert.equal(winner,arrival[0]);assert.equal(g.players.get(arrival[0]).ammo,9);assert.equal(g.players.get(arrival[1]).ammo,10);assert.equal(g.players.get(arrival[1]).shotsFired,0);
});
test('repeated copies cannot steal the original receipt priority',()=>{
 const {g,guest,command}=createDuel();g.inputBatch('guest',[command('guest')]);g.inputBatch('host',[command('host')]);for(let i=0;i<100;i++)g.inputBatch('guest',[command('guest')]);g.step();assert.equal(guest.alive,true);assert.equal(guest.ammo,9);
});
test('an earlier but future input cannot jump its own pending sequence to win',()=>{
 const {g,guest,command}=createDuel();g.inputBatch('host',[command('host',2)]);g.inputBatch('guest',[command('guest')]);g.inputBatch('host',[command('host',1,{fire:false})]);g.step();assert.equal(guest.alive,true);assert.equal(guest.ammo,9);
});
test('client fields cannot forge the private server receipt priority',()=>{
 const {g,guest,command}=createDuel();g.inputBatch('guest',[{...command('guest'),receivedOrder:999999}]);g.inputBatch('host',[{...command('host'),receivedOrder:-999999}]);g.step();assert.equal(guest.alive,true);assert.equal(guest.ammo,9);
});
for(const join of [['host','guest'],['guest','host']])for(const first of ['host','guest'])test(`${join.join('/')} ${first} received first: queued knife secondary competes in the same combat order`,()=>{
 const {g,host,guest,command}=createDuel({join,hp:50});g.equip('guest',3);guest.nextAttackAt=guest.nextSecondaryAt=0;guest.z=21.1;aimAt(host,guest,g.time);aimAt(guest,host,g.time);g.input('guest',{...blankInput(),round:g.round,yaw:guest.yaw,pitch:guest.pitch});
 const gun=()=>g.inputBatch('host',[command('host')]),knife=()=>applyScopeAwareAction(g,'guest',{type:'secondary',round:g.round,afterInputSeq:0,commands:[]});if(first==='host'){gun();knife();}else{knife();gun();}g.step();assert.equal(host.alive?'host':'guest',first);
});
for(const join of [['host','guest'],['guest','host']])test(`nonlethal same-tick shots both commit with ${join.join('/')} joining`,()=>{
 const {g,host,guest,command}=createDuel({join,hp:1000});for(const id of ['guest','host'])g.inputBatch(id,[command(id)]);g.step();assert.ok(host.alive&&guest.alive);assert.equal(host.ammo,9);assert.equal(guest.ammo,9);assert.equal(host.shotsFired,1);assert.equal(guest.shotsFired,1);
});

for(const moving of [false,true])for(const profile of [{name:'host',rtt:0,delay:2000/30},{name:'remote-jitter',rtt:40,delay:130}])for(const order of ['critical-first','batch-first','weapon-copy-first'])for(const group of ['head','chest'])test(`${group} ${moving?'moving':'static'} ${profile.name} ${order}: displayed time lands the same shot`,()=>{
 const {g,host:p,guest:q}=createDuel({hp:1000}),buffer=createSnapshotBuffer({minDelayMs:profile.delay,maxDelayMs:profile.delay,initialDelayMs:profile.delay});
 for(let i=0;i<=30;i++){const time=9+i/30,received=time*1000+profile.rtt/2;if(received<=10000)buffer.push({time,round:g.round,players:[{...q,x:0,y:0,z:0}]},received);}buffer.sample(q.id,10000);const viewTime=buffer.view().playbackTimeMs/1000,now=10+profile.rtt/2000,speed=moving?6.25:0;
 g.lagComp=createLagCompensation();for(let i=0;i<=32;i++){const time=now-(32-i)/100;q.x=-18.4+(time-viewTime)*speed;g.lagComp.record({time,round:g.round,players:[p,q]});}
 aimAt(p,g.lagComp.pose(q.id,viewTime,g.round),viewTime,group);g.lagComp.timing(p.id,profile.rtt);g.time=now;const c={seq:1,round:g.round,fire:true,yaw:p.yaw,pitch:p.pitch,viewTime,interpDelayMs:profile.delay},copies=buildInputBatch([{...c,input:c}],g.round).commands;
 const accepted=[];g.inputBatch(p.id,order==='weapon-copy-first'?copies:[c],accepted);g.lagComp.view(p.id,accepted,{now,round:g.round,...(order==='batch-first'?{viewTime:9.99,interpDelayMs:67}:{})});
 const duplicates=[];g.inputBatch(p.id,[{...c,viewTime:9.99}],duplicates);g.lagComp.view(p.id,duplicates,{now,round:g.round,viewTime:9.99});g.events=[];g.step();assert.equal(p.ammo,9);assert.ok(q.hp<1000,'the aimed historical original hitbox must be hit');assert.ok(g.events.some(e=>e.type==='shot'&&e.hitImpact?.targetId===q.id));
 const shot=g.events.find(e=>e.type==='shot');assert.ok(Math.abs((g.time-shot.rewindMs/1000)-viewTime)<1e-9);
});
