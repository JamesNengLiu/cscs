// Real browser + actual server, with controlled delivery delay and main/server stalls.
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import WebSocket from 'ws';
import assert from 'node:assert/strict';
const server=fork('tests/network-fixture-server.mjs',[],{env:{...process.env,HOST:'127.0.0.1',PORT:'0'},silent:true});
const report={scope:'Loopback real Chrome/WebGL and authoritative WebSocket; controlled delays, not a remote Wi-Fi test',errors:[]};
const timers=new Set();let delivery=Promise.resolve(),browser,peer,base,stdout='',closing=false,inject=false,deadline=0,index=0;
try{
  await mkdir('artifacts',{recursive:true});
  base=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Startup timeout')),10000);server.stdout.on('data',b=>{stdout+=b;const m=stdout.match(/http:\/\/localhost:(\d+)/);if(m){clearTimeout(t);resolve('http://127.0.0.1:'+m[1]);}});server.stderr.on('data',b=>process.stderr.write(b));});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
  const page=await browser.newPage({viewport:{width:1280,height:900},acceptDownloads:true});page.setDefaultTimeout(45000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.routeWebSocket('**',route=>{const upstream=route.connectToServer();upstream.onMessage(message=>{
    const now=performance.now();deadline=Math.max(deadline,now+(inject?([0,0,120,20,0][index++%5]):0));const due=deadline;
    // Preserve TCP/WebSocket message order: independent timers can reorder equal deadlines.
    delivery=delivery.then(()=>new Promise(resolve=>{const timer=setTimeout(()=>{timers.delete(timer);if(!closing)try{route.send(message);}catch(e){report.errors.push(String(e));}resolve();},Math.max(0,due-performance.now()));timers.add(timer);}));
  });});
  await page.goto(base,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.lanStrike?.getDiagnosticReport);
  await page.click('#lobbySettingsButton');await page.click('#resetDiagnosticsButton');assert.equal((await page.evaluate(()=>window.lanStrike.getDiagnosticReport())).network.totals.longTasks,0);await page.click('#resumeButton');
  await page.fill('#name','PrivateName42');await page.selectOption('#team','T');await page.click('#joinButton');await page.waitForFunction(()=>window.lanStrike.getState()?.players.length===1);
  peer=new WebSocket(base.replace('http','ws'));await once(peer,'open');peer.send(JSON.stringify({type:'join',name:'PrivatePeer42',team:'CT'}));
  await page.waitForFunction(()=>window.lanStrike.getState()?.players.length===2);const ready=once(server,'message');server.send({type:'start-load'});assert.equal((await ready)[0].type,'load-ready');
  await page.waitForFunction(()=>window.lanStrike.getState()?.phase==='live');await page.click('#resumeButton');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().locked);
  await page.keyboard.down('KeyW');await page.waitForTimeout(350);await page.keyboard.up('KeyW');inject=true;
  await page.waitForTimeout(1600);
  await page.evaluate(()=>{const end=performance.now()+150;while(performance.now()<end){}});
  const stalled=once(server,'message');server.send({type:'stall',ms:120});assert.equal((await stalled)[0].type,'stall-done');
  await page.waitForTimeout(2400);inject=false;
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.getElementById('resume').hidden);
  await page.locator('#networkDiagnosticsDetails summary').click();
  const downloadEvent=page.waitForEvent('download');await page.click('#exportDiagnosticsButton');const download=await downloadEvent;
  assert.match(download.suggestedFilename(),/^lan-strike-diagnostics-.*\.json$/);await download.saveAs('artifacts/diagnostics-browser-export.json');
  const exported=JSON.parse(await readFile('artifacts/diagnostics-browser-export.json','utf8'));
  assert.equal(exported.schema,'lan-strike-diagnostic-report-v1');assert.equal(exported.network.server.diagnosticsVersion,'netdiag-v1');assert.equal(exported.network.server.snapshotHz,30);assert.equal(exported.network.server.tickHz,60);
  assert.ok(exported.network.metrics.applicationRttMs.samples>=2);assert.ok(exported.network.metrics.stateArrivalIntervalMs.max>=100);assert.ok(exported.network.metrics.foregroundFrameIntervalMs.max>=100);
  assert.ok(exported.network.metrics.pendingInputs.samples>0);assert.ok(exported.performance.samples>0,'Esc export must preserve prior foreground performance');
  if(exported.longTaskSupported)assert.ok(exported.network.metrics.longTaskMs.max>=100);
  assert.ok(!JSON.stringify(exported).includes('PrivateName42'));assert.ok(!JSON.stringify(exported).includes('PrivatePeer42'));assert.ok(!JSON.stringify(exported).includes('players'));
  assert.ok((await(await fetch(base+'/health')).json()).network.sourceFingerprint);await page.locator('#exportDiagnosticsButton').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/diagnostics-desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.locator('#exportDiagnosticsButton').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'artifacts/diagnostics-mobile.png'});
  Object.assign(report,{status:'passed',exportBytes:(await readFile('artifacts/diagnostics-browser-export.json')).length,metrics:exported.network.metrics,longTaskSupported:exported.longTaskSupported,server:exported.network.server,checks:['real-authoritative-connection','controlled-delivery-delay','main-thread-stall-recorded','server-telemetry-present','foreground-stats-survive-Esc','actual-JSON-download','privacy-whitelist','390px-no-horizontal-overflow']});assert.deepEqual(report.errors,[]);
}finally{
  closing=true;for(const t of timers)clearTimeout(t);peer?.terminate();await browser?.close();const exit=once(server,'exit');server.kill('SIGTERM');await exit;
  try{await fetch(base+'/health',{signal:AbortSignal.timeout(500)});report.serverClosed=false;}catch{report.serverClosed=true;}assert.equal(report.serverClosed,true);await writeFile('artifacts/diagnostics-browser-report.json',JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
