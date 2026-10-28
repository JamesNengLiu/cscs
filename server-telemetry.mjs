// Read-only scheduling telemetry. Never affects tick rate, gameplay or transport policy.
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const percentiles=values=>{const a=[...values].sort((a,b)=>a-b);return {p95:a.length?a[Math.ceil(a.length*.95)-1]:0,max:a.at(-1)??0};};
export function createServerTelemetry({tickHz,snapshotHz}){
  const histogram=monitorEventLoopDelay({resolution:10});histogram.enable();
  const gaps=[],work=[];let revision=null,sourceFingerprint=null;
  try{revision=execFileSync('git',['rev-parse','--short','HEAD'],{cwd:fileURLToPath(new URL('.',import.meta.url)),encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
  try{sourceFingerprint=createHash('sha256').update(readFileSync(new URL('./server.mjs',import.meta.url))).update(readFileSync(new URL(import.meta.url))).digest('hex');}catch{}
  let window={serverLoopP95Ms:0,serverLoopMaxMs:0,tickGapP95Ms:0,tickGapMaxMs:0,loopWorkP95Ms:0,loopWorkMaxMs:0,updatedAtMs:performance.now()},ticks=0;
  const timer=setInterval(()=>{
    const gap=percentiles(gaps),busy=percentiles(work);
    window={serverLoopP95Ms:histogram.count?histogram.percentile(95)/1e6:0,serverLoopMaxMs:histogram.count?histogram.max/1e6:0,tickGapP95Ms:gap.p95,tickGapMaxMs:gap.max,loopWorkP95Ms:busy.p95,loopWorkMaxMs:busy.max,updatedAtMs:performance.now()};
    gaps.length=work.length=0;histogram.reset();
  },1000);timer.unref();
  return {
    record(gapMs,workMs,steps){gaps.push(gapMs);work.push(workMs);if(gaps.length>120)gaps.shift();if(work.length>120)work.shift();ticks+=steps;},
    snapshot(){return {diagnosticsVersion:'netdiag-v1',transport:'websocket',tickHz,snapshotHz,revision,sourceFingerprint,...window,measuredTicks:ticks};},
    dispose(){clearInterval(timer);histogram.disable();},
  };
}
