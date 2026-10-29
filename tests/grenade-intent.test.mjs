import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.mjs';
import {GRENADE_PROTOCOL,GRENADE_KINDS,normalizeGrenadeIntent,createGrenadePrediction} from '../public/grenade-intent.js';

function match(kind='hegrenade'){
 const g=new Game(),p=g.add('p','Intent test','T');g.begin();g.buy(p.id,kind);g.equip(p.id,kind);g.enableGrenadeIntents(p.id);
 for(let i=0;i<55;i++)g.step();return {g,p};
}
function driver(g,p){let seq=0;return (kind,extra={})=>g.grenadeIntent(p.id,{round:g.round,seq:++seq,actionId:1,weapon:p.weapon,kind,yaw:0,pitch:0,...extra});}
const step=(g,n)=>{for(let i=0;i<n;i++)g.step();};
for(const kind of GRENADE_KINDS){
 test(`intent ${kind}: gaps never release/restart, reliable release commits once with server trajectory`,()=>{
  const {g,p}=match(kind),intent=driver(g,p);assert.equal(intent('press').status,'active');const started=p.grenadeStartedAt;
  // No periodic input packets at all, well beyond both former timeout thresholds.
  step(g,360);assert.equal(p.grenadePhase,'hold');assert.equal(p.grenadeStartedAt,started);assert.equal(p.grenades[kind],1);
  assert.equal(g.projectiles.length,0);
  for(let seq=1;seq<=20;seq++){g.inputBatch(p.id,[{round:g.round,seq,fire:seq%2===0}]);g.step();}
  assert.equal(p.grenadeStartedAt,started);assert.equal(g.projectiles.length,0,'movement button samples cannot release intent-mode grenades');
  const x=p.x;assert.equal(intent('release',{yaw:Math.PI/2,x:99999,landing:{x:99999}}).status,'released');g.step();
  assert.equal(p.grenades[kind],0);assert.equal(g.projectiles.length,1);const q=g.projectiles[0];assert.ok(q.vx<0);assert.ok(Math.abs(q.vz)<1e-8);assert.ok(Math.abs(q.x-x)<2);
  assert.equal(q.actionId,1);assert.equal(q.round,g.round);assert.ok(Math.abs(q.detonateAt-q.bornAt-1.5)<1e-8);
  assert.equal(g.snapshot(p.id).projectiles[0].actionId,1);
  assert.equal(g.grenadeIntent(p.id,{round:g.round,seq:2,actionId:1,weapon:kind,kind:'release',yaw:0,pitch:0}),null);
  step(g,5);assert.equal(g.events.filter(e=>e.type==='throw').length,1);
 });
 test(`intent ${kind}: quick click waits for server minimum pin time`,()=>{
  const {g,p}=match(kind),intent=driver(g,p);intent('press');const start=g.time;intent('release');step(g,20);assert.equal(g.projectiles.length,0);
  step(g,11);assert.equal(g.projectiles.length,1);assert.ok(g.projectiles[0].bornAt+1e-8>=start+.5);
 });
 for(const cancel of ['cancel','menu','switch','death','round','disconnect'])test(`intent ${kind}: ${cancel} cannot produce a late grenade`,()=>{
  const {g,p}=match(kind),intent=driver(g,p);intent('press');step(g,10);
  if(cancel==='cancel')intent('cancel');else if(cancel==='menu')g.input(p.id,{round:g.round,cancelThroughSeq:1});
  else if(cancel==='switch')g.equip(p.id,2);else if(cancel==='death')g.damage(p,1000);else if(cancel==='round')g.begin();else g.remove(p.id);
  const response=intent('release');if(response)assert.equal(response.status,'rejected');step(g,80);
  assert.equal(g.projectiles.length,0);assert.equal(g.events.filter(e=>e.type==='throw').length,0);
 });
}

test('intent order: wrong round, out-of-order, duplicate and stale actions do not advance or rearm',()=>{
 const {g,p}=match(),base={round:g.round,seq:1,actionId:1,weapon:p.weapon,kind:'press'};
 assert.equal(g.grenadeIntent(p.id,{...base,round:g.round-1}),null);
 assert.equal(g.grenadeIntent(p.id,{...base,seq:2,actionId:2}),null);assert.equal(p.grenadeAckSeq,0);
 assert.equal(g.grenadeIntent(p.id,base).status,'active');const started=p.grenadeStartedAt;
 assert.equal(g.grenadeIntent(p.id,base),null);assert.equal(p.grenadeStartedAt,started);
 assert.equal(g.grenadeIntent(p.id,{...base,seq:2,actionId:99,kind:'release',yaw:0,pitch:0}).status,'rejected');
 step(g,40);assert.equal(g.projectiles.length,0);assert.equal(p.grenadeStartedAt,started);
 assert.equal(g.grenadeIntent(p.id,{...base,seq:3,kind:'cancel'}).status,'cancelled');
 assert.equal(g.grenadeIntent(p.id,base),null);step(g,40);assert.equal(p.grenadePhase,'');
});

test('intent validation rejects malformed payloads without trusting client time, position or inventory',()=>{
 const base={round:1,seq:1,actionId:1,kind:'press',weapon:'hegrenade'};
 for(const raw of [null,[],{}, {...base,seq:NaN},{...base,actionId:2},{...base,weapon:'ak47'}, {...base,kind:'release',yaw:Infinity,pitch:0}])assert.equal(normalizeGrenadeIntent(raw,1),null);
 assert.equal(normalizeGrenadeIntent({...base,x:9999,time:999999,ammo:999},1).x,undefined);
 const {g,p}=match();g.equip(p.id,2);assert.equal(g.grenadeIntent(p.id,{...base,round:g.round}).status,'rejected');assert.equal(p.grenades.hegrenade,1);
 for(const stop of ['cancel','release']){
  const {g,p}=match('flashbang');g.buy(p.id,'flashbang');const intent=driver(g,p);
  intent('press');intent('release');step(g,31);assert.equal(p.grenadePhase,'throw');
  assert.equal(intent('press',{actionId:3}).status,'pending');
  assert.equal(intent(stop,{actionId:3}).status,'cancelled');assert.equal(p.grenadeIntentStatus,'cancelled');
  step(g,60);assert.equal(p.grenades.flashbang,1);assert.equal(g.events.filter(e=>e.type==='throw').length,1);
 }
});

test('intent mode: movement/fire samples and their late reliable backups cannot start or revive a pin',()=>{
 const {g,p}=match();
 for(let seq=1;seq<=35;seq++){g.inputBatch(p.id,[{round:g.round,seq,fire:true,f:1}]);g.step();}
 assert.equal(p.grenadePhase,'');assert.equal(p.appliedInputCommands,35);
 const intent=driver(g,p);intent('press');intent('cancel');
 for(let seq=36;seq<=70;seq++){g.inputBatch(p.id,[{round:g.round,seq,fire:true}]);g.step();}
 assert.equal(p.grenadePhase,'');assert.equal(p.grenades.hegrenade,1);assert.equal(g.projectiles.length,0);
});

test('intent: stale cancel cannot stop a new preparation; admission failure exposes cancellation',()=>{
 const {g,p}=match();const intent=driver(g,p);intent('press');intent('cancel');
 intent('press',{actionId:3});const started=p.grenadeStartedAt;
 assert.equal(intent('cancel',{actionId:1}).status,'rejected');assert.equal(p.grenadeStartedAt,started);assert.equal(p.grenadeActionId,3);
 intent('release',{actionId:3});g.projectiles=Array(64).fill(null);
 // Check admission without stepping dummy projectile physics.
 g.time=started+.6;g.updateGrenade(p,false);assert.equal(p.grenades.hegrenade,1);assert.equal(p.grenadeIntentStatus,'cancelled');assert.equal(p.grenadePhase,'');
});

function predicted(){
 let time=100;const sent=[],prediction=createGrenadePrediction({now:()=>time,send:m=>sent.push(m)});
 const p={alive:true,weapon:'hegrenade',grenades:{hegrenade:1},grenadeProtocol:GRENADE_PROTOCOL,nextAttackAt:5,grenadePhase:''};
 const ctx={round:1,stateTime:5,phase:'live',yaw:0,pitch:0};prediction.observe(p,ctx);
 return {prediction,p,ctx,sent,setTime:t=>{time=t;}};
}
test('prediction: pin and throw render before any server response; confirmations never re-anchor or replay',()=>{
 const {prediction:p,p:me,ctx,sent,setTime}=predicted();p.press(me,ctx);assert.equal(p.view(me).grenadePhase,'pin');assert.equal(me.grenadePhase,'');
 const start=p.view(me).grenadeStartedAt;setTime(102);assert.equal(p.view(me).grenadePhase,'hold');p.release({yaw:1,pitch:0});assert.equal(p.view(me).grenadePhase,'throw');
 assert.equal(me.grenades.hegrenade,1);assert.equal(sent.length,2);
 p.confirm({round:1,seq:1,actionId:1,status:'active'});
 p.observe({...me,grenadeAckSeq:1,grenadeActionId:1,grenadeIntentStatus:'active',grenadePhase:'pin',grenadeStartedAt:900},{...ctx,stateTime:900});
 assert.equal(p.view(me).grenadePhase,'throw');assert.equal(p.view(me).grenadeStartedAt,start);
 p.confirm({round:1,seq:2,actionId:1,status:'released'});assert.equal(p.diagnostics().predicted,1);assert.equal(p.diagnostics().confirmed,1);
});
test('prediction: early release obeys preparation; cancelled and rejected actions never revive from late snapshots',()=>{
 const {prediction:p,p:me,ctx,setTime}=predicted();p.press(me,ctx);setTime(100.1);p.release();assert.equal(p.view(me).grenadePhase,'pin');setTime(100.5);assert.equal(p.view(me).grenadePhase,'throw');
 p.cancel();assert.equal(p.view(me).grenadePhase,'');p.confirm({round:1,seq:1,actionId:1,status:'active'});assert.equal(p.view(me).grenadePhase,'');
 setTime(102);p.press(me,ctx);const id=p.diagnostics().actionId;p.confirm({round:1,seq:p.diagnostics().sequence,actionId:id,status:'rejected'});assert.equal(p.view(me).grenadePhase,'');
 p.observe({...me,grenadeActionId:id,grenadeIntentStatus:'active',grenadeAckSeq:99},ctx);assert.equal(p.view(me).grenadePhase,'');
});
test('prediction: round, death and weapon change cancel; deployment and repeat clicks cannot skip cooldown',()=>{
 const {prediction:p,p:me,ctx,setTime}=predicted();me.nextAttackAt=6;p.press(me,ctx);assert.equal(p.view(me).grenadePhase,'');p.release();setTime(102);assert.equal(p.view(me).grenadePhase,'');
 me.nextAttackAt=5;p.press(me,ctx);assert.equal(p.press(me,ctx),false);p.release();setTime(102.5);assert.equal(p.view(me).grenadePhase,'throw');
 p.press(me,ctx);assert.equal(p.view(me).grenadePhase,'');setTime(103);assert.equal(p.view(me).grenadePhase,'pin');
 p.observe({...me,alive:false},ctx);assert.equal(p.view(me).grenadePhase,'');p.observe(me,{...ctx,round:2});assert.equal(p.diagnostics().sequence,0);
 p.press(me,{...ctx,round:2});p.observe({...me,weapon:'glock18'},{...ctx,round:2});assert.equal(p.diagnostics().actionId,0);
});
