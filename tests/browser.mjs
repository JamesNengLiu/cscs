import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
const base=process.env.TEST_URL||'http://127.0.0.1:3000';
const report={base,checks:[],errors:[],externalRequests:[],screenshots:[]};
const check=(name,details)=>{report.checks.push({name,details});console.log('PASS',name,details||'');};
const health=await fetch(base+'/health');assert.equal(health.status,200);assert.equal((await health.json()).ok,true);check('HTTP health');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
try{
  await mkdir('artifacts',{recursive:true});
  const contexts=await Promise.all([browser.newContext({viewport:{width:1440,height:900}}),browser.newContext({viewport:{width:1280,height:800}})]);
  const pages=await Promise.all(contexts.map(c=>c.newPage()));
  for(const p of pages){p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});p.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))report.externalRequests.push(r.url());});}
  await Promise.all(pages.map(p=>p.goto(base,{waitUntil:'networkidle'})));
  await pages[0].waitForFunction(()=>window.lanStrike?.getRenderInfo().triangles>0);check('WebGL renders actual geometry',await pages[0].evaluate(()=>window.lanStrike.getRenderInfo()));
  await pages[0].screenshot({path:'artifacts/lobby.png'});report.screenshots.push('artifacts/lobby.png');
  await pages[0].click('#previewButton');
  for(const view of ['overview','short','long','tunnels','mid','b','a']){await pages[0].click(`[data-view="${view}"]`);await pages[0].waitForFunction(v=>window.lanStrike.getDiagnostics().renderedView===v,view);await pages[0].waitForTimeout(180);await pages[0].screenshot({path:`artifacts/map-${view}.png`});report.screenshots.push(`artifacts/map-${view}.png`);}
  assert.ok(await pages[0].evaluate(()=>window.lanStrike.getDiagnostics().terrainTriangles>1000));const imported=await pages[0].evaluate(()=>window.lanStrike.getDiagnostics());assert.equal(imported.mapFaces,4002);assert.equal(imported.mapTextures,44);assert.equal(imported.terrainTriangles,9932);assert.match(imported.mapVersion,/bsp30/);check('seven original BSP map views, all imported faces, textures and triangles verified',imported.sourceSHA256);
  await pages[0].click('#backButton');await pages[0].waitForFunction(()=>!document.getElementById('lobby').hidden);
  for(let i=0;i<pages.length;i++){const p=pages[i];await p.fill('#name',i===0?'测试进攻':'测试防守');await p.selectOption('#team',i===0?'T':'CT');await p.click('#joinButton');await p.waitForFunction(()=>!document.getElementById('hud').hidden);}
  await pages[0].click('#openBuyButton');await pages[0].locator('button[data-category="rifle"]').click();await pages[0].locator('[data-item="ak47"]').click();
  await pages[0].waitForFunction(()=>window.lanStrike.getDiagnostics().weapon==='ak47'&&window.lanStrike.getDiagnostics().money===7500);
  await pages[0].locator('button[data-category="ammo"]').click();await pages[0].locator('[data-item="primaryammo"]').click();
  await pages[0].waitForFunction(()=>window.lanStrike.getDiagnostics().money===7420);
  await pages[0].waitForFunction(()=>{const m=window.lanStrike.getDiagnostics().weaponModel;return m.id==='ak47'&&m.source==='original-mdl'&&!m.loading;});check('actual converted MDL viewmodel loaded, not fallback',await pages[0].evaluate(()=>window.lanStrike.getDiagnostics().weaponModel.sourceSHA256));
  await pages[0].screenshot({path:'artifacts/purchase-live.png'});report.screenshots.push('artifacts/purchase-live.png');
  await pages[0].click('#buyClose');check('real server purchase: AK47 plus paid ammunition, authoritative cash and inventory');
  await pages[0].waitForFunction(()=>window.lanStrike.getState()?.phase==='live',null,{timeout:18000});
  for(const p of pages)assert.equal(await p.evaluate(()=>window.lanStrike.getState().players.length),2);check('two isolated browser sessions join opposing teams and start a round');
  const p=pages[0];await p.bringToFront();await p.click('#resumeButton');
  await p.waitForFunction(()=>document.pointerLockElement===document.querySelector('#game')&&window.lanStrike.getDiagnostics().locked&&document.hasFocus(),null,{timeout:5000});await p.waitForTimeout(250);check('real pointer lock from user gesture');
  const position=await p.evaluate(()=>{const s=window.lanStrike.getState(),me=s.players.find(p=>p.id===window.lanStrike.getId());return {x:me.x,z:me.z};});
  await p.keyboard.down('KeyW');await p.waitForFunction(()=>window.lanStrike.getDiagnostics().input.f===1,null,{timeout:2000});await p.waitForFunction(()=>{const me=window.lanStrike.getState().players.find(p=>p.id===window.lanStrike.getId());return Math.hypot(me.vx,me.vz)>1;},null,{timeout:2500});await p.waitForTimeout(650);await p.keyboard.up('KeyW');await p.waitForTimeout(200);
  const moved=await p.evaluate(()=>{const s=window.lanStrike.getState(),me=s.players.find(p=>p.id===window.lanStrike.getId());return {x:me.x,z:me.z};});assert.ok(Math.hypot(moved.x-position.x,moved.z-position.z)>.7,JSON.stringify({position,moved,diagnostics:await p.evaluate(()=>({state:window.lanStrike.getState(),client:window.lanStrike.getDiagnostics()}))}));check('keyboard movement confirmed by server snapshot',{before:position,after:moved});
  // Strafe off the CT spawn sightline so the reload test cannot accidentally end the round.
  await p.keyboard.down('KeyD');await p.waitForTimeout(450);await p.keyboard.up('KeyD');await p.waitForTimeout(150);
  const baselineY=await p.evaluate(()=>window.lanStrike.getState().players.find(p=>p.id===window.lanStrike.getId()).y);
  await p.keyboard.down('Space');await p.waitForFunction(y=>window.lanStrike.getState().players.find(p=>p.id===window.lanStrike.getId()).y>y+.25,baselineY,{timeout:2000});await p.keyboard.up('Space');await p.waitForFunction(()=>window.lanStrike.getState().players.find(p=>p.id===window.lanStrike.getId()).grounded,null,{timeout:2500});check('jump and landing on elevated spawn floor',baselineY);
  await p.mouse.down();await p.waitForFunction(()=>window.lanStrike.getDiagnostics().input.fire,null,{timeout:2000});await p.waitForFunction(()=>window.lanStrike.getDiagnostics().maxBurst>=7,null,{timeout:5000,polling:50});
  await p.waitForFunction(()=>window.lanStrike.getDiagnostics().maxRecoilPitch>.04,null,{timeout:4000,polling:50});
  const recoil=await p.evaluate(()=>window.lanStrike.getDiagnostics().maxRecoilPitch);assert.ok(recoil>.04,JSON.stringify({recoil,diagnostics:await p.evaluate(()=>({state:window.lanStrike.getState(),client:window.lanStrike.getDiagnostics()}))}));assert.ok(await p.evaluate(()=>window.lanStrike.getDiagnostics().maxBurst>=7));
  await p.screenshot({path:'artifacts/spray.png'});report.screenshots.push('artifacts/spray.png');check('sustained fire changes authoritative ray recoil and rendered camera',recoil);
  await p.mouse.up();await p.waitForTimeout(150);
  const ammo=await p.evaluate(()=>window.lanStrike.getState().players.find(p=>p.id===window.lanStrike.getId()).ammo);assert.ok(ammo<30);check('mouse shooting consumes server-side ammunition',ammo);
  await p.waitForFunction(()=>window.lanStrike.getState().players.find(p=>p.id===window.lanStrike.getId()).recoilPitch<.001,null,{timeout:3000});check('releasing fire recovers recoil');
  await p.keyboard.press('KeyR');await p.waitForFunction(()=>window.lanStrike.getState().players.find(p=>p.id===window.lanStrike.getId()).reloadAt>0,null,{timeout:2000});await p.waitForFunction(()=>window.lanStrike.getState().players.find(p=>p.id===window.lanStrike.getId()).ammo===30,null,{timeout:6000});assert.equal(await p.evaluate(()=>window.lanStrike.getState().phase),'live');check('reload via keyboard restores ammunition without a round reset');
  await p.keyboard.down('Tab');assert.equal(await p.locator('#board').isVisible(),true);await p.keyboard.up('Tab');check('scoreboard keyboard UI');
  await p.screenshot({path:'artifacts/gameplay.png'});report.screenshots.push('artifacts/gameplay.png');
  await p.keyboard.press('Escape');await p.waitForFunction(()=>document.pointerLockElement===null);check('Escape releases pointer lock');
  await contexts[1].close();await p.waitForFunction(()=>window.lanStrike.getState()?.phase==='waiting',null,{timeout:5000});check('disconnect returns to waiting without phantom opponents');
  const addresses=process.env.LOCAL_ONLY==='1'?[]:Object.values(os.networkInterfaces()).flat().filter(a=>a?.family==='IPv4'&&!a.internal&&/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address));
  report.lanAddresses=[];
  for(const a of addresses){const url=`http://${a.address}:${new URL(base).port||80}`;try{const r=await fetch(url+'/health',{signal:AbortSignal.timeout(2500)});assert.equal(r.status,200);report.lanAddresses.push(url);check('private LAN interface HTTP reachable from this host',url);}catch(e){report.lanAddresses.push({url,error:e.message});}}
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);check('no browser errors or external resource requests');
  report.status='passed';
}catch(e){report.status='failed';report.failure=e.stack;report.failureDiagnostics=[];for(const [i,p] of browser.contexts().flatMap(c=>c.pages()).entries())try{report.failureDiagnostics.push(await p.evaluate(()=>({state:window.lanStrike?.getState(),client:window.lanStrike?.getDiagnostics()})));await p.screenshot({path:`artifacts/browser-failure-${i}.png`});}catch{}console.error('FAILURE DIAGNOSTICS',JSON.stringify(report.failureDiagnostics));throw e;}
finally{await browser.close();await writeFile('artifacts/browser-report.json',JSON.stringify(report,null,2));}
