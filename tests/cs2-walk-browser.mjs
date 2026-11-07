import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {createStaticFixture} from '../tools/cs2-static-fixture.mjs';
const headed=process.argv.includes('--headed'),width=Number(process.env.CS2_WALK_WIDTH)||1280,height=Number(process.env.CS2_WALK_HEIGHT)||800,tag=headed?'-headed':'';
const report={status:'running',headed,errors:[],websockets:[],checks:[],scope:headed?'Native Chrome foreground rendering/physics with scripted frame input; OS pointer-lock input tested separately in headless Chrome. Not multiplayer or CS2 movement calibration.':'Native Chrome real browser pointer-lock/keyboard input and actual CS2 physics; not physical mouse/DPI or multiplayer validation.'};
await mkdir('artifacts',{recursive:true});const fixture=await createStaticFixture();let browser,page;
const inspect=()=>page.evaluate(()=>window.cs2Walk.diagnostics());
try{
 browser=await chromium.launch({headless:!headed,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-precise-memory-info','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
 const context=await browser.newContext({viewport:{width,height}});page=await context.newPage();page.setDefaultTimeout(90000);
 page.on('pageerror',e=>report.errors.push(e.stack||e.message));page.on('websocket',socket=>report.websockets.push(socket.url()));page.on('console',m=>{if(['warning','warn','error'].includes(m.type())&&/WebGL.*(?:INVALID|error)|shader.*error|out of memory/i.test(m.text()))report.errors.push(m.text());});
 report.environment={browser:browser.version(),width,height,dpr:1};report.sourceHashes={};
 for(const file of ['public/cs2-walk.js','public/cs2-walk.html','public/cs2-world.js','public/cs2-collision.js','public/cs2-movement.js','public/cs2-walk-camera.js','public/experimental-world-contract.js','public/cs2-physics-loader.js','public/cs2-physics-worker.js','public/cs2-optimized-renderer.js'])report.sourceHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
 await page.goto(fixture.url+'/cs2-walk.html?automation=1');await page.waitForFunction(()=>window.cs2Walk?.ready||document.querySelector('#error').textContent);
 assert.equal(await page.evaluate(()=>window.cs2Walk?.ready),true,await page.locator('#error').textContent());report.cold=await inspect();
 assert.equal(report.cold.integrityVerified,true);assert.equal(report.cold.physics.shapes,10149);assert.equal(report.cold.contract.sourceSHA1,'7dc529cd65d843a2b8a98c297e79b9923dd70a5d');assert.equal(report.cold.player.grounded,true);assert.deepEqual(report.websockets,[]);report.checks.push('verified native physics, renderer contract and no legacy room join');
 const reference=JSON.parse(await readFile('artifacts/cs2-walk-physics.json','utf8'));
 for(const team of ['T','CT'])for(const index of [0,7,14]){
  const d=await page.evaluate(([team,index])=>window.cs2Walk.spawn(team,index),[team,index]),expected=reference.spawns.find(p=>p.team===team&&p.index===index);assert.ok(Math.abs(d.player.y-expected.position.y)<1e-8);
  const rest=await page.evaluate(()=>window.cs2Walk.run(Array.from({length:60},()=>({}))));assert.ok(Math.abs(rest.player.y-d.player.y)<.002);assert.equal(rest.player.grounded,true);
 }
 report.checks.push('six authored spawns stay grounded and agree with Node CPU world');
 await page.evaluate(()=>window.cs2Walk.spawn('T',0));let d=await page.evaluate(()=>window.cs2Walk.run(Array.from({length:30},()=>({crouch:true}))));assert.equal(d.player.crouch,true);
 d=await page.evaluate(()=>window.cs2Walk.run(Array.from({length:30},()=>({}))));assert.equal(d.player.crouch,false);
 const before=d.player.y;d=await page.evaluate(()=>window.cs2Walk.run([{jump:true}]));assert.ok(d.player.y>before);assert.ok(d.player.vy>0);
 d=await page.evaluate(()=>window.cs2Walk.run(Array.from({length:120},()=>({jump:true}))));assert.equal(d.player.grounded,true);assert.ok(Math.abs(d.player.y-before)<.002);report.checks.push('crouch/stand and held jump does not auto-bunny-hop');
 await page.evaluate(()=>window.cs2Walk.spawn('CT',0));await page.evaluate(()=>window.cs2Walk.settled());await page.bringToFront();
 if(headed){
  await page.evaluate(()=>{window.cs2Walk.resetMetrics();window.cs2Walk.setScriptedInput({f:1});});await page.waitForTimeout(1800);
  await page.evaluate(()=>window.cs2Walk.setScriptedInput({}));await page.waitForTimeout(500);
  await page.evaluate(()=>window.cs2Walk.setScriptedInput({crouch:true}));await page.waitForTimeout(600);assert.equal((await inspect()).player.crouch,true);
  await page.evaluate(()=>window.cs2Walk.setScriptedInput({}));await page.waitForTimeout(500);assert.equal((await inspect()).player.crouch,false);
  const floor=(await inspect()).player.y;await page.evaluate(()=>window.cs2Walk.setScriptedInput({jump:true}));await page.waitForTimeout(100);assert.ok((await inspect()).player.y>floor+.05);
  await page.evaluate(()=>window.cs2Walk.setScriptedInput({}));await page.waitForTimeout(900);report.liveInput=await inspect();await page.evaluate(()=>window.cs2Walk.setScriptedInput(null));
  assert.ok(report.liveInput.frame.samples>=120);report.checks.push('actual foreground GPU/physics frame timing with scripted held commands');
 }else{
  await page.evaluate(()=>{window.cs2Walk.useLiveInput();window.cs2Walk.resetMetrics();});await page.getByRole('button',{name:'开始行走',exact:true}).click();await page.waitForFunction(()=>document.pointerLockElement===document.querySelector('canvas'),undefined,{timeout:8000});
  const liveBefore=await inspect();await page.keyboard.down('w');await page.waitForTimeout(1200);await page.keyboard.up('w');await page.waitForTimeout(200);const liveAfter=await inspect();assert.ok(liveAfter.ticks-liveBefore.ticks>=40);assert.ok(Math.hypot(liveAfter.player.x-liveBefore.player.x,liveAfter.player.z-liveBefore.player.z)>.2);
  await page.keyboard.down('Control');await page.waitForTimeout(600);assert.equal((await inspect()).player.crouch,true);await page.keyboard.up('Control');await page.waitForTimeout(500);assert.equal((await inspect()).player.crouch,false);
  const jumpY=(await inspect()).player.y;await page.mouse.wheel(0,80);await page.waitForTimeout(100);assert.ok((await inspect()).player.y>jumpY+.05);await page.waitForTimeout(800);report.liveInput=await inspect();
  await page.keyboard.down('w');await page.waitForTimeout(80);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.waitForFunction(()=>!document.pointerLockElement);const paused=await inspect();await page.waitForTimeout(180);const still=await inspect();assert.equal(still.player.x,paused.player.x);assert.equal(still.player.z,paused.player.z);assert.equal(still.player.jumpHeld,false);await page.keyboard.up('w');
  await page.getByRole('button',{name:'开始行走',exact:true}).click();await page.waitForFunction(()=>document.pointerLockElement===document.querySelector('canvas'));const resumed=await inspect();assert.ok(Math.hypot(resumed.camera.position[0]-still.player.x,resumed.camera.position[2]-still.player.z)<.12);await page.evaluate(()=>document.exitPointerLock());await page.waitForFunction(()=>!document.pointerLockElement);
  report.checks.push('native pointer lock, WASD, Control, wheel jump, loss-of-focus suspension and camera rebase');
 }
 await page.waitForTimeout(500);await page.screenshot({path:'artifacts/cs2-walk-ct'+tag+'.png'});report.final=await inspect();assert.deepEqual(report.final.errors,[]);assert.deepEqual(report.final.streaming.errors,[]);assert.ok(report.final.physicsPeakMs<33);
 const cdp=await context.newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');report.retainedAfterGC=await page.evaluate(()=>window.cs2Walk.diagnostics().memory);await cdp.detach();report.checks.push('streamed map, physics and camera stay finite without WebGL errors');
 const bad=await browser.newContext({viewport:{width:800,height:600}}),badPage=await bad.newPage();
 await badPage.route('**/assets/cs2-physics/manifest.json',async route=>{const body=JSON.parse(await readFile('public/assets/cs2-physics/manifest.json','utf8'));body.mapSHA1='0'.repeat(40);await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
 await badPage.goto(fixture.url+'/cs2-walk.html?automation=1');await badPage.waitForFunction(()=>document.querySelector('#error').textContent);assert.match(await badPage.locator('#error').textContent(),/map source mismatch/);assert.notEqual(await badPage.evaluate(()=>window.cs2Walk?.ready),true);await bad.close();report.checks.push('incompatible map rejected before play');
 const early=await context.newPage();await early.goto(fixture.url+'/cs2-walk.html?automation=1',{waitUntil:'domcontentloaded'});await early.close();report.checks.push('closing during initialization cancels owned work');
 await page.evaluate(()=>document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());await page.waitForFunction(()=>window.cs2Walk.diagnostics().phase==='failed');assert.equal(await page.evaluate(()=>window.cs2Walk.ready),false);assert.match(await page.locator('#error').textContent(),/刷新独立行走页/);report.checks.push('context loss stops updates and requires explicit reload');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.websockets,[]);await context.close();report.status='completed';
}catch(error){report.status='failed';report.failure=error.stack;if(page&&!page.isClosed())try{report.failureDiagnostics=await inspect();}catch{}process.exitCode=1;console.error(error.stack);
}finally{await browser?.close();await fixture.close();report.fixtureClosed=true;await writeFile('artifacts/cs2-walk-browser'+tag+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks,errors:report.errors,failure:report.failure,fixtureClosed:true}));}
