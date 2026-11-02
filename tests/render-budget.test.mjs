import test from 'node:test';
import assert from 'node:assert/strict';
import {createResolutionController} from '../public/render-budget.js';
import {createFrameMetrics} from '../public/performance.js';
import {createFrameTargetSettings,bindFrameTargets} from '../public/performance-settings.js';
function feed(c,options={}){
 const {frame=1000/120,cpu=1,duration=2400,start=0,idOffset=0,meta=()=>({})}=options,gpu=Object.hasOwn(options,'gpu')?options.gpu:.5;
 let changes=0;const count=Math.ceil(duration/frame);
 for(let i=0;i<count;i++){const now=start+i*frame;changes+=c.sample(frame,now,gpu,{cpuMs:cpu,gpuSampleId:idOffset+i,gpuSubmittedAt:now,gpuRatio:c.ratio,...meta(now,i)})?1:0;}
 return {changes,next:start+count*frame,id:idOffset+count};
}
for(const [hz,frame,gpu]of [[60,20,18],[120,11,10],[144,9,8]])test(`${hz} FPS budget catches sustained GPU overload below the old 22ms trigger`,()=>{
 const c=createResolutionController(1.25);c.setTarget(hz);feed(c,{frame,gpu});assert.equal(c.targetHz,hz);assert.equal(c.ratio,1);assert.equal(c.diagnostics().classification,'gpu-pressure');assert.equal(c.diagnostics().lastDecision,'lower-resolution');
});
for(const hz of [60,120,144])test(`${hz} FPS with cheap CPU/GPU preserves full clarity despite callback jitter`,()=>{
 const c=createResolutionController(1.25);c.setTarget(hz);feed(c,{frame:1000/hz+2,gpu:.6,cpu:1,duration:10000});assert.equal(c.ratio,1.25);assert.equal(c.diagnostics().changes,0);
});
test('CPU pressure retains resolution and is separately diagnosed',()=>{
 const c=createResolutionController(1.25);c.setTarget(120);feed(c,{frame:14,gpu:.6,cpu:12,duration:9000});assert.equal(c.ratio,1.25);assert.equal(c.diagnostics().classification,'cpu-pressure');
});
test('pure scheduling/display limits do not blur the scene to chase an unreachable target',()=>{
 const c=createResolutionController(1.25);c.setTarget(144);feed(c,{frame:1000/60,gpu:.6,cpu:1,duration:9000});assert.equal(c.ratio,1.25);assert.equal(c.diagnostics().classification,'cadence-or-scheduling');
});
test('repeated, expired, future and previous-resolution GPU results cannot vote for degradation',()=>{
 for(const meta of [()=>({gpuSampleId:42}),now=>({gpuSubmittedAt:now-600}),now=>({gpuSubmittedAt:now+1}),()=>({gpuRatio:.7})]){
  const c=createResolutionController(1.25);c.setTarget(120);feed(c,{frame:12,gpu:11,duration:9000,meta});assert.equal(c.ratio,1.25);assert.equal(c.diagnostics().classification,'gpu-unavailable');
 }
});
test('without GPU support or valid samples adaptation is safely manual-only',()=>{
 for(const gpu of [null,undefined,NaN,Infinity,-1]){const c=createResolutionController(1.25);c.setTarget(144);feed(c,{frame:40,gpu,duration:9000});assert.equal(c.ratio,1.25);assert.equal(c.diagnostics().classification,'gpu-unavailable');}
});
test('a single stall, a paused gap, and inactive sampling do not trigger a quality change',()=>{
 const c=createResolutionController(1.25);c.setTarget(120);feed(c,{frame:12,gpu:11,duration:1800});assert.equal(c.sample(350,2000,100),false);assert.equal(c.sample(12,6000,11,{active:false}),false);assert.equal(c.sample(12,6100,11),false);assert.equal(c.ratio,1.25);assert.equal(c.diagnostics().changes,0);
});
test('auto cadence learns 120Hz with headroom and keeps that budget during GPU or CPU overload',()=>{
 const c=createResolutionController(1.25);let at=feed(c,{duration:2000});assert.equal(c.targetHz,120);assert.equal(c.diagnostics().cadenceCalibrated,true);
 at=feed(c,{frame:16.7,gpu:16,cpu:2,duration:5000,start:at.next,idOffset:at.id});assert.equal(c.targetHz,120);
 feed(c,{frame:20,gpu:.5,cpu:17,duration:5000,start:at.next,idOffset:at.id});assert.equal(c.targetHz,120);
});
test('moving to a slower observed cadence needs three cheap windows rather than one low-FPS interval',()=>{
 const c=createResolutionController(1.25);let at=feed(c,{duration:2000});assert.equal(c.targetHz,120);
 at=feed(c,{frame:1000/60,duration:3200,start:at.next,idOffset:at.id});assert.equal(c.targetHz,120);
 feed(c,{frame:1000/60,duration:1800,start:at.next,idOffset:at.id});assert.equal(c.targetHz,60);
});
test('resolution changes are bounded, have cooldowns, and restore with long hysteresis',()=>{
 const c=createResolutionController(1.25);c.setTarget(120);const hot=feed(c,{frame:12,gpu:11,duration:11000});assert.equal(c.ratio,.7);assert.equal(hot.changes,3);
 let at=feed(c,{duration:3000,start:hot.next,idOffset:hot.id});assert.equal(c.ratio,.7);
 at=feed(c,{duration:21000,start:at.next,idOffset:at.id});assert.equal(c.ratio,.85);
 feed(c,{duration:46000,start:at.next,idOffset:at.id});assert.equal(c.ratio,1.25);
});
test('manual quality is fixed; changing the target does not change DPR or cap the device upwards',()=>{
 const c=createResolutionController(.6);c.setTarget(144);feed(c,{frame:12,gpu:11});assert.equal(c.ratio,.6);c.setQuality('performance');assert.equal(c.ratio,.6);feed(c,{frame:30,gpu:25});assert.equal(c.ratio,.6);
 c.setQuality('sharp');c.setTarget(60);feed(c,{frame:30,gpu:25});assert.equal(c.ratio,.6);assert.equal(c.setTarget('240'),false);assert.equal(c.target,'60');
});
test('distinct GPU query metrics preserve null for unknown data and reject previous measurement epochs',()=>{
 const m=createFrameMetrics(4);assert.equal(m.snapshot().gpuFrameMs.mean,null);const old=m.epoch;m.add(8,2,.4,.5,.05,1,.2);m.addGpu(6);m.addGpu(7);assert.equal(m.snapshot().gpuFrameMs.samples,2);assert.equal(m.snapshot().cpuMs.mean,2);assert.equal(m.snapshot().callbackLagMs.mean,1);
 m.reset();m.addGpu(100,old);m.addGpu(NaN);assert.equal(m.snapshot().gpuFrameMs.samples,0);m.addGpu(.5,m.epoch);assert.equal(m.snapshot().gpuFrameMs.mean,.5);
});
test('target selection persists, supports a tab override, and tolerates unavailable storage',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)},a=createFrameTargetSettings(storage);assert.equal(a.target,'auto');assert.equal(a.set('120'),true);assert.equal(createFrameTargetSettings(storage).target,'120');
 const b=createFrameTargetSettings(storage,new URLSearchParams('frameTarget=144'));assert.equal(b.target,'144');assert.equal(createFrameTargetSettings(storage).target,'120');assert.equal(b.set('bad'),false);
 const blocked=createFrameTargetSettings({getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}});assert.equal(blocked.target,'auto');assert.equal(blocked.set('60'),true);
});
test('lobby and pause-menu targets stay synchronized without changing any gameplay controls',()=>{
 const controls=Array.from({length:2},()=>({value:'',addEventListener(name,fn){this.change=fn;}})),settings=createFrameTargetSettings(null),changes=[];bindFrameTargets({querySelectorAll:()=>controls},settings,value=>changes.push(value));assert.ok(controls.every(c=>c.value==='auto'));controls[1].value='144';controls[1].change();assert.ok(controls.every(c=>c.value==='144'));assert.deepEqual(changes,['144']);
});

test('sustained very slow GPU frames remain eligible rather than being discarded as isolated stalls',()=>{
 const c=createResolutionController(1.25);c.setTarget(120);feed(c,{frame:150,gpu:140,cpu:2,duration:11000});assert.equal(c.ratio,1);assert.equal(c.diagnostics().classification,'gpu-pressure');
});
