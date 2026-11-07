// CS2-only, offline callback/renderer-feedback measurements. No IO or GPU calls.
// AnimationFrame b/e pairing and args.id attribution follow DevTools:
// https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/front_end/models/trace/handlers/AnimationFramesHandler.ts
// Feedback is software presentation feedback, not physical scanout or photons.

const finite=Number.isFinite;
const state=value=>typeof value==='number'?['STATE_NO_UPDATE_DESIRED','STATE_PRESENTED_ALL','STATE_PRESENTED_PARTIAL','STATE_DROPPED'][value]??'UNKNOWN':value;
const frameType=value=>typeof value==='number'?['FORKED','BACKFILL'][value]??'UNKNOWN':value??null;
const identity=value=>typeof value==='string'&&value.length?value:typeof value==='number'&&Number.isSafeInteger(value)?String(value):null;
const threadMatches=(event,pid,tid)=>identity(event.pid)===pid&&identity(event.tid)===tid;
const reporterPayload=event=>event?.args?.frame_reporter??event?.args?.chrome_frame_reporter;
const frameIdentity=value=>{
  const source=identity(value?.source_id),sequence=identity(value?.sequence_number);
  return source!==null&&sequence!==null?{source,sequence,key:JSON.stringify([source,sequence])}:null;
};
const reporterFrameIdentity=value=>frameIdentity({source_id:value?.frame_source,sequence_number:value?.frame_sequence});
const inWindow=(time,window)=>time>=window.startTsUs&&time<window.endTsUs;

function distribution(values){
  const sorted=values.filter(finite).sort((a,b)=>a-b),count=sorted.length;
  const at=quantile=>count?sorted[Math.ceil((count-1)*quantile)]:null;
  return {samples:count,min:sorted[0]??null,p50:at(.5),p95:at(.95),p99:at(.99),max:sorted.at(-1)??null,mean:count?sorted.reduce((sum,value)=>sum+value,0)/count:null};
}
function upperBound(sorted,value){
  let begin=0,end=sorted.length;
  while(begin<end){const middle=(begin+end)>>>1;if(sorted[middle]<=value)begin=middle+1;else end=middle;}
  return begin;
}
function asyncIdentity(event){
  const namespace=JSON.stringify([event.cat??'',event.scope??'']);
  if(event.id2?.global!==undefined){const id=identity(event.id2.global);return id===null?null:'global:'+namespace+':'+id;}
  if(event.id2?.local!==undefined){const id=identity(event.id2.local),pid=identity(event.pid);return id===null||pid===null?null:'local:'+namespace+':'+pid+':'+id;}
  const id=identity(event.id);return id===null?null:'legacy-global:'+namespace+':'+id;
}

function animationIntervals(events,diagnostics){
  const pending=[],intervals=[];
  for(const event of events){
    if(event.ph==='b'){
      const item={begin:event,start:event.ts,overlapping:false,fires:[]};
      if(pending.length){item.overlapping=true;for(const prior of pending)prior.overlapping=true;}
      pending.push(item);
    }else if(event.ph==='e'){
      const item=pending.pop();
      if(!item){diagnostics.unmatchedAnimationFrameEnds.push(event.ts);continue;}
      item.end=event.ts;
      if(item.end<item.start){diagnostics.invalidAnimationIntervals.push({start:item.start,end:item.end});continue;}
      intervals.push(item);
    }
  }
  diagnostics.unmatchedAnimationFrameBegins=pending.map(item=>item.start);
  return intervals.sort((a,b)=>a.start-b.start);
}

function selectedReporters(events,pid,layer,diagnostics){
  const pending=new Map(),records=[];
  function append(begin,end){
    const data=reporterPayload(begin)??reporterPayload(end)??{};
    if(identity(begin.pid)!==pid||identity(data.layer_tree_host_id)!==layer)return;
    const finish=end?.ts??begin.ts+begin.dur;
    if(!finite(finish)||finish<begin.ts){diagnostics.invalidReporterIntervals++;return;}
    const frame=reporterFrameIdentity(data);
    if(!frame){diagnostics.reportersWithoutSafeSourceIdentity++;return;}
    for(const field of ['display_trace_id','surface_frame_trace_id'])if(typeof data[field]==='number'&&!Number.isSafeInteger(data[field]))diagnostics.ignoredUnsafeDisplayOrSurfaceNumbers++;
    records.push({start:begin.ts,end:finish,frame,state:state(data.state),frameType:frameType(data.frame_type)});
  }
  for(const event of events){
    if(event.ph==='X'&&finite(event.dur)){append(event,null);continue;}
    if(event.ph!=='b'&&event.ph!=='e')continue;
    const key=asyncIdentity(event);
    if(key===null){if(identity(event.pid)===pid)diagnostics.reporterEventsWithoutSafeAsyncIdentity++;continue;}
    if(event.ph==='b'){const stack=pending.get(key)??[];stack.push(event);pending.set(key,stack);}
    else{
      const stack=pending.get(key),begin=stack?.pop();
      if(begin)append(begin,event);else if(identity(event.pid)===pid)diagnostics.unmatchedReporterEnds++;
      if(stack&&!stack.length)pending.delete(key);
    }
  }
  diagnostics.unmatchedReporterBegins=[...pending.values()].flat().filter(event=>identity(event.pid)===pid).length;
  return records;
}

/**
 * Input timestamps are microseconds. Select one page's main thread explicitly.
 * Callbacks are selected by START in [window.startTsUs, window.endTsUs); their
 * later feedback remains usable. Prefix/suffix callbacks are retained only as
 * queue-reference observations. Missing/ambiguous links never use a nearby time.
 * frameId optionally selects FireAnimationFrame.args.data.frame on that thread.
 */
export function analyzeCS2PresentationMetrics(trace,{rendererPid,mainThreadId,layerTreeHostId,window,frameId,gapThresholdMs=20,feedbackCoincidenceUs=100}={}){
  const source=Array.isArray(trace)?trace:trace?.traceEvents;
  if(!Array.isArray(source))throw new TypeError('Expected traceEvents or an event array');
  const pid=identity(rendererPid),tid=identity(mainThreadId),layer=identity(layerTreeHostId);
  if(pid===null||tid===null||layer===null)throw new TypeError('Explicit safe rendererPid, mainThreadId and layerTreeHostId are required');
  if(!finite(window?.startTsUs)||!finite(window?.endTsUs)||window.startTsUs>=window.endTsUs)throw new RangeError('A finite, increasing callback measurement window is required');
  if(!finite(gapThresholdMs)||gapThresholdMs<=0||!finite(feedbackCoincidenceUs)||feedbackCoincidenceUs<0)throw new RangeError('Invalid presentation interval thresholds');
  if(frameId!==undefined&&identity(frameId)===null)throw new TypeError('Invalid page frameId');
  const diagnostics={unmatchedAnimationFrameBegins:[],unmatchedAnimationFrameEnds:[],invalidAnimationIntervals:[],invalidReporterIntervals:0,reportersWithoutSafeSourceIdentity:0,reporterEventsWithoutSafeAsyncIdentity:0,unmatchedReporterBegins:0,unmatchedReporterEnds:0,ignoredUnsafeDisplayOrSurfaceNumbers:0,duplicateAnimationFrameIds:[],duplicatePresentationIds:[]};
  const events=source.filter(event=>event&&typeof event.name==='string'&&finite(event.ts)).slice().sort((a,b)=>a.ts-b.ts);
  const main=events.filter(event=>threadMatches(event,pid,tid));
  const animations=animationIntervals(main.filter(event=>event.name==='AnimationFrame'&&(event.ph==='b'||event.ph==='e')),diagnostics);
  const ids=new Map();
  for(const animation of animations){const id=animation.begin.args?.id;if(typeof id==='string'&&id){const list=ids.get(id)??[];list.push(animation);ids.set(id,list);}}
  diagnostics.duplicateAnimationFrameIds=[...ids].filter(([,list])=>list.length!==1).map(([id])=>id);
  const presentations=new Map();
  for(const event of main.filter(event=>event.name==='AnimationFrame::Presentation'&&event.ph==='n')){
    const id=event.args?.id;if(typeof id!=='string'||!id)continue;
    const list=presentations.get(id)??[];list.push(event);presentations.set(id,list);
  }
  diagnostics.duplicatePresentationIds=[...presentations].filter(([,list])=>list.length!==1).map(([id])=>id);
  const reporters=selectedReporters(events.filter(event=>event.name==='PipelineReporter'),pid,layer,diagnostics),reportersByFrame=new Map();
  for(const reporter of reporters){const list=reportersByFrame.get(reporter.frame.key)??[];list.push(reporter);reportersByFrame.set(reporter.frame.key,list);}
  const callbackEvents=main.filter(event=>event.name==='FireAnimationFrame'&&event.ph==='X'&&(frameId===undefined||identity(event.args?.data?.frame)===identity(frameId)));
  const fires=callbackEvents.filter(event=>finite(event.dur)&&event.dur>=0);
  let nextAnimation=0,active=[];
  const callbackCandidates=[];
  for(const fire of fires){
    active=active.filter(animation=>animation.end>=fire.ts);
    while(nextAnimation<animations.length&&animations[nextAnimation].start<=fire.ts)active.push(animations[nextAnimation++]);
    const containers=active.filter(animation=>fire.ts+fire.dur<=animation.end);
    const candidate={fire,selected:inWindow(fire.ts,window),animation:containers.length===1?containers[0]:null,reason:containers.length!==1?'non_unique_animation_containment':null};
    if(candidate.animation)candidate.animation.fires.push(candidate);
    callbackCandidates.push(candidate);
  }
  const verified=[],rejected=callbackEvents.filter(event=>!finite(event.dur)||event.dur<0).map(event=>({callbackStartTsUs:event.ts,callbackEndTsUs:null,selected:inWindow(event.ts,window),reason:'invalid_callback_duration'}));
  for(const candidate of callbackCandidates){
    const {fire,animation}=candidate;
    let reason=candidate.reason,origin=null,presentation=null,mainReporter=null,currentCheck='not_checked';
    const id=animation?.begin.args?.id;
    if(!reason&&animation.overlapping)reason='overlapping_animation_intervals';
    if(!reason&&animation.fires.length!==1)reason='multiple_callbacks_in_animation_frame';
    if(!reason&&(typeof id!=='string'||!id))reason='missing_animation_args_id';
    if(!reason&&ids.get(id)?.length!==1)reason='duplicate_animation_args_id';
    if(!reason&&presentations.get(id)?.length!==1)reason=presentations.has(id)?'duplicate_presentation_args_id':'missing_presentation_args_id';
    if(!reason){
      presentation=presentations.get(id)[0];origin=frameIdentity(animation.begin.args?.animation_frame_timing_info?.begin_frame_id);
      if(!origin)reason='missing_or_unsafe_origin_frame_identity';
      else if(presentation.ts<fire.ts+fire.dur)reason='presentation_before_callback_end';
    }
    if(!reason){
      const exact=(reportersByFrame.get(origin.key)??[]).filter(reporter=>reporter.state==='STATE_PRESENTED_ALL'&&reporter.end===presentation.ts);
      if(exact.length!==1)reason=exact.length?'non_unique_origin_reporter_feedback':'origin_reporter_feedback_not_verified';
      else{
        mainReporter=exact[0];
        const current=frameIdentity(presentation.args?.begin_frame_id);
        if(current?.key===origin.key)currentCheck='same_origin';
        else if(current){
          const forks=(reportersByFrame.get(current.key)??[]).filter(reporter=>reporter.state==='STATE_PRESENTED_PARTIAL'&&reporter.frameType==='FORKED'&&reporter.end===presentation.ts);
          currentCheck=forks.length===1?'fork_same_feedback_verified':forks.length?'ambiguous_current_fork':'current_metadata_not_verified';
        }else currentCheck='missing_or_unsafe_current_metadata';
      }
    }
    if(reason){rejected.push({callbackStartTsUs:fire.ts,callbackEndTsUs:fire.ts+fire.dur,selected:candidate.selected,reason});continue;}
    verified.push({callbackStartTsUs:fire.ts,callbackEndTsUs:fire.ts+fire.dur,animationBeginTsUs:animation.start,animationEndTsUs:animation.end,animationFrameId:id,callbackRequestId:identity(fire.args?.data?.id),pageFrameId:identity(fire.args?.data?.frame),originFrameSource:origin.source,originFrameSequence:origin.sequence,presentationTsUs:presentation.ts,presentationReporterEndTsUs:mainReporter.end,currentMetadataCheck:currentCheck,selected:candidate.selected});
  }
  const frames=verified.filter(row=>row.selected),selectedRejected=rejected.filter(row=>row.selected);
  const completed=verified.map(row=>row.callbackEndTsUs).sort((a,b)=>a-b),feedback=verified.map(row=>row.presentationTsUs).sort((a,b)=>a-b),unknownEnds=rejected.map(row=>row.callbackEndTsUs).filter(finite).sort((a,b)=>a-b);
  const depth=time=>upperBound(completed,time)-upperBound(feedback,time);
  for(const row of frames){row.knownCompletedAwaitingFeedbackAtAFBegin=depth(row.animationBeginTsUs);row.knownCompletedAwaitingFeedbackAtCallbackBegin=depth(row.callbackStartTsUs);row.knownCompletedAwaitingFeedbackAtCallbackEnd=depth(row.callbackEndTsUs);row.unverifiedCompletedCallbacksAtAFBegin=upperBound(unknownEnds,row.animationBeginTsUs);}
  // Callback cadence includes rejected/missing-feedback callbacks as well. A
  // missing attribution must not be mistaken for a missing callback itself.
  const windowCallbacks=callbackEvents.filter(event=>inWindow(event.ts,window));
  const callbackIntervals=windowCallbacks.slice(1).map((event,index)=>(event.ts-windowCallbacks[index].ts)/1000);
  const sourceOrderIntervals=frames.slice(1).map((row,index)=>(row.presentationTsUs-frames[index].presentationTsUs)/1000);
  const distinctTimes=[...new Set(frames.map(row=>row.presentationTsUs))].sort((a,b)=>a-b),distinctIntervals=distinctTimes.slice(1).map((time,index)=>(time-distinctTimes[index])/1000);
  const clusters=[];
  for(const time of distinctTimes){if(!clusters.length||time-clusters.at(-1).at(-1)>feedbackCoincidenceUs)clusters.push([time]);else clusters.at(-1).push(time);}
  const clusterTimes=clusters.map(cluster=>cluster.at(-1)),clusterIntervals=clusterTimes.slice(1).map((time,index)=>(time-clusterTimes[index])/1000);
  const reasons={};for(const row of selectedRejected)reasons[row.reason]=(reasons[row.reason]??0)+1;
  const currentMetadataChecks={};for(const row of frames)currentMetadataChecks[row.currentMetadataCheck]=(currentMetadataChecks[row.currentMetadataCheck]??0)+1;
  return {schema:'cs2-callback-presentation-metrics-v1',selection:{rendererPid:pid,mainThreadId:tid,layerTreeHostId:layer,frameId:frameId===undefined?null:identity(frameId),window:{...window},scope:'Callbacks beginning in the selected page/main-thread window; later captured feedback is retained'},coverage:{windowCallbacks:frames.length+selectedRejected.length,verifiedCallbacks:frames.length,rejectedCallbacks:selectedRejected.length,verifiedFraction:frames.length+selectedRejected.length?frames.length/(frames.length+selectedRejected.length):null,reasons,currentMetadataChecks,referenceCallbacks:callbackEvents.length,verifiedReferenceCallbacks:verified.length,referenceCallbacksBeforeWindow:verified.filter(row=>row.callbackStartTsUs<window.startTsUs).length,feedbackAfterWindow:frames.filter(row=>row.presentationTsUs>=window.endTsUs).length},summary:{callbackStartToPresentationMs:distribution(frames.map(row=>(row.presentationTsUs-row.callbackStartTsUs)/1000)),callbackEndToPresentationMs:distribution(frames.map(row=>(row.presentationTsUs-row.callbackEndTsUs)/1000)),animationBeginToPresentationMs:distribution(frames.map(row=>(row.presentationTsUs-row.animationBeginTsUs)/1000)),callbackStartIntervalMs:distribution(callbackIntervals)},presentation:{scope:'Software feedback for the selected source callbacks; no display/surface ID aggregation',callbackOrderIntervalMs:distribution(sourceOrderIntervals),nonMonotonicFeedbackPairs:sourceOrderIntervals.filter(value=>value<0).length,duplicateFeedbackTimestamps:frames.length-distinctTimes.length,distinctFeedbackTimestamps:distinctTimes.length,distinctFeedbackIntervalMs:distribution(distinctIntervals),gapThresholdMs,gapsOverThreshold:distinctIntervals.flatMap((intervalMs,index)=>intervalMs>gapThresholdMs?[{fromTsUs:distinctTimes[index],toTsUs:distinctTimes[index+1],intervalMs}]:[]),feedbackCoincidenceUs,nearCoincidentDistinctFeedbackPairs:distinctIntervals.filter(value=>value*1000<=feedbackCoincidenceUs).length,clusteredFeedbackTimes:clusterTimes.length,clusteredFeedbackIntervalMs:distribution(clusterIntervals),clusterInterpretation:'Explicit sensitivity view of near-coincident feedback timestamps; clusters are not certified physical refreshes'},queue:{scope:'Known completed callbacks without feedback at each query time, including captured prefix callbacks. Unverified callbacks/unseen trace prefix can make this a lower bound.',knownCompletedAwaitingFeedbackAtAFBegin:distribution(frames.map(row=>row.knownCompletedAwaitingFeedbackAtAFBegin)),knownCompletedAwaitingFeedbackAtCallbackBegin:distribution(frames.map(row=>row.knownCompletedAwaitingFeedbackAtCallbackBegin)),knownCompletedAwaitingFeedbackAtCallbackEnd:distribution(frames.map(row=>row.knownCompletedAwaitingFeedbackAtCallbackEnd)),unverifiedCompletedCallbacksAtAFBegin:distribution(frames.map(row=>row.unverifiedCompletedCallbacksAtAFBegin)),traceLeftBoundaryMayBeCensored:diagnostics.unmatchedAnimationFrameEnds.length>0||diagnostics.unmatchedReporterEnds>0,traceRightBoundaryMayBeCensored:diagnostics.unmatchedAnimationFrameBegins.length>0||diagnostics.unmatchedReporterBegins>0||rejected.some(row=>row.reason==='missing_presentation_args_id')},frames,rejectedCallbacks:selectedRejected,diagnostics,inputToPresentation:{computed:false,reason:'No input-flow or relative-movement attribution is performed by this callback helper'},limitations:['AnimationFrame args.id and safe origin source/sequence plus exact reporter feedback time establish renderer-update attribution; a nearby presentation never fills a missing link.','Display/surface identifiers are deliberately unused, even when exported as apparently precise strings, because a prior UI JSON export may already have rounded int64 values.','A source callback and containing renderer update do not by themselves prove GL drawing, changed camera pixels, physical scanout, or input-to-photon latency.','Incomplete or ambiguous callback attribution is exposed. Queue depth counts captured verified callbacks; unseen/censored work is not invented.']};
}
