import test from 'node:test';
import assert from 'node:assert/strict';
import {createCS2ShotDiagnostics} from '../public/cs2-shot-diagnostics.js';
const create=options=>createCS2ShotDiagnostics({enabled:true,...options});
const state=patch=>({round:2,time:20,weapon:'ak47',ammo:29,shotsFired:1,reloadAt:0,ackInputSeq:6,...patch});
const shot=patch=>({round:2,time:19.4,weapon:'ak47',shotOrdinal:1,shotId:'2:p:1',eventId:10,inputSeq:6,...patch});
const predicted=patch=>({round:2,weapon:'ak47',ordinal:1,seq:6,...patch});
const row=(d,kind)=>d.report().records.filter(r=>r.kind===kind).at(-1);

test('off is inert even for invalid capacities, clocks, getters and input objects',()=>{
 const d=createCS2ShotDiagnostics({maxRecords:NaN}),danger=new Proxy({},{get(){throw Error('read');}});
 for(const method of ['stateArrival','predicted','shot','effect','submitted','reset'])assert.equal(d[method](danger,NaN),null);
 assert.deepEqual(d.report({transport:'webtransport'}),{schema:'cs2-shot-diagnostics-v1',enabled:false,transport:'webtransport'});
 assert.equal(Object.isFrozen(d),true);
});
test('active capacities fail explicitly and support tiny bounded buffers',()=>{
 for(const maxRecords of [0,-1,1.5,4097,NaN,Infinity])assert.throws(()=>create({maxRecords}),RangeError);
 assert.equal(create({maxRecords:1}).report().maxRecords,1);
});
test('authority leads use only same server clock while local stages use performance milliseconds',()=>{
 const d=create(),e=shot();d.stateArrival(state(),100000);d.predicted(predicted(),100001);
 d.shot(e,100101,state({time:19.8}));d.effect(e,100104,{added:true,decalCount:1});d.submitted(100110);
 const r=d.report({transport:'webtransport'}),s=r.records.find(r=>r.kind==='shot'),f=r.records.find(r=>r.kind==='effect');
 assert.ok(Math.abs(s.receivedStateLeadMs-600)<1e-8);assert.ok(Math.abs(s.appliedStateLeadMs-400)<1e-8);
 assert.equal(s.predictionToReceiptMs,100);assert.equal(f.receiptToEffectMs,3);assert.equal(f.effectToSubmissionMs,6);assert.equal(f.receiptToSubmissionMs,9);assert.equal(f.predictionToSubmissionMs,109);
 assert.equal(r.totals.receivedStateLeadOver100Ms,1);assert.equal(r.totals.receivedStateLeadOver500Ms,1);assert.equal(r.totals.appliedStateLeadOver500Ms,0);
 assert.equal(r.summary.predictionToFirstAuthorityReceiptMs.p50,100);assert.equal(r.totals.submittedEffects,1);
 assert.equal(f.submissionRecordSeq,r.records.at(-1).seq);assert.match(r.submission,/not GPU/);
});
test('penetration segments share one predicted shot without being labeled duplicate events',()=>{
 const d=create(),a=shot(),b=shot({eventId:11});d.predicted(predicted(),10);d.shot(a,20,state());d.shot(b,21,state());
 d.effect(a,22,{added:true,decalCount:1});d.effect(b,23,{added:true,decalCount:2});d.submitted(30);
 const r=d.report(),events=r.records.filter(r=>r.kind==='shot');assert.deepEqual(events.map(r=>r.firstSegmentForShot),[true,false]);assert.deepEqual(events.map(r=>r.duplicateEvent),[false,false]);
 assert.equal(r.totals.shotEvents,2);assert.equal(r.totals.uniqueAuthorityShots,1);assert.equal(r.totals.predictionMatches,1);assert.equal(r.summary.predictionToFirstAuthorityReceiptMs.samples,1);assert.equal(r.totals.submittedEffects,2);
 assert.notEqual(r.records.find(r=>r.kind==='effect').shotRecordSeq,r.records.filter(r=>r.kind==='effect')[1].shotRecordSeq);
});
test('exact event IDs and repeated object identity are observed as duplicates, with bounded counting',()=>{
 const d=create(),a=shot();d.stateArrival(state(),1);d.shot(a,2,state());d.shot({...a},3,state());d.shot(a,4,state());
 const r=d.report();assert.equal(r.totals.shotEvents,3);assert.equal(r.totals.uniqueAuthorityShots,1);assert.equal(r.totals.duplicateShotEvents,2);assert.equal(r.totals.receivedStateLeadOver500Ms,1);assert.equal(r.summary.receivedStateLeadMs.samples,1);
 const b=shot({eventId:undefined});d.shot(b,5);d.shot({...b},6);assert.equal(d.report().records.at(-1).duplicateEvent,false);
});
test('matching requires round and weapon as well as ordinal; authoritative presentations are excluded',()=>{
 const d=create();d.predicted(predicted(),1);d.shot(shot({weapon:'m4a1'}),2);assert.equal(row(d,'shot').predictionRecordSeq,null);
 d.predicted(predicted({ordinal:2,auth:true}),3);d.shot(shot({shotOrdinal:2,shotId:'second',eventId:11}),4);assert.equal(row(d,'shot').predictionRecordSeq,null);
 d.shot(shot({round:1,eventId:12}),5);assert.equal(row(d,'shot').predictionRecordSeq,null);
 d.predicted(predicted({weapon:undefined}),6);assert.equal(d.report().totals.invalidIdentity,1);
});
test('reload state receipts expose previously seen sequence and later event arrival',()=>{
 const d=create(),e=shot();d.shot(e,1);d.stateArrival(state({ammo:0,reloadAt:22,time:20,shotsFired:30,ack:180}),2);
 d.shot(shot({shotOrdinal:30,shotId:'last',eventId:40,time:19.9}),502,state({time:20,ammo:0,reloadAt:22}));
 const r=d.report(),reload=r.summary.reloadStateArrivals[0];assert.equal(reload.shotEventsSeen,1);assert.equal(reload.lastEventId,10);assert.equal(reload.lastShotOrdinal,1);assert.equal(reload.ack,180);
 assert.equal(row(d,'shot').afterReloadStateArrivalMs,500);assert.equal(row(d,'shot').latestReloadStateRecordSeq,reload.seq);assert.equal(r.summary.firstEventId,10);assert.equal(r.summary.lastEventId,40);
 d.stateArrival(state({reloadAt:22}),503);assert.equal(d.report().totals.reloadStateArrivals,2);assert.equal(d.report().totals.reloadTransitions,1);
});
test('accepted FX at full decal capacity still waits for the next actual submission',()=>{
 const d=create();for(let i=0;i<2;i++){const e=shot({eventId:10+i,shotId:'s'+i,shotOrdinal:i+1});d.shot(e,i*10);d.effect(e,i*10+1,{added:true,decalCount:512});}
 assert.equal(d.report().totals.addedWithoutCountIncrease,1);assert.equal(d.report().totals.pendingEffects,2);assert.equal(d.report().totals.submissions,0);
 d.submitted(20);assert.equal(d.report().totals.submittedEffects,2);d.submitted(30);assert.equal(d.report().totals.submittedEffects,2);
 const e=shot({eventId:99});d.shot(e,40);d.effect(e,41,{added:false,decalCount:512});d.submitted(50);assert.equal(d.report().totals.effectsRejected,1);assert.equal(d.report().totals.submittedEffects,2);
});
test('invalid clocks are rejected and out-of-order clocks remain visible without negative latency',()=>{
 const d=create();for(const at of [NaN,Infinity,-1,undefined])for(const method of ['stateArrival','predicted','shot','effect','submitted'])d[method](method==='submitted'?at:shot(),at);
 assert.equal(d.report().totals.invalidClock,20);assert.equal(d.report().retainedRecords,0);
 d.predicted(predicted(),100);const e=shot();d.shot(e,90);assert.equal(row(d,'shot').clockOutOfOrder,true);assert.equal(row(d,'shot').predictionToReceiptMs,null);
 d.effect(e,80,{added:true,decalCount:1});assert.equal(row(d,'effect').receiptToEffectMs,null);d.submitted(70);assert.equal(d.report().totals.pendingEffects,1);d.submitted(110);
 assert.equal(row(d,'effect').effectToSubmissionMs,30);assert.equal(d.report().summary.predictionToFirstAuthorityReceiptMs.samples,0);assert.ok(d.report().totals.negativeDurations>=3);
});
test('state regression and receipt reordering are diagnosed without cross-round authority subtraction',()=>{
 const d=create();d.stateArrival(state({time:21}),100);d.stateArrival(state({time:20}),110);assert.equal(row(d,'state').serverClockRegressed,true);
 d.stateArrival(state({time:19}),90);d.shot(shot(),120,state({round:1}));const e=row(d,'shot');assert.equal(e.receivedAuthority.time,20);assert.equal(e.appliedStateLeadMs,null);assert.equal(d.report().totals.outOfOrderStates,2);
 d.shot(shot({eventId:11,time:NaN}),121);assert.equal(row(d,'shot').receivedStateLeadMs,null);
 d.shot(shot({eventId:12,time:-Number.MAX_VALUE}),122,state({time:Number.MAX_VALUE}));assert.equal(row(d,'shot').appliedStateLeadMs,null);
});
test('a new round retires matching and pending effects without clearing retained evidence',()=>{
 const d=create(),a=shot();d.predicted(predicted(),1);d.shot(a,2);d.effect(a,3,{added:true,decalCount:512});
 d.stateArrival(state({round:3,time:0,ammo:30,shotsFired:0}),4);assert.equal(d.report().totals.unsubmittedOnRoundChange,1);assert.equal(row(d,'effect').canceledByRoundChange,true);
 const b=shot({round:3,eventId:1,time:0,shotId:'new'});d.shot(b,5);d.effect(b,6,{added:true,decalCount:1});assert.equal(row(d,'effect').countDidNotIncrease,false);assert.equal(row(d,'shot').predictionRecordSeq,null);d.submitted(7);assert.equal(d.report().totals.submittedEffects,1);assert.equal(d.report().totals.roundChanges,1);
});
test('ring overflow bounds retained evidence and pending effects, and reports censoring',()=>{
 const d=create({maxRecords:2}),a=shot();d.shot(a,1);d.effect(a,2,{added:true,decalCount:1});d.stateArrival(state(),3);d.stateArrival(state(),4);
 let r=d.report();assert.equal(r.retainedRecords,2);assert.equal(r.totals.overwrittenRecords,2);assert.equal(r.totals.unsubmittedOverwritten,1);assert.equal(r.totals.pendingEffects,0);assert.deepEqual(r.records.map(r=>r.seq),[3,4]);
 for(let i=0;i<1000;i++){const e=shot({eventId:100+i,shotId:'many'+i,shotOrdinal:i+1});d.shot(e,5+i*2);d.effect(e,6+i*2,{added:true,decalCount:512});}
 r=d.report();assert.equal(r.retainedRecords,2);assert.ok(r.totals.pendingEffects<=2);assert.equal(r.totals.records,2004);d.submitted(3000);assert.equal(d.report().totals.pendingEffects,0);
});
test('reset starts a clean capture and reports return detached whitelisted data only',()=>{
 const d=create(),e=shot({nickname:'secret',from:{x:1},players:[{name:'private'}]});d.stateArrival(state({name:'private',players:[1]}),1);d.shot(e,2);d.effect(e,3,{added:true,decalCount:1});
 const report=d.report();report.records[0].state.time=999;report.records[1].receivedAuthority.ammo=999;report.totals.shotEvents=999;
 assert.equal(d.report().records[0].state.time,20);assert.equal(d.report().totals.shotEvents,1);assert.doesNotMatch(JSON.stringify(d.report()),/secret|private|nickname|players|positionTrace/);assert.equal(e.nickname,'secret');
 assert.equal(d.reset(),true);const r=d.report();assert.equal(r.retainedRecords,0);assert.equal(r.currentRound,null);assert.equal(r.totals.shotEvents,0);assert.equal(r.totals.resets,1);assert.equal(r.totals.pendingEffects,0);
});
test('blank/overlong IDs fall back safely and unsafe numeric IDs are not silently rounded',()=>{
 const d=create();for(let i=1;i<=3;i++)d.shot(shot({shotOrdinal:i,shotId:i===3?'x'.repeat(161):' ',eventId:i===3?Number.MAX_SAFE_INTEGER+1:''}),i);
 const r=d.report();assert.equal(r.totals.uniqueAuthorityShots,3);assert.equal(r.totals.duplicateShotEvents,0);assert.ok(r.records.every(e=>e.shotId===null&&e.eventId===null));
 d.shot(shot({shotId:'a',eventId:'9007199254740992'}),4);d.shot(shot({shotId:'b',eventId:'9007199254740993'}),5);assert.equal(d.report().totals.duplicateShotEvents,0);
});
test('negative authority clocks cannot create state-lead samples; hit flags do not copy coordinates',()=>{
 const d=create();d.stateArrival(state({time:-1,reloadAt:-1}),1);d.shot(shot({time:-2,hit:true,impact:{position:{x:99}}}),2,state({time:-1}));
 const r=d.report(),e=row(d,'shot');assert.equal(e.receivedStateLeadMs,null);assert.equal(e.appliedStateLeadMs,null);assert.equal(r.totals.reloadStateArrivals,0);assert.equal(e.hitPlayer,true);assert.equal(e.hasWallImpact,true);assert.doesNotMatch(JSON.stringify(r),/"position"|"x"/);assert.equal(Object.hasOwn(e,'impact'),false);
});
test('held source events do not grow diagnostic associations past capacity; overflow loses strict object joins explicitly',()=>{
 const d=create({maxRecords:3}),held=[];for(let i=1;i<=200;i++){const e=shot({eventId:i,shotId:'s'+i,shotOrdinal:i});held.push(e);d.shot(e,i);}
 assert.ok(Object.values(d.report().retainedAssociations).every(n=>n<=3));d.effect(held[0],201,{added:true,decalCount:1});assert.equal(row(d,'effect').shotRecordSeq,null);
 d.stateArrival(state({round:3,time:0}),202);d.shot(shot({round:2,eventId:300}),203);assert.equal(row(d,'shot').staleRound,true);assert.equal(row(d,'shot').predictionRecordSeq,null);assert.equal(row(d,'shot').receivedStateLeadMs,null);
});
