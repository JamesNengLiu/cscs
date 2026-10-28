// Real client and WebGL with local files and authoritative Game shot fixtures.
// No listening server, production restart, or external asset requests.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {Game} from '../game.mjs';
import {supportHeight,resetWeapon} from '../public/shared.js';
import {SHOT_FX_LIMITS} from '../public/shot-effects.js';

const g=new Game({random:()=>.5}),p=g.add('local','Impact Review','T');g.begin();g.time=10;
Object.assign(p,{x:-18.4,y:supportHeight(-18.4,18,3.3),z:18,yaw:0,pitch:0});
const snapshot=structuredClone(g.snapshot(p.id)),shots=[];
for(const pitch of [-.14,0,.14])for(const yaw of [-.24,-.12,0,.12,.24]){
  p.pitch=pitch;p.yaw=yaw;resetWeapon(p);g.time+=.3;g.shoot(p);
  const e=g.events.findLast(e=>e.type==='shot');if(e?.impact)shots.push(e);
}
assert.ok(shots.length>=10);
const report={status:'running',checks:[],errors:[],externalRequests:[],scope:'Headless Chrome/WebGL, real client and current imported map, authoritative offline Game events; no live service or physical-device FPS claim.'};
const check=(name,details)=>{report.checks.push({name,details});console.log('PASS',name,details||'');};
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  await mkdir('artifacts',{recursive:true});
  const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(30000);
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('request',r=>{if(!r.url().startsWith('https://impacts.test/')&&!r.url().startsWith('data:'))report.externalRequests.push(r.url());});
  await page.addInitScript(snapshot=>{
    window.impactFixture={snapshot};
    window.WebSocket=class {
      static OPEN=1;
      constructor(){this.readyState=1;window.impactSocket=this;setTimeout(()=>{this.onopen?.();this.emit({type:'hello',id:'local'});},0);}
      emit(data){this.onmessage?.({data:JSON.stringify(data)});}
      send(raw){if(JSON.parse(raw).type==='join')setTimeout(()=>{this.emit({type:'joined',id:'local'});this.emit(window.impactFixture.snapshot);},0);}
    };
  },snapshot);
  await page.route('https://impacts.test/**',async route=>{
    const pathname=new URL(route.request().url()).pathname,relative=pathname==='/'?'index.html':pathname.slice(1);
    if(relative.includes('..'))return route.abort();
    const file=relative.startsWith('vendor/')?new URL(`../node_modules/three/build/${relative.slice(7)}`,import.meta.url):new URL(`../public/${relative}`,import.meta.url);
    const type=relative.endsWith('.js')?'text/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.json')?'application/json':relative.endsWith('.png')?'image/png':'text/html';
    try{await route.fulfill({contentType:type,body:await readFile(file)});}catch{await route.fulfill({status:404,body:'Missing fixture asset'});}
  });
  await page.goto('https://impacts.test/');await page.waitForFunction(()=>window.lanStrike?.getRenderInfo().triangles>0);
  await page.click('#joinButton');await page.click('#resumeButton');
  await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.locked&&!d.weaponModel.loading;});
  const baseline=await page.evaluate(()=>window.lanStrike.getRenderInfo());
  await page.evaluate(events=>window.impactSocket.emit({type:'events',events}),shots);
  await page.waitForFunction(n=>window.lanStrike.getDiagnostics().shotEffects.decals===n,shots.length);
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().shotEffects.dust===0);
  const settled=await page.evaluate(()=>({fx:window.lanStrike.getDiagnostics().shotEffects,render:window.lanStrike.getRenderInfo()}));
  assert.equal(settled.fx.tracers,0);assert.ok(settled.render.calls<=baseline.calls+5);
  await page.screenshot({path:'artifacts/shot-effects-wall.png'});
  check('authoritative wall shots render persistent surface holes without tracers',{shots:shots.length,additionalDrawCalls:settled.render.calls-baseline.calls});
  const before=await page.evaluate(()=>window.lanStrike.getDiagnostics().localPosition);
  await page.keyboard.down('KeyD');
  await page.waitForFunction(x=>window.lanStrike.getDiagnostics().localPosition.x>x+.35,before.x);
  await page.screenshot({path:'artifacts/shot-effects-moving.png'});await page.keyboard.up('KeyD');
  assert.equal(await page.evaluate(()=>window.lanStrike.getDiagnostics().shotEffects.decals),shots.length);
  check('camera movement preserves the existing wall impact count without a screen-space trail');
  const misses=shots.map(e=>({...e,hit:false,impact:null}));
  await page.evaluate(events=>window.impactSocket.emit({type:'events',events}),misses);
  assert.equal(await page.evaluate(()=>window.lanStrike.getDiagnostics().shotEffects.decals),shots.length);
  await page.evaluate(events=>window.impactSocket.emit({type:'events',events}),Array.from({length:1200},(_,i)=>shots[i%shots.length]));
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().shotEffects.dust===0);
  const stress=await page.evaluate(()=>({fx:window.lanStrike.getDiagnostics().shotEffects,render:window.lanStrike.getRenderInfo()}));
  assert.ok(stress.fx.decals<=SHOT_FX_LIMITS.decals);assert.ok(stress.render.calls<=baseline.calls+5);
  check('misses create no holes and sustained shooting stays within the decal and draw-batch limits',stress);
  await page.evaluate(()=>{window.impactFixture.snapshot.round++;window.impactSocket.emit(window.impactFixture.snapshot);});
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().shotEffects.decals===0);
  check('a new authoritative round clears all holes and dust');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{await browser.close();await writeFile('artifacts/shot-effects-report.json',JSON.stringify(report,null,2));}
