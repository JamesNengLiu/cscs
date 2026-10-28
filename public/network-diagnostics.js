// Bounded local diagnostics, never used for simulation, input or matchmaking.
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const stats=values=>{
  const a=[...values].sort((a,b)=>a-b),n=a.length;
  return {samples:n,min:n?a[0]:null,median:n?a[Math.floor((n-1)*.5)]:null,p95:n?a[Math.ceil(n*.95)-1]:null,max:n?a[n-1]:null,mean:n?a.reduce((s,v)=>s+v,0)/n:null};
};
export function createNetworkDiagnostics({now=()=>performance.now(),capacity=600,timelineSeconds=180}={}){
  if(!Number.isInteger(capacity)||capacity<1||capacity>3600||!Number.isInteger(timelineSeconds)||timelineSeconds<1||timelineSeconds>180)throw new RangeError('Diagnostic buffers exceed supported limits');
  const rings=new Map(),pings=new Map();let startedAt,startedUTC,lastState,lastFrame,longTasks,corrections,receivedStates,receivedBytes,server,seconds;
  function reset(){startedAt=now();startedUTC=new Date().toISOString();rings.clear();pings.clear();lastState=null;lastFrame=null;longTasks=0;corrections=0;receivedStates=0;receivedBytes=0;server=null;seconds=[];}
  function add(name,value){if(!finite(value)||value<0)return;let ring=rings.get(name);if(!ring){ring={values:new Float64Array(capacity),cursor:0,count:0};rings.set(name,ring);}ring.values[ring.cursor]=value;ring.cursor=(ring.cursor+1)%capacity;ring.count=Math.min(capacity,ring.count+1);}
  function bucket(name,value){if(!finite(value)||value<0)return;const second=Math.floor(Math.max(0,now()-startedAt)/1000);let b=seconds.at(-1);if(!b||b.second!==second){b={second,metrics:{}};seconds.push(b);if(seconds.length>timelineSeconds)seconds.shift();}const m=b.metrics[name]??={samples:0,sum:0,max:0};m.samples++;m.sum+=value;m.max=Math.max(m.max,value);}
  function record(name,value){add(name,value);bucket(name,value);}
  reset();
  return {
    reset,
    ping(sent){if(!finite(sent))return;for(const [key,at] of pings)if(sent-at>10000)pings.delete(key);if(pings.size<16)pings.set(sent,sent);},
    pong(m){if(!pings.has(m.sent))return false;const elapsed=now()-pings.get(m.sent);pings.delete(m.sent);record('applicationRttMs',elapsed);if(m.net){server={...m.net};record('serverLoopMaxMs',m.net.serverLoopMaxMs);record('serverTickGapMs',m.net.tickGapMaxMs);}return true;},
    state(m,bytes=0){const at=now(),emitted=finite(m.net?.emittedAtMs)?m.net.emittedAtMs:null;
      if(lastState){const arrival=at-lastState.at;record('stateArrivalIntervalMs',arrival);const source=emitted!==null&&lastState.emitted!==null?emitted-lastState.emitted:(m.time-lastState.time)*1000;if(finite(source)&&source>=0){record('stateSourceIntervalMs',source);record('deliveryVariationMs',Math.abs(arrival-source));}if(finite(m.net?.seq)&&finite(lastState.seq)&&m.net.seq>lastState.seq+1)record('snapshotSequenceGap',m.net.seq-lastState.seq-1);}
      lastState={at,emitted,time:m.time,seq:m.net?.seq};receivedStates++;receivedBytes+=Math.max(0,finite(bytes)?bytes:0);record('stateBytes',bytes);
      if(m.net){server={...server,...m.net};record('serverLoopMaxMs',m.net.serverLoopMaxMs);}
    },
    frame(intervalMs,foreground){if(foreground){record('foregroundFrameIntervalMs',intervalMs);lastFrame=now();}},
    prediction(correction,pending){record('positionCorrectionUnits',correction);record('pendingInputs',pending);if(correction>.05)corrections++;},
    queues(bytes){record('webSocketBufferedBytes',bytes);},
    longTask(duration,startTime){if(!finite(duration)||duration<0||(finite(startTime)&&startTime<startedAt))return;longTasks++;record('longTaskMs',duration);},
    snapshot(){const metrics={};for(const [name,r]of rings)metrics[name]=stats(r.values.subarray(0,r.count));const at=now();return {schema:'lan-strike-netdiag-v1',startedUTC,durationMs:Math.max(0,at-startedAt),limits:{metricSamples:capacity,timelineSeconds,pendingPings:16},totals:{receivedStates,receivedStateBytes:receivedBytes,longTasks,correctionsOverPoint05:corrections},metrics,stateAgeMs:lastState?Math.max(0,at-lastState.at):null,lastForegroundFrameAgeMs:lastFrame===null?null:Math.max(0,at-lastFrame),pendingPings:pings.size,server:server?{...server}:null,timeline:seconds.map(b=>({second:b.second,metrics:Object.fromEntries(Object.entries(b.metrics).map(([k,v])=>[k,{samples:v.samples,mean:v.sum/v.samples,max:v.max}]))})),notes:['Application RTT includes browser/server event-loop waits and WebSocket/TCP queues, not pure network RTT.','Delivery variation includes network and browser delivery scheduling, not packet-loss measurement.','Position units are internal game units, not a certified physical metre.','Timeline retains up to 180 sampled seconds; per-metric statistics retain the latest bounded samples.']};},
  };
}

export function observeLongTasks(diagnostics,Observer=globalThis.PerformanceObserver){
  if(!Observer||(Array.isArray(Observer.supportedEntryTypes)&&!Observer.supportedEntryTypes.includes('longtask')))return {supported:false,dispose(){}};
  try{const observer=new Observer(list=>{for(const entry of list.getEntries())diagnostics.longTask(entry.duration,entry.startTime);});observer.observe({type:'longtask',buffered:false});return {supported:true,dispose(){observer.disconnect();}};}catch{return {supported:false,dispose(){}};}
}

export function buildDiagnosticReport({network,performance,diagnostics,environment,longTaskSupported}){
  // Deliberately whitelist fields. Never export player names, IDs, chat, credentials or raw game state.
  const fields=['locked','visibility','frameCount','unackedInputs','inputSeq','ackInputSeq','lastCorrection','mouseSensitivity','scopedSensitivity'];
  return {schema:'lan-strike-diagnostic-report-v1',exportedUTC:new Date().toISOString(),network,performance,client:Object.fromEntries(fields.filter(k=>diagnostics[k]!==undefined).map(k=>[k,diagnostics[k]])),environment,longTaskSupported};
}
