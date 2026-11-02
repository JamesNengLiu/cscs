// Rendering budget only. Never gates rAF, inputs, fixed simulation, or effects.
export const FRAME_TARGETS=Object.freeze(['auto','60','120','144']);
const CADENCES=[30,60,75,90,100,120,144,165,180,240,360,480];
const percentile=(values,q)=>{const a=[...values].sort((x,y)=>x-y);return a[Math.floor((a.length-1)*q)]||0;};
const boundedPush=(a,value)=>{if(a.length<512)a.push(value);};
export function createResolutionController(maxRatio=1.25){
  const ratios=[...new Set([Math.min(maxRatio,1.25),Math.min(maxRatio,1),Math.min(maxRatio,.85),Math.min(maxRatio,.7)])].sort((a,b)=>b-a);
  let quality='auto',target='auto',observedHz=60,calibrated=false,level=0,lastChange=-Infinity,lastNow=null,since=null;
  let lastGpuId=null,lowerCandidate=null,lowerVotes=0,changes=0,classification='warming-up',lastDecision='hold',lastWindow=null;
  const frames=[],cpus=[],gpus=[],cadence=[];
  const hz=()=>target==='auto'?observedHz:Number(target);
  const ratio=()=>quality==='performance'?Math.min(maxRatio,.85):quality==='sharp'?ratios[0]:ratios[level];
  function clearWindow(){frames.length=cpus.length=gpus.length=0;since=null;}
  function reset(){clearWindow();cadence.length=0;lastNow=null;classification='warming-up';}
  function learnCadence(ms,cpu,gpu,fresh){
    // Learn only with substantial measured headroom. Overloaded frame intervals
    // must not be mistaken for a slower display and relax the desired budget.
    if(!fresh||cpu>ms*.5||gpu>ms*.5||ms>40)return false;
    cadence.push(ms);if(cadence.length<90)return false;
    const measured=1000/percentile(cadence,.5);cadence.length=0;
    const candidate=CADENCES.reduce((a,b)=>Math.abs(b-measured)<Math.abs(a-measured)?b:a);
    if(Math.abs(candidate-measured)/candidate>.10)return false;
    if(calibrated&&candidate<observedHz){
      if(lowerCandidate===candidate)lowerVotes++;else{lowerCandidate=candidate;lowerVotes=1;}
      if(lowerVotes<3)return false;
    }
    lowerCandidate=null;lowerVotes=0;calibrated=true;
    if(candidate===observedHz)return false;
    observedHz=candidate;return target==='auto';
  }
  return {
    get quality(){return quality;},get ratio(){return ratio();},get target(){return target;},get targetHz(){return hz();},reset,
    setQuality(value){if(!['auto','performance','sharp'].includes(value))return false;quality=value;level=0;lastChange=-Infinity;reset();return true;},
    setTarget(value){value=String(value);if(!FRAME_TARGETS.includes(value))return false;target=value;reset();return true;},
    sample(ms,now,gpuMs,{cpuMs=0,gpuSampleId=null,gpuSubmittedAt=now,gpuRatio=ratio(),active=true}={}){
      if(!active||!Number.isFinite(ms)||ms<=0||ms>250||!Number.isFinite(now)||!Number.isFinite(cpuMs)||cpuMs<0){reset();return false;}
      if(lastNow!==null&&(now<=lastNow||now-lastNow>250))reset();lastNow=now;
      const validGpu=Number.isFinite(gpuMs)&&gpuMs>=0&&Number.isFinite(gpuSubmittedAt)&&now-gpuSubmittedAt>=0&&now-gpuSubmittedAt<=500&&Math.abs(gpuRatio-ratio())<.005;
      const fresh=validGpu&&(gpuSampleId===null||gpuSampleId!==lastGpuId);
      if(fresh)lastGpuId=gpuSampleId;
      if(learnCadence(ms,cpuMs,gpuMs,fresh))clearWindow();
      if(quality!=='auto'){classification='manual-quality';clearWindow();return false;}
      since??=now;boundedPush(frames,ms);boundedPush(cpus,cpuMs);
      if(fresh&&gpuSubmittedAt>=since)boundedPush(gpus,gpuMs);
      if(now-since<2000||frames.length<60)return false;
      const budget=1000/hz(),frameP90=percentile(frames,.9),frameMean=frames.reduce((s,x)=>s+x,0)/frames.length,cpuP90=percentile(cpus,.9),gpuP90=percentile(gpus,.9),gpuCount=gpus.length;
      lastWindow={durationMs:now-since,frames:frames.length,gpuSamples:gpuCount,frameP90Ms:frameP90,frameMeanMs:frameMean,cpuP90Ms:cpuP90,gpuP90Ms:gpuCount?gpuP90:null};
      clearWindow();lastDecision='hold';
      if(gpuCount<30){classification='gpu-unavailable';return false;}
      const gpuPressure=gpuP90>budget*.9&&(frameMean>budget*1.03||frameP90>budget*1.15);
      const cpuPressure=cpuP90>budget*.85;
      classification=gpuPressure?(cpuPressure?'gpu-and-cpu-pressure':'gpu-pressure'):cpuPressure?'cpu-pressure':frameP90>budget*1.15?'cadence-or-scheduling':'no-sustained-overload';
      const before=level;
      if(gpuPressure&&now-lastChange>3000){level=Math.min(level+1,ratios.length-1);if(level!==before)lastDecision='lower-resolution';}
      else if(!cpuPressure&&gpuP90<budget*.55&&now-lastChange>20000){level=Math.max(0,level-1);if(level!==before)lastDecision='restore-resolution';}
      if(level!==before){lastChange=now;changes++;return true;}return false;
    },
    diagnostics:()=>({target,targetHz:hz(),observedCallbackHz:observedHz,cadenceCalibrated:calibrated,budgetMs:1000/hz(),quality,ratio:ratio(),classification,lastDecision,changes,lastWindow,scope:'GPU-evidenced resolution budget; target is not an FPS cap or display certification'})
  };
}
