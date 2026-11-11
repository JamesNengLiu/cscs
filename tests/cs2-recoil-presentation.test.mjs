// Pure presentation invariants. No browser, server, map assets or local capture receipts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecoilPresentationClock} from '../public/cs2-recoil-presentation.js';
import {addReferenceImpulse,advanceReferencePunch,sampleReferencePunch} from '../public/cs2-recoil-state.js';
import {createCS2RecoilTable} from '../public/cs2-recoil-reference.js';
import {CS2_WEAPON_PROFILE} from '../public/cs2-weapon-profile.js';
const DT=1/60,ROUND=7,EPS=1e-11;
const FIELDS=['recoilPitch','recoilYaw','cs2RecoilPitchVelocity','cs2RecoilYawVelocity'];
const ak=CS2_WEAPON_PROFILE.guns.ak47.source;
const impulses=createCS2RecoilTable({seed:ak.m_nRecoilSeed,angle:ak.m_flRecoilAngle[0],angleVariance:ak.m_flRecoilAngleVariance[0],magnitude:ak.m_flRecoilMagnitude[0],magnitudeVariance:ak.m_flRecoilMagnitudeVariance[0],automatic:true}).map(x=>x.impulse);
const picks=p=>Object.fromEntries(FIELDS.map(k=>[k,p[k]]));
const close=(actual,expected,message)=>{for(const k of FIELDS)assert.ok(Math.abs(actual[k]-expected[k])<=EPS,`${message}: ${k} ${actual[k]} versus ${expected[k]}`);};
function sourceAt(shots,at,{weapon='ak47',ack}={}){const p={id:'pure-fixture',weapon,alive:true,hp:100,flinchAt:-100,playedRound:ROUND,ackInputSeq:0,shotsFired:0,recoilPitch:0,recoilYaw:0};for(let i=0;i<shots.length;i++){const s=shots[i];if(s.at>at+1e-10)break;addReferenceImpulse(p,s.impulse,s.at);p.shotsFired=i+1;p.lastShot=s.at;}advanceReferencePunch(p,0,at);p.ackInputSeq=ack??p.shotsFired;return p;}
function sampleAt(source,targetTime){const q={...source};let left=targetTime-q.cs2PunchTime;assert.ok(left>=-1e-10);while(left>1e-12){const step=Math.min(DT,left);Object.assign(q,sampleReferencePunch(q,step));left-=step;}return q;}
const make=()=>createRecoilPresentationClock({sampleRecoil:sampleReferencePunch});
const sampled=(clock,source,nowMs,fractionSeconds=0,authority=source)=>clock.sample(source,{round:ROUND,nowMs,fractionSeconds,active:true,authority});
function markerFor(shots,index,{weapon='ak47'}={}){const shot=shots[index],prior=sourceAt(shots.slice(0,index),shot.at,{weapon}),after={...prior};addReferenceImpulse(after,shot.impulse,shot.at);return Object.freeze({token:`synthetic:${weapon}:${index+1}`,round:ROUND,weapon,seq:index+1,ordinal:index+1,impulse:Object.freeze({at:shot.at,deltaPitch:after.recoilPitch-prior.recoilPitch,deltaYaw:after.recoilYaw-prior.recoilYaw,deltaPitchVelocity:after.cs2RecoilPitchVelocity-prior.cs2RecoilPitchVelocity,deltaYawVelocity:after.cs2RecoilYawVelocity-prior.cs2RecoilYawVelocity})});}
// Synthetic clock controls cover rising and recovering punch; no raw capture,
// user coordinates, local diagnostic receipt or map data enters tracked tests.
for(const [ordinal,lag,fraction,wall]of [[5,2*DT,.0166,.0167],[8,4*DT,1/30000,.0166],[30,6*DT,.0166,.0167],[1,3*DT,1/15000,.0166],[4,0,1/30000,.0166]])test(`no new impulse: extra ACK/sample tick does not advance display twice after shot${ordinal}`,()=>{
 const shots=Array.from({length:ordinal},(_,i)=>({at:10+i*.1,impulse:impulses[i]})),time=shots.at(-1).at+lag,clock=make(),a=sourceAt(shots,time),fractionB=fraction<.001?fraction+wall:fraction+wall-DT,b=sourceAt(shots,time+(fraction<.001?DT:2*DT)),first=sampled(clock,Object.freeze(a),1000,fraction),expected=sampleAt(a,time+fraction+wall),raw=sampleReferencePunch(b,fractionB);
 close(first,sampleReferencePunch(a,fraction),'initial passthrough');assert.ok(Math.hypot(raw.recoilPitch-expected.recoilPitch,raw.recoilYaw-expected.recoilYaw)>1e-7,'control must expose old raw-time discontinuity');const output=sampled(clock,Object.freeze(b),1000+wall*1000,fractionB);close(output,expected,'one natural elapsed frame');
});
for(const hz of [60,75,120,144])test(`coherent${hz}Hz recoil sampling is numerically unchanged through fresh shots`,()=>{
 const clock=make(),shots=Array.from({length:6},(_,i)=>({at:20+i*.1,impulse:impulses[i]}));let noted=0;
 for(let i=0;i<=hz;i++){const elapsed=i/hz,goal=20+elapsed,tick=20+Math.floor((elapsed+1e-12)/DT)*DT,fraction=Math.max(0,Math.min(DT,goal-tick));while(noted<shots.length&&shots[noted].at<=tick+1e-10)clock.noteShot(markerFor(shots,noted++));const p=sourceAt(shots,tick),expected=sampleReferencePunch(p,fraction),actual=sampled(clock,Object.freeze(p),5000+elapsed*1000,fraction);assert.deepEqual(actual,expected,`original complete sample at frame${i}`);}
});
test('after corrected clock gap, the next genuine impulse acts at mapped visual time without raw catch-up or delay',()=>{
 const shots=[{at:10,impulse:impulses[0]},{at:10.1+DT,impulse:impulses[1]}],clock=make(),first=sourceAt(shots.slice(0,1),10.05);sampled(clock,first,1000);
 const rawGap=sourceAt(shots.slice(0,1),10.05+2*DT);close(sampled(clock,rawGap,1000+DT*1000),sampleAt(first,10.05+DT),'correct initial extra tick');
 const rawPrior=sourceAt(shots.slice(0,1),10.05+3*DT),prior=sampled(clock,rawPrior,1000+2*DT*1000),expectedPrior=sampleAt(first,10.05+2*DT);close(prior,expectedPrior,'phase remains continuous before next shot');
 const marker=markerFor(shots,1);clock.noteShot(marker);const mappedImpulseAt=marker.impulse.at-DT,visualBefore=sampleAt(first,mappedImpulseAt),expectedAfter={...visualBefore};addReferenceImpulse(expectedAfter,shots[1].impulse,mappedImpulseAt);
 const rawWithShot=sourceAt(shots,shots[1].at),authority=sourceAt(shots.slice(0,1),shots[1].at,{ack:1}),sourceCopy=structuredClone(rawWithShot);const actual=sampled(clock,Object.freeze(rawWithShot),1000+3*DT*1000,0,Object.freeze(authority));close(actual,expectedAfter,'new impulse now, without restarting old phase');assert.deepEqual(rawWithShot,sourceCopy,'presenter must not mutate source');assert.ok(Math.abs(actual.cs2RecoilPitchVelocity-visualBefore.cs2RecoilPitchVelocity)>1e-4,'impulse velocity must act in current frame');
 assert.equal(clock.noteShot(marker),false,'repeated shot token must be inert');assert.equal(clock.diagnostics().duplicates,1);
 const nextRaw=sourceAt(shots,shots[1].at+DT),expectedNext=sampleAt(expectedAfter,mappedImpulseAt+DT);close(sampled(clock,nextRaw,1000+4*DT*1000),expectedNext,'authority confirmation does not re-anchor and lose impulse phase');
});
test('AWP-shot knife AWP and repeated Q-like identities preserve the same residual punch phase',()=>{
 const shots=[{at:30,impulse:[-45,7,0]}],clock=make(),initial=sourceAt(shots,30.05,{weapon:'awp'});sampled(clock,initial,1000);
 const gap=sourceAt(shots,30.05+2*DT,{weapon:'awp'});sampled(clock,gap,1000+DT*1000);
 for(const[step,weapon]of [[2,'knife'],[3,'awp'],[4,'knife'],[5,'awp']]){const s=sourceAt(shots,30.05+(step+1)*DT,{weapon}),frozen=Object.freeze(s),expected=sampleAt(initial,30.05+step*DT);close(sampled(clock,frozen,1000+step*DT*1000),expected,`switch${weapon} adds no delayed kick`);}
});

function correctedFixture({weapon='ak47',shots=[{at:10,impulse:impulses[0]}]}={}){
 const clock=make(),time=shots.at(-1).at+.05,initial=sourceAt(shots,time,{weapon});sampled(clock,initial,1000);
 const rawTime=time+2*DT,nowMs=1000+DT*1000,source=sourceAt(shots,rawTime,{weapon});close(sampled(clock,source,nowMs),sampleAt(initial,time+DT),'synthetic phase correction');
 return{clock,shots,initial,rawTime,nowMs,renderTime:time+DT};
}

test('a fresh impulse in the same frame as the extra clock tick preserves its within-frame fraction',()=>{
 const clock=make(),initialShots=[{at:10,impulse:impulses[0]}],initial=sourceAt(initialShots,10.05);sampled(clock,initial,1000);
 const rawTime=10.05+2*DT,shotAt=rawTime-DT/2,shots=[...initialShots,{at:shotAt,impulse:impulses[1]}],marker=markerFor(shots,1);clock.noteShot(marker);
 const mapped=shotAt-DT,expectedBase=sampleAt(initial,mapped);addReferenceImpulse(expectedBase,shots[1].impulse,mapped);const expected=sampleAt(expectedBase,10.05+DT),source=sourceAt(shots,rawTime),authority=sourceAt(initialShots,rawTime,{ack:1});
 close(sampled(clock,Object.freeze(source),1000+DT*1000,0,Object.freeze(authority)),expected,'clock correction and new impulse coexist');assert.equal(clock.diagnostics().corrections,1);assert.equal(clock.diagnostics().impulses,1);
});

test('multiple fresh markers in one frame use their source order and each impulse exactly once',()=>{
 const f=correctedFixture(),wall=.025,rawEnd=f.rawTime+wall,renderEnd=f.renderTime+wall,shots=[...f.shots,{at:rawEnd-1/60,impulse:[-21,8,0]},{at:rawEnd-1/120,impulse:[-17,-9,0]}],second=markerFor(shots,1),third=markerFor(shots,2);
 // Delivery order is intentionally reversed. The physical source times define
 // the expected order, independent of the presenter's marker queue layout.
 f.clock.noteShot(third);f.clock.noteShot(second);const expected={...f.initial};for(const shot of shots.slice(1)){advanceReferencePunch(expected,0,shot.at-DT);addReferenceImpulse(expected,shot.impulse,shot.at-DT);}const target=sampleAt(expected,renderEnd);
 const source=sourceAt(shots,rawEnd),authority=sourceAt(f.shots,rawEnd,{ack:1});close(sampled(f.clock,source,f.nowMs+wall*1000,0,authority),target,'two chronological mapped impulses');assert.equal(f.clock.diagnostics().impulses,2);assert.equal(f.clock.noteShot(third),false,'confirmation cannot replay third impulse');
 const later=sourceAt(shots,rawEnd+DT);close(sampled(f.clock,later,f.nowMs+(wall+DT)*1000,0,sourceAt(f.shots,rawEnd+DT,{ack:1})),sampleAt(expected,renderEnd+DT),'following frame retains both impulses');assert.equal(f.clock.diagnostics().impulses,2);
});

test('a late marker explicitly reanchors instead of silently skipping or applying it in the future',()=>{
 const f=correctedFixture(),shots=[...f.shots,{at:f.rawTime-2*DT,impulse:impulses[1]}],marker=markerFor(shots,1);f.clock.noteShot(marker);const p=sourceAt(shots,f.rawTime+DT),out=sampled(f.clock,p,f.nowMs+DT*1000);
 assert.deepEqual(picks(out),picks(sampleReferencePunch(p,0)));assert.equal(f.clock.diagnostics().reason,'late-impulse');assert.equal(f.clock.diagnostics().mode,'source');
});

test('an acknowledged rejected prediction uses authority punch rather than retaining a speculative impulse',()=>{
 const f=correctedFixture(),shotAt=f.rawTime+DT,shots=[...f.shots,{at:shotAt,impulse:impulses[1]}],marker=markerFor(shots,1);f.clock.noteShot(marker);
 sampled(f.clock,sourceAt(shots,shotAt),f.nowMs+DT*1000,0,sourceAt(f.shots,shotAt,{ack:1}));const rejected=sourceAt(f.shots,shotAt+DT,{ack:2}),expected=sampleReferencePunch(rejected,0),out=sampled(f.clock,Object.freeze(rejected),f.nowMs+2*DT*1000);
 assert.deepEqual(picks(out),picks(expected));assert.equal(f.clock.diagnostics().reason,'prediction-rejected');assert.equal(f.clock.diagnostics().rejected,1);
});

for(const signal of ['hp','flinch'])test(`genuine ${signal} damage punch is an explicit source reanchor`,()=>{
 const f=correctedFixture(),p=sourceAt(f.shots,f.rawTime+DT);p.recoilPitch+=.12;advanceReferencePunch(p,0,p.cs2PunchTime);if(signal==='hp')p.hp=90;else p.flinchAt=p.cs2PunchTime;
 const expected=sampleReferencePunch(p,0),out=sampled(f.clock,Object.freeze(p),f.nowMs+DT*1000);assert.deepEqual(picks(out),picks(expected));assert.equal(f.clock.diagnostics().reason,'external-hit');
});

test('an untracked authoritative shot falls back to its valid source punch',()=>{
 const f=correctedFixture(),shots=[...f.shots,{at:f.rawTime+DT,impulse:impulses[1]}],p=sourceAt(shots,f.rawTime+DT),out=sampled(f.clock,p,f.nowMs+DT*1000);
 assert.deepEqual(picks(out),picks(sampleReferencePunch(p,0)));assert.equal(f.clock.diagnostics().reason,'untracked-shot');assert.equal(f.clock.diagnostics().unknown,1);
});

test('untracked first shot on another gun uses the continuing player-wide ordinal and source fallback',()=>{
 const shots=Array.from({length:5},(_,i)=>({at:10+i*.1,impulse:impulses[i]})),f=correctedFixture({shots}),knife=sourceAt(shots,f.rawTime+DT,{weapon:'knife',ack:5});knife.lastShot=-100;sampled(f.clock,knife,f.nowMs+DT*1000);
 const awp=sourceAt(shots,f.rawTime+2*DT,{weapon:'awp',ack:6});addReferenceImpulse(awp,[-43,4,0],awp.cs2PunchTime);awp.shotsFired=6;awp.lastShot=awp.cs2PunchTime;const out=sampled(f.clock,awp,f.nowMs+2*DT*1000);
 assert.deepEqual(picks(out),picks(sampleReferencePunch(awp,0)),'weapon switch keeps the player-wide shot ordinal; a new unknown sixth shot must not disappear');assert.equal(f.clock.diagnostics().mode,'source');assert.equal(f.clock.diagnostics().reason,'untracked-shot');
});

test('missing impulse metadata takes the documented source fallback rather than guessing a kick',()=>{
 const f=correctedFixture();f.clock.noteShot({token:'missing-impulse',round:ROUND,weapon:'ak47',seq:2,ordinal:2});const p=sourceAt(f.shots,f.rawTime+DT),out=sampled(f.clock,p,f.nowMs+DT*1000);assert.deepEqual(picks(out),picks(sampleReferencePunch(p,0)));assert.equal(f.clock.diagnostics().reason,'untracked-shot');
});

test('inactive menu, a long frame and a new round do not carry the old wall-clock epoch',()=>{
 for(const boundary of ['inactive','long-frame','round']){const f=correctedFixture(),p=sourceAt(f.shots,f.rawTime+DT),context={round:boundary==='round'?ROUND+1:ROUND,nowMs:f.nowMs+(boundary==='long-frame'?80:DT*1000),fractionSeconds:.003,active:boundary!=='inactive',authority:p},out=f.clock.sample(p,context);assert.deepEqual(picks(out),picks(sampleReferencePunch(p,.003)),boundary);assert.notEqual(f.clock.diagnostics().mode,'wall-clock',boundary);}
});

test('an old-round marker cannot disturb the current residual recoil clock',()=>{
 const f=correctedFixture(),old={...markerFor([...f.shots,{at:f.rawTime+DT,impulse:impulses[1]}],1),round:ROUND-1};f.clock.noteShot(old);
 const p=sourceAt(f.shots,f.rawTime+DT),expected=sampleAt(f.initial,f.renderTime+DT);close(sampled(f.clock,p,f.nowMs+DT*1000),expected,'old-round marker ignored');assert.equal(f.clock.diagnostics().impulses,0);assert.equal(f.clock.diagnostics().pendingMarkers,0);
});

test('display results and scalar sources do not alias the stored recoil epoch',()=>{
 const f=correctedFixture(),p=sourceAt(f.shots,f.rawTime+DT),snapshot=structuredClone(p),output=sampled(f.clock,Object.freeze(p),f.nowMs+DT*1000);
 assert.deepEqual(p,snapshot);output.recoilPitch=100;output.cs2RecoilPitchVelocity=100;
 const next=sourceAt(f.shots,f.rawTime+2*DT),expected=sampleAt(f.initial,f.renderTime+2*DT);close(sampled(f.clock,Object.freeze(next),f.nowMs+2*DT*1000),expected,'caller cannot mutate retained clock state');
});

test('a new round legitimately restarts its global shot ordinal at one',()=>{
 const oldShots=Array.from({length:5},(_,i)=>({at:10+i*.1,impulse:impulses[i]})),f=correctedFixture({shots:oldShots}),newShots=[{at:30,impulse:[-43,4,0]}],source=sourceAt(newShots,30.02,{weapon:'awp',ack:1});source.playedRound=ROUND+1;
 f.clock.noteShot({...markerFor(newShots,0,{weapon:'awp'}),round:ROUND+1});const out=f.clock.sample(Object.freeze(source),{round:ROUND+1,nowMs:f.nowMs+DT*1000,fractionSeconds:.004,active:true,authority:source});
 assert.deepEqual(picks(out),picks(sampleReferencePunch(source,.004)));assert.equal(f.clock.diagnostics().mode,'source');assert.equal(f.clock.diagnostics().unknown,0,'a new round first shot is not an unexpected old-round ordinal');
});

test('same timestamp with identical recoil and authority is idempotent inside the corrected epoch',()=>{
 const f=correctedFixture(),source=sourceAt(f.shots,f.rawTime+DT),now=f.nowMs+DT*1000,first=sampled(f.clock,Object.freeze(source),now),before=f.clock.diagnostics(),again=sampled(f.clock,Object.freeze({...source}),now);
 assert.deepEqual(picks(again),picks(first));assert.equal(f.clock.diagnostics().mode,'wall-clock');assert.equal(f.clock.diagnostics().corrections,before.corrections);assert.equal(f.clock.diagnostics().reanchors,before.reanchors);
 const next=sourceAt(f.shots,f.rawTime+2*DT),expected=sampleAt(f.initial,f.renderTime+2*DT);close(sampled(f.clock,next,now+DT*1000),expected,'duplicate sample must not reset corrected phase');
});

test('a higher source-only shot without a fresh marker reanchors once while authority is still behind',()=>{
 const f=correctedFixture(),shots=[...f.shots,{at:f.rawTime+DT,impulse:impulses[1]}],source=sourceAt(shots,f.rawTime+DT,{ack:1}),authority=sourceAt(f.shots,f.rawTime+DT,{ack:1}),out=sampled(f.clock,source,f.nowMs+DT*1000,0,authority);
 assert.deepEqual(picks(out),picks(sampleReferencePunch(source,0)));assert.equal(f.clock.diagnostics().reason,'untracked-shot');assert.equal(f.clock.diagnostics().unknown,1);
 const nextSource=sourceAt(shots,f.rawTime+2*DT,{ack:1}),nextAuthority=sourceAt(f.shots,f.rawTime+2*DT,{ack:1});assert.deepEqual(picks(sampled(f.clock,nextSource,f.nowMs+2*DT*1000,0,nextAuthority)),picks(sampleReferencePunch(nextSource,0)));assert.equal(f.clock.diagnostics().unknown,1,'adopted source ordinal must not trigger the same fallback on every frame');
});

test('after a rejected prediction the reused ordinal can carry a new token and later real impulse',()=>{
 const f=correctedFixture(),firstAt=f.rawTime+DT,attempt=[...f.shots,{at:firstAt,impulse:impulses[1]}],oldMarker=markerFor(attempt,1);f.clock.noteShot(oldMarker);sampled(f.clock,sourceAt(attempt,firstAt,{ack:1}),f.nowMs+DT*1000,0,sourceAt(f.shots,firstAt,{ack:1}));
 const rejected=sourceAt(f.shots,firstAt+DT,{ack:2});sampled(f.clock,rejected,f.nowMs+2*DT*1000);assert.equal(f.clock.diagnostics().rejected,1);assert.equal(f.clock.noteShot(oldMarker),false,'late duplicate of a rejected token is still not a new event');
 const retryAt=firstAt+2*DT,retry=[...f.shots,{at:retryAt,impulse:impulses[1]}],fresh={...markerFor(retry,1),token:'synthetic:retry-ordinal-two',seq:3};assert.equal(fresh.ordinal,oldMarker.ordinal);assert.equal(f.clock.noteShot(fresh),true);const source=sourceAt(retry,retryAt,{ack:2}),authority=sourceAt(f.shots,retryAt,{ack:2});
 assert.deepEqual(picks(sampled(f.clock,source,f.nowMs+3*DT*1000,0,authority)),picks(sampleReferencePunch(source,0)));assert.equal(f.clock.diagnostics().presentedShots,2);assert.equal(f.clock.diagnostics().rejected,1);assert.equal(f.clock.diagnostics().unknown,0);
});
