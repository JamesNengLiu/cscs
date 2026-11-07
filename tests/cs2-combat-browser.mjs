// Native browser plus real loopback authority; no persistent listener or v1.0 server.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {WebSocket} from 'ws';
import {once} from 'node:events';
import {createExperimentalServer} from '../cs2-server.mjs';
const native=process.env.CS2_COMBAT_NATIVE==='1',profile=process.env.CS2_COMBAT_PROFILE||'legacy';
const headed=process.argv.includes('--headed'),tag=headed?'-headed':'',report={status:'running',headed,errors:[],checks:[],native,profile,scope:'Real CS2 map + authority + browser combat. Synthetic peers are not physical LAN clients.'};
await mkdir('artifacts',{recursive:true});let server,browser,page;const peers=[];
const inspect=()=>page.evaluate(()=>window.lanStrike?.getDiagnostics());
try{
 server=await createExperimentalServer({presentation:native?'native':'legacy',gameOptions:{weaponProfile:profile}});server.url='http://127.0.0.1:'+server.address().port;report.server=server.url;
 browser=await chromium.launch({headless:!headed,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-precise-memory-info','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
 const context=await browser.newContext({viewport:{width:1280,height:800}});page=await context.newPage();page.setDefaultTimeout(120000);
 page.on('pageerror',e=>report.errors.push(e.stack||e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|shader|OUT_OF_MEMORY/i.test(m.text()))report.errors.push(m.text());});
 const start=performance.now();await page.goto(server.url+'/cs2-play.html?transport=websocket');
 await page.waitForFunction(()=>window.lanStrike&&!document.querySelector('#joinButton').disabled||document.querySelector('#error').textContent);
 assert.equal(await page.locator('#error').textContent(),'');assert.equal(await page.locator('#joinButton').isEnabled(),true);
 report.readyMs=performance.now()-start;report.cold=await inspect();assert.equal(report.cold.experimental,true);if(native){assert.equal(report.cold.nativeContent.source,'source2-native-gltf');assert.equal(report.cold.weaponModel.source,'source2-native-gltf');}assert.equal(report.cold.worldContract.sourceSHA1,server.world.contract.sourceSHA1);report.checks.push('physics/render/world contract and actor/weapon preparation gate');
 await page.locator('#joinButton').click();await page.waitForFunction(()=>window.lanStrike.getState()?.players.find(p=>p.id===window.lanStrike.getId())?.alive);
 report.checks.push('complete authority joins and starts single-player warmup');
 await page.locator('#resumeButton').click();await page.waitForFunction(()=>document.pointerLockElement===document.querySelector('#game'));
 const before=await inspect();await page.keyboard.down('w');await page.waitForTimeout(750);await page.keyboard.up('w');await page.waitForTimeout(200);const after=await inspect();assert.ok(after.inputSeq>before.inputSeq+15);assert.ok(Math.hypot(after.localPosition.x-before.localPosition.x,after.localPosition.z-before.localPosition.z)>.1);assert.ok(after.lastCorrection<.3);report.checks.push('live pointer-lock input predicts/reconciles on actual new collision');
 await page.keyboard.press('b');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().buyMenuOpen);await page.mouse.click(1100,400,{button:'right'});await page.waitForFunction(()=>document.pointerLockElement===document.querySelector('#game'));assert.equal((await inspect()).buyMenuOpen,false);report.checks.push('buy-menu right click restores game input');
 const id=await page.evaluate(()=>window.lanStrike.getId()),p=server.game.players.get(id);p.money=16000;p.buyUntil=server.game.time+100;server.game.buy(id,'awp');server.game.equip(id,'awp');p.nextAttackAt=server.game.time;p.nextShotAt=server.game.time;
 await page.waitForFunction(()=>window.lanStrike.getDiagnostics().weapon==='awp');await page.waitForTimeout(300);
 await page.mouse.click(600,400,{button:'right'});await page.waitForTimeout(150);const ammo=p.ammo;
 await page.mouse.down();await page.waitForTimeout(40);await page.keyboard.press('q');await page.waitForTimeout(35);await page.keyboard.press('q');await page.mouse.up();
 await page.waitForTimeout(700);assert.equal(p.ammo,ammo-1);assert.equal(p.weapon,'awp');assert.equal(p.zoom,90);report.awp=await inspect();assert.ok(Number.isFinite(report.awp.recoilPitch));report.checks.push('AWP shot is consumed through rapid double Q and returns unscoped');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.pointerLockElement);
 for(let n=0;n<9;n++){
  const ws=new WebSocket(server.url.replace('http','ws'));peers.push(ws);const messages=[];ws.on('message',b=>{const m=JSON.parse(b);messages.push(m);if(m.type==='hello')ws.send(JSON.stringify({type:'assetReady',worldContract:m.worldContract,weaponProfileId:m.weaponProfileId,presentationProfileId:m.presentationProfileId}));if(m.type==='assetReadyAck')ws.send(JSON.stringify({type:'join',name:'Load '+n,team:n<4?'T':'CT',character:n<4?'terror':'urban',worldContract:m.worldContract,weaponProfileId:m.weaponProfileId,presentationProfileId:m.presentationProfileId}));});await once(ws,'open');for(let tries=0;tries<200&&!messages.some(m=>m.type==='joined');tries++)await new Promise(r=>setTimeout(r,10));assert.ok(messages.some(m=>m.type==='joined'));
 }
 await page.waitForFunction(()=>window.lanStrike.getDiagnostics().remoteModels.length===9);await page.waitForTimeout(2000);report.tenPlayers=await inspect();assert.equal(server.game.players.size,10);assert.ok(report.tenPlayers.remoteModels.every(r=>!r.error));if(native)assert.ok(report.tenPlayers.remoteModels.every(r=>r.source==='source2-native-gltf'));report.checks.push('nine live protocol peers join existing browser without contract drift');
 const cdp=await context.newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');report.memory=await page.evaluate(()=>performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize}:null);await cdp.detach();await page.screenshot({path:'artifacts/cs2-combat'+tag+'.png'});
 assert.deepEqual(report.errors,[]);report.status='completed';await context.close();
}catch(error){report.status='failed';report.failure=error.stack;try{report.failureDiagnostics=await inspect();}catch{}console.error(error.stack);process.exitCode=1;
}finally{for(const peer of peers)peer.terminate();await browser?.close();await server?.close();report.fixtureClosed=true;await writeFile('artifacts/cs2-combat-browser'+(native?'-native':'')+tag+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,readyMs:report.readyMs,checks:report.checks,errors:report.errors,failure:report.failure,fixtureClosed:true}));}
