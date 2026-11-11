import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameScheduler,frameSchedulingFromSearch} from '../public/cs2-frame-scheduler.js';

// Deterministic stand-ins: animation-frame callbacks and channel messages are
// delivered only when requested. This tests scheduler state, not compositor
// ordering, physical refresh or browser input latency.
function harness(mode='deferred'){
 const raf=new Map(),posted=[],frames=[],cancelled=[];let serial=0,wall=0,shown=true;
 const channel={port1:{onmessage:null,closed:false,close(){this.closed=true;}},port2:{closed:false,close(){this.closed=true;},postMessage(value){posted.push(value);}}};
 const events=[];
 const scheduler=createFrameScheduler(now=>{frames.push(now);events.push('frame:'+now);body?.(now);},{mode,request:fn=>{raf.set(++serial,fn);return serial;},cancel:id=>{cancelled.push(id);raf.delete(id);},channel:mode==='deferred'?channel:null,clock:()=>wall,visible:()=>shown});
 let body=null;
 return{scheduler,frames,posted,cancelled,channel,events,raf,
  setBody(fn){body=fn;},
  elapse(ms){wall+=ms;},setVisible(value){shown=value;},
  vsync(now){wall=now;const pending=[...raf];raf.clear();for(const [,fn] of pending){events.push('raf:'+now);fn(now);}return pending.length;},
  task(){if(!posted.length)return false;posted.shift();channel.port1.onmessage?.({data:0});return true;}};
}

test('URL selection defaults to deferred and only the explicit value restores inline execution',()=>{
 assert.equal(frameSchedulingFromSearch(''),'deferred');assert.equal(frameSchedulingFromSearch('?frame=deferred'),'deferred');assert.equal(frameSchedulingFromSearch('?camera=baseline&frame=inline'),'inline');assert.equal(frameSchedulingFromSearch('?frame=INLINE'),'deferred');assert.equal(frameSchedulingFromSearch('?frame='),'deferred');
});

test('deferred mode returns from the animation-frame callback before the frame body runs and passes the rAF timestamp through',()=>{
 const h=harness();h.setBody(()=>h.scheduler.request());
 assert.equal(h.scheduler.request(),true);assert.equal(h.vsync(1000.5),1);
 assert.deepEqual(h.frames,[],'The callback itself does no frame work');assert.equal(h.posted.length,1);assert.equal(h.raf.size,0,'The next callback is requested by the frame body, not the callback');
 assert.equal(h.task(),true);assert.deepEqual(h.frames,[1000.5]);assert.equal(h.raf.size,1);
 h.vsync(1013.8);h.task();h.vsync(1027.2);h.task();
 assert.deepEqual(h.frames,[1000.5,1013.8,1027.2]);assert.deepEqual(h.events,['raf:1000.5','frame:1000.5','raf:1013.8','frame:1013.8','raf:1027.2','frame:1027.2']);
 const d=h.scheduler.diagnostics();assert.equal(d.callbacks,3);assert.equal(d.frames,3);assert.equal(d.pending,true);assert.equal(d.stopped,false);assert.equal(d.lastTaskDelayMs,0);assert.equal(d.discardedStale,0);
});

test('at most one callback and one queued frame exist, so a slow frame delays the next one instead of stacking',()=>{
 const h=harness();
 assert.equal(h.scheduler.request(),true);assert.equal(h.scheduler.request(),false,'A second request while one is pending is ignored');assert.equal(h.raf.size,1);
 h.vsync(10);assert.equal(h.scheduler.request(),false,'No new callback while the frame task is still queued');assert.equal(h.raf.size,0);assert.equal(h.posted.length,1);
 h.task();assert.deepEqual(h.frames,[10]);assert.equal(h.task(),false);
 // A frame body that does not re-request simply ends the loop.
 assert.equal(h.vsync(20),0);assert.deepEqual(h.frames,[10]);assert.equal(h.scheduler.request(),true);h.vsync(30);h.task();assert.deepEqual(h.frames,[10,30]);
 // A stray message without a queued frame never renders.
 h.channel.port1.onmessage({data:0});assert.deepEqual(h.frames,[10,30]);
});

test('stop cancels the pending callback, drops an already queued frame and is final',()=>{
 const pending=harness();pending.scheduler.request();assert.equal(pending.scheduler.stop(),true);assert.deepEqual(pending.cancelled,[1]);assert.equal(pending.vsync(5),0);assert.equal(pending.scheduler.request(),false);assert.equal(pending.scheduler.stop(),false);
 assert.equal(pending.channel.port1.closed,true);assert.equal(pending.channel.port2.closed,true);assert.equal(pending.channel.port1.onmessage,null);
 const queued=harness();queued.scheduler.request();queued.vsync(7);const deliver=queued.channel.port1.onmessage;queued.scheduler.stop();deliver({data:0});
 assert.deepEqual(queued.frames,[],'A frame queued before pagehide or context loss must not render afterwards');assert.equal(queued.scheduler.stopped,true);assert.equal(queued.scheduler.diagnostics().pending,false);
 // Stopping from inside the frame body (context loss during render) is safe.
 const inside=harness();inside.setBody(()=>{inside.scheduler.stop();assert.equal(inside.scheduler.request(),false);});inside.scheduler.request();inside.vsync(9);inside.task();assert.deepEqual(inside.frames,[9]);assert.equal(inside.raf.size,0);
});

test('inline mode keeps the previous behaviour: the frame body runs inside the callback and needs no channel',()=>{
 const h=harness('inline');h.setBody(()=>h.scheduler.request());
 h.scheduler.request();h.vsync(16);assert.deepEqual(h.frames,[16]);assert.equal(h.posted.length,0);assert.equal(h.raf.size,1);h.vsync(33);assert.deepEqual(h.frames,[16,33]);
 assert.equal(h.scheduler.mode,'inline');assert.equal(h.scheduler.stop(),true);assert.equal(h.vsync(50),0);
});

test('a throwing frame body does not wedge the scheduler',()=>{
 const h=harness();let fail=true;h.setBody(()=>{h.scheduler.request();if(fail){fail=false;throw Error('render failed');}});
 h.scheduler.request();h.vsync(1);assert.throws(()=>h.task(),/render failed/);assert.equal(h.raf.size,1,'The next callback was already requested');h.vsync(2);h.task();assert.deepEqual(h.frames,[1,2]);
});

test('invalid construction is rejected and real MessageChannel delivery is not a compositor guarantee',async()=>{
 assert.throws(()=>createFrameScheduler(null,{request(){},cancel(){}}),TypeError);assert.throws(()=>createFrameScheduler(()=>{},{request:null,cancel(){}}),TypeError);
 assert.throws(()=>createFrameScheduler(()=>{},{mode:'later',request(){},cancel(){}}),RangeError);assert.throws(()=>createFrameScheduler(()=>{},{mode:'deferred',request(){},cancel(){},channel:{}}),TypeError);
 assert.throws(()=>createFrameScheduler(()=>{},{mode:'inline',request(){},cancel(){},maxTaskDelayMs:NaN}),TypeError);
 let callback=null,done,timeout;const seen=[],received=new Promise(resolve=>done=resolve);const scheduler=createFrameScheduler(now=>{seen.push(now);done();},{request:fn=>{callback=fn;return 1;},cancel(){},maxTaskDelayMs:1000});
 try{scheduler.request();callback(42.25);assert.deepEqual(seen,[]);await Promise.race([received,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('MessageChannel did not deliver')),3000);})]);assert.deepEqual(seen,[42.25]);}finally{clearTimeout(timeout);scheduler.stop();}
});

test('stale deferred tasks obtain a fresh real rAF before consuming queued fire/Q/Q',()=>{
 const h=harness(),pending=[],consumed=[];h.setBody(now=>{h.scheduler.request();consumed.push({now,inputs:pending.splice(0)});});
 h.scheduler.request();h.vsync(10);pending.push('fire','Q','Q');h.elapse(50.001);h.task();assert.deepEqual(consumed,[]);assert.equal(h.scheduler.diagnostics().discardedStale,1);assert.equal(h.raf.size,1);
 h.vsync(80);h.elapse(1);h.task();assert.deepEqual(consumed,[{now:80,inputs:['fire','Q','Q']}]);assert.deepEqual(h.frames,[80]);assert.equal(h.scheduler.diagnostics().lastTaskDelayMs,1);
});

test('the 50ms guard measures task residence and never substitutes wall time for rAF time',()=>{
 const h=harness();h.scheduler.request();h.vsync(100);h.elapse(50);h.task();assert.deepEqual(h.frames,[100]);assert.equal(h.scheduler.diagnostics().lastTaskDelayMs,50);
 const next=harness();next.scheduler.request();next.vsync(500);next.elapse(65);next.task();next.vsync(600);next.task();assert.deepEqual(next.frames,[600]);assert.equal(next.scheduler.diagnostics().peakTaskDelayMs,65);
});

test('hidden deferred work is dropped and fresh visible input retains its order',()=>{
 const h=harness(),pending=['old-fire'],consumed=[];h.setBody(now=>{h.scheduler.request();consumed.push({now,inputs:pending.splice(0)});});
 h.scheduler.request();h.vsync(10);h.setVisible(false);pending.length=0;h.elapse(1);h.task();assert.deepEqual(consumed,[]);assert.equal(h.raf.size,1);
 h.vsync(20);assert.equal(h.posted.length,0,'No hidden MessageChannel work stacks');assert.equal(h.raf.size,1);
 h.setVisible(true);pending.push('jump','release');h.vsync(1000);h.task();assert.deepEqual(consumed,[{now:1000,inputs:['jump','release']}]);assert.equal(h.scheduler.diagnostics().discardedHidden,2);
});

test('stop after stale or hidden rescheduling cancels the sole fresh callback',()=>{
 for(const kind of ['stale','hidden']){const h=harness();h.scheduler.request();h.vsync(10);if(kind==='stale')h.elapse(60);else h.setVisible(false);h.task();assert.equal(h.raf.size,1);h.scheduler.stop();assert.equal(h.raf.size,0);assert.equal(h.vsync(100),0);assert.deepEqual(h.frames,[]);}
});
