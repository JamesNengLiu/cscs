import test from 'node:test';
import assert from 'node:assert/strict';
import {GameConnection} from '../public/game-connection.js';
import {createSnapshotBuffer} from '../public/snapshot-buffer.js';
import {remoteExtrapolationSafe,remoteGapSafe,predictionCorrectionLimit} from '../public/network-continuity.js';
import {visualCorrection,decayCorrection} from '../public/prediction.js';
import {flatSlowdownPose} from './fixtures/hit-slowdown-cases.mjs';
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const player=(patch={})=>flatSlowdownPose({id:'remote',x:-21,vx:6.25,yaw:-Math.PI/2,...patch});
const state=(time,p,round=1)=>({type:'state',time,round,players:[p],net:{seq:Math.round(time*1000)+1}});
class Offline extends GameConnection{connect(){}}
const connection=()=>new Offline({mode:'websocket',deferStates:true});
const fixed=options=>createSnapshotBuffer({minDelayMs:0,maxDelayMs:0,...options});

test('snapshot coalescing retains intermediate render samples but reconciles authority only once',()=>{
 const c=connection(),b=fixed(),delivered=[];let history;
 c.onstatehistory=entries=>{history=entries;b.pushBatch(entries.map(e=>({...e,receivedAtMs:1000})));};c.onmessage=e=>delivered.push(e);
 for(let i=0;i<8;i++)c.deliver(state(i/30,player({x:-21+i/30*6.25})));
 c.flushState();assert.equal(delivered.length,1);assert.equal(delivered[0].timelineBuffered,true);assert.equal(history.length,8);
 assert.equal(b.diagnostics().accepted,8);assert.equal(b.diagnostics().clockSamples,1);assert.equal(b.diagnostics().largestEntityBuffer,8);
 assert.equal(c.diagnostics().pendingTimelineStates,0);c.finish();
});
test('timeline queue has a fixed bound and close cannot replay retained states',()=>{
 const c=connection();for(let i=0;i<100;i++)c.deliver(state(i/30,player()));
 assert.equal(c.diagnostics().pendingTimelineStates,32);assert.equal(c.diagnostics().droppedTimelineStates,68);
 let callbacks=0;c.onstatehistory=()=>callbacks++;c.finish();c.flushState();assert.equal(callbacks,0);assert.equal(c.diagnostics().pendingTimelineStates,0);
});
test('a local callback burst keeps all positions without treating each old packet as fresh clock jitter',()=>{
 const b=fixed();b.push(state(0,player()),1000);b.push(state(.1,player({x:-20.375})),1100);
 b.sample('remote',1100);
 const entries=[.2,.3,.4].map(t=>({snapshot:state(t,player({x:-21+t*6.25})),receivedAtMs:1400}));b.pushBatch(entries);
 assert.equal(b.diagnostics().jitterMs,0);assert.equal(b.diagnostics().clockSamples,3);assert.equal(b.diagnostics().accepted,5);
 assert.equal(b.pushBatch(Array(33).fill(entries[0])),false);assert.equal(b.diagnostics().accepted,5);
});
for(const hz of [30,60,144])test(`recovery playback advances at most 1.2x real time, ${hz}Hz`,()=>{
 const b=fixed({maxPlaybackRate:1.2,maxBridgeGapMs:500,canBridgeGap:()=>true});b.push(state(0,player()),1000);b.sample('remote',1000);
 for(let t=1000+1000/hz;t<1400;t+=1000/hz)b.sample('remote',t);
 const old=b.diagnostics().playbackTimeMs;b.push(state(.4,player({x:-18.5})),1400);
 const first=b.sample('remote',1400),at=b.diagnostics().playbackTimeMs;assert.ok(at-old<=1.2*1000/hz+1e-6);
 for(let i=1;i<8;i++){const before=b.diagnostics().playbackTimeMs;b.sample('remote',1400+i*1000/hz);assert.ok(b.diagnostics().playbackTimeMs-before<=1.2*1000/hz+1e-6);}
 assert.ok(first.x<-18.5);assert.equal(b.diagnostics().bridgedGaps,1);
});
test('multiple actors and same-arrival packet bursts cannot multiply the shared playback budget',()=>{
 const b=fixed({maxPlaybackRate:1.2,maxBridgeGapMs:500,canBridgeGap:()=>true});b.push(state(0,player()),1000);b.sample('remote',1000);
 b.pushBatch([.3,.35,.4].map(t=>({snapshot:state(t,player({x:-21+t*6.25})),receivedAtMs:1400})));
 b.sample('remote',1400);const before=b.diagnostics().playbackTimeMs;
 for(let i=0;i<10;i++)b.sample('remote',1416);assert.ok(b.diagnostics().playbackTimeMs-before<=19.2+1e-8);
});
for(const mode of ['missing','false','throw','too-long','death','spawn','teleport'])test(`unsafe gap still resets history: ${mode}`,()=>{
 const opts={maxBridgeGapMs:500,canBridgeGap:()=>true};if(mode==='missing')delete opts.canBridgeGap;if(mode==='false')opts.canBridgeGap=()=>false;if(mode==='throw')opts.canBridgeGap=()=>{throw Error('blocked');};
 const b=fixed(opts);b.push(state(0,player()),1000);const patch=mode==='death'?{alive:false}:mode==='spawn'?{spawnId:2}:mode==='teleport'?{teleport:true}:{};
 b.push(state(mode==='too-long'?.6:.4,player({x:-19,...patch})),1600);assert.equal(b.diagnostics().largestEntityBuffer,1);assert.equal(b.diagnostics().bridgedGaps,0);
});
test('known flat-ground gap bridges only a collision-safe segment and callback mutations are detached',()=>{
 const b=fixed({maxBridgeGapMs:500,canBridgeGap:(a,z,c)=>{const safe=remoteGapSafe(a,z,c);a.x=999;z.x=999;return safe;}});
 b.push(state(0,player()),1000);b.push(state(.4,player({x:-18.5})),1400);assert.equal(b.diagnostics().bridgedGaps,1);assert.equal(b.sample('remote',1400).x,-18.5);
});
test('safe extrapolation only spans a short, stable, supported flat-ground segment',()=>{
 const p=player(),to={...p,x:p.x+.25};assert.equal(remoteExtrapolationSafe(p,to,{previous:{...p},dtSeconds:.04}),true);
 const b=fixed({extrapolation:'velocity',maxExtrapolationMs:50,canExtrapolate:remoteExtrapolationSafe});
 b.push(state(0,player()),1000);b.push(state(.1,player({x:-20.375})),1100);
 near(b.sample('remote',1140).x,-20.125);near(b.sample('remote',1300).x,-20.0625);near(b.sample('remote',1600).x,-20.0625);
});
for(const [name,patch]of [['air',{grounded:false,vy:3}],['duck transition',{ducking:true}],['fast',{vx:12}],['direction reversal',{vx:-3}],['dead',{alive:false}],['stance',{crouch:true}],['missing velocity',{vx:NaN}]])test(`no extrapolation through ${name}`,()=>{
 const p=player(patch),to={...p,x:p.x+.2};assert.equal(remoteExtrapolationSafe(p,to,{previous:player(),dtSeconds:.04}),false);
});
test('same-direction acceleration can use the latest bounded velocity without freezing',()=>{
 const p=player({vx:3}),to={...p,x:p.x+.12};assert.equal(remoteExtrapolationSafe(p,to,{previous:player({vx:1}),dtSeconds:.04}),true);
});
test('local long-frame suspension retains history and resumes clock from the pre-stall anchor',()=>{
 const b=fixed();b.push(state(0,player()),1000);b.push(state(.1,player({x:-20.375})),1100);
 b.pushBatch([{snapshot:state(.2,player({x:-19.75})),receivedAtMs:1400}],{updateClock:false});assert.equal(b.diagnostics().clockSamples,2);assert.equal(b.diagnostics().clockBatchSuspensions,1);
 b.pushBatch([{snapshot:state(.5,player({x:-17.875})),receivedAtMs:1500}]);assert.equal(b.diagnostics().jitterMs,0);assert.equal(b.diagnostics().accepted,4);
 const first=fixed();first.pushBatch([{snapshot:state(0,player()),receivedAtMs:1000}],{updateClock:false});assert.ok(first.sample('remote',1000));
});
test('wall, ledge, slope-height change and nearby bodies reject smoothing across geometry',()=>{
 const wall=player({x:-18.4,z:16.6,vx:0,vz:-6.25});assert.equal(remoteExtrapolationSafe(wall,{...wall,z:16.2},{previous:{...wall},dtSeconds:.05}),false);
 const ledge=player({x:11.6,y:2.40078125,z:-37.8,vx:0,vz:-6.25});assert.equal(remoteExtrapolationSafe(ledge,{...ledge,z:-38.2},{previous:{...ledge},dtSeconds:.05}),false);
 const p=player();assert.equal(remoteGapSafe(p,{...p,x:p.x+1,y:p.y-.2},{dtSeconds:.3}),false);
 assert.equal(remoteGapSafe(p,{...p,x:p.x+1},{dtSeconds:.3},[player({id:'other',x:p.x+.5})]),false);
 assert.equal(remoteGapSafe(p,{...p,x:p.x+8},{dtSeconds:.5}),false);
 assert.equal(remoteGapSafe(p,{...p,x:p.x+1,jumpFatigue:1000},{dtSeconds:.4}),false,'an unseen jump cannot be replaced by a straight grounded segment');
});
for(const value of [{maxPlaybackRate:.9},{maxPlaybackRate:NaN},{maxBridgeGapMs:100},{canBridgeGap:true}])test(`invalid continuity options are rejected: ${JSON.stringify(value)}`,()=>assert.throws(()=>fixed(value)));
const authority=(patch={})=>({id:'p',team:'T',alive:true,playedRound:1,recoilSeed:7,skippedInputCommands:0,...patch});
const local=(x=0)=>({x,y:0,z:0,vx:6.25,vy:0,vz:0,weapon:'knife',alive:true});
test('normal reconciliation keeps the existing half-unit cutoff and exact exponential decay',()=>{
 const context={previousAuthority:authority(),authority:authority(),intervalSeconds:1/30};assert.equal(predictionCorrectionLimit(local(),local(1),context),.5);assert.deepEqual(visualCorrection(local(),local(1)),{x:0,y:0,z:0});
 const d=decayCorrection({x:.2,y:-.1,z:.3},1/60);for(const [k,v]of Object.entries({x:.2,y:-.1,z:.3}))assert.equal(d[k],v*Math.exp(-16/60));
});
test('skipped history and a long frame preserve the displayed position without changing physics',()=>{
 const before=local(2),after=local(.7),saved=structuredClone([before,after]);
 const limit=predictionCorrectionLimit(before,after,{previousAuthority:authority(),authority:authority({skippedInputCommands:14}),intervalSeconds:1/30});assert.ok(limit>1.3&&limit<=2);
 const offset=visualCorrection(before,after,undefined,{maxDistance:limit});near(after.x+offset.x,before.x);assert.deepEqual([before,after],saved);
 assert.ok(predictionCorrectionLimit(before,after,{previousAuthority:authority(),authority:authority(),intervalSeconds:.35})>1.3);
 assert.deepEqual(visualCorrection(local(4),local(),undefined,{maxDistance:2}),{x:0,y:0,z:0});
});
test('following small snapshots do not prematurely discard an in-progress large recovery',()=>{
 const limit=predictionCorrectionLimit(local(1),local(.99),{previousAuthority:authority({skippedInputCommands:14}),authority:authority({skippedInputCommands:14}),intervalSeconds:1/30,activeRecovery:true});
 assert.equal(limit,2);assert.ok(visualCorrection(local(1),local(.99),{x:1.2,y:0,z:0},{maxDistance:limit}).x>1.2);
});
for(const [name,patch]of [['death',{alive:false}],['round',{playedRound:2}],['life',{recoilSeed:9}],['spawn',{spawnId:2}],['teleport',{teleport:true}],['team',{team:'CT'}]])test(`${name} cannot gain a recovery allowance`,()=>{
 const limit=predictionCorrectionLimit(local(),local(1),{previousAuthority:authority(),authority:authority({...patch,skippedInputCommands:14}),intervalSeconds:.35,activeRecovery:true});assert.equal(limit,.5);
});
test('large recovery has a bounded per-frame correction speed, then converges without a second cutoff',()=>{
 let p={x:1.35,y:0,z:0};for(let i=0;i<120;i++){const next=decayCorrection(p,1/60,{maxSpeed:5.625});assert.ok(p.x-next.x<=5.625/60+1e-12);assert.ok(next.x>=0&&next.x<=p.x);p=next;}assert.ok(p.x<1e-8);
 const zero=decayCorrection({x:1,y:0,z:0},0,{maxSpeed:5});assert.deepEqual(zero,{x:1,y:0,z:0});
});
