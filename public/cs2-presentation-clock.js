// Filter callback timestamp phase for a stable position-presentation cadence.
// raw/output are simulation-relative seconds; frameTimeMs is the rAF timestamp.
// This never changes the simulation clock. Extra sampling lag is bounded to 2ms,
// which is not a measurement of physical input-to-display latency.
export function createPresentationClock({targetDelay=.001,maxDelay=.002,phaseGain=.04}={}){
 if(!(targetDelay>=0&&targetDelay<=maxDelay&&maxDelay<1/60&&phaseGain>0&&phaseGain<=1))throw new RangeError('Invalid presentation clock options');
 const periods=[30,50,60,72,75,90,100,120,144,165,180,240].map(hz=>1/hz);
 let observations=[],lastRaw=null,lastFrame=null,lastOutput=null,period=null,phase=0,delay=0,locks=0,resets=0,bounds=0;
 function reset(raw=null,frameTimeMs=null){observations=raw===null||frameTimeMs===null?[]:[{raw,frame:frameTimeMs/1000}];lastRaw=lastOutput=raw;lastFrame=frameTimeMs;period=null;phase=raw??0;delay=0;resets++;}
 function sample(raw,{enabled=true,frameTimeMs}={}){
  if(!Number.isFinite(raw))throw new TypeError('Invalid presentation time');
  if(!enabled||!Number.isFinite(frameTimeMs)){reset(raw);return raw;}
  if(lastRaw===null||lastFrame===null){reset(raw,frameTimeMs);return raw;}
  if(raw===lastRaw&&frameTimeMs===lastFrame)return lastOutput;
  const interval=(frameTimeMs-lastFrame)/1000,simulationInterval=raw-lastRaw;
  if(interval<=0||simulationInterval<=0||interval>=.05||Math.abs(interval-simulationInterval)>1e-6||(period&&interval>period*1.8)){reset(raw,frameTimeMs);return raw;}
  lastRaw=raw;lastFrame=frameTimeMs;observations.push({raw,frame:frameTimeMs/1000});if(observations.length>13)observations.shift();
  if(observations.length<13){lastOutput=raw;return raw;}
  const measured=(observations.at(-1).frame-observations[0].frame)/(observations.length-1),candidate=periods.reduce((a,b)=>Math.abs(b-measured)<Math.abs(a-measured)?b:a);
  const coherent=Math.abs(measured-candidate)<=candidate*.025&&observations.slice(1).every((value,i)=>Math.abs(value.frame-observations[i].frame-candidate)<=Math.max(.0025,candidate*.15));
  if(!coherent||(period&&Math.abs(candidate/period-1)>.05)){reset(raw,frameTimeMs);return raw;}
  if(period===null){period=candidate;phase=observations.reduce((sum,value,i)=>sum+value.raw+(observations.length-1-i)*period,0)/observations.length;locks++;}
  else{phase+=period;phase+=(raw-phase)*phaseGain;}
  delay=Math.min(targetDelay,delay+.0001);
  const target=phase-delay,output=Math.max(raw-maxDelay,Math.min(raw,target));if(output!==target)bounds++;
  lastOutput=output;return output;
 }
 return{reset,sample,diagnostics:()=>({policy:'cs2-position-cadence-v1',samplingDelayLimitMs:maxDelay*1000,locked:period!==null,cadenceHz:period?1/period:null,extraDelayMs:lastRaw===null?0:(lastRaw-lastOutput)*1000,locks,resets,bounds})};
}
