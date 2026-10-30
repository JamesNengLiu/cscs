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
  const fields = ['intervalMs', 'cpuMs', 'animationMs', 'renderSubmitMs'];
  const rings = fields.map(() => new Float32Array(capacity));
  let cursor = 0, count = 0;
  return {
    add(...values) {
      if (!values.every(v => Number.isFinite(v) && v >= 0)) return;
      for (let i = 0; i < fields.length; i++) rings[i][cursor] = values[i] || 0;
      cursor = (cursor + 1) % capacity; count = Math.min(count + 1, capacity);
    },
    reset() { cursor = count = 0; },
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
      return result;
    },
  };
}
export function createResolutionController(maxRatio = 1.25) {
  const ratios = [...new Set([Math.min(maxRatio, 1.25), Math.min(maxRatio, 1), Math.min(maxRatio, .85), Math.min(maxRatio, .7)])].sort((a,b)=>b-a);
  let quality = 'auto', level = 0, count = 0, sum = 0, gpuSum = 0, since = null, lastChange = -Infinity;
  function reset() { count = sum = gpuSum = 0; since = null; }
  function ratio() { return quality === 'performance' ? Math.min(maxRatio, .85) : quality === 'sharp' ? ratios[0] : ratios[level]; }
  return {
    get quality() { return quality; }, get ratio() { return ratio(); },
    reset,
    setQuality(value) {
      if (!['auto', 'performance', 'sharp'].includes(value)) return false;
      quality = value; level = 0; lastChange = -Infinity; reset(); return true;
    },
    sample(ms, now, gpuMs) {
      if (quality !== 'auto' || !Number.isFinite(ms) || ms <= 0 || ms > 250 || !Number.isFinite(gpuMs) || gpuMs<0) { reset(); return false; }
      if (since === null) since = now;
      sum += ms; gpuSum += gpuMs; count++;
      if (count < 120 || now - since < 2000) return false;
      const mean = sum / count, gpuMean=gpuSum/count; reset(); const before = level;
      if (mean > 22 && gpuMean>14 && now - lastChange > 3000) level = Math.min(level + 1, ratios.length - 1);
      else if ((mean < 17.5 || gpuMean<10) && now - lastChange > 20000) level = Math.max(level - 1, 0);
      if (level !== before) { lastChange = now; return true; }
      return false;
    },
  };
}
