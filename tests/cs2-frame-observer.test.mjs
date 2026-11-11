import test from 'node:test';
import assert from 'node:assert/strict';
import {instrumentCS2FrameBody} from './fixtures/cs2-frame-observer.mjs';
import {createFrameScheduler} from '../public/cs2-frame-scheduler.js';

for(const mode of ['inline','deferred'])test(`actual frame-body observation includes GL work and finally paths in ${mode}`,()=>{
 const events=[],callbacks=[],messages=[];let scheduler,throwNext=false;
 const channel={port1:{onmessage:null,close(){}},port2:{postMessage(){messages.push(0);},close(){}}};
 const source='let stopped=false;function frame(now){if(stopped)return;frameScheduler.request();body(now);\n}\nframeScheduler.request();';
 const patched=instrumentCS2FrameBody(source,{before:'begin(now)',after:'end(__cs2ObservedFrame);'});

 let body;
 // The production entry itself is compiled once. No callback-name matching.
 scheduler=createFrameScheduler(now=>body(now),{mode,request:fn=>{callbacks.push(fn);return callbacks.length;},cancel(){},channel:mode==='deferred'?channel:null,clock:()=>0});
 body=new Function('frameScheduler','body','begin','end',patched+'\nreturn frame;')(scheduler,now=>{events.push('draw:'+now);if(throwNext)throw Error('test draw failure');},now=>{events.push('before:'+now);return now;},token=>events.push('after:'+token));
 const tick=now=>{callbacks.shift()(now);if(mode==='deferred'){assert.notEqual(events.at(-1),'draw:'+now);messages.shift();channel.port1.onmessage();}};
 tick(10);assert.deepEqual(events,['before:10','draw:10','after:10']);throwNext=true;assert.throws(()=>tick(20),/test draw failure/);assert.deepEqual(events.slice(-3),['before:20','draw:20','after:20']);scheduler.stop();
});

test('frame-body observer also closes on a production early return and refuses ambiguous source',()=>{
 const source='let rafId,stopped=false;function frame(now){if(stopped)return;return;\n}\nrafId=requestAnimationFrame(frame);',events=[];
 const result=instrumentCS2FrameBody(source,{before:'begin(now)',after:'end(__cs2ObservedFrame);'});
 const f=new Function('requestAnimationFrame','begin','end',result+'\nreturn frame;')(()=>1,n=>{events.push('before');return n;},()=>events.push('after'));
 f(10);assert.deepEqual(events,['before','after']);assert.throws(()=>instrumentCS2FrameBody(result,{before:'0',after:''}),/already instrumented/);
 assert.throws(()=>instrumentCS2FrameBody('function frame(){}',{before:'0',after:''}),/entry/);
});
