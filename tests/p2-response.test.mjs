import test from 'node:test';
import assert from 'node:assert/strict';
import {createAwpView,SCOPE_VIEW_PROTOCOL} from '../public/awp-view.js';
import {applyScopeAwareAction} from '../scope-actions.mjs';
import {GameConnection} from '../public/game-connection.js';
import {createNetworkDiagnostics} from '../public/network-diagnostics.js';
import {Game} from '../game.mjs';
import {hitboxAnimation,playerHitboxes} from '../hitboxes.mjs';
const initial=()=>({weapon:'awp',alive:true,zoom:90,ammo:10,reserve:30,nextSecondaryAt:0,reloadAt:0,ackInputSeq:0,shotsFired:0});
function viewFixture(){const v=createAwpView(),p=initial();v.observe(p,{round:1,stateTime:10,protocol:SCOPE_VIEW_PROTOCOL,nowMs:0});return {v,p,intent:(type,time=10,extra={})=>v.intent({type,...extra},p,{round:1,stateTime:time,phase:'live',nowMs:(time-10)*1000,canSwitch:extra.canSwitch}),zoom:(time=10,nowMs=(time-10)*1000)=>v.zoom(p,{stateTime:time,nowMs})};}
function ack(m,extra={}){return {type:'scopeAck',protocol:SCOPE_VIEW_PROTOCOL,scopeSeq:m.scopeSeq,round:1,time:10,ok:true,weapon:'awp',zoom:40,nextSecondaryAt:10.3,...extra};}
test('AWP first/second/unzoom responds before ACK and never mutates authoritative gun state',()=>{
 const {v,p,intent,zoom}=viewFixture(),before=structuredClone(p);
 const a=intent('secondary');assert.equal(zoom(),40);v.confirm(ack(a));assert.equal(zoom(),40);
 const b=intent('secondary',10.31);assert.equal(zoom(10.31),10);v.confirm(ack(b,{time:10.31,zoom:10,nextSecondaryAt:10.61}));
 const c=intent('secondary',10.62);assert.equal(zoom(10.62),90);v.confirm(ack(c,{time:10.62,zoom:90}));assert.equal(v.diagnostics().pending,0);assert.deepEqual(p,before);
});
test('AWP rapid secondary within cooldown is acknowledged without inventing an extra zoom',()=>{
 const {v,intent,zoom}=viewFixture(),a=intent('secondary'),b=intent('secondary',10.05);assert.equal(zoom(10.05),40);
 v.confirm(ack(a));v.confirm(ack(b,{ok:false}));assert.equal(zoom(10.1),40);assert.equal(v.diagnostics().rejected,1);
});
test('AWP server rejection rolls the view back and ignores old or foreign acknowledgements',()=>{
 const {v,intent,zoom}=viewFixture(),a=intent('secondary');assert.equal(zoom(),40);
 assert.equal(v.confirm(ack(a,{round:2})),false);assert.equal(v.confirm(ack(a,{protocol:'old'})),false);
 assert.equal(v.confirm(ack(a,{ok:false,zoom:90})),true);assert.equal(zoom(),90);assert.equal(v.confirm(ack(a)),false);
});
test('old snapshot cannot rewind reliable scope acknowledgement; late ACK cannot rewind newer state',()=>{
 const {v,p,intent,zoom}=viewFixture(),a=intent('secondary');v.confirm(ack(a));
 v.observe(p,{round:1,stateTime:10,protocol:SCOPE_VIEW_PROTOCOL,nowMs:50});assert.equal(zoom(10.05),40);
 const b=intent('secondary',10.4);v.observe({...p,zoom:90},{round:1,stateTime:10.5,protocol:SCOPE_VIEW_PROTOCOL,nowMs:500});
 assert.equal(v.confirm(ack(b,{time:10.4,zoom:10})),true);assert.equal(zoom(10.5),90);assert.equal(v.diagnostics().pending,0);
});
test('predicted AWP shot exits scope immediately, stays out through stale states and confirms normal auto-rescope',()=>{
 const {v,p,intent,zoom}=viewFixture(),a=intent('secondary');v.confirm(ack(a));
 v.shot({weapon:'awp',seq:20,ordinal:1},{stateTime:10.4,nowMs:400});assert.equal(zoom(10.4),90);
 v.observe({...p,zoom:40,nextSecondaryAt:10.3},{round:1,stateTime:10.5,protocol:SCOPE_VIEW_PROTOCOL,nowMs:500});assert.equal(zoom(10.5),90);
 intent('secondary',10.6);assert.equal(zoom(10.6),90,'pending shot still owns secondary cooldown');
 v.observe({...p,zoom:90,shotsFired:1,ackInputSeq:20,nextSecondaryAt:11.85,resumeZoomAt:11.85,resumeZoom:40},{round:1,stateTime:10.7,protocol:SCOPE_VIEW_PROTOCOL,nowMs:700});
 assert.equal(zoom(11),90);assert.equal(zoom(11.86),40);
});
test('rejected predicted shot restores scoped view without changing authoritative ammo or spread',()=>{
 const {v,p,intent,zoom}=viewFixture(),a=intent('secondary');v.confirm(ack(a));
 v.shot({weapon:'awp',seq:20,ordinal:1},{stateTime:10.4,nowMs:400});
 v.observe({...p,zoom:40,ackInputSeq:20,nextSecondaryAt:10.3},{round:1,stateTime:10.5,protocol:SCOPE_VIEW_PROTOCOL,nowMs:500});assert.equal(zoom(10.5),40);assert.equal(v.diagnostics().shotRollbacks,1);assert.equal(p.ammo,10);
});
test('quick switch away and back cancels AWP auto-rescope even when no pistol snapshot was rendered',()=>{
 const {v,p,intent,zoom}=viewFixture(),a=intent('secondary');v.confirm(ack(a));
 v.shot({weapon:'awp',seq:20,ordinal:1},{stateTime:10.4,nowMs:400});const b=intent('equip',10.5,{weapon:2,canSwitch:true});assert.equal(zoom(10.5),90);
 v.confirm(ack(b,{time:10.5,weapon:'glock18',zoom:90,nextSecondaryAt:0}));
 v.observe({...p,zoom:90,resumeZoomAt:0,ackInputSeq:21,shotsFired:1},{round:1,stateTime:10.6,protocol:SCOPE_VIEW_PROTOCOL,nowMs:600});assert.equal(zoom(12),90);
});
for(const [name,change]of [['reload',{type:'reload',ammo:9}],['drop',{type:'drop'}],['valid equip',{type:'equip',canSwitch:true}],['invalid equip',{type:'equip',canSwitch:false}]])test(`AWP ${name} handles zoom exit and rejected action`,()=>{
 const {v,p,intent,zoom}=viewFixture();p.ammo=change.ammo??10;v.confirm(ack(intent('secondary')));
 const b=intent(change.type,10.4,change);assert.equal(zoom(10.4),name==='invalid equip'?40:90);v.confirm(ack(b,{time:10.4,ok:false,zoom:40}));assert.equal(zoom(10.5),40);
});
test('death, weapon identity, round reset, unsupported server and expiry discard visual prediction',()=>{
 for(const mode of ['death','weapon','round','old-server','expiry']){
  const {v,p,intent,zoom}=viewFixture();intent('secondary');
  if(mode==='expiry')assert.equal(zoom(16,6000),90);
  else{const q={...p,...(mode==='death'?{alive:false}:mode==='weapon'?{weapon:'knife'}:{})};v.observe(q,{round:mode==='round'?2:1,stateTime:10.1,protocol:mode==='old-server'?undefined:SCOPE_VIEW_PROTOCOL,nowMs:100});assert.equal(v.zoom(q,{stateTime:10.1,nowMs:100}),90);}
  assert.equal(v.diagnostics().pending,0);
 }
 const v=createAwpView(),p=initial();v.observe(p,{round:1,stateTime:10});assert.deepEqual(v.intent({type:'secondary'},p,{round:1,stateTime:10,phase:'live'}),{type:'secondary'});
});
test('local pending controls are bounded and round-frozen scope is not predicted',()=>{
 const {v,p,intent}=viewFixture();assert.equal(v.intent({type:'secondary'},p,{round:1,stateTime:10,phase:'countdown'}).scopeSeq,undefined);
 for(let i=0;i<100;i++)intent('secondary');assert.equal(v.diagnostics().pending,16);
});
function gameFixture(){const g=new Game({random:()=>.5}),p=g.add('p','Test','T');g.begin();g.time=10;g.buy(p.id,'awp');p.nextAttackAt=p.nextSecondaryAt=0;return {g,p};}
test('scope ACK wraps existing authority, preserves legacy actions and rejects invalid round/sequence',()=>{
 const {g,p}=gameFixture();assert.equal(g.snapshot(p.id).scopeProtocol,SCOPE_VIEW_PROTOCOL);
 const a=applyScopeAwareAction(g,p.id,{type:'secondary',round:g.round,scopeSeq:1});assert.equal(a.ok,true);assert.equal(a.zoom,40);assert.equal(p.zoom,40);
 const b=applyScopeAwareAction(g,p.id,{type:'secondary',round:g.round,scopeSeq:2});assert.equal(b.ok,false);assert.equal(b.zoom,40);
 g.time+=.31;assert.equal(applyScopeAwareAction(g,p.id,{type:'secondary'}),null);assert.equal(p.zoom,10);
 for(const scopeSeq of [0,-1,1.5,2147483648])assert.throws(()=>applyScopeAwareAction(g,p.id,{type:'secondary',round:g.round,scopeSeq}));
 assert.throws(()=>applyScopeAwareAction(g,p.id,{type:'drop',round:g.round+1,scopeSeq:3}));assert.equal(p.weapon,'awp');
});
test('scope ACK observes actual reload/equip/drop results without changing gun rules',()=>{
 const {g,p}=gameFixture();p.ammo=9;let m={round:g.round,scopeSeq:1};assert.equal(applyScopeAwareAction(g,p.id,{...m,type:'reload'}).ok,true);assert.ok(p.reloadAt>g.time);
 assert.equal(applyScopeAwareAction(g,p.id,{...m,scopeSeq:2,type:'equip',weapon:'invalid'}).ok,false);
 assert.equal(applyScopeAwareAction(g,p.id,{...m,scopeSeq:3,type:'equip',weapon:2}).ok,true);assert.equal(p.zoom,90);
 assert.equal(applyScopeAwareAction(g,p.id,{...m,scopeSeq:4,type:'drop'}).ok,true);
});
class OfflineConnection extends GameConnection{connect(){}}
const connection=()=>new OfflineConnection({mode:'websocket',deferStates:true});
test('snapshot burst processes only newest state; reliable controls and hit events are immediate',()=>{
 const c=connection(),delivered=[],arrivals=[];c.onmessage=e=>delivered.push(JSON.parse(e.data));c.onstatearrival=(m,e)=>arrivals.push({m,at:e.receivedAtMs});
 for(let i=1;i<=40;i++)c.deliver({type:'state',time:i/30,net:{seq:i}});
 c.deliver({type:'events',events:[{type:'shot'}]});c.deliver({type:'scopeAck'});assert.deepEqual(delivered.map(m=>m.type),['events','scopeAck']);
 c.flushState();assert.equal(delivered.at(-1).net.seq,40);assert.equal(arrivals.length,40);assert.equal(c.diagnostics().coalescedStates,39);c.flushState();assert.equal(delivered.length,3);
 c.deliver({type:'state',net:{seq:39}});assert.equal(c.diagnostics().staleStates,1);assert.equal(arrivals.length,40);
 c.deliver({type:'state',net:{seq:41}});c.finish();c.flushState();assert.equal(delivered.length,3);
});
test('coalescing preserves actual receipt timestamps and counts all arrivals without inventing loss',()=>{
 const c=connection(),d=createNetworkDiagnostics({now:()=>1000}),times=[];c.onstatearrival=(m,e)=>{times.push(e.receivedAtMs);d.state(m,e.data.length,e.receivedAtMs);};c.onmessage=e=>assert.equal(e.receivedAtMs,times.at(-1));
 for(let i=1;i<=4;i++)c.deliver({type:'state',time:i/30,net:{seq:i,emittedAtMs:i*1000/30}});c.flushState();const r=d.snapshot();assert.equal(r.totals.receivedStates,4);assert.equal(r.metrics.snapshotSequenceGap,undefined);assert.ok(Math.abs(r.metrics.stateArrivalIntervalMs.max-Math.max(...times.slice(1).map((v,i)=>v-times[i])))<1e-6);
});
test('legacy fixtures and default connection deliver states immediately',()=>{
 for(const c of [connection(),new OfflineConnection({mode:'websocket'})]){const out=[];c.onmessage=e=>out.push(JSON.parse(e.data));c.deliver({type:'state',time:1});assert.equal(out.length,1);}
});
test('automatic fire lets the shared flinch animation advance; head reaction has priority',()=>{
 const {g,p}=gameFixture(),q=g.add('q','Target','CT');g.phase='live';q.hp=10000;g.damage(q,1,p,{kind:'mp5navy',hitgroup:'chest'});const started=q.flinchAt;
 g.time+=.08;const before=hitboxAnimation(q,g.time);g.damage(q,1,p,{kind:'mp5navy',hitgroup:'chest'});assert.equal(q.flinchAt,started);assert.equal(hitboxAnimation(q,g.time).playerFrame,before.playerFrame);assert.ok(before.playerFrame>0);
 g.time+=.02;g.damage(q,1,p,{kind:'ak47',hitgroup:'head'});assert.equal(q.flinchAt,g.time);assert.equal(q.flinchHead,true);const headStart=g.time;
 g.time+=.07;g.damage(q,1,p,{kind:'mp5navy',hitgroup:'chest'});assert.equal(q.flinchAt,headStart);assert.equal(q.flinchHead,true);
 g.time+=.1;g.damage(q,1,p,{kind:'mp5navy',hitgroup:'chest'});assert.equal(q.flinchAt,g.time);assert.equal(q.flinchHead,false);assert.equal(q.hp,9995);
 const snap=g.snapshot(p.id).players.find(v=>v.id===q.id);assert.equal(snap.playerFrame,hitboxAnimation(q,g.time).playerFrame);assert.deepEqual(playerHitboxes(snap,g.time),playerHitboxes(q,g.time));
});

test('other scoped guns retain every original authoritative FOV and sensitivity level',()=>{
 const v=createAwpView();for(const weapon of ['aug','sg552','scout','g3sg1','sg550'])for(const zoom of [90,55,40,15]){const p={...initial(),weapon,zoom};v.observe(p,{round:1,stateTime:10,protocol:SCOPE_VIEW_PROTOCOL});assert.equal(v.zoom(p),zoom);assert.deepEqual(v.intent({type:'secondary'},p,{round:1,stateTime:10,phase:'live'}),{type:'secondary'});}
});
