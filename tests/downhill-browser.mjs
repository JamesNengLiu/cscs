import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {chromium} from 'playwright';
import {DOWNHILL_CASES} from './downhill-fixtures.mjs';
const report={scope:'Loopback browser + real WebSocket/authoritative server. Not two physical Wi-Fi devices.',cases:[],errors:[]};
const server=fork('tests/downhill-browser-server.mjs',[],{env:{...process.env,HOST:'127.0.0.1',PORT:'0'},silent:true});
let browser,peer,base,output='';
try{
  base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server start timeout')),10000);server.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/http:\/\/localhost:(\d+)/);if(m){clearTimeout(timer);resolve(`http://127.0.0.1:${m[1]}`);}});server.stderr.on('data',chunk=>process.stderr.write(chunk));});
  const health=await (await fetch(base+'/health')).json();assert.equal(health.movementSync,'ack-replay-v1');
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
  const page=await browser.newPage({viewport:{width:960,height:600}});page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(base,{waitUntil:'networkidle'});await page.fill('#name','下坡回归测试');await page.selectOption('#team','T');await page.click('#joinButton');await page.waitForFunction(()=>window.lanStrike?.getId()&&!document.getElementById('hud').hidden);
  peer=new WebSocket(base.replace('http:','ws:'));await once(peer,'open');peer.send(JSON.stringify({type:'join',name:'Test CT peer',team:'CT'}));
  await page.waitForFunction(()=>window.lanStrike.getState()?.phase==='live',null,{timeout:15000});await page.click('#resumeButton');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().locked);
  for(const c of DOWNHILL_CASES){
    const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture IPC timeout')),5000);const listener=message=>{if(message.type==='fixtureReady'){clearTimeout(timer);server.off('message',listener);resolve(message);}else if(message.type==='fixtureError'){clearTimeout(timer);server.off('message',listener);reject(Error(message.message));}};server.on('message',listener);server.send({type:'fixture',name:c.name});});
    await page.waitForFunction(round=>window.lanStrike.getState()?.round===round&&window.lanStrike.getState()?.phase==='live',ready.round,{timeout:5000});
    await page.evaluate(async()=>{const {isGrounded,collides}=await import('/map.js');window.slopeCapture={running:true,samples:[]};const step=t=>{const r=window.slopeCapture;if(!r.running)return;const d=window.lanStrike.getDiagnostics(),p=d.localPosition;if(p)r.samples.push({t,...p,cameraY:d.cameraY,unackedInputs:d.unackedInputs,ackInputSeq:d.ackInputSeq,grounded:isGrounded(p),solid:collides(p.x,p.z,.4,p.y)});requestAnimationFrame(step);};requestAnimationFrame(step);});
    await page.keyboard.down('KeyW');await page.waitForFunction(({start,distance})=>{const p=window.lanStrike.getDiagnostics().localPosition;return Math.hypot(p.x-start[0],p.z-start[2])>=distance;},{start:c.start,distance:c.distance},{timeout:9000,polling:30});await page.keyboard.up('KeyW');
    const captured=await page.evaluate(()=>{window.slopeCapture.running=false;const s=window.lanStrike.getState();return {samples:window.slopeCapture.samples,diagnostics:window.lanStrike.getDiagnostics(),server:s.players.find(p=>p.id===window.lanStrike.getId())};});
    const settled=captured.samples.filter(p=>p.t-captured.samples[0].t>350);let stalls=0,maxStall=0,cameraUp=0;
    for(let i=1;i<settled.length;i++){const delta=Math.hypot(settled[i].x-settled[i-1].x,settled[i].z-settled[i-1].z);stalls=delta<.001?stalls+1:0;maxStall=Math.max(maxStall,stalls);cameraUp+=settled[i].cameraY-settled[i-1].cameraY>.02;}
    const result={name:c.name,samples:captured.samples,frames:captured.samples.length,solidFrames:settled.filter(p=>p.solid).length,airFrames:settled.filter(p=>!p.grounded).length,maxConsecutiveStallFrames:maxStall,cameraUpSteps:cameraUp,maxPending:Math.max(...captured.samples.map(p=>p.unackedInputs)),ackInputSeq:captured.diagnostics.ackInputSeq,serverTravel:Math.hypot(captured.server.x-c.start[0],captured.server.z-c.start[2])};report.cases.push(result);
    assert.ok(result.frames>10);assert.equal(result.solidFrames,0);assert.equal(result.airFrames,0);assert.ok(result.maxConsecutiveStallFrames<=3);assert.equal(result.cameraUpSteps,0);assert.ok(result.maxPending<30);assert.ok(result.ackInputSeq>0);assert.ok(result.serverTravel>=c.distance-.7);
    console.log('PASS browser downhill',JSON.stringify({...result,samples:undefined}));
  }
  assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack;console.error(error.stack);process.exitCode=1;}
finally{
  if(peer)peer.terminate();if(browser)await browser.close();const exited=once(server,'exit');server.kill('SIGTERM');await exited;
  try{await fetch(base+'/health',{signal:AbortSignal.timeout(1000)});report.portClosed=false;}catch{report.portClosed=true;}
  await mkdir('artifacts',{recursive:true});await writeFile('artifacts/downhill-browser-report.json',JSON.stringify(report,null,2));assert.equal(report.portClosed,true);console.log('PASS downhill fixture server port closed');
}
