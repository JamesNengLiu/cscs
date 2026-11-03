import test from 'node:test';import assert from 'node:assert/strict';
import {createRenderedInputView} from '../public/rendered-input-view.js';import {createSnapshotBuffer} from '../public/snapshot-buffer.js';
import {buildInputBatch,normalizeInputCommand} from '../public/input-protocol.js';import {createWeaponActionOrder} from '../public/weapon-action-order.js';
import {createLagCompensation} from '../lag-compensation.mjs';import {Game} from '../game.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('command view stays on the submitted scene until another scene is presented',()=>{
 const view=createRenderedInputView();assert.deepEqual(view.command(1),{});view.present(1,{playbackTimeMs:9850,delayMs:130});const first={seq:1,round:1,input:{fire:true},...view.command(1)};
 const newerCursor={playbackTimeMs:9900,delayMs:140};near(view.command(1).viewTime,9.85);view.present(1,newerCursor);near(view.command(1).viewTime,9.9);near(first.viewTime,9.85);assert.deepEqual(view.command(2),{});view.reset();assert.deepEqual(view.command(1),{});
});
test('input metadata survives normalization, retransmission and a weapon barrier without becoming movement intent',()=>{
 const source={seq:1,round:1,input:{fire:true,f:1,dt:100},viewTime:9.85,interpDelayMs:130},saved=structuredClone(source),c=normalizeInputCommand(source,1),batch=buildInputBatch([source],1);
 near(c.viewTime,9.85);assert.equal(c.input.viewTime,undefined);assert.equal(c.input.dt,undefined);near(batch.commands[0].viewTime,9.85);
 const order=createWeaponActionOrder(),message=order.prepare({type:'equip',weapon:3},{supported:true,active:true,round:1,seq:1,ack:0,commands:[source],firePending:false,viewTime:9.99,interpDelayMs:100});near(message.commands[0].viewTime,9.85);assert.deepEqual(source,saved);
 const duplicate=buildInputBatch([source,{...source,viewTime:9.9}],1);near(duplicate.commands[0].viewTime,9.85);
});
test('non-finite view fields are stripped and the lightweight view getter never advances playback',()=>{
 const c=normalizeInputCommand({seq:1,round:1,viewTime:NaN,interpDelayMs:Infinity},1);assert.equal(c.viewTime,undefined);assert.equal(c.interpDelayMs,undefined);
 const b=createSnapshotBuffer();b.push({time:10,round:1,players:[{id:'p',x:0,y:0,z:0,yaw:0}]},10000);b.sample('p',10010);const a=b.view();for(let i=0;i<100;i++)assert.deepEqual(b.view(),a);assert.equal(b.diagnostics().samples,1);
});
for(const order of ['critical-first','batch-first','barrier-first'])test(`${order}: an immutable command view beats a later packet header`,()=>{
 const h=createLagCompensation();h.timing('p',40);const command={seq:1,round:1,viewTime:9.85,interpDelayMs:130},packet={viewTime:9.9,interpDelayMs:80,now:10.02,round:1};
 if(order==='batch-first')h.view('p',[command],packet);else if(order==='barrier-first')h.view('p',buildInputBatch([{...command,input:{fire:true}}],1).commands,packet);else h.view('p',[command],{now:10.02,round:1});
 h.view('p',[{...command,viewTime:9.89}],packet);near(h.targetTime('p',1,10.02,1),9.85);
});
for(const count of [10,400])for(const first of ['record','view'])test(`${count} prior commands, ${first} first: a new round reuses seq 1 safely`,()=>{
 const h=createLagCompensation();h.timing('p',40);for(let seq=1;seq<=count;seq++)h.view('p',[{seq,round:1}],{viewTime:9.9,interpDelayMs:80,now:10,round:1});
 if(first==='record')h.record({time:20,round:2,players:[]});h.view('p',[{seq:1,round:2,viewTime:19.9,interpDelayMs:80}],{now:20,round:2});if(first==='view')h.record({time:20,round:2,players:[]});near(h.targetTime('p',1,20,2),19.9);assert.equal(h.targetTime('p',1,20,1),null);
});
test('old-round packets cannot register a current-round view or clear another player current view',()=>{
 const h=createLagCompensation();h.view('p',[{seq:1,round:2,viewTime:19.9,interpDelayMs:100}],{now:20,round:2});h.view('q',[{seq:1,round:1}],{now:20,round:2,viewTime:19.9});assert.equal(h.targetTime('q',1,20,2),null);
 h.view('q',[{seq:2,round:1}],{now:10,round:1,viewTime:9.9});near(h.targetTime('p',1,20,2),19.9);assert.ok(h.diagnostics().ignoredCommands>0);
});
test('wire callers register only commands actually accepted by the server input queue',()=>{
 const g=new Game({random:()=>.5}),p=g.add('p','P','T');g.begin();const accepted=[];g.inputBatch(p.id,[{seq:1,round:g.round-1},{seq:2},{seq:999,round:g.round},{seq:1,round:g.round,fire:true,viewTime:.9,interpDelayMs:100}],accepted);assert.equal(accepted.length,1);assert.equal(accepted[0].seq,1);
 const h=createLagCompensation();h.view(p.id,accepted,{now:1,round:g.round});near(h.targetTime(p.id,1,1,g.round),.9);assert.equal(h.targetTime(p.id,2,1,g.round),null);assert.equal(h.targetTime(p.id,999,1,g.round),null);
});
test('invalid or excessive timestamps retain the original bounded fallback and history cap',()=>{
 const h=createLagCompensation();h.timing('p',40);for(let seq=1;seq<=300;seq++)h.view('p',[{seq,round:1,viewTime:seq%2?999999:-999999,interpDelayMs:99999}],{now:10,round:1});
 const at=h.targetTime('p',300,10,1);assert.ok(at>=9.8&&at<=10);assert.equal(h.targetTime('p',1,10,1),null);assert.equal(h.diagnostics().maxRewindMs,200);assert.ok(h.diagnostics().rejectedTimes>0);
});
test('older commands keep their original render time in a later redundant batch without widening the rewind cap',()=>{
 const h=createLagCompensation();const commands=Array.from({length:8},(_,i)=>({seq:i+1,round:1,viewTime:9.82+i/60,interpDelayMs:67}));h.view('p',commands,{now:10,round:1,viewTime:9.94,interpDelayMs:67});near(h.targetTime('p',1,10,1),9.82);
 h.view('p',[{seq:9,round:1,viewTime:9.1,interpDelayMs:67}],{now:10,round:1});assert.ok(h.targetTime('p',9,10,1)>=9.8);assert.equal(h.diagnostics().maxRewindMs,200);
});
test('a long frame records the age of the actual submitted image and freezes it with the command',()=>{
 const v=createRenderedInputView();v.present(1,{playbackTimeMs:9853,delayMs:67},1000);const c={seq:1,round:1,...v.command(1,1080)};assert.equal(c.viewAgeMs,80);v.present(1,{playbackTimeMs:9950,delayMs:67},1090);assert.equal(buildInputBatch([c],1).commands[0].viewAgeMs,80);
 const h=createLagCompensation();h.view('p',[c],{now:10,round:1});near(h.targetTime('p',1,10,1),9.853);const malicious={...c,seq:2,viewTime:1,viewAgeMs:999999};h.view('p',[malicious],{now:10,round:1});assert.ok(h.targetTime('p',2,10,1)>=9.8);
});
test('measured downlink clock uncertainty does not reject an honest view still inside 200ms',()=>{
 const h=createLagCompensation();h.timing('p',130);h.view('p',[{seq:1,round:1,viewTime:9.885,interpDelayMs:50,viewAgeMs:0}],{now:10.065,round:1});near(h.targetTime('p',1,10.065,1),9.885);
 h.view('p',[{seq:2,round:1,viewTime:9.7,interpDelayMs:50,viewAgeMs:0}],{now:10.065,round:1});assert.ok(h.targetTime('p',2,10.065,1)>=9.865);
});
test('floating-point noise at the horizon is clamped to exactly 200ms, never to another view',()=>{
 const h=createLagCompensation();h.view('p',[{seq:1,round:1,viewTime:9.8-1e-12,interpDelayMs:160}],{now:10,round:1});near(h.targetTime('p',1,10,1),9.8);assert.equal(h.diagnostics().rejectedTimes,0);
});
