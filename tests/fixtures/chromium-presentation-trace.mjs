// Offline only. No browser, server, file IO, or assumptions about physical scanout.
// Primary schemas:
// https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/front_end/models/trace/types/TraceEvents.ts
// https://chromium.googlesource.com/chromium/src/+/HEAD/cc/metrics/compositor_frame_reporter.cc
// https://raw.githubusercontent.com/google/perfetto/main/protos/perfetto/trace/track_event/chrome_frame_reporter.proto
// https://raw.githubusercontent.com/chromium/chromium/main/cc/metrics/frame_info.cc

const STATES=['STATE_NO_UPDATE_DESIRED','STATE_PRESENTED_ALL','STATE_PRESENTED_PARTIAL','STATE_DROPPED'];
const presented=state=>state==='STATE_PRESENTED_ALL'||state==='STATE_PRESENTED_PARTIAL';
const normalizeState=value=>typeof value==='number'?STATES[value]??'UNKNOWN':STATES.includes(value)?value:'UNKNOWN';
const payload=event=>event?.args?.frame_reporter??event?.args?.chrome_frame_reporter??null;
const counter=values=>{const counts=new Map();for(const value of values)counts.set(value,(counts.get(value)??0)+1);return Object.fromEntries([...counts].sort(([a],[b])=>String(a).localeCompare(String(b))));};
const exists=value=>value!==undefined&&value!==null;
const instant=event=>event.ph==='I'||event.ph==='i';
function distribution(values){
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b),at=q=>sorted.length?sorted[Math.ceil((sorted.length-1)*q)]:null;
  return{samples:sorted.length,min:sorted[0]??null,p50:at(.5),p95:at(.95),p99:at(.99),max:sorted.at(-1)??null,mean:sorted.length?sorted.reduce((s,v)=>s+v,0)/sorted.length:null};
}
function asyncKey(event){
  const namespace=JSON.stringify([event.cat??'',event.scope??'']);
  if(exists(event.id2?.global))return'global:'+namespace+':'+String(event.id2.global);
  if(exists(event.id2?.local))return'local:'+namespace+':'+String(event.pid)+':'+String(event.id2.local);
  // For async phases, legacy unqualified ids are global (Perfetto's legacy
  // event importer). Never use tid: an async event can end on another thread.
  if(exists(event.id))return'legacy-global:'+namespace+':'+String(event.id);
  return null;
}
function markerKey(event){
  return exists(event.args?.layerTreeId)&&exists(event.args?.frameSeqId)?JSON.stringify([event.pid,event.args.layerTreeId,event.args.frameSeqId]):null;
}
function reporterRecord(begin,end){
  const data=payload(begin)??payload(end)??{},endTs=end?.ts??(Number.isFinite(begin.dur)?begin.ts+begin.dur:null);
  return{pid:begin.pid,tid:begin.tid,id:asyncKey(begin),startTsUs:begin.ts,endTsUs:endTs,durationUs:Number.isFinite(endTs)?endTs-begin.ts:null,state:normalizeState(data.state),rawState:data.state??null,
    layerTreeHostId:data.layer_tree_host_id??null,frameSource:data.frame_source??null,frameSequence:data.frame_sequence??null,frameType:data.frame_type??null,displayTraceId:data.display_trace_id??null,surfaceFrameTraceId:data.surface_frame_trace_id??null,
    affectsSmoothness:data.affects_smoothness??null,reason:data.reason??null,hasMissingContent:data.has_missing_content??null,hasHighLatency:data.has_high_latency??null};
}

/** Preserve trace uint64 ids without rounding them through JavaScript Number. */
export function parseChromiumTraceJson(text){
  return JSON.parse(text,(_key,value,context)=>{
    if(typeof value==='number'&&Number.isInteger(value)&&!Number.isSafeInteger(value)){
      if(typeof context?.source!=='string')throw new Error('This runtime cannot preserve trace uint64 ids; JSON reviver context.source is required');
      return context.source;
    }
    return value;
  });
}

/**
 * Summarize Chrome's reported presentation feedback, keeping three layers apart:
 * async reporter instances, unique BeginFrame identities, and display feedback ids.
 * Input is a Chrome {traceEvents:[...]} export or its raw event array.
 * Timestamps/durations in the input are microseconds. Cadence outputs are ms.
 * Omitting the renderer/layer selectors deliberately keeps all candidate scopes;
 * an unfiltered browser-wide result must not be read as one page's frame rate.
 */
export function analyzeChromiumPresentationTrace(trace,{rendererPid,layerTreeHostId}={}){
  const events=Array.isArray(trace)?trace:trace?.traceEvents;
  if(!Array.isArray(events))throw new TypeError('Expected traceEvents array or raw event array');
  const ordered=events.filter(e=>e&&typeof e.name==='string'&&Number.isFinite(e.ts)).slice().sort((a,b)=>a.ts-b.ts);
  const pipeline=ordered.filter(e=>e.name==='PipelineReporter'),pending=new Map(),records=[],unmatchedEnds=[],missingAsyncIdentity=[];
  for(const event of pipeline){
    if(event.ph==='X'&&Number.isFinite(event.dur)){records.push(reporterRecord(event,null));continue;}
    if(event.ph!=='b'&&event.ph!=='e')continue;
    const key=asyncKey(event);
    if(key===null){missingAsyncIdentity.push({pid:event.pid,tid:event.tid,ts:event.ts,phase:event.ph});continue;}
    if(event.ph==='b'){const stack=pending.get(key)??[];stack.push(event);pending.set(key,stack);}
    else{const stack=pending.get(key),begin=stack?.pop();if(!begin)unmatchedEnds.push({pid:event.pid,tid:event.tid,ts:event.ts,key});else records.push(reporterRecord(begin,event));if(stack&&!stack.length)pending.delete(key);}
  }
  const unmatchedBegins=[...pending.values()].flat().map(e=>({pid:e.pid,tid:e.tid,ts:e.ts,key:asyncKey(e),reporter:payload(e)}));
  const pidMatches=pid=>rendererPid===undefined||String(pid)===String(rendererPid);
  const layerMatches=layer=>layerTreeHostId===undefined||String(layer)===String(layerTreeHostId);
  const selected=records.filter(r=>pidMatches(r.pid)&&layerMatches(r.layerTreeHostId));
  const candidateMap=new Map();
  for(const r of records){const key=JSON.stringify([r.pid,r.layerTreeHostId]),c=candidateMap.get(key)??{rendererPid:r.pid,layerTreeHostId:r.layerTreeHostId,reporters:0,states:{},frameTypes:{}};c.reporters++;c.states[r.state]=(c.states[r.state]??0)+1;if(r.frameType!==null)c.frameTypes[String(r.frameType)]=(c.frameTypes[String(r.frameType)]??0)+1;candidateMap.set(key,c);}
  const frameMap=new Map(),incompleteBeginFrameIdentity=[];
  for(const r of selected){
    if([r.layerTreeHostId,r.frameSource,r.frameSequence].some(v=>!exists(v))){incompleteBeginFrameIdentity.push(r);continue;}
    const key=JSON.stringify([r.pid,r.layerTreeHostId,r.frameSource,r.frameSequence]);
    const list=frameMap.get(key)??[];list.push(r);frameMap.set(key,list);
  }
  const frameGroups=[...frameMap.entries()].map(([key,members])=>({key,rendererPid:members[0].pid,layerTreeHostId:members[0].layerTreeHostId,frameSource:members[0].frameSource,frameSequence:members[0].frameSequence,reporterCount:members.length,
    states:[...new Set(members.map(r=>r.state))].sort(),frameTypes:counter(members.map(r=>r.frameType??'UNSPECIFIED')),displayTraceIds:[...new Set(members.filter(r=>exists(r.displayTraceId)).map(r=>String(r.displayTraceId)))],members}));
  const ambiguous=frameGroups.filter(g=>g.states.length!==1||g.states[0]==='UNKNOWN');
  const presentReports=selected.filter(r=>presented(r.state)),displayMap=new Map(),presentReportsWithoutDisplayId=[];
  for(const r of presentReports){
    if(!exists(r.displayTraceId)){presentReportsWithoutDisplayId.push(r);continue;}
    const key=String(r.displayTraceId),list=displayMap.get(key)??[];list.push(r);displayMap.set(key,list);
  }
  const displayFeedbacks=[...displayMap.entries()].map(([displayTraceId,members])=>({displayTraceId,states:[...new Set(members.map(r=>r.state))].sort(),reporterCount:members.length,
    presentationFeedbackTimestampsUs:[...new Set(members.map(r=>r.endTsUs).filter(Number.isFinite))].sort((a,b)=>a-b)}));
  // A shared display id is the aggregation identity. Conflicting feedback
  // timestamps are exposed rather than silently choosing one as physical present.
  const consistentDisplays=displayFeedbacks.filter(d=>d.presentationFeedbackTimestampsUs.length===1),displayTimes=consistentDisplays.map(d=>d.presentationFeedbackTimestampsUs[0]).sort((a,b)=>a-b);
  const uniqueFeedbackTimes=[...new Set(presentReports.map(r=>r.endTsUs).filter(Number.isFinite))].sort((a,b)=>a-b);
  const markers=ordered.filter(e=>pidMatches(e.pid)&&layerMatches(e.args?.layerTreeId));
  const draws=markers.filter(e=>e.name==='DrawFrame'&&instant(e)),drops=markers.filter(e=>e.name==='DroppedFrame'&&instant(e));
  const dropMap=new Map(),unidentifiedDropMarkers=[];
  for(const e of drops){const key=markerKey(e);if(!key){unidentifiedDropMarkers.push(e);continue;}const prior=dropMap.get(key)??{key,pid:e.pid,layerTreeId:e.args.layerTreeId,frameSeqId:e.args.frameSeqId,hasPartialUpdate:false,events:0};prior.hasPartialUpdate||=Boolean(e.args.hasPartialUpdate);prior.events++;dropMap.set(key,prior);}
  const dedupDrops=[...dropMap.values()];
  const pidMap=new Map();
  for(const e of ordered){const key=String(e.pid),p=pidMap.get(key)??{pid:e.pid,eventCount:0,processName:null,threadNames:{},eventNames:{},mouseMoveDispatches:0,animationFrameCallbacks:0,frameMetadata:new Map()};p.eventCount++;p.eventNames[e.name]=(p.eventNames[e.name]??0)+1;if(e.ph==='M'&&e.name==='process_name')p.processName=e.args?.name??null;if(e.ph==='M'&&e.name==='thread_name')p.threadNames[String(e.tid)]=e.args?.name??null;if(e.name==='EventDispatch'&&e.args?.data?.type==='mousemove')p.mouseMoveDispatches++;if(e.name==='FireAnimationFrame')p.animationFrameCallbacks++;if(e.name==='TracingStartedInBrowser'||e.name==='TracingStartedInPage'||e.name==='SetLayerTreeId'){const mk=JSON.stringify([e.name,e.args]),m=p.frameMetadata.get(mk)??{name:e.name,args:e.args,firstTsUs:e.ts,lastTsUs:e.ts,count:0};m.count++;m.lastTsUs=e.ts;p.frameMetadata.set(mk,m);}pidMap.set(key,p);}
  const unsafeNumericIdentifiers=[];
  for(const r of selected)for(const field of ['layerTreeHostId','frameSource','frameSequence','displayTraceId','surfaceFrameTraceId'])if(typeof r[field]==='number'&&!Number.isSafeInteger(r[field]))unsafeNumericIdentifiers.push({reporterId:r.id,field,value:r[field]});
  const timeline=ordered.filter(e=>e.ph!=='M'&&e.ts>0),firstTs=timeline[0]?.ts??null,lastTs=timeline.at(-1)?.ts??null;
  const displayIdPrecisionSafe=!unsafeNumericIdentifiers.some(v=>v.field==='displayTraceId');
  // A JSON file can already contain rounded uint64 literals before this parser
  // sees it (e.g. after a prior JavaScript import/export). A shared id pointing
  // at different presentation timestamps is not a trustworthy unique identity.
  const displayIdentityConsistent=displayFeedbacks.every(d=>d.presentationFeedbackTimestampsUs.length===1);
  const displayIdentityUsable=displayIdPrecisionSafe&&displayIdentityConsistent;
  return{
    selection:{rendererPid:rendererPid??null,layerTreeHostId:layerTreeHostId??null,fullyScoped:rendererPid!==undefined&&layerTreeHostId!==undefined,scope:rendererPid!==undefined&&layerTreeHostId!==undefined?'selected renderer/layer':'unfiltered or partially filtered; do not treat aggregate as one page'},
    trace:{eventCount:events.length,validTimestampEvents:ordered.length,firstTsUs:firstTs,lastTsUs:lastTs,spanMs:firstTs!==null&&lastTs!==null?(lastTs-firstTs)/1000:null,topEventNames:Object.entries(counter(ordered.map(e=>e.name))).sort((a,b)=>b[1]-a[1]).slice(0,40)},
    candidates:{layerTrees:[...candidateMap.values()].sort((a,b)=>b.reporters-a.reporters),processes:[...pidMap.values()].map(p=>({...p,frameMetadata:[...p.frameMetadata.values()],eventNames:Object.entries(p.eventNames).sort((a,b)=>b[1]-a[1]).slice(0,25)})).sort((a,b)=>b.eventCount-a.eventCount)},
    pairing:{pipelineEvents:pipeline.length,matchedReporters:records.length,selectedMatchedReporters:selected.length,unmatchedBegins,unmatchedEnds,missingAsyncIdentity,negativeDurationReporters:selected.filter(r=>r.durationUs<0)},
    reporterInstances:{count:selected.length,stateCounts:counter(selected.map(r=>r.state)),frameTypeCounts:counter(selected.map(r=>r.frameType??'UNSPECIFIED')),records:selected,interpretation:'Async reporter instances; forked reporters are not independent frames.'},
    beginFrames:{count:frameGroups.length,singleStateCounts:counter(frameGroups.filter(g=>g.states.length===1).map(g=>g.states[0])),multipleReporterGroups:frameGroups.filter(g=>g.reporterCount>1).length,ambiguousCount:ambiguous.length,ambiguousGroups:ambiguous,incompleteIdentityReporters:incompleteBeginFrameIdentity,groups:frameGroups,interpretation:'Unique renderer/layer/source/sequence identities. Mixed fork states remain unresolved; no made-up state priority.'},
    presentationFeedback:{presentedReporterCount:presentReports.length,displayIdPrecisionSafe,displayIdentityConsistent,uniquePresentedDisplayFrames:displayIdentityUsable?(displayFeedbacks.length||null):null,displayIdCoverage:presentReports.length?{withDisplayId:presentReports.length-presentReportsWithoutDisplayId.length,withoutDisplayId:presentReportsWithoutDisplayId.length}:null,allOnlyDisplayFrames:displayIdentityUsable?displayFeedbacks.filter(d=>d.states.length===1&&d.states[0]==='STATE_PRESENTED_ALL').length:null,partialOnlyDisplayFrames:displayIdentityUsable?displayFeedbacks.filter(d=>d.states.length===1&&d.states[0]==='STATE_PRESENTED_PARTIAL').length:null,mixedStateDisplayFrames:displayIdentityUsable?displayFeedbacks.filter(d=>d.states.length!==1).length:null,displayFeedbacks,conflictingTimestampDisplayFrames:displayFeedbacks.filter(d=>d.presentationFeedbackTimestampsUs.length!==1),displayFeedbackCadenceMs:distribution(displayIdentityUsable?displayTimes.slice(1).map((t,i)=>(t-displayTimes[i])/1000):[]),distinctReporterEndTimestamps:uniqueFeedbackTimes.length,reporterEndCadenceMs:distribution(uniqueFeedbackTimes.slice(1).map((t,i)=>(t-uniqueFeedbackTimes[i])/1000)),physicalScanoutCertified:false,interpretation:'Chromium presentation feedback/aggregation ids. Missing, rounded, or conflicting display ids are not inferred. Headless/synthetic output and physical display scanout remain separate.'},
    drawAndDropMarkers:{drawFrameInstantEvents:draws.length,uniqueDrawFrameKeys:new Set(draws.map(markerKey).filter(Boolean)).size,drawFrameNonInstantEvents:markers.filter(e=>e.name==='DrawFrame'&&!instant(e)).length,droppedFrameInstantEvents:drops.length,pureDroppedSmoothnessFrames:dedupDrops.filter(d=>!d.hasPartialUpdate).length,partialSmoothnessFrames:dedupDrops.filter(d=>d.hasPartialUpdate).length,frames:dedupDrops,unidentifiedDropMarkers,interpretation:'DrawFrame is draw activity, not presentation. DroppedFrame marks smoothness-affecting drop/partial updates; do not add these counts to reporter counts.'},
    inputToRaf:{computed:false,interpretation:'EventDispatch and generic FireAnimationFrame proximity is not a causal input-to-app-frame link. Use app RAF/input markers or explicit flows; EventLatency frame ids are primarily available for scroll updates.'},
    limitations:{unsafeNumericIdentifiers,notes:['Reporters crossing trace boundaries are censored and listed as unmatched.','State counts include idle/no-update separately.','Do not equate a long PipelineReporter duration with a dropped frame; use the reported state and presentation cadence.','No physical mouse-to-photon latency is certified by this parser.']},
  };
}
