// Opt-in, bounded observations of the existing look/render path. This module
// never installs listeners, requests pointer lock, schedules frames or changes
// input. Times use the page's performance time origin, in milliseconds.
const SCHEMA='cs2-look-diagnostics-v1';
const SCOPE='Browser mouse dispatch and camera submission observations; no hardware polling-rate or physical presentation certification';
const EVENT_FIELDS=['id','session','receivedAt','eventTimestamp','dispatchDelayMs','receiveIntervalMs','sourceIntervalMs','movementX','movementY','yaw','pitch','factor','observedYawDelta','expectedYawDelta','yawResidual'];
const FRAME_FIELDS=['id','session','now','wallNow','rafIntervalMs','wallIntervalMs','yaw','pitch','cameraYaw','cameraPitch','recoilYaw','recoilPitch','cameraMinusInputYaw','cameraYawResidual','inputYawDelta','expectedYawDelta','observedYawDelta','yawResidual','eventCount','movementX','movementY','absoluteMovementX','firstEventId','lastEventId','oldestReceiptToFrameMs','newestReceiptToFrameMs','newestTimestampToFrameMs','cpuMs','mapUpdateMs','renderSubmitMs','cameraMs','animationMs','renderRatio','drawCalls','triangles','gpuMs','gpuSampleId','submittedAt'];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const optional=value=>finite(value)?value:NaN;
const angleDifference=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const noop=()=>false;
const quantiles=values=>{
  const sorted=values.filter(finite).sort((a,b)=>a-b),count=sorted.length;
  const at=q=>count?sorted[Math.ceil((count-1)*q)]:null;
  return {samples:count,min:sorted[0]??null,p50:at(.5),p95:at(.95),p99:at(.99),max:sorted.at(-1)??null,mean:count?sorted.reduce((sum,value)=>sum+value,0)/count:null};
};
function ring(capacity,fields){
  const data=new Float64Array(capacity*fields.length);
  let cursor=0,count=0,total=0;
  function reserve(){const offset=cursor*fields.length;cursor=(cursor+1)%capacity;count=Math.min(count+1,capacity);total++;return offset;}
  return {
    data,reserve,
    write(values){const offset=reserve();for(let index=0;index<fields.length;index++)data[offset+index]=optional(values[index]);},
    snapshot(){const rows=[];for(let index=0;index<count;index++){const offset=((cursor-count+index+capacity)%capacity)*fields.length,row={};for(let field=0;field<fields.length;field++){const value=data[offset+field];row[fields[field]]=finite(value)?value:null;}rows.push(row);}return rows;},
    get retained(){return count;},get total(){return total;},get overwritten(){return total-count;}
  };
}

export function createLookDiagnostics({enabled=false,eventCapacity=16384,frameCapacity=1800,now=()=>performance.now()}={}){
  if(!enabled)return Object.freeze({enabled:false,begin:noop,end:noop,observe:noop,sample:noop,snapshot:()=>({schema:SCHEMA,enabled:false,active:false,scope:SCOPE})});
  if(!Number.isInteger(eventCapacity)||eventCapacity<1||eventCapacity>32768||!Number.isInteger(frameCapacity)||frameCapacity<1||frameCapacity>3600)throw new RangeError('Look diagnostic buffers exceed supported limits');
  if(typeof now!=='function')throw new TypeError('Look diagnostic clock must be a function');
  const events=ring(eventCapacity,EVENT_FIELDS),frames=ring(frameCapacity,FRAME_FIELDS),sessions=[];
  let active=false,sessionId=0,firstStartedAt=null,lastEndedAt=null,lastEventAt=null,lastFrameAt=null,rejectedEvents=0,rejectedFrames=0,overwrittenSessions=0;
  let previousEventAt=NaN,previousSourceAt=NaN,previousEventYaw=NaN,previousFrameAt=NaN,previousRafAt=NaN,previousFrameYaw=NaN;
  let pendingCount=0,pendingX=0,pendingY=0,pendingAbsoluteX=0,pendingExpectedYaw=0,pendingObservedYaw=0,pendingExpectedKnown=true,pendingObservedKnown=true,pendingFirstId=NaN,pendingLastId=NaN,pendingFirstAt=NaN,pendingLastAt=NaN,pendingLastSource=NaN;
  function clearPending(){pendingCount=pendingX=pendingY=pendingAbsoluteX=pendingExpectedYaw=pendingObservedYaw=0;pendingExpectedKnown=pendingObservedKnown=true;pendingFirstId=pendingLastId=pendingFirstAt=pendingLastAt=pendingLastSource=NaN;}
  function end({wallNow=now(),reason='unlock'}={}){
    if(!active)return false;
    const at=finite(wallNow)?wallNow:now(),session=sessions.at(-1);
    session.endedAt=at;session.reason=String(reason).slice(0,64);session.unconsumedEvents=pendingCount;
    lastEndedAt=at;active=false;return true;
  }
  function begin({wallNow=now(),yaw,pitch,rawMode,sensitivity}={}){
    const at=finite(wallNow)?wallNow:now();
    if(active)end({wallNow:at,reason:'next-lock'});
    active=true;sessionId++;firstStartedAt??=at;
    previousEventAt=previousSourceAt=previousFrameAt=previousRafAt=NaN;previousEventYaw=previousFrameYaw=optional(yaw);
    clearPending();
    sessions.push({id:sessionId,startedAt:at,endedAt:null,reason:null,yaw:finite(yaw)?yaw:null,pitch:finite(pitch)?pitch:null,rawMode:typeof rawMode==='string'?rawMode.slice(0,64):null,sensitivity:finite(sensitivity)?sensitivity:null,unconsumedEvents:null});
    if(sessions.length>32){sessions.shift();overwrittenSessions++;}return true;
  }
  function observe({receivedAt,eventTimestamp,movementX,movementY,yaw,pitch,factor}={}){
    if(!active)return false;
    if(!finite(receivedAt)||!finite(movementX)||!finite(movementY)||!finite(yaw)||!finite(pitch)){rejectedEvents++;return false;}
    const id=events.total+1,source=optional(eventTimestamp),turnFactor=optional(factor),expected=finite(turnFactor)?-movementX*turnFactor:NaN,observed=finite(previousEventYaw)?yaw-previousEventYaw:NaN;
    // Avoid temporary arrays/records for high-rate mouse input. Object records
    // and quantiles are materialized only when the user requests a snapshot.
    const offset=events.reserve(),data=events.data;
    data[offset]=id;data[offset+1]=sessionId;data[offset+2]=receivedAt;data[offset+3]=source;data[offset+4]=receivedAt-source;data[offset+5]=receivedAt-previousEventAt;data[offset+6]=source-previousSourceAt;data[offset+7]=movementX;data[offset+8]=movementY;data[offset+9]=yaw;data[offset+10]=pitch;data[offset+11]=turnFactor;data[offset+12]=observed;data[offset+13]=expected;data[offset+14]=observed-expected;
    if(!pendingCount){pendingFirstId=id;pendingFirstAt=receivedAt;}
    pendingCount++;pendingX+=movementX;pendingY+=movementY;pendingAbsoluteX+=Math.abs(movementX);pendingLastId=id;pendingLastAt=receivedAt;pendingLastSource=source;
    if(finite(expected))pendingExpectedYaw+=expected;else pendingExpectedKnown=false;
    if(finite(observed))pendingObservedYaw+=observed;else pendingObservedKnown=false;
    previousEventAt=lastEventAt=receivedAt;previousSourceAt=source;previousEventYaw=yaw;return true;
  }
  // wallNow is callback entry; submittedAt is the optional frame-tail clock.
  // When omitted, entry + CPU duration approximates the recorded frame tail.
  function sample({now:rafNow,wallNow,submittedAt,yaw,pitch,cameraYaw,cameraPitch,recoilYaw,recoilPitch,cpuMs,mapUpdateMs,renderSubmitMs,cameraMs,animationMs,renderRatio,drawCalls,triangles,gpuMs,gpuSampleId}={}){
    if(!active)return false;
    if(![rafNow,wallNow,yaw,pitch,cameraYaw,cameraPitch].every(finite)){rejectedFrames++;return false;}
    const id=frames.total+1,inputDelta=yaw-previousFrameYaw,expected=pendingExpectedKnown?pendingExpectedYaw:NaN,observed=pendingObservedKnown?pendingObservedYaw:NaN;
    const tail=finite(submittedAt)?submittedAt:finite(cpuMs)&&cpuMs>=0?wallNow+cpuMs:NaN;
    frames.write([id,sessionId,rafNow,wallNow,rafNow-previousRafAt,wallNow-previousFrameAt,yaw,pitch,cameraYaw,cameraPitch,recoilYaw,recoilPitch,angleDifference(cameraYaw,yaw),finite(recoilYaw)?angleDifference(cameraYaw,yaw+recoilYaw):NaN,inputDelta,expected,observed,inputDelta-expected,pendingCount,pendingX,pendingY,pendingAbsoluteX,pendingFirstId,pendingLastId,wallNow-pendingFirstAt,wallNow-pendingLastAt,wallNow-pendingLastSource,cpuMs,mapUpdateMs,renderSubmitMs,cameraMs,animationMs,renderRatio,drawCalls,triangles,gpuMs,gpuSampleId,tail]);
    previousFrameAt=lastFrameAt=wallNow;previousRafAt=rafNow;previousFrameYaw=yaw;
    // A round reset or another existing writer may have changed yaw between
    // events. It remains visible in the frame residual, without contaminating
    // the next frame's event baseline.
    previousEventYaw=yaw;clearPending();return true;
  }
  function snapshot(){
    const at=now(),eventRows=events.snapshot(),frameRows=frames.snapshot();
    let frameIndex=0;
    for(const event of eventRows){
      // Both rings are chronological, so this join is linear even when many
      // empty frames precede a high-rate burst. A later lock cannot consume an
      // earlier session's event that was still pending when the lock ended.
      while(frameIndex<frameRows.length){const frame=frameRows[frameIndex];if(frame.session<event.session||(frame.session===event.session&&(frame.eventCount===0||frame.lastEventId<event.id)))frameIndex++;else break;}
      const frame=frameRows[frameIndex],consumed=frame&&frame.session===event.session&&frame.firstEventId<=event.id&&frame.lastEventId>=event.id;
      event.consumedFrameId=consumed?frame.id:null;event.receiptToFrameMs=consumed?frame.wallNow-event.receivedAt:null;event.timestampToFrameMs=consumed&&event.eventTimestamp!==null?frame.wallNow-event.eventTimestamp:null;event.receiptToSubmissionMs=consumed&&frame.submittedAt!==null?frame.submittedAt-event.receivedAt:null;event.timestampToSubmissionMs=consumed&&frame.submittedAt!==null&&event.eventTimestamp!==null?frame.submittedAt-event.eventTimestamp:null;
    }
    const eventMetric=key=>quantiles(eventRows.map(row=>row[key])),frameMetric=key=>quantiles(frameRows.map(row=>row[key]));
    const summary={dispatchDelayMs:eventMetric('dispatchDelayMs'),receiveIntervalMs:eventMetric('receiveIntervalMs'),sourceIntervalMs:eventMetric('sourceIntervalMs'),receiptToFrameMs:eventMetric('receiptToFrameMs'),timestampToFrameMs:eventMetric('timestampToFrameMs'),receiptToSubmissionMs:eventMetric('receiptToSubmissionMs'),timestampToSubmissionMs:eventMetric('timestampToSubmissionMs'),rafIntervalMs:frameMetric('rafIntervalMs'),wallIntervalMs:frameMetric('wallIntervalMs'),eventsPerFrame:frameMetric('eventCount'),cpuMs:frameMetric('cpuMs'),mapUpdateMs:frameMetric('mapUpdateMs'),renderSubmitMs:frameMetric('renderSubmitMs'),absoluteFrameYawResidual:quantiles(frameRows.map(row=>row.yawResidual===null?NaN:Math.abs(row.yawResidual))),absoluteCameraYawResidual:quantiles(frameRows.map(row=>row.cameraYawResidual===null?NaN:Math.abs(row.cameraYawResidual))),negativeDispatchDelays:eventRows.filter(row=>row.dispatchDelayMs!==null&&row.dispatchDelayMs<0).length,negativeSourceIntervals:eventRows.filter(row=>row.sourceIntervalMs!==null&&row.sourceIntervalMs<0).length,framesWithYawResidual:frameRows.filter(row=>row.yawResidual!==null&&Math.abs(row.yawResidual)>1e-6).length,framesWithCameraYawResidual:frameRows.filter(row=>row.cameraYawResidual!==null&&Math.abs(row.cameraYawResidual)>1e-6).length,eventsWithoutRetainedConsumingFrame:eventRows.filter(row=>row.consumedFrameId===null).length};
    return {schema:SCHEMA,enabled:true,active,scope:SCOPE,clock:'Page performance time origin, milliseconds; event timestamps are browser observations, not certified hardware timestamps',frameTiming:'now is the rAF timestamp; wallNow is callback entry. Event *ToFrameMs ends at callback entry. submittedAt is an explicit frame-tail timestamp or entry plus cpuMs, not GPU completion.',presentation:'cameraYaw/cameraPitch are CPU camera submission observations. Actual presented/partial/dropped frames require a browser compositor trace; gpuMs may be an earlier completed sample identified by gpuSampleId.',capturedAt:at,startedAt:firstStartedAt,endedAt:lastEndedAt,lastEventAgeMs:lastEventAt===null?null:at-lastEventAt,lastFrameAgeMs:lastFrameAt===null?null:at-lastFrameAt,limits:{eventCapacity,frameCapacity,sessionCapacity:32},totals:{events:events.total,frames:frames.total,sessions:sessionId,rejectedEvents,rejectedFrames,overwrittenEvents:events.overwritten,overwrittenFrames:frames.overwritten,overwrittenSessions},sessions:sessions.map(session=>({...session})),summary,events:eventRows,frames:frameRows};
  }
  return Object.freeze({enabled:true,begin,end,observe,sample,snapshot});
}
