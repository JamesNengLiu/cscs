import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeCS2PresentationMetrics} from './fixtures/cs2-presentation-metrics.mjs';

const selection={rendererPid:10,mainThreadId:11,layerTreeHostId:2,window:{startTsUs:0,endTsUs:100000}};
function frame({id='a',sequence=1,begin=0,fire=1000,end=2000,present=32000,currentSequence=sequence,request=1,reporterAsync,display=9007199254740992,page='game'}={}){
  const source=4294967296,bid={source_id:source,sequence_number:sequence},current={source_id:source,sequence_number:currentSequence};
  reporterAsync??='0x'+sequence.toString(16);
  const events=[
    {name:'AnimationFrame',ph:'b',pid:10,tid:11,ts:begin,args:{id,animation_frame_timing_info:{begin_frame_id:bid}}},
    {name:'FireAnimationFrame',ph:'X',pid:10,tid:11,ts:fire,dur:end-fire,args:{data:{frame:page,id:request}}},
    {name:'AnimationFrame',ph:'e',pid:10,tid:11,ts:end,args:{}},
    {name:'AnimationFrame::Presentation',ph:'n',pid:10,tid:11,ts:present,args:{id,begin_frame_id:current}},
    {name:'PipelineReporter',ph:'b',pid:10,tid:12,ts:fire-10,cat:'cc',id2:{local:reporterAsync},args:{frame_reporter:{layer_tree_host_id:2,frame_source:source,frame_sequence:sequence,state:'STATE_PRESENTED_ALL',display_trace_id:display,surface_frame_trace_id:display}}},
    {name:'PipelineReporter',ph:'e',pid:10,tid:13,ts:present,cat:'cc',id2:{local:reporterAsync},args:{}},
  ];
  if(currentSequence!==sequence)events.push(
    {name:'PipelineReporter',ph:'X',pid:10,tid:12,ts:fire+1,dur:present-fire-1,args:{frame_reporter:{layer_tree_host_id:2,frame_source:source,frame_sequence:currentSequence,state:'STATE_PRESENTED_PARTIAL',frame_type:'FORKED',display_trace_id:display,surface_frame_trace_id:display}}},
  );
  return events;
}
const analyze=(events,extra={})=>analyzeCS2PresentationMetrics({traceEvents:events},{...selection,...extra});

test('callback feedback latency and known outstanding work use exact AF IDs and callback end',()=>{
  const events=[...frame({id:'a',sequence:1,begin:0,fire:10000,end:14000,present:40000}),...frame({id:'b',sequence:2,begin:15000,fire:23000,end:27000,present:53333}),...frame({id:'c',sequence:3,begin:28000,fire:36000,end:40000,present:66666})];
  const original=structuredClone(events),result=analyze(events);
  assert.equal(result.coverage.verifiedCallbacks,3);assert.equal(result.coverage.rejectedCallbacks,0);
  assert.deepEqual(result.frames.map(row=>row.animationFrameId),['a','b','c']);
  assert.equal(result.summary.callbackEndToPresentationMs.p50,26.333);
  assert.deepEqual(result.frames.map(row=>row.knownCompletedAwaitingFeedbackAtAFBegin),[0,1,2]);
  assert.equal(result.frames[2].knownCompletedAwaitingFeedbackAtCallbackEnd,2,'feedback at the query timestamp has already arrived');
  assert.deepEqual(events,original,'offline analysis is read-only');
});

test('rounded or colliding int64 display/surface numbers cannot change attribution',()=>{
  const events=[...frame({id:'a',sequence:1}),...frame({id:'b',sequence:2,begin:14000,fire:15000,end:18000,present:45333})];
  const result=analyze(events);assert.equal(result.coverage.verifiedCallbacks,2);assert.ok(result.diagnostics.ignoredUnsafeDisplayOrSurfaceNumbers>=4);
  const without=structuredClone(events);for(const event of without){const p=event.args?.frame_reporter;if(p){delete p.display_trace_id;delete p.surface_frame_trace_id;}}
  assert.deepEqual(analyze(without).frames,result.frames);assert.deepEqual(analyze(without).summary,result.summary);
});

test('forked current compositor sequence never shifts the originating callback by a frame',()=>{
  const result=analyze(frame({id:'origin',sequence:40,currentSequence:41,present:42000}));
  assert.equal(result.coverage.verifiedCallbacks,1);assert.equal(result.frames[0].presentationTsUs,42000);assert.equal(result.frames[0].originFrameSequence,'40');
  assert.equal(result.frames[0].currentMetadataCheck,'fork_same_feedback_verified');
});

test('nearby unrelated feedback never repairs a missing explicit Presentation ID',()=>{
  const events=frame();events.splice(events.findIndex(event=>event.name==='AnimationFrame::Presentation'),1);
  events.push({name:'AnimationFrame::Presentation',ph:'n',pid:10,tid:11,ts:2100,args:{id:'nearest-but-unrelated'}});
  const result=analyze(events);assert.equal(result.coverage.verifiedCallbacks,0);assert.equal(result.coverage.reasons.missing_presentation_args_id,1);assert.equal(result.summary.callbackEndToPresentationMs.samples,0);
});

test('missing feedback does not remove the callback from cadence or coverage',()=>{
  const middle=frame({id:'b',sequence:2,begin:10000,fire:11000,end:12000,present:45333}).filter(event=>event.name!=='AnimationFrame::Presentation');
  const result=analyze([...frame(),...middle,...frame({id:'c',sequence:3,begin:20000,fire:21000,end:22000,present:58666})]);
  assert.equal(result.coverage.windowCallbacks,3);assert.equal(result.coverage.verifiedCallbacks,2);assert.equal(result.summary.callbackStartIntervalMs.max,10);
});

test('invalid callback durations remain visible in the coverage denominator',()=>{
  const result=analyze([...frame(),{name:'FireAnimationFrame',ph:'X',pid:10,tid:11,ts:15000,dur:NaN,args:{data:{frame:'game'}}}]);
  assert.equal(result.coverage.windowCallbacks,2);assert.equal(result.coverage.verifiedCallbacks,1);assert.equal(result.coverage.reasons.invalid_callback_duration,1);
});

test('duplicate AF or Presentation identities are exposed instead of silently deduplicated',()=>{
  const duplicatePresentation=frame();duplicatePresentation.push(structuredClone(duplicatePresentation.find(event=>event.name==='AnimationFrame::Presentation')));
  const a=analyze(duplicatePresentation);assert.equal(a.coverage.reasons.duplicate_presentation_args_id,1);assert.deepEqual(a.diagnostics.duplicatePresentationIds,['a']);
  const duplicateAF=[...frame(),...frame({sequence:2,begin:14000,fire:15000,end:18000,present:45333})];
  const b=analyze(duplicateAF);assert.equal(b.coverage.verifiedCallbacks,0);assert.equal(b.coverage.reasons.duplicate_animation_args_id,2);
});

test('multiple callbacks in a renderer update are ambiguous unless explicitly page-filtered',()=>{
  const events=frame();events.push({name:'FireAnimationFrame',ph:'X',pid:10,tid:11,ts:1200,dur:100,args:{data:{frame:'iframe',id:2}}});
  assert.equal(analyze(events).coverage.reasons.multiple_callbacks_in_animation_frame,2);
  assert.equal(analyze(events,{frameId:'game'}).coverage.verifiedCallbacks,1);
});

test('callback source window retains later feedback and captured prefix queue evidence',()=>{
  const events=[...frame({id:'prefix',sequence:1,begin:-20000,fire:-10000,end:-5000,present:30000}),...frame({id:'inside',sequence:2,begin:0,fire:10000,end:14000,present:40000}),...frame({id:'suffix',sequence:3,begin:20000,fire:23000,end:27000,present:53333})];
  const result=analyze(events,{window:{startTsUs:0,endTsUs:20000}});
  assert.equal(result.coverage.windowCallbacks,1);assert.equal(result.coverage.referenceCallbacksBeforeWindow,1);assert.equal(result.coverage.feedbackAfterWindow,1);
  assert.equal(result.frames[0].knownCompletedAwaitingFeedbackAtAFBegin,1);assert.equal(result.summary.callbackEndToPresentationMs.p50,26);
});

test('the measurement boundary is callback start, not the surrounding animation-frame start',()=>{
  const events=[...frame({id:'entered',sequence:1,begin:-1000,fire:1000,end:2000,present:32000}),...frame({id:'after-exit',sequence:2,begin:19000,fire:21000,end:23000,present:45333})];
  const result=analyze(events,{window:{startTsUs:0,endTsUs:20000}});
  assert.equal(result.coverage.windowCallbacks,1);assert.equal(result.frames[0].animationFrameId,'entered');assert.equal(result.frames[0].callbackStartTsUs,1000);
});

test('numeric protobuf state and fork enums preserve the same explicit source association',()=>{
  const events=frame({sequence:1,currentSequence:2});
  for(const event of events){const p=event.args?.frame_reporter;if(p){p.state=p.state==='STATE_PRESENTED_ALL'?1:2;if(p.frame_type==='FORKED')p.frame_type=0;}}
  assert.equal(analyze(events).frames[0].currentMetadataCheck,'fork_same_feedback_verified');
});

test('trace boundaries and unverified preceding callbacks make queue coverage explicit',()=>{
  const prefix=frame({id:'missing',sequence:1,begin:-20000,fire:-10000,end:-5000,present:30000}).filter(event=>event.name!=='AnimationFrame::Presentation');
  const events=[{name:'AnimationFrame',ph:'e',pid:10,tid:11,ts:-21000,args:{}},...prefix,...frame({id:'inside',sequence:2,begin:0,fire:10000,end:14000,present:40000}),{name:'AnimationFrame',ph:'b',pid:10,tid:11,ts:50000,args:{id:'truncated'}}];
  const result=analyze(events,{window:{startTsUs:0,endTsUs:20000}});assert.equal(result.frames[0].unverifiedCompletedCallbacksAtAFBegin,1);assert.equal(result.queue.traceLeftBoundaryMayBeCensored,true);assert.equal(result.queue.traceRightBoundaryMayBeCensored,true);
});

test('reporter async IDs may be reused and may end on a different compositor thread',()=>{
  const events=[...frame({id:'a',sequence:1,present:12000,reporterAsync:'0xa'}),...frame({id:'b',sequence:2,begin:14000,fire:15000,end:18000,present:45333,reporterAsync:'0xa'})];
  const result=analyze(events);assert.equal(result.coverage.verifiedCallbacks,2);assert.equal(result.diagnostics.unmatchedReporterBegins,0);assert.equal(result.diagnostics.unmatchedReporterEnds,0);
});

test('reporter origin source/sequence and exact feedback timestamp must agree',()=>{
  const events=frame();events.find(event=>event.name==='PipelineReporter'&&event.ph==='e').ts++;
  assert.equal(analyze(events).coverage.reasons.origin_reporter_feedback_not_verified,1);
  const unsafe=frame();unsafe.find(event=>event.name==='AnimationFrame'&&event.ph==='b').args.animation_frame_timing_info.begin_frame_id.source_id=2**60;
  assert.equal(analyze(unsafe).coverage.reasons.missing_or_unsafe_origin_frame_identity,1);
});

test('an empty-payload complete reporter is ignored without dereferencing a nonexistent end',()=>{
  const result=analyze([...frame(),{name:'PipelineReporter',ph:'X',pid:10,tid:12,ts:500,dur:100,args:{}}]);
  assert.equal(result.coverage.verifiedCallbacks,1);
});

test('callback-order duplicates and near-coincident feedback are separate from gap evidence',()=>{
  const events=[...frame({id:'a',sequence:1,begin:0,fire:1000,end:2000,present:100000}),...frame({id:'b',sequence:2,begin:14000,fire:15000,end:18000,present:100000}),...frame({id:'c',sequence:3,begin:28000,fire:29000,end:32000,present:100001}),...frame({id:'d',sequence:4,begin:42000,fire:43000,end:46000,present:126667})];
  const result=analyze(events);assert.equal(result.presentation.duplicateFeedbackTimestamps,1);assert.equal(result.presentation.callbackOrderIntervalMs.min,0);assert.equal(result.presentation.nearCoincidentDistinctFeedbackPairs,1);assert.equal(result.presentation.clusteredFeedbackTimes,2);assert.equal(result.presentation.gapsOverThreshold.length,1);assert.equal(result.presentation.gapsOverThreshold[0].intervalMs,26.666);assert.equal(result.presentation.clusteredFeedbackIntervalMs.max,26.666);
});

test('another renderer, thread and post-window drop do not inflate page callback statistics',()=>{
  const events=[...frame(),...frame({id:'other',sequence:2}).map(event=>({...event,pid:20})),{name:'FireAnimationFrame',ph:'X',pid:10,tid:99,ts:1000,dur:999999,args:{}},{name:'DroppedFrame',ph:'I',pid:10,tid:12,ts:200000,args:{layerTreeId:2,frameSeqId:200}}];
  const result=analyze(events);assert.equal(result.coverage.windowCallbacks,1);assert.equal(result.coverage.verifiedCallbacks,1);assert.equal(result.summary.callbackEndToPresentationMs.p50,30);
});

test('a feedback time before its callback ends is invalid, not negative latency',()=>{
  assert.equal(analyze(frame({present:1500})).coverage.reasons.presentation_before_callback_end,1);
});

test('overlapping renderer update intervals cannot produce a fabricated unique frame',()=>{
  const events=frame();events.push({name:'AnimationFrame',ph:'b',pid:10,tid:11,ts:500,args:{id:'overlap'}},{name:'AnimationFrame',ph:'e',pid:10,tid:11,ts:1600,args:{}});
  const result=analyze(events);assert.equal(result.coverage.verifiedCallbacks,0);assert.equal(result.coverage.reasons.overlapping_animation_intervals,1);
});

test('measurement requires an explicit safe main-thread scope and a bounded source window',()=>{
  assert.throws(()=>analyzeCS2PresentationMetrics([]),/Explicit safe/);assert.throws(()=>analyzeCS2PresentationMetrics([],{...selection,rendererPid:2**60}),/Explicit safe/);assert.throws(()=>analyze([],{window:{startTsUs:10,endTsUs:0}}),/increasing/);
  const result=analyze([]);assert.equal(result.coverage.verifiedFraction,null);assert.equal(result.summary.callbackEndToPresentationMs.samples,0);
});
