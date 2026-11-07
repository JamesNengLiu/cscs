import test from 'node:test';
import assert from 'node:assert/strict';
import {createLookDiagnostics} from '../public/cs2-look-diagnostics.js';

const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
const event=(receivedAt,movementX,yaw,extra={})=>({receivedAt,eventTimestamp:receivedAt-2,movementX,movementY:0,yaw,pitch:0,factor:.001,...extra});
const frame=(now,yaw,extra={})=>({now,wallNow:now+4,yaw,pitch:0,cameraYaw:yaw,cameraPitch:0,recoilYaw:0,recoilPitch:0,cpuMs:4,mapUpdateMs:1,renderSubmitMs:2,...extra});

test('disabled capture does no clock reads, validation, input changes or buffering',()=>{
  const capture=createLookDiagnostics({now:()=>{throw Error('Disabled clock used');}}),input=Object.freeze(event(10,5,-.005));
  assert.equal(capture.enabled,false);assert.equal(capture.begin(),false);assert.equal(capture.observe(input),false);assert.equal(capture.sample(),false);assert.equal(capture.end(),false);
  assert.deepEqual(capture.snapshot(),{schema:'cs2-look-diagnostics-v1',enabled:false,active:false,scope:'Browser mouse dispatch and camera submission observations; no hardware polling-rate or physical presentation certification'});
});

test('bursty dispatch is distinguished from camera consumption and recoil',()=>{
  const capture=createLookDiagnostics({enabled:true,now:()=>100});capture.begin({wallNow:0,yaw:0,pitch:0,rawMode:'raw-accepted',sensitivity:1});
  capture.observe(Object.freeze(event(8,3,-.003,{eventTimestamp:1})));capture.observe(Object.freeze(event(8.2,4,-.007,{eventTimestamp:2})));capture.observe(Object.freeze(event(8.4,5,-.012,{eventTimestamp:3})));
  capture.sample(frame(10,-.012,{cameraYaw:.008,recoilYaw:.02}));
  const snapshot=capture.snapshot(),row=snapshot.frames[0];
  assert.equal(row.eventCount,3);assert.equal(row.movementX,12);near(row.inputYawDelta,-.012);near(row.expectedYawDelta,-.012);near(row.observedYawDelta,-.012);near(row.yawResidual,0);near(row.cameraYawResidual,0);near(row.cameraMinusInputYaw,.02);
  near(snapshot.summary.dispatchDelayMs.max,7);near(snapshot.summary.receiveIntervalMs.max,.2);near(snapshot.summary.sourceIntervalMs.max,1);
  assert.equal(snapshot.events[0].consumedFrameId,1);near(snapshot.events[0].receiptToFrameMs,6);near(snapshot.events[0].timestampToFrameMs,13);near(snapshot.events[0].receiptToSubmissionMs,10);near(snapshot.events[0].timestampToSubmissionMs,17);assert.equal(snapshot.summary.framesWithYawResidual,0);assert.equal(snapshot.summary.framesWithCameraYawResidual,0);
  assert.equal(snapshot.sessions[0].rawMode,'raw-accepted');assert.equal(snapshot.lastFrameAgeMs,86);
});

test('angular residual identifies ignored mouse delta separately from a wrong camera',()=>{
  const capture=createLookDiagnostics({enabled:true,now:()=>60});capture.begin({wallNow:0,yaw:0});
  capture.observe(event(3,10,-.01));capture.sample(frame(10,-.01));
  capture.observe(event(18,10,-.01));capture.sample(frame(20,-.01,{cameraYaw:-.02}));
  const snapshot=capture.snapshot();near(snapshot.frames[1].yawResidual,.01);near(snapshot.frames[1].cameraYawResidual,-.01);assert.equal(snapshot.summary.framesWithYawResidual,1);assert.equal(snapshot.summary.framesWithCameraYawResidual,1);
  assert.equal(snapshot.events[1].consumedFrameId,2);near(snapshot.events[1].yawResidual,.01);
});

test('opposing counts within a frame cancel without manufacturing a stall',()=>{
  const capture=createLookDiagnostics({enabled:true,now:()=>50});capture.begin({wallNow:0,yaw:0});
  capture.observe(event(3,10,-.01));capture.observe(event(4,-10,0));capture.sample(frame(10,0));
  const row=capture.snapshot().frames[0];assert.equal(row.eventCount,2);assert.equal(row.absoluteMovementX,20);assert.equal(row.movementX,0);near(row.expectedYawDelta,0);near(row.yawResidual,0);
});

test('unlock preserves samples and new lock sessions retain separate baselines',()=>{
  let time=50;const capture=createLookDiagnostics({enabled:true,now:()=>time});capture.begin({wallNow:0,yaw:0});
  capture.observe(event(3,10,-.01));capture.sample(frame(10,-.01));capture.observe(event(18,10,-.02));capture.end({wallNow:20,reason:'unlock'});
  assert.equal(capture.observe(event(22,10,-.03)),false);assert.equal(capture.sample(frame(30,-.02)),false);
  let snapshot=capture.snapshot();assert.equal(snapshot.active,false);assert.equal(snapshot.events.length,2);assert.equal(snapshot.sessions[0].unconsumedEvents,1);assert.equal(snapshot.events[1].consumedFrameId,null);
  capture.begin({wallNow:40,yaw:1});capture.observe(event(43,10,.99));capture.sample(frame(50,.99));time=65;snapshot=capture.snapshot();
  assert.equal(snapshot.totals.sessions,2);assert.equal(snapshot.events[1].consumedFrameId,null);assert.equal(snapshot.events[2].consumedFrameId,2);near(snapshot.frames[1].yawResidual,0);assert.equal(snapshot.events[2].receiveIntervalMs,null);assert.equal(snapshot.frames[1].wallIntervalMs,null);assert.equal(snapshot.lastEventAgeMs,22);
});

test('typed rings preserve chronology, overwrite counts and event/frame associations',()=>{
  const capture=createLookDiagnostics({enabled:true,eventCapacity:3,frameCapacity:2,now:()=>100});capture.begin({wallNow:0,yaw:0});
  for(let index=1;index<=5;index++){capture.observe(event(index*10,1,-index*.001));capture.sample(frame(index*10+1,-index*.001));}
  const snapshot=capture.snapshot();assert.deepEqual(snapshot.events.map(row=>row.id),[3,4,5]);assert.deepEqual(snapshot.frames.map(row=>row.id),[4,5]);assert.equal(snapshot.totals.events,5);assert.equal(snapshot.totals.overwrittenEvents,2);assert.equal(snapshot.totals.overwrittenFrames,3);assert.deepEqual(snapshot.events.map(row=>row.consumedFrameId),[null,4,5]);
  snapshot.events[1].yaw=99;snapshot.sessions[0].yaw=99;assert.notEqual(capture.snapshot().events[1].yaw,99);assert.notEqual(capture.snapshot().sessions[0].yaw,99);
});

test('absent factors/timestamps stay unknown and invalid clocks remain visible',()=>{
  const capture=createLookDiagnostics({enabled:true,now:()=>100});capture.begin({wallNow:0});
  capture.observe(event(8,2,-.002,{factor:undefined,eventTimestamp:undefined}));capture.sample(frame(10,-.002,{recoilYaw:undefined}));
  capture.observe(event(18,2,-.004,{eventTimestamp:25}));capture.sample(frame(20,-.004));capture.observe(event(28,2,-.006,{eventTimestamp:24}));capture.sample(frame(30,-.006));
  const snapshot=capture.snapshot();assert.equal(snapshot.events[0].dispatchDelayMs,null);assert.equal(snapshot.frames[0].expectedYawDelta,null);assert.equal(snapshot.frames[0].inputYawDelta,null);assert.equal(snapshot.frames[0].cameraYawResidual,null);assert.equal(snapshot.summary.negativeDispatchDelays,1);assert.equal(snapshot.summary.negativeSourceIntervals,1);assert.equal(snapshot.events[1].dispatchDelayMs,-7);
  assert.equal(snapshot.events[0].timestampToFrameMs,null);assert.doesNotThrow(()=>JSON.stringify(snapshot));
});

test('empty frames cannot steal an event from its later consuming frame',()=>{
  const capture=createLookDiagnostics({enabled:true,now:()=>100});capture.begin({wallNow:0,yaw:0});capture.sample(frame(1,0));capture.sample(frame(10,0));capture.observe(event(23,10,-.01));capture.sample(frame(30,-.01));
  const snapshot=capture.snapshot();assert.equal(snapshot.events[0].consumedFrameId,3);assert.equal(snapshot.frames[2].eventCount,1);near(snapshot.frames[2].wallIntervalMs,20);
});

test('capture rejects invalid records without corrupting valid pending movement',()=>{
  const capture=createLookDiagnostics({enabled:true,now:()=>100});capture.begin({wallNow:0,yaw:0});assert.equal(capture.observe(event(2,Infinity,0)),false);assert.equal(capture.sample(frame(NaN,0)),false);
  capture.observe(event(3,10,-.01));capture.sample(frame(10,-.01));const snapshot=capture.snapshot();assert.equal(snapshot.totals.rejectedEvents,1);assert.equal(snapshot.totals.rejectedFrames,1);assert.equal(snapshot.frames[0].movementX,10);near(snapshot.frames[0].yawResidual,0);
});

test('session metadata is bounded and enabled limits are validated',()=>{
  assert.throws(()=>createLookDiagnostics({enabled:true,eventCapacity:32769}),RangeError);assert.throws(()=>createLookDiagnostics({enabled:true,frameCapacity:0}),RangeError);
  const capture=createLookDiagnostics({enabled:true,eventCapacity:1,frameCapacity:1,now:()=>100});for(let index=0;index<35;index++)capture.begin({wallNow:index,yaw:0});const snapshot=capture.snapshot();assert.equal(snapshot.sessions.length,32);assert.equal(snapshot.sessions[0].id,4);assert.equal(snapshot.totals.overwrittenSessions,3);assert.equal(snapshot.sessions[0].reason,'next-lock');
});
