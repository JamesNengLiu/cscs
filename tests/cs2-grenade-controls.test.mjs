import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {CS2_GRENADE_CONTROLS,createThrowControl,changeThrowButtons,throwStrength,throwMode} from '../public/cs2-grenade-controls.js';
import {GRENADE_PROTOCOL,GRENADE_KINDS,normalizeGrenadeIntent,createGrenadePrediction} from '../public/cs2-grenade-intent.js';

function predicted(){
 let time=100;const sent=[],prediction=createGrenadePrediction({now:()=>time,send:m=>sent.push(m)});
 const p={alive:true,weapon:'hegrenade',grenades:{hegrenade:1},grenadeProtocol:GRENADE_PROTOCOL,nextAttackAt:5,grenadePhase:''};
 const context={round:1,stateTime:5,phase:'live',yaw:0,pitch:0};prediction.observe(p,context);
 return {prediction,p,context,sent,time:value=>{time=value;}};
}

for(const [mask,strength,mode] of [[1,1,'overhand'],[2,0,'underhand'],[3,.5,'medium']])test(`CS2 controls mask ${mask}: independent initial mode, no hold charging or input mutation`,()=>{
 const c=createThrowControl(mask,10),copy=structuredClone(c);assert.equal(throwStrength(c,10),strength);assert.equal(throwStrength(c,100),strength);assert.equal(throwMode(strength),mode);
 const released=changeThrowButtons(c,0,11);assert.equal(released.buttons,0);assert.equal(throwStrength(released,1000),strength);assert.deepEqual(c,copy);
 assert.equal(changeThrowButtons(released,mask,12),released,'a released action cannot be rearmed');
});
for(const remaining of [1,2])test(`CS2 dual release: remaining mask ${remaining} keeps medium within grace, single mode after grace`,()=>{
 const held=createThrowControl(3,0),split=changeThrowButtons(held,remaining,.5);
 assert.equal(throwStrength(split,.55),.5);assert.equal(throwStrength(changeThrowButtons(split,0,.55),10),.5);
 assert.equal(throwStrength(split,.7),remaining===1?1:0);assert.equal(throwStrength(changeThrowButtons(split,0,.7),10),remaining===1?1:0);
 assert.equal(changeThrowButtons(split,remaining,.6),split,'same-mask repeats do not extend the grace window');
 const brief=changeThrowButtons(held,remaining,CS2_GRENADE_CONTROLS.dualSettleSeconds/2);assert.equal(throwStrength(brief,.06),remaining===1?1:0);
});
test('CS2 controls: entering dual is immediate, re-entering requires a fresh settle and invalid inputs cannot mutate state',()=>{
 let c=createThrowControl(2,1);c=changeThrowButtons(c,3,2);assert.equal(throwStrength(c,2),.5);
 c=changeThrowButtons(c,1,3);c=changeThrowButtons(c,3,3.01);c=changeThrowButtons(c,2,3.02);assert.equal(throwStrength(c,3.03),0);
 for(const mask of [-1,4,1.2,NaN,null,'1']){assert.equal(createThrowControl(mask,1),null);assert.equal(changeThrowButtons(c,mask,4),c);}
 assert.equal(changeThrowButtons(c,1,NaN),c);assert.equal(changeThrowButtons(c,1,0).changedAt,c.changedAt);
});

test('CS2 v2 wire validation: only ordered button masks survive and client strength/time/velocity are stripped',()=>{
 const base={round:1,seq:1,actionId:1,kind:'press',weapon:'hegrenade',buttons:2};
 assert.equal(GRENADE_PROTOCOL,'grenade-intent-v2');assert.equal(normalizeGrenadeIntent(base,1).buttons,2);
 assert.equal(normalizeGrenadeIntent({...base,buttons:undefined},1).buttons,1);
 for(const raw of [{...base,buttons:0},{...base,buttons:4},{...base,buttons:null},{...base,buttons:'2'},{...base,kind:'buttons',buttons:undefined},{...base,kind:'release',buttons:2,yaw:0,pitch:0},{...base,kind:'release',buttons:0,yaw:Infinity,pitch:0}])assert.equal(normalizeGrenadeIntent(raw,1),null);
 const update=normalizeGrenadeIntent({...base,seq:2,kind:'buttons',buttons:3,strength:999,at:-99,velocity:{x:999}},1);assert.equal(update.buttons,3);assert.equal(update.strength,undefined);assert.equal(update.at,undefined);assert.equal(update.velocity,undefined);
 const release=normalizeGrenadeIntent({...base,seq:3,kind:'release',buttons:0,yaw:20,pitch:20},1);assert.equal(release.buttons,0);assert.ok(Math.abs(release.yaw)<=Math.PI);assert.equal(release.pitch,Math.PI/2);
});
test('CS2 v2 edge clock: finite bounded elapsed only, zero press origin and optional legacy internal clock',()=>{
 const base={round:1,seq:1,actionId:1,kind:'press',weapon:'hegrenade',buttons:3};
 assert.equal(normalizeGrenadeIntent(base,1).elapsed,undefined);assert.equal(normalizeGrenadeIntent({...base,elapsed:0},1).elapsed,0);
 for(const elapsed of [-1,.1,Infinity,NaN,null,'0',3600.1])assert.equal(normalizeGrenadeIntent({...base,elapsed},1),null);
 for(const elapsed of [-1,Infinity,NaN,null,'1',3600.1])assert.equal(normalizeGrenadeIntent({...base,seq:2,kind:'buttons',elapsed},1),null);
 assert.equal(normalizeGrenadeIntent({...base,seq:2,kind:'buttons',elapsed:3600},1).elapsed,3600);
 assert.equal(normalizeGrenadeIntent({...base,seq:3,kind:'release',buttons:0,elapsed:.65,yaw:0,pitch:0},1).elapsed,.65);
});

for(const firstRelease of [1,2])test(`CS2 prediction: dual split to ${firstRelease}, final release is immediate and one action`,()=>{
 const f=predicted(),{prediction:p,p:me,context:ctx,sent}=f;
 assert.equal(p.buttons(me,1,ctx),true);assert.equal(p.buttons(me,3,ctx),true);assert.equal(p.view(me).grenadeMode,'medium');
 f.time(100.6);assert.equal(p.buttons(me,firstRelease,ctx),true);assert.equal(p.view(me).grenadePhase,'hold');assert.equal(p.view(me).grenadeStrength,.5);
 f.time(100.65);assert.equal(p.buttons(me,0,{...ctx,yaw:1}),true);assert.equal(p.view(me).grenadePhase,'throw');assert.equal(p.view(me).grenadeStrength,.5);assert.equal(p.view(me).grenadeThrownAt,100.65);
 assert.deepEqual(sent.map(m=>m.kind),['press','buttons','buttons','release']);assert.deepEqual(sent.map(m=>m.buttons),[1,3,firstRelease,0]);assert.ok(sent.every(m=>m.actionId===1));assert.deepEqual(sent.map(m=>m.seq),[1,2,3,4]);
 assert.equal(p.buttons(me,0,ctx),false);for(let n=0;n<1000;n++)p.view(me,100.7+n/120);assert.equal(sent.length,4,'rendering emits no per-frame intensity messages');
 assert.equal(me.grenades.hegrenade,1,'prediction has no inventory authority');
 p.confirm({round:1,seq:4,actionId:1,status:'released'});p.confirm({round:1,seq:4,actionId:1,status:'released'});assert.equal(p.diagnostics().confirmed,1);assert.equal(p.view(me).grenadeThrownAt,100.65);
});
test('CS2 prediction: direct underhand and overhand release have no added dual-release delay',()=>{
 for(const [mask,strength] of [[1,1],[2,0]]){
  const f=predicted();f.prediction.buttons(f.p,mask,f.context);f.time(102);f.prediction.buttons(f.p,0,f.context);
  assert.equal(f.prediction.view(f.p).grenadeStrength,strength);assert.equal(f.prediction.view(f.p).grenadeThrownAt,102);assert.equal(f.sent.length,2);
 }
});
test('CS2 prediction: late remaining-key release changes strength without a new action',()=>{
 const f=predicted();f.prediction.buttons(f.p,3,f.context);f.time(100.6);f.prediction.buttons(f.p,2,f.context);f.time(100.8);
 assert.equal(f.prediction.view(f.p).grenadeMode,'underhand');f.prediction.buttons(f.p,0,f.context);assert.equal(f.prediction.view(f.p).grenadeStrength,0);assert.equal(f.prediction.diagnostics().predicted,1);
});
test('CS2 prediction: batched delivery retains physical button intervals independently of deploy and server clocks',()=>{
 const f=predicted();f.p.nextAttackAt=5.4;f.prediction.buttons(f.p,3,f.context);f.time(100.6);f.prediction.buttons(f.p,2,f.context);f.time(100.65);f.prediction.buttons(f.p,0,f.context);
 assert.ok(Math.abs(f.sent[1].elapsed-.6)<1e-10,'edge elapsed starts at the physical press, before deployment completes');
 assert.ok(Math.abs(f.sent[2].elapsed-.65)<1e-10);
 // Simulate all queued reliable edges being consumed during a single authority
 // tick; only their relative control timestamps advance, never spawn/fuse time.
 let control=null;for(const message of f.sent)control=message.kind==='press'?createThrowControl(message.buttons,message.elapsed):changeThrowButtons(control,message.buttons,message.elapsed);
 assert.equal(throwStrength(control,10),.5);assert.equal(f.prediction.view(f.p).grenadeStrength,.5);
});
test('CS2 prediction: edge elapsed never goes backwards and is bounded for excessively long holds',()=>{
 const f=predicted();f.prediction.buttons(f.p,1,f.context);f.time(101);f.prediction.buttons(f.p,3,f.context);f.time(100.5);f.prediction.buttons(f.p,2,f.context);f.time(100000);f.prediction.buttons(f.p,0,f.context);
 assert.deepEqual(f.sent.map(m=>m.elapsed),[0,1,1,3600]);assert.ok(f.sent.every(m=>normalizeGrenadeIntent(m,1)));
});
test('CS2 prediction: cancellation, death, weapon switch and late release cannot rearm an action',()=>{
 for(const reason of ['cancel','death','weapon','round']){
  const f=predicted(),p=f.prediction;p.buttons(f.p,2,f.context);f.time(100.7);assert.equal(p.view(f.p).grenadePhase,'hold');
  if(reason==='cancel')p.cancel();else if(reason==='death')p.observe({...f.p,alive:false},f.context);else if(reason==='weapon')p.observe({...f.p,weapon:'knife'},f.context);else p.observe(f.p,{...f.context,round:2});
  const sent=f.sent.length;assert.equal(p.buttons(f.p,0,reason==='round'?{...f.context,round:2}:f.context),false);assert.equal(f.sent.length,sent);assert.equal(p.view(f.p).grenadePhase,'');
 }
});
test('CS2 prediction: early deployment tap is cancelled; a held follow-up flash waits for recovery',()=>{
 const f=predicted(),p=f.prediction;f.p.nextAttackAt=6;p.buttons(f.p,2,f.context);p.buttons(f.p,0,f.context);f.time(102);assert.equal(p.view(f.p).grenadePhase,'');
 f.p.nextAttackAt=5;p.buttons(f.p,3,f.context);f.time(103);p.buttons(f.p,0,f.context);p.buttons(f.p,2,f.context);assert.equal(p.view(f.p).grenadePhase,'');
 f.time(103.5);assert.equal(p.view(f.p).grenadePhase,'pin');assert.equal(p.view(f.p).grenadeMode,'underhand');
});

const client=await readFile(new URL('../public/cs2-client.js',import.meta.url),'utf8');
function inputFixture(weapon='hegrenade'){
 const f=predicted();f.p.weapon=weapon;const handlers={},sent=[],context={GRENADE_KINDS,grenadePrediction:f.prediction,grenadeButtons:0,mouseFire:false,locked:true,shop:{isOpen:false},$:()=>({hidden:true}),player:()=>f.p,lastRound:1,serverTime:()=>5,state:{phase:'live'},yaw:0,pitch:0,sceneDirty:false,queueInputEdge:()=>{},send:m=>sent.push(m),document:{addEventListener:(name,fn)=>handlers[name]=fn}};
 vm.runInNewContext(client.slice(client.indexOf('function grenadeInputContext()'),client.indexOf("document.addEventListener('contextmenu'")),context);
 return {...f,context,handlers,secondary:sent,down(button){handlers.mousedown({button,preventDefault(){}});},up(button){handlers.mouseup({button});}};
}
test('production mouse handlers: right then left, either first release, preserve the remaining held key',()=>{
 for(const first of [0,2]){
  const f=inputFixture();f.down(2);assert.equal(f.prediction.view(f.p).grenadeMode,'underhand');assert.equal(f.context.mouseFire,false);f.down(0);assert.equal(f.context.mouseFire,true);assert.equal(f.context.grenadeButtons,3);
  f.time(100.6);f.up(first);assert.equal(f.prediction.view(f.p).grenadePhase,'hold');assert.equal(f.context.grenadeButtons,first===0?2:1);f.time(100.65);f.up(first===0?2:0);
  assert.equal(f.context.grenadeButtons,0);assert.equal(f.context.mouseFire,false);assert.equal(f.prediction.view(f.p).grenadePhase,'throw');assert.equal(f.prediction.view(f.p).grenadeStrength,.5);assert.equal(f.secondary.length,0);
 }
});
test('production mouse handlers: non-grenade right click retains secondary, disabled UI does not start throws',()=>{
 for(const weapon of ['awp','knife','ak47','m4a1']){const f=inputFixture(weapon);f.down(2);assert.equal(f.secondary.length,1);assert.equal(f.secondary[0].type,'secondary');assert.equal(f.sent.length,0);f.down(0);assert.equal(f.context.mouseFire,true);assert.equal(f.sent.length,0);}
 for(const blocked of ['lock','shop','menu']){const f=inputFixture();if(blocked==='lock')f.context.locked=false;else if(blocked==='shop')f.context.shop.isOpen=true;else f.context.$=()=>({hidden:false});f.down(2);f.down(0);assert.equal(f.sent.length,0);assert.equal(f.context.grenadeButtons,0);}
});
test('production equip wrapper: cancels grenade visuals before a valid switch while gun QQ ordering is unchanged',()=>{
 const source=client.slice(client.indexOf('function send(m)'),client.indexOf('function flushWeaponActions()'));
 for(const weapon of ['hegrenade','flashbang','smokegrenade','awp','ak47']){
  let cancelled=0;const order=[],context={GRENADE_KINDS,grenadePrediction:{cancel(){cancelled++;order.push('cancel');}},grenadeButtons:3,socket:{readyState:1},WebSocket:{OPEN:1},player:()=>({weapon}),canSwitchWeapon:()=>true,weaponSwitchView:{intent(m){order.push('intent');return m;}},state:{round:1,phase:'live'},weaponActionOrder:{pending:0,prepare(m){order.push('prepare');return m;}},WEAPON_ACTION_LIMIT:16,weaponActionProtocol:true,isWeaponAction:t=>t==='equip',weaponActionContext:()=>({}),transmit(){order.push('transmit');}};
  vm.runInNewContext(source,context);context.send({type:'equip',weapon:'knife'});const grenade=GRENADE_KINDS.includes(weapon);
  assert.equal(cancelled,grenade?1:0);assert.equal(context.grenadeButtons,grenade?0:3);assert.deepEqual(order,grenade?['cancel','intent','prepare','transmit']:['intent','prepare','transmit']);
 }
});
