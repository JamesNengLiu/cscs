import test from 'node:test';
import assert from 'node:assert/strict';
import {createGpuTimer} from '../public/gpu-timer.js';
import {createResolutionController} from '../public/performance.js';
function fixture(supported=true){
  const state={disjoint:false,lost:false,queries:[],deleted:[],begins:0,ends:0,resultReads:0};
  const ext={TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2};
  const gl={QUERY_RESULT_AVAILABLE:3,QUERY_RESULT:4,getExtension:()=>supported?ext:null,isContextLost:()=>state.lost,
    getParameter:()=>state.disjoint,createQuery:()=>{const q={available:false,result:0};state.queries.push(q);return q;},
    beginQuery:()=>state.begins++,endQuery:()=>state.ends++,deleteQuery:q=>state.deleted.push(q),
    getQueryParameter(q,key){if(key===this.QUERY_RESULT_AVAILABLE)return q.available;state.resultReads++;return q.result;},
  };
  return {timer:createGpuTimer(gl),state};
}
test('GPU timestamps poll availability without blocking on unfinished query results',()=>{
  const {timer,state}=fixture();timer.begin();timer.end(0);assert.equal(timer.poll(10),null);assert.equal(state.resultReads,0);
  state.queries[0].available=true;state.queries[0].result=16e6;assert.equal(timer.poll(20),16);assert.equal(state.resultReads,1);
  assert.equal(timer.poll(600),null);timer.dispose();
});
test('GPU timestamp queue is bounded and times out stale queries',()=>{
  const {timer,state}=fixture();for(let i=0;i<20;i++){timer.begin();timer.end(i);}assert.equal(state.queries.length,4);
  assert.equal(timer.poll(2000),null);assert.equal(state.deleted.length,4);timer.begin();timer.end(2000);assert.equal(state.queries.length,5);timer.dispose();
});
test('GPU disjoint and unsupported timers fail safely without invented timings',()=>{
  const {timer,state}=fixture();timer.begin();timer.end(0);state.disjoint=true;assert.equal(timer.poll(10),null);assert.equal(state.deleted.length,1);timer.dispose();
  const missing=fixture(false);assert.equal(missing.timer.supported,false);missing.timer.begin();missing.timer.end(1);assert.equal(missing.timer.poll(2),null);missing.timer.dispose();assert.equal(missing.state.queries.length,0);
});
test('GPU timer disposal is idempotent and context loss never starts more queries',()=>{
  const {timer,state}=fixture();timer.begin();timer.dispose();timer.dispose();assert.equal(state.ends,1);assert.equal(state.deleted.length,1);timer.begin();assert.equal(state.queries.length,1);
  const other=fixture();other.state.lost=true;other.timer.begin();assert.equal(other.timer.poll(10),null);assert.equal(other.state.queries.length,0);other.timer.dispose();
});
test('auto resolution never blurs the image for CPU/display-bound pacing or unavailable GPU measurements',()=>{
  for(const gpuMs of [null,undefined,NaN,1,8]){
    const c=createResolutionController(1.25);for(let i=0;i<1000;i++)c.sample(50,i*50,gpuMs);assert.equal(c.ratio,1.25);
  }
});
