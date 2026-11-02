// Bounded diagnostics and conservative resolution adaptation; never changes simulation.
export function interpolateRemote(display, target, dt) {
  const snap = Math.hypot(target.x-display.x,target.y-display.y,target.z-display.z)>3;
  const factor = snap ? 1 : 1-Math.exp(-Math.max(0,dt)*15);
  for (const key of ['x','y','z','pitch']) {
    if (!Number.isFinite(target[key])) continue;
    if (!Number.isFinite(display[key])) display[key]=target[key];
    display[key]+=(target[key]-display[key])*factor;
  }
  if (Number.isFinite(target.yaw)) {
    if (!Number.isFinite(display.yaw)||snap) display.yaw=target.yaw;
    else display.yaw+=Math.atan2(Math.sin(target.yaw-display.yaw),Math.cos(target.yaw-display.yaw))*factor;
  }
  return display;
}
export function createFrameMetrics(capacity = 240) {
  const fields = ['intervalMs', 'cpuMs', 'animationMs', 'renderSubmitMs','cameraMs','callbackLagMs','adaptationMs'];
  const rings = fields.map(() => new Float32Array(capacity));
  let cursor = 0, count = 0, gpuCursor=0, gpuCount=0, epoch=0;
  const gpuRing=new Float32Array(capacity);
  return {
    add(...values) {
      if (!values.every(v => Number.isFinite(v) && v >= 0)) return;
      for (let i = 0; i < fields.length; i++) rings[i][cursor] = values[i] || 0;
      cursor = (cursor + 1) % capacity; count = Math.min(count + 1, capacity);
    },
    get epoch(){return epoch;},
    addGpu(ms,sampleEpoch=epoch){if(sampleEpoch!==epoch||!Number.isFinite(ms)||ms<0)return;gpuRing[gpuCursor]=ms;gpuCursor=(gpuCursor+1)%capacity;gpuCount=Math.min(capacity,gpuCount+1);},
    reset() { cursor = count = gpuCursor = gpuCount = 0;epoch++; },
    snapshot() {
      const result = {samples: count, capacity, scope: 'Recent rendered foreground frames; CPU submit time is not GPU time'};
      for (let i = 0; i < fields.length; i++) {
        const samples = Array.from(rings[i].subarray(0, count)).sort((a, b) => a - b);
        result[fields[i]] = {median: samples[Math.floor((count - 1) * .5)] || 0, p95: samples[Math.floor((count - 1) * .95)] || 0,
          p99:samples[Math.floor((count-1)*.99)]||0,max:samples.at(-1)||0,
          mean: count ? samples.reduce((a, b) => a + b, 0) / count : 0};
        if(i===0){const tail=samples.slice(-Math.max(1,Math.ceil(count*.01))),mean=tail.reduce((a,b)=>a+b,0)/tail.length;result.onePercentLowFps=mean>0?1000/mean:0;}
      }
      result.estimatedFps = result.intervalMs.mean ? 1000 / result.intervalMs.mean : 0;
      const gpu=Array.from(gpuRing.subarray(0,gpuCount)).sort((a,b)=>a-b),gpuAt=q=>gpu[Math.floor((gpuCount-1)*q)]??null;
      result.gpuFrameMs={samples:gpuCount,median:gpuAt(.5),p95:gpuAt(.95),p99:gpuAt(.99),max:gpu.at(-1)??null,mean:gpuCount?gpu.reduce((s,x)=>s+x,0)/gpuCount:null,scope:'Distinct completed GPU queries for this measurement epoch; never CPU submit or a reused last result'};
      const intervals=Array.from(rings[0].subarray(0,count));
      result.frameBudgets=Object.fromEntries([60,120,144].map(hz=>{
        const budgetMs=1000/hz,toleranceMs=Math.max(.2,budgetMs*.02);
        return [hz,{targetHz:hz,budgetMs,toleranceMs,samples:count,
          overBudgetFrames:intervals.filter(ms=>ms>budgetMs+toleranceMs).length,
          cadenceP99WithinBudget:count>0&&result.intervalMs.p99<=budgetMs+toleranceMs,
          cpuP99WithinBudget:count>0&&result.cpuMs.p99<=budgetMs,
          cameraP99Ms:result.cameraMs.p99,gpuP99WithinBudget:gpuCount?result.gpuFrameMs.p99<=budgetMs:null,callbackLagP99Ms:result.callbackLagMs.p99}];
      }));
      result.cadenceScope='Observed callback intervals; not a display capability or physical input-latency certification';
      return result;
    },
  };
}
export {createResolutionController} from './render-budget.js';
