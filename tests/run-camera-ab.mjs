// Sequential native-GPU runs: never confuse a synthetic submission clock with
// an actual high-refresh display. Receipts remain in ignored artifacts/.
import {spawn} from 'node:child_process';
import {open,readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const profiles=[
 {tag:'ab-a-60',mode:'baseline'}, {tag:'ab-b-60',mode:'responsive'},
 {tag:'ab-a-native',mode:'baseline',headed:true}, {tag:'ab-b-native',mode:'responsive',headed:true},
 ...[120,144].flatMap(hz=>['baseline','responsive'].map((mode,i)=>({tag:`ab-${i?'b':'a'}-${hz}-submit`,mode,headed:true,hz})))
];
const stats=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b),at=q=>a[Math.floor((a.length-1)*q)]||0;return {samples:a.length,median:at(.5),p99:at(.99),max:a.at(-1)||0};};
const report={status:'running',scope:'Offline Game/client IPC; native WebGL, scripted keyboard/wheel. Synthetic 120/144Hz submits are workload/logic tests, never display or physical mouse-to-photon certification.',profiles:[]};
await mkdir('artifacts',{recursive:true});
try{
 for(const profile of profiles){
  if(!process.argv.includes('--report-only')){
   const log=await open(`artifacts/camera-${profile.tag}.log`,'w');
   try{await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['tests/wheel-jump-browser.mjs'],{env:{...process.env,CAMERA_TEST_MODE:profile.mode,CAMERA_TEST_TAG:profile.tag,CAMERA_TEST_HEADED:profile.headed?'1':'0',CAMERA_TEST_HZ:String(profile.hz||'')},stdio:['ignore',log.fd,log.fd]});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`${profile.tag} exited ${code}; see artifacts/camera-${profile.tag}.log`)));});}finally{await log.close();}
  }
  const r=JSON.parse(await readFile(`artifacts/wheel-jump-browser-report-${profile.tag}.json`,'utf8'));assert.equal(r.status,'passed');assert.equal(r.cameraProfile.mode,profile.mode);
  const intervals=r.testClock?.nativeIntervals||r.emptyRaf,observed=stats(intervals);
  const row={...profile,clock:r.cameraProfile.clockKind,nativeRaf:observed,observedNativeHz:observed.median?1000/observed.median:0,regressions:r.regressions,camera:r.finalCamera,scenes:r.cases.map(c=>({label:c.label,intervalMs:c.metrics.intervalMs,cpuMs:c.metrics.cpuMs,cameraMs:c.metrics.cameraMs,onePercentLowFps:c.metrics.onePercentLowFps,gpuLastMs:c.metrics.gpuMs,frameBudgets:c.metrics.frameBudgets}))};
  report.profiles.push(row);console.log(`${profile.tag}: passed; native rAF median ${observed.median.toFixed(2)}ms; ${row.clock}`);
 }
 report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;console.error(error);}
finally{await writeFile('artifacts/camera-ab-report.json',JSON.stringify(report,null,2));}
