// Real client + authoritative Game + real WS + original map/models/WAV + native AudioContext.
// Native node recording is test-only; no DSP or fetch/decode implementation is replaced.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import WebSocket from 'ws';
const server=fork('tests/audio-fixture.mjs',[],{env:{...process.env,HOST:'127.0.0.1',PORT:'0',WEBTRANSPORT:'0'},silent:true});
const report={scope:'Loopback actual game/native Web Audio/original local WAV; NOT physical headphones or Wi-Fi acceptance',checks:[],errors:[],missingAssets:[],external:[]};
let browser,peer,base,logs='',heartbeat;
const ipc=async type=>{const message=once(server,'message');server.send({type});const result=(await message)[0];if(result.error)throw Error(result.error);return result;};
try{
  base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server timeout '+logs)),15000);
    server.stdout.on('data',b=>{logs+=b;const m=logs.match(/http:\/\/localhost:(\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});
    server.stderr.on('data',b=>{logs+=b;});server.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+' '+logs));});});
  report.health=await (await fetch(base+'/health')).json();assert.equal(report.health.audioSystem,'cs16-spatial-v1');
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(30000);
  await page.addInitScript(()=>{
    const Native=window.AudioContext;window.__audioContexts=[];window.__panners=[];
    window.AudioContext=class extends Native{
      constructor(...args){super(...args);window.__audioContexts.push(this);}
      createPanner(){const node=super.createPanner();window.__panners.push(node);return node;}
    };
  });
  page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&new URL(r.url()).pathname.startsWith('/assets/'))report.missingAssets.push(r.url());});
  page.on('request',r=>{if(new URL(r.url()).origin!==base)report.external.push(r.url());});
  await page.goto(base+'/?transport=websocket');await page.waitForFunction(()=>window.lanStrike?.getId());await page.selectOption('#team','T');await page.click('#joinButton');
  await page.waitForFunction(()=>window.lanStrike.getState()?.players.length===1);
  peer=new WebSocket(base.replace('http','ws'));await new Promise((resolve,reject)=>{peer.once('error',reject);peer.on('message',raw=>{const m=JSON.parse(String(raw));if(m.type==='hello')peer.send(JSON.stringify({type:'join',team:'CT',name:'audio fixture enemy'}));if(m.type==='clockProbe')peer.send(JSON.stringify({type:'clockReply',token:m.token}));if(m.type==='joined')resolve();});});
  report.layout=await ipc('layout');await page.waitForFunction(()=>window.lanStrike.getState()?.phase==='live'&&window.lanStrike.getDiagnostics().weapon==='knife');
  await page.click('#resumeButton');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().locked);
  await page.waitForFunction(()=>{const a=window.lanStrike.getDiagnostics().audio;return a?.ready&&a.cached===316&&a.activeLoads===0&&a.queuedLoads===0;});
  const diagnostics=()=>page.evaluate(()=>window.lanStrike.getDiagnostics());const before=await diagnostics();assert.equal(before.audio.missing,0);report.checks.push('316-original-WAVs-native-decoded-cached-no-missing');
  const send=input=>peer.send(JSON.stringify({type:'input',input:{f:0,s:0,yaw:Math.PI,pitch:0,...input}}));
  heartbeat=setInterval(()=>send({f:1}),33);send({f:1});await page.waitForFunction(n=>window.lanStrike.getDiagnostics().audioRouting.remoteSteps>=n+2,before.audioRouting.remoteSteps);clearInterval(heartbeat);heartbeat=null;send({f:0});
  await page.waitForTimeout(180);const moved=await diagnostics();assert.ok(moved.audio.played>before.audio.played);assert.ok(moved.audioRouting.remoteSteps>=before.audioRouting.remoteSteps+2);report.checks.push('actual-enemy-movement-authoritative-footsteps-over-WS-to-native-spatial-playback');
  const graph=await page.evaluate(()=>({
    contexts:window.__audioContexts.length,state:window.__audioContexts[0]?.state,
    panners:window.__panners.map(p=>({mode:p.panningModel,distance:p.distanceModel,maxDistance:p.maxDistance,x:p.positionX.value,y:p.positionY.value,z:p.positionZ.value})),
    listener:{x:window.__audioContexts[0].listener.positionX.value,y:window.__audioContexts[0].listener.positionY.value,z:window.__audioContexts[0].listener.positionZ.value}
  }));assert.equal(graph.contexts,1);assert.equal(graph.state,'running');assert.ok(graph.panners.length>=2);assert.ok(graph.panners.every(p=>p.mode==='HRTF'&&p.distance==='linear'));assert.ok(Math.hypot(graph.listener.x-report.layout.viewer.x,graph.listener.z-report.layout.viewer.z)<1);report.graph=graph;
  report.checks.push('real-HRTF-PannerNodes-follow-original-world-metres-and-real-camera-listener');
  await page.keyboard.down('KeyW');await page.waitForFunction(n=>window.lanStrike.getDiagnostics().audioRouting.localSteps>n,moved.audioRouting.localSteps);await page.keyboard.up('KeyW');await page.waitForTimeout(150);const predicted=await diagnostics();assert.ok(predicted.audioRouting.localSteps>moved.audioRouting.localSteps);assert.equal(predicted.audioRouting.remoteSteps,moved.audioRouting.remoteSteps,'own authoritative ACK must not create another remote step');report.checks.push('local-predicted-footstep-without-own-authoritative-ACK-replay');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().gameMenuOpen);
  await page.locator('#audioMode').selectOption('equalpower');assert.equal((await diagnostics()).audio.settings.spatialMode,'equalpower');
  await page.locator('#audioMaster').evaluate(e=>{e.value='37';e.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal((await diagnostics()).audio.settings.master,.37);report.checks.push('actual-audio-menu-updates-native-mixer-and-local-settings');
  await page.locator('#audioMode').selectOption('hrtf');await page.click('#testAudioPosition');await page.waitForTimeout(2900);assert.match(await page.locator('#audioSettingsStatus').textContent(),/后方/);
  await page.locator('#testAudioPosition').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/audio-menu.png'});await page.waitForTimeout(700);report.checks.push('actual-left-right-front-back-calibration-button-and-menu-render');
  report.final=await diagnostics();assert.equal(report.final.audio.missing,0);assert.deepEqual(report.errors,[]);assert.deepEqual(report.missingAssets,[]);assert.deepEqual(report.external,[]);report.status='passed';
}finally{
  clearInterval(heartbeat);peer?.terminate();await browser?.close();if(server.exitCode===null){const closed=once(server,'exit');server.kill('SIGTERM');await closed;}
  report.serverClosed=server.exitCode!==null;if(base){let reachable=false;try{await fetch(base+'/health',{signal:AbortSignal.timeout(1000)});reachable=true;}catch{}assert.equal(reachable,false);}
  await writeFile('artifacts/audio-game-browser.json',JSON.stringify(report,null,2)+'\n');await writeFile('artifacts/audio-game-server.log',logs);
}
console.log(JSON.stringify({status:report.status,checks:report.checks,errors:report.errors,missingAssets:report.missingAssets,serverClosed:report.serverClosed},null,2));
