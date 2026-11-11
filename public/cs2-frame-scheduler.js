// Runs the game frame in a task queued from the animation-frame callback
// instead of inside the callback itself.
//
// This changes task placement for a reversible presentation experiment. A
// MessageChannel task runs after the current JavaScript callback returns; it
// is NOT a compositor commit fence and provides no zero-latency or physical
// presentation guarantee. Browser task scheduling can delay its execution.
//
// A queued task older than 50ms is discarded instead of sampling fresh input
// using its old rAF timestamp. This matches the existing 50ms simulation-step
// clamp / presentation-clock discontinuity boundary. The next real rAF owns
// the new timestamp; no wall-clock value is substituted for it. The deferred
// path also discards hidden work. Inline retains its original callback path.
//
// `?frame=inline` restores the previous in-callback execution for comparison.
export function frameSchedulingFromSearch(search){
  return new URLSearchParams(search).get('frame')==='inline'?'inline':'deferred';
}

export function createFrameScheduler(frame,{mode='deferred',request=globalThis.requestAnimationFrame?.bind(globalThis),cancel=globalThis.cancelAnimationFrame?.bind(globalThis),channel=mode==='deferred'?new MessageChannel():null,clock=()=>performance.now(),visible=()=>globalThis.document?.hidden!==true,maxTaskDelayMs=50}={}){
  if(typeof frame!=='function'||typeof request!=='function'||typeof cancel!=='function')throw new TypeError('Frame scheduler requires a frame function and animation-frame hooks');
  if(mode!=='deferred'&&mode!=='inline')throw new RangeError('Unknown frame scheduling mode');
  if(mode==='deferred'&&(!channel?.port1||!channel?.port2))throw new TypeError('Deferred frame scheduling requires a message channel');
  if(typeof clock!=='function'||typeof visible!=='function'||!Number.isFinite(maxTaskDelayMs)||maxTaskDelayMs<=0)throw new TypeError('Invalid frame task safety options');
  let handle=null,queued=false,stopped=false,timestamp=0,queuedAt=null,callbacks=0,frames=0,lastTaskDelayMs=0,peakTaskDelayMs=0,discardedStale=0,discardedHidden=0;
  function schedule(){if(stopped||handle!==null||queued)return false;handle=request(onAnimationFrame);return true;}
  const run=()=>{
    // A stop between the callback and this task drops the frame; a stale
    // message after a stop/restart of the page lifetime must never render.
    if(!queued)return;queued=false;if(stopped)return;
    const delay=clock()-queuedAt;queuedAt=null;lastTaskDelayMs=delay;peakTaskDelayMs=Math.max(peakTaskDelayMs,delay);
    if(!visible()){discardedHidden++;schedule();return;}
    if(!Number.isFinite(delay)||delay<0||delay>maxTaskDelayMs){discardedStale++;schedule();return;}
    frames++;frame(timestamp);
  };
  if(mode==='deferred')channel.port1.onmessage=run;
  function onAnimationFrame(now){
    handle=null;callbacks++;if(stopped)return;
    if(mode==='inline'){frames++;frame(now);return;}
    if(!visible()){discardedHidden++;schedule();return;}
    timestamp=now;queuedAt=clock();queued=true;channel.port2.postMessage(0);
  }
  return {
    // Called by the frame body itself, as requestAnimationFrame was. At most
    // one callback and one queued frame exist at any time, so a slow frame
    // delays the next one instead of stacking work.
    request:schedule,
    stop(){
      if(stopped)return false;stopped=true;queued=false;queuedAt=null;
      if(handle!==null){cancel(handle);handle=null;}
      if(mode==='deferred'){channel.port1.onmessage=null;channel.port1.close?.();channel.port2.close?.();}
      return true;
    },
    get mode(){return mode;},
    get stopped(){return stopped;},
    diagnostics:()=>({mode,callbacks,frames,pending:handle!==null||queued,stopped,taskDelayLimitMs:maxTaskDelayMs,lastTaskDelayMs,peakTaskDelayMs,discardedStale,discardedHidden,scope:'Task-placement experiment, not a compositor fence or physical latency guarantee. Accepted frames keep their real rAF timestamp; stale/hidden deferred tasks request a fresh rAF.'}),
  };
}
