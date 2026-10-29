// Real client + original assets + offline authoritative Game over an in-process bridge.
// No listening socket, production restart, external assets or physical FPS claim.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {Game} from '../game.mjs';
import {supportHeight} from '../public/shared.js';
import {createGrenade} from '../grenades.mjs';
const report={status:'running',checks:[],errors:[],externalRequests:[],scope:'Isolated headless Chrome/WebGL, real client/assets and offline authoritative Game; no live service or physical-device performance result.'};
const g=new Game({random:()=>.5}),p=g.add('local','Utility settings','T');g.begin();g.buy(p.id,'ak47');g.buy(p.id,'hegrenade');g.time=10;
Object.assign(p,{x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),yaw:0,pitch:0});
const sent=[];let joined=false,closed=false,busy=false,timer=null,ticks=0;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  await mkdir('artifacts',{recursive:true});const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(15000);
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  page.on('request',r=>{if(!r.url().startsWith('https://utility-settings.test/')&&!r.url().startsWith('data:'))report.externalRequests.push(r.url());});
  await page.exposeFunction('sendToGame',m=>{
    sent.push(m);if(m.type==='join'){g.spawn(p);Object.assign(p,{x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),yaw:0,pitch:0});joined=true;return [{type:'joined',id:p.id},g.snapshot(p.id)];}
    if(m.type==='inputBatch'||m.type==='inputCritical')g.inputBatch(p.id,m.commands);
    else if(m.type==='input')g.input(p.id,m.input);
    else if(m.type==='equip')g.equip(p.id,m.weapon);
    else if(m.type==='reload')g.reload(p.id);
    else if(m.type==='secondary')g.secondary(p.id);
    else if(m.type==='ping')return [{type:'pong',sent:m.sent}];
    return [];
  });
  await page.addInitScript(()=>{
    window.utilitySent=[];
    window.WebSocket=class{static OPEN=1;
      constructor(){this.readyState=1;this.bufferedAmount=0;window.gameSocket=this;setTimeout(()=>{this.onopen?.();this.emit({type:'hello',id:'local'});},0);}
      emit(m){this.onmessage?.({data:JSON.stringify(m)});}
      send(raw){const m=JSON.parse(raw);window.utilitySent.push(m);window.sendToGame(m).then(messages=>messages.forEach(m=>this.emit(m)));}
    };
  });
  await page.route('https://utility-settings.test/**',async route=>{
    const path=new URL(route.request().url()).pathname,name=path==='/'?'index.html':path.slice(1);if(name.includes('..'))return route.abort();
    const file=name.startsWith('vendor/')?new URL(`../node_modules/three/build/${name.slice(7)}`,import.meta.url):new URL(`../public/${name}`,import.meta.url);
    const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':name.endsWith('.png')?'image/png':name.endsWith('.wav')?'audio/wav':'text/html';
    try{await route.fulfill({contentType:type,body:await readFile(file)});}catch{await route.fulfill({status:404,body:'Missing local fixture asset'});}
  });
  timer=setInterval(async()=>{
    if(!joined||closed)return;g.step();if(busy)return;busy=true;
    try{const events=g.events.splice(0),messages=[];if(events.length)messages.push({type:'events',events});if(++ticks%2===0)messages.push(g.snapshot(p.id));if(messages.length)await page.evaluate(messages=>messages.forEach(m=>window.gameSocket.emit(m)),messages);}
    catch(error){if(!closed)report.errors.push(error.message);}finally{busy=false;}
  },1000/60);
  const join=async()=>{await page.goto('https://utility-settings.test/?transport=websocket');await page.waitForFunction(()=>window.lanStrike);await page.click('#joinButton');await page.click('#resumeButton');await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.locked&&d.weaponModel.id==='ak47'&&!d.weaponModel.loading;});};
  await join();
  const turn=await page.evaluate(()=>{const before=window.lanStrike.getDiagnostics().input.yaw;document.dispatchEvent(new MouseEvent('mousemove',{movementX:100}));return Math.abs(window.lanStrike.getDiagnostics().input.yaw-before);});
  assert.ok(Math.abs(turn-.1)<1e-8);report.checks.push('sensitivity 1 produces exactly half the former turn angle');
  const centerBefore=await page.locator('#crosshair').boundingBox();await page.screenshot({path:'artifacts/weapon-hand-right.png'});
  await page.keyboard.press('Escape');await page.selectOption('#weaponHand','left');assert.equal(await page.evaluate(()=>localStorage.getItem('lan-strike-weapon-hand')),'left');
  await page.click('#resumeButton');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().locked);assert.equal(await page.evaluate(()=>window.lanStrike.getDiagnostics().weaponHand),'left');
  const centerAfter=await page.locator('#crosshair').boundingBox();assert.equal(centerBefore.x,centerAfter.x);assert.equal(centerBefore.y,centerAfter.y);await page.screenshot({path:'artifacts/weapon-hand-left.png'});
  report.checks.push('left-hand setting mirrors the imported weapon while keeping the crosshair centered');
  joined=false;await join();assert.equal(await page.evaluate(()=>window.lanStrike.getDiagnostics().weaponHand),'left');report.checks.push('left-hand preference survives a full page reload and reconnect');
  for(const key of ['ControlLeft','ControlRight','KeyC']){
    await page.keyboard.down(key);await page.waitForFunction(()=>window.lanStrike.getDiagnostics().input.crouch);await page.keyboard.up(key);await page.waitForFunction(()=>!window.lanStrike.getDiagnostics().input.crouch);
  }
  await page.keyboard.down('ControlLeft');const reloads=sent.filter(m=>m.type==='reload').length;await page.keyboard.press('KeyR');await page.keyboard.up('ControlLeft');assert.equal(sent.filter(m=>m.type==='reload').length,reloads+1);assert.ok(page.url().includes('utility-settings.test'));
  report.checks.push('C and both Ctrl keys crouch; Ctrl+R reloads the weapon without reloading the page');
  const beforeWheel=sent.length;await page.mouse.wheel(0,120);
  await page.waitForFunction(()=>window.utilitySent.filter(m=>m.type==='inputCritical').some(m=>m.commands.some(c=>c.jump)));
  const jumpSeq=await page.evaluate(()=>window.utilitySent.filter(m=>m.type==='inputCritical').flatMap(m=>m.commands).find(c=>c.jump).seq);
  await page.waitForFunction(seq=>window.lanStrike.getDiagnostics().ackInputSeq>=seq+1,jumpSeq);
  const wheelMessages=sent.slice(beforeWheel),commands=wheelMessages.filter(m=>m.type==='inputCritical').flatMap(m=>m.commands);
  assert.ok(commands.some(c=>c.jump));assert.ok(commands.some(c=>!c.jump));assert.equal(wheelMessages.some(m=>m.type==='equip'),false);
  assert.ok(p.jumpHeld===false);const beforeUp=sent.filter(m=>m.type==='equip').length,beforeWeapon=p.weapon;await page.mouse.wheel(0,-120);await page.waitForFunction(weapon=>window.lanStrike.getDiagnostics().weapon!==weapon,beforeWeapon);assert.equal(sent.filter(m=>m.type==='equip').length,beforeUp+1);
  report.checks.push('wheel down sends jump press/release to Game; wheel up still switches weapons');
  await page.keyboard.press('Escape');const menuStart=sent.length;await page.mouse.wheel(0,120);await page.keyboard.press('ControlLeft');
  assert.equal(sent.slice(menuStart).some(m=>m.type==='inputCritical'||m.type==='equip'),false);await page.click('#resumeButton');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().locked);
  await page.keyboard.press('Digit1');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().weapon==='ak47');await page.waitForFunction(()=>window.lanStrike.getState().players[0].grounded);
  report.checks.push('menu scrolling/keys do not generate gameplay actions');
  const grenade=createGrenade(p,'hegrenade',g.time);Object.assign(grenade,{x:p.x,y:p.y+.35,z:p.z-3.5,vx:.7,vy:2,vz:0});g.projectiles.push(grenade);
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().worldEffects.projectiles>0);assert.equal(await page.evaluate(()=>window.lanStrike.getDiagnostics().worldEffects.projectileModels.displayScale),2);await page.screenshot({path:'artifacts/grenade-flight-enlarged.png'});
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().worldEffects.explosions.active>0);await page.screenshot({path:'artifacts/he-explosion-visible.png'});
  assert.equal(await page.evaluate(()=>window.lanStrike.getDiagnostics().worldEffects.projectiles),0);
  const effects=await page.evaluate(()=>window.lanStrike.getDiagnostics().worldEffects.explosions);assert.equal(effects.batches,3);report.checks.push('a real Game HE detonation renders fire/smoke/sparks and removes its enlarged flying body');
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().worldEffects.explosions.active===0);report.checks.push('explosion effects expire and release active instances');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{closed=true;clearInterval(timer);await browser.close();await writeFile('artifacts/utility-settings-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
