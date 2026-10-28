// Ten real WebSocket clients, one real WebGL client. Not ten physical machines.
import {chromium} from 'playwright';
import WebSocket from 'ws';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:'0'},stdio:['ignore','pipe','pipe']});
const defaultRenderer=process.env.PERF_RENDERER==='default',tag=defaultRenderer?'default-':'';
let browser,base,output='',heartbeat;const peers=[],report={status:'running',errors:[],scope:'10 local WebSocket clients; one Chrome WebGL renderer; not physical 10-device/Wi-Fi performance'};
try{
  await mkdir('artifacts',{recursive:true});
  base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),10000);server.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/http:\/\/localhost:(\d+)/);if(m){clearTimeout(timer);resolve(`http://127.0.0.1:${m[1]}`);}});server.stderr.on('data',c=>process.stderr.write(c));server.once('exit',c=>{clearTimeout(timer);reject(Error('Server exited '+c));});});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:[...(defaultRenderer?[]:['--use-angle=swiftshader','--enable-unsafe-swiftshader']),'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(45000);page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.goto(base,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.lanStrike?.getPerformance);
  report.renderer=await page.evaluate(()=>{const gl=document.getElementById('game').getContext('webgl2'),debug=gl.getExtension('WEBGL_debug_renderer_info');return debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
  await page.selectOption('#joinForm [data-quality]','performance');const low=await page.evaluate(()=>window.lanStrike.getPerformance());assert.ok(low.pixelRatio<=.85);
  await page.selectOption('#joinForm [data-quality]','sharp');const high=await page.evaluate(()=>window.lanStrike.getPerformance());assert.ok(high.pixelRatio>=low.pixelRatio);
  assert.equal(await page.inputValue('#resume [data-quality]'),'sharp');assert.equal(await page.evaluate(()=>localStorage.getItem('lan-strike-quality')),'sharp');report.qualityControls={low:low.pixelRatio,high:high.pixelRatio,synchronized:true,persisted:true};
  await page.fill('#name','Render Observer');await page.selectOption('#team','T');await page.click('#joinButton');
  // Join the real renderer first, before starting the opposing team/countdown.
  await page.waitForFunction(()=>window.lanStrike.getState()?.players.length===1);
  for(let i=0;i<9;i++){
    const ws=new WebSocket(base.replace('http','ws'));peers.push(ws);
    await new Promise((resolve,reject)=>{const deadline=setTimeout(()=>reject(Error('Peer join timeout')),10000);ws.on('error',reject);ws.on('message',buffer=>{const m=JSON.parse(String(buffer));if(m.type==='hello')ws.send(JSON.stringify({type:'join',name:`Load ${i}`,team:i<4?'T':'CT',character:i<4?'terror_trump':'urban'}));if(m.type==='joined'){clearTimeout(deadline);resolve();}if(m.type==='error'){clearTimeout(deadline);reject(Error(m.message));}});});
  }
  heartbeat=setInterval(()=>{for(const ws of peers)if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'input',input:{f:0,s:0,fire:false,yaw:0,pitch:0}}));},100);
  await page.waitForFunction(()=>window.lanStrike.getState()?.players.length===10);await page.click('#resumeButton');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().locked);
  await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.remoteModels.length===9&&d.remoteModels.every(m=>m.skinning==='gpu'&&!m.loading&&m.source!=='missing-asset-wireframe'&&m.thirdPersonWeapon.loaded);});
  const health=await(await fetch(base+'/health')).json();assert.equal(health.players,10);report.connectedPlayers=health.players;report.remoteModels=await page.evaluate(()=>window.lanStrike.getDiagnostics().remoteModels.map(m=>({id:m.id,source:m.source,skinning:m.skinning,weapon:m.thirdPersonWeapon.id})));
  assert.equal(await page.locator('#boardBody tr').count(),0,'Hidden scoreboard should not build rows');
  await page.keyboard.down('Tab');await page.waitForFunction(()=>document.querySelectorAll('#boardBody tr').length===10);
  await page.evaluate(()=>{window.scoreboardChanges=0;window.boardObserver=new MutationObserver(changes=>window.scoreboardChanges+=changes.length);window.boardObserver.observe(document.getElementById('boardBody'),{childList:true,subtree:true});});
  await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>window.scoreboardChanges),0,'Unchanged board must not be rebuilt for snapshots');await page.keyboard.up('Tab');report.scoreboardStable=true;
  await page.waitForFunction(()=>{const s=window.lanStrike.getState();return s?.phase==='live'&&s.players.find(p=>p.id===window.lanStrike.getId())?.alive;});
  // Reset foreground metrics after countdown: measure live gameplay, not the lobby.
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.lanStrike.getDiagnostics().locked);
  await page.click('#resumeButton');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().locked);
  const before=await page.evaluate(()=>window.lanStrike.getDiagnostics().localPosition);await page.keyboard.down('KeyW');await page.waitForTimeout(500);await page.keyboard.up('KeyW');
  const after=await page.evaluate(()=>window.lanStrike.getDiagnostics().localPosition);report.movementMetres=Math.hypot(after.x-before.x,after.y-before.y,after.z-before.z);assert.ok(report.movementMetres>.05,'Live renderer must actually move');
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().weaponModel.source==='original-mdl'&&window.lanStrike.getDiagnostics().weaponModel.skinning==='gpu');
  await page.waitForFunction(()=>window.lanStrike.getPerformance().samples>=120);report.performance=await page.evaluate(()=>window.lanStrike.getPerformance());
  assert.ok(report.performance.cpuMs.p95>=report.performance.cpuMs.median);assert.equal(report.performance.skinning,'gpu');
  await page.screenshot({path:`artifacts/smooth-${tag}ten-clients-game.png`});await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.lanStrike.getDiagnostics().locked);
  await page.selectOption('#resume [data-quality]','auto');assert.equal(await page.inputValue('#joinForm [data-quality]'),'auto');
  assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{
  clearInterval(heartbeat);for(const ws of peers)ws.terminate();await browser?.close();const closed=once(server,'exit');server.kill('SIGTERM');const graceful=await Promise.race([closed.then(()=>true),new Promise(r=>setTimeout(()=>r(false),3000))]);if(!graceful){server.kill('SIGKILL');await closed;}
  let reachable=false;try{await fetch(base+'/health',{signal:AbortSignal.timeout(1000)});reachable=true;}catch{}report.serverClosed=!reachable;
  assert.equal(report.serverClosed,true);await writeFile(`artifacts/smooth-${tag}load-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
