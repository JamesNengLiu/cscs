// Real mouse edges, production client/models and offline authoritative Game over IPC.
// No listening service, live-room connection or production restart.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {chromium} from 'playwright';
import {Game} from '../game.mjs';
import {supportHeight} from '../public/shared.js';
const g=new Game({random:()=>.5}),p=g.add('local','Double flash regression','T');g.begin();
g.buy(p.id,'ak47');g.buy(p.id,'flashbang');g.buy(p.id,'flashbang');g.equip(p.id,'flashbang');
Object.assign(p,{x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),yaw:0,pitch:0});
const report={status:'running',checks:[],errors:[],externalRequests:[],scope:'Isolated native Chrome, real production client/assets and offline Game via IPC; no live room, listening service or physical multiplayer/FPS claim.'};
let browser,timer,joined=false,closed=false,busy=false,previous=performance.now(),accumulator=0,tick=0;
try{
  await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
  const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(15000);
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('request',r=>{if(!r.url().startsWith('https://double-flash.test/')&&!r.url().startsWith('data:'))report.externalRequests.push(r.url());});
  await page.exposeFunction('sendToGame',m=>{
    if(m.type==='join'){joined=true;previous=performance.now();return [{type:'joined',id:p.id},g.snapshot(p.id)];}
    if(m.type==='inputBatch'||m.type==='inputCritical')g.inputBatch(p.id,m.commands);
    else if(m.type==='input')g.input(p.id,m.input);
    else if(m.type==='equip')g.equip(p.id,m.weapon);
    else if(m.type==='ping')return [{type:'pong',sent:m.sent}];
    return [];
  });
  await page.addInitScript(()=>{
    window.doubleFlash={states:[],events:[]};
    window.WebSocket=class{static OPEN=1;
      constructor(){this.readyState=1;this.bufferedAmount=0;window.fixtureSocket=this;setTimeout(()=>{this.onopen?.();this.emit({type:'hello',id:'local'});},0);}
      emit(m){if(m.type==='state'){const p=m.players.find(p=>p.id==='local');window.doubleFlash.states.push({time:m.time,weapon:p.weapon,phase:p.grenadePhase,started:p.grenadeStartedAt,thrown:p.grenadeThrownAt,count:p.grenades.flashbang});}
        if(m.type==='events')window.doubleFlash.events.push(...m.events);this.onmessage?.({data:JSON.stringify(m)});}
      send(raw){window.sendToGame(JSON.parse(raw)).then(ms=>ms.forEach(m=>this.emit(m)));}
    };
  });
  await page.route('https://double-flash.test/**',async route=>{
    const pathname=new URL(route.request().url()).pathname,name=pathname==='/'?'index.html':pathname.slice(1);if(name.includes('..'))return route.abort();
    const file=name.startsWith('vendor/')?new URL(`../node_modules/three/build/${name.slice(7)}`,import.meta.url):new URL(`../public/${name}`,import.meta.url);
    const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':name.endsWith('.png')?'image/png':name.endsWith('.wav')?'audio/wav':'text/html';
    try{await route.fulfill({contentType:type,body:await readFile(file)});}catch{await route.fulfill({status:404,body:'Missing fixture asset'});}
  });
  timer=setInterval(async()=>{
    const now=performance.now();accumulator+=Math.min(.1,(now-previous)/1000);previous=now;
    if(!joined||closed){accumulator=0;return;}let steps=0;
    while(accumulator>=1/60){g.step();accumulator-=1/60;tick++;steps++;}
    if(!steps||busy)return;busy=true;
    try{const messages=[],events=g.events.splice(0);if(events.length)messages.push({type:'events',events});if(tick%2===0)messages.push(g.snapshot(p.id));if(messages.length)await page.evaluate(ms=>ms.forEach(m=>window.fixtureSocket.emit(m)),messages);}
    catch(e){if(!closed)report.errors.push(e.message);}finally{busy=false;}
  },1000/60);
  await page.goto('https://double-flash.test/?transport=websocket');await page.waitForFunction(()=>window.lanStrike);await page.click('#joinButton');await page.click('#resumeButton');
  await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.locked&&d.weapon==='flashbang'&&!d.weaponModel.loading;});
  await page.waitForFunction(()=>window.lanStrike.getState().time>1);
  await page.mouse.click(640,400);
  await page.waitForFunction(()=>window.doubleFlash.events.filter(e=>e.type==='throw').length===1);
  const firstThrow=await page.evaluate(()=>window.doubleFlash.events.find(e=>e.type==='throw').time);
  await page.mouse.down();
  await page.waitForFunction(first=>{const p=window.lanStrike.getState().players[0],m=window.lanStrike.getDiagnostics().weaponModel;return p.weapon==='flashbang'&&p.grenadeStartedAt>first&&p.grenadePhase==='pin'&&m.sequence==='pullpin';},firstThrow);
  report.secondPin=await page.evaluate(()=>{const s=window.lanStrike.getState(),p=s.players[0];return {time:s.time,started:p.grenadeStartedAt,weapon:p.weapon,remaining:p.grenades.flashbang,model:window.lanStrike.getDiagnostics().weaponModel.sequence};});
  assert.ok(report.secondPin.started+1e-8>=firstThrow+.5);assert.equal(report.secondPin.remaining,1);
  report.checks.push('real mouse re-press during recovery starts the second pin pull after the 0.5-second cooldown');
  await page.waitForFunction(()=>{const s=window.lanStrike.getState(),p=s.players[0],d=window.lanStrike.getDiagnostics();return p.grenadePhase==='hold'&&d.weaponModel.sequence==='pullpin'&&d.weaponModel.frame>=40&&s.time-p.grenadeStartedAt>3&&d.flashOpacity===0;});
  assert.equal(await page.evaluate(()=>window.doubleFlash.events.filter(e=>e.type==='throw').length),1);
  const before=await page.evaluate(first=>window.doubleFlash.states.filter(s=>s.time>=first),firstThrow);
  assert.ok(before.every(s=>s.weapon==='flashbang'),'rifle was drawn between the two flashes');
  await page.screenshot({path:'artifacts/double-flash-held-second.png'});
  report.checks.push('the second imported viewmodel stays in the held pin pose, keeps one flash in inventory, and does not cook or auto-throw');
  await page.mouse.up();await page.waitForFunction(()=>window.doubleFlash.events.filter(e=>e.type==='throw').length===2);
  await page.waitForFunction(()=>{const p=window.lanStrike.getState().players[0];return p.weapon==='ak47'&&p.grenades.flashbang===0;});
  const states=await page.evaluate(()=>window.doubleFlash.states);report.secondThrow=await page.evaluate(()=>window.doubleFlash.events.filter(e=>e.type==='throw')[1].time);
  const rifle=states.find(s=>s.time>report.secondThrow&&s.weapon==='ak47');assert.ok(rifle.time+1e-8>=report.secondThrow+.5);
  report.checks.push('releasing left click throws exactly the second flash, consumes it once, and returns to the rifle after recovery');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.status='passed';
}catch(e){report.status='failed';report.failure=e.stack;console.error(e);process.exitCode=1;}
finally{closed=true;clearInterval(timer);await browser?.close();await writeFile(new URL('../artifacts/double-flash-browser-report.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
