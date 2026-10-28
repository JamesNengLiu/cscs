import {chromium} from 'playwright';
import WebSocket from 'ws';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:'0'},stdio:['ignore','pipe','pipe']});
const report={status:'running',checks:[],errors:[],externalRequests:[],screenshots:[],scope:'Real Chrome/WebGL and server; controlled relative-mouse events verify the application multiplier, not physical DPI or OS acceleration'};
const check=(name,details)=>{report.checks.push({name,details});console.log('PASS',name,details??'');};
let browser,peer,heartbeat,base,output='';
try{
  await mkdir('artifacts',{recursive:true});base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Startup timeout')),10000);server.stdout.on('data',c=>{output+=c;const m=output.match(/http:\/\/localhost:(\d+)/);if(m){clearTimeout(timeout);resolve(`http://127.0.0.1:${m[1]}`);}});server.stderr.on('data',c=>process.stderr.write(c));server.once('exit',c=>{clearTimeout(timeout);reject(Error('Server exited '+c));});});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();page.setDefaultTimeout(45000);
  const observe=p=>{p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});p.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))report.externalRequests.push(r.url());});};observe(page);
  const loaded=()=>page.waitForFunction(()=>window.lanStrike?.getDiagnostics&&window.lanStrike.getRenderInfo().triangles>0);
  await page.goto(base,{waitUntil:'networkidle'});await loaded();await page.click('#lobbySettingsButton');
  assert.equal(await page.locator('#resume').isVisible(),true);assert.equal(await page.locator('#openBuyButton').isVisible(),false);assert.equal((await(await fetch(base+'/health')).json()).players,0);assert.equal(await page.inputValue('#mouseSensitivityNumber'),'1.00');check('game menu opens before joining with compatible default and no hidden join');
  await page.fill('#mouseSensitivityNumber','2');assert.equal(await page.inputValue('#mouseSensitivity'),'2');await page.locator('#mouseSensitivity').focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.inputValue('#mouseSensitivityNumber'),'2.05');assert.equal(await page.locator('#mouseSensitivityValue').textContent(),'2.05×');
  await page.fill('#mouseSensitivityNumber','999');await page.locator('#mouseSensitivityNumber').blur();assert.equal(await page.inputValue('#mouseSensitivityNumber'),'5.00');
  await page.fill('#mouseSensitivityNumber','');await page.locator('#mouseSensitivityNumber').blur();assert.equal(await page.inputValue('#mouseSensitivityNumber'),'5.00');
  await page.fill('#mouseSensitivityNumber','0.5');await page.locator('#mouseSensitivityNumber').blur();check('slider, exact number, empty/over-range inputs stay synchronized and bounded');
  await page.reload({waitUntil:'networkidle'});await loaded();await page.click('#lobbySettingsButton');assert.equal(await page.inputValue('#mouseSensitivityNumber'),'0.50');check('sensitivity persists across a real reload');
  await page.selectOption('#resume [data-quality]','sharp');await page.click('#resetMouseSettings');assert.equal(await page.inputValue('#mouseSensitivityNumber'),'1.00');assert.equal(await page.inputValue('#resume [data-quality]'),'sharp');check('restore default affects mouse sensitivity only');
  // Assert tab wrapping at the last visible control, then reverse wrap.
  await page.locator('#resumeButton').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'mouseSensitivity');
  await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'resumeButton');check('modal traps keyboard focus and does not expose the inert lobby');
  await page.screenshot({path:'artifacts/game-menu-desktop.png'});report.screenshots.push('artifacts/game-menu-desktop.png');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'artifacts/game-menu-mobile.png'});report.screenshots.push('artifacts/game-menu-mobile.png');await page.setViewportSize({width:1280,height:900});
  await page.fill('#mouseSensitivityNumber','0.5');await page.locator('#mouseSensitivityNumber').blur();await page.click('#resumeButton');assert.equal(await page.locator('#resume').isVisible(),false);
  await page.fill('#name','Menu Test');await page.selectOption('#team','T');await page.click('#joinButton');await page.waitForFunction(()=>window.lanStrike.getState()?.players.length===1);
  peer=new WebSocket(base.replace('http','ws'));await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Peer timeout')),10000);peer.on('error',reject);peer.on('message',c=>{const m=JSON.parse(String(c));if(m.type==='hello')peer.send(JSON.stringify({type:'join',team:'CT',name:'Menu Opponent'}));if(m.type==='joined'){clearTimeout(timeout);resolve();}});});heartbeat=setInterval(()=>{if(peer.readyState===WebSocket.OPEN)peer.send(JSON.stringify({type:'input',input:{f:0,s:0,fire:false,yaw:0,pitch:0}}));},100);
  await page.bringToFront();await page.click('#resumeButton');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().locked&&document.pointerLockElement===document.getElementById('game'));
  const move=()=>page.evaluate(()=>{const before=window.lanStrike.getDiagnostics().input;document.dispatchEvent(new MouseEvent('mousemove',{movementX:40,movementY:-10,bubbles:true}));const after=window.lanStrike.getDiagnostics().input;return {yawDelta:after.yaw-before.yaw,pitchDelta:after.pitch-before.pitch,sensitivity:window.lanStrike.getDiagnostics().mouseSensitivity};});
  const low=await move();assert.ok(Math.abs(low.yawDelta-(-40*.002*.5))<1e-8);assert.ok(Math.abs(low.pitchDelta-(10*.002*.5))<1e-8);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().gameMenuOpen&&!window.lanStrike.getDiagnostics().locked&&document.pointerLockElement===null);
  await page.fill('#mouseSensitivityNumber','1');await page.locator('#mouseSensitivityNumber').blur();await page.click('#resumeButton');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().locked);const normal=await move();assert.ok(Math.abs(normal.yawDelta-low.yawDelta*2)<1e-8);assert.ok(Math.abs(normal.pitchDelta-low.pitchDelta*2)<1e-8);check('real pointer lock and actual yaw/pitch use the selected multiplier immediately',{low,normal});
  await page.waitForFunction(()=>{const s=window.lanStrike.getState();return s?.phase==='live'&&s.players.find(p=>p.id===window.lanStrike.getId())?.alive;});
  await page.keyboard.down('KeyW');await page.mouse.down();await page.waitForFunction(()=>window.lanStrike.getDiagnostics().input.f===1&&window.lanStrike.getDiagnostics().input.fire);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().gameMenuOpen);await page.keyboard.up('KeyW');await page.mouse.up();
  const baseline=await page.evaluate(()=>{const s=window.lanStrike.getState(),p=s.players.find(p=>p.id===window.lanStrike.getId());return {weapon:p.weapon,time:s.time};});
  await page.keyboard.press('Digit3');await page.keyboard.press('KeyR');await page.keyboard.press('KeyB');
  await page.evaluate(()=>{document.dispatchEvent(new MouseEvent('mousemove',{movementX:40,movementY:10,bubbles:true}));});
  await page.waitForTimeout(500);const paused=await page.evaluate(()=>{const s=window.lanStrike.getState(),d=window.lanStrike.getDiagnostics(),p=s.players.find(p=>p.id===window.lanStrike.getId());return {weapon:p.weapon,time:s.time,input:d.input,buyMenuOpen:d.buyMenuOpen};});
  assert.equal(paused.input.f,0);assert.equal(paused.input.fire,false);assert.equal(paused.weapon,baseline.weapon);assert.equal(paused.buyMenuOpen,false);assert.ok(paused.time>baseline.time);check('Esc clears held movement/fire, menu shortcuts cannot equip/reload/buy, server time continues');
  await page.click('#openBuyButton');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().buyMenuOpen&&!window.lanStrike.getDiagnostics().gameMenuOpen);await page.click('#buyClose');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().gameMenuOpen);check('armory and game menu transition without competing modals');
  await context.close();
  const blocked=await browser.newContext({viewport:{width:1280,height:900}});await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw Error('Storage denied for test');}}));const blockedPage=await blocked.newPage();observe(blockedPage);await blockedPage.goto(base,{waitUntil:'networkidle'});await blockedPage.waitForFunction(()=>window.lanStrike);await blockedPage.click('#lobbySettingsButton');await blockedPage.fill('#mouseSensitivityNumber','1.5');await blockedPage.locator('#mouseSensitivityNumber').blur();assert.equal(await blockedPage.inputValue('#mouseSensitivity'),'1.5');assert.match(await blockedPage.locator('#mouseSettingsStatus').textContent(),/存储不可用/);await blocked.close();check('blocked browser storage does not break the game or in-session sensitivity');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{
  clearInterval(heartbeat);peer?.terminate();await browser?.close();const closed=once(server,'exit');server.kill('SIGTERM');const graceful=await Promise.race([closed.then(()=>true),new Promise(r=>setTimeout(()=>r(false),3000))]);if(!graceful){server.kill('SIGKILL');await closed;}
  let reachable=false;try{await fetch(base+'/health',{signal:AbortSignal.timeout(1000)});reachable=true;}catch{}report.serverClosed=!reachable;assert.equal(report.serverClosed,true);await writeFile('artifacts/game-menu-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,errors:report.errors,serverClosed:report.serverClosed},null,2));
}
