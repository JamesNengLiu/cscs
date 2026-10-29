// Real client and imported viewmodels; offline Game snapshots replace transport only.
// No listening service or production restart.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {Game} from '../game.mjs';
import {RULES} from '../public/shared.js';
const game=()=>{const g=new Game({random:()=>.5}),p=g.add('local','Utility Review','T');g.begin();g.time=10;g.buy(p.id,'awp');return {g,p};};
function advance(g,seconds,fire=false){for(let i=0;i<Math.ceil(seconds*RULES.tick);i++){g.input('local',{fire});g.step();}}
const {g,p}=game(),initial=g.snapshot(p.id);g.secondary(p.id);const scoped=g.snapshot(p.id);g.equip(p.id,2);const pistol=g.snapshot(p.id);
const grenades=[];
for(const kind of ['hegrenade','flashbang','smokegrenade']){
  const {g,p}=game();g.buy(p.id,kind);g.equip(p.id,kind);advance(g,.6);
  advance(g,1/RULES.tick,true);const pin=g.snapshot(p.id);
  advance(g,1.2,true);const hold=g.snapshot(p.id);
  advance(g,1/RULES.tick);const thrown=g.snapshot(p.id);
  advance(g,.51);grenades.push({kind,pin,hold,thrown,recovered:g.snapshot(p.id)});
}
const report={status:'running',checks:[],errors:[],scope:'Isolated headless Chrome/WebGL with real client/assets and offline authoritative Game states; no physical multiplayer or FPS claim.'};
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  await mkdir('artifacts',{recursive:true});const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(30000);
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(snapshot=>{
    window.utilityFixture={snapshot,sent:[]};
    window.WebSocket=class{static OPEN=1;
      constructor(){this.readyState=1;this.bufferedAmount=0;window.utilitySocket=this;setTimeout(()=>{this.onopen?.();this.emit({type:'hello',id:'local'});},0);}
      emit(data){this.onmessage?.({data:JSON.stringify(data)});}
      send(raw){const m=JSON.parse(raw);window.utilityFixture.sent.push(m);if(m.type==='join')setTimeout(()=>{this.emit({type:'joined',id:'local'});this.emit(window.utilityFixture.snapshot);},0);}
    };
  },initial);
  await page.route('https://utility.test/**',async route=>{
    const pathname=new URL(route.request().url()).pathname,name=pathname==='/'?'index.html':pathname.slice(1);
    if(name.includes('..'))return route.abort();
    const file=name.startsWith('vendor/')?new URL(`../node_modules/three/build/${name.slice(7)}`,import.meta.url):new URL(`../public/${name}`,import.meta.url);
    const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':name.endsWith('.png')?'image/png':'text/html';
    try{await route.fulfill({contentType:type,body:await readFile(file)});}catch{await route.fulfill({status:404,body:'Missing fixture asset'});}
  });
  await page.goto('https://utility.test/?transport=websocket');await page.waitForFunction(()=>window.lanStrike?.getRenderInfo().triangles>0);
  await page.click('#joinButton');await page.click('#resumeButton');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().locked);
  await page.mouse.down();await page.mouse.up();
  await page.waitForFunction(()=>{const sent=window.utilityFixture.sent.filter(m=>m.type==='inputCritical').flatMap(m=>m.commands);return sent.some(c=>c.fire)&&sent.some(c=>!c.fire);});
  report.checks.push('real mouse press/release edges reach the reliable input-command path');
  const emit=state=>page.evaluate(state=>window.utilitySocket.emit(state),state);
  await page.waitForFunction(()=>{const m=window.lanStrike.getDiagnostics().weaponModel;return m.id==='awp'&&!m.loading;});
  assert.equal(await page.locator('#crosshair').isVisible(),false);assert.equal(await page.locator('#scopeOverlay').isVisible(),false);
  await page.screenshot({path:'artifacts/awp-unscoped-no-crosshair.png'});
  await emit(scoped);await page.waitForFunction(()=>!document.getElementById('scopeOverlay').hidden);
  assert.equal(await page.locator('#crosshair').isVisible(),false);
  await emit(pistol);await page.waitForFunction(()=>!document.getElementById('crosshair').hidden);
  report.checks.push('unscoped AWP has no crosshair, scoped AWP shows its scope, pistol retains the normal crosshair');
  for(const item of grenades){
    await emit(item.pin);await page.waitForFunction(kind=>{const m=window.lanStrike.getDiagnostics().weaponModel;return m.id===kind&&!m.loading&&m.sequence==='pullpin';},item.kind);
    await page.screenshot({path:`artifacts/${item.kind}-pullpin.png`});
    await emit(item.hold);await page.waitForFunction(()=>{const m=window.lanStrike.getDiagnostics().weaponModel;return m.sequence==='pullpin'&&m.frame>=39;});
    await emit(item.thrown);await page.waitForFunction(()=>window.lanStrike.getDiagnostics().weaponModel.sequence==='throw');
    await page.waitForFunction(kind=>window.lanStrike.getDiagnostics().worldEffects.projectileModels.models.some(m=>m.kind===kind&&m.source==='viewmodel-weapon-body'),item.kind);
    await page.screenshot({path:`artifacts/${item.kind}-throw.png`});
    await emit(item.recovered);await page.waitForFunction(()=>window.lanStrike.getDiagnostics().weapon==='awp');
    report.checks.push(`${item.kind}: imported pin-pull, held pose, throw and weapon recovery`);
  }
  const flash=structuredClone(initial),me=flash.players[0];me.flashUntil=flash.time+4;me.flashAmount=1;me.flashFade=3;
  await emit(flash);await page.waitForFunction(()=>window.lanStrike.getDiagnostics().flashOpacity>.99);
  await page.screenshot({path:'artifacts/flash-initial.png'});
  await page.waitForFunction(()=>{const n=window.lanStrike.getDiagnostics().flashOpacity;return n<.8&&n>.2;});
  await page.screenshot({path:'artifacts/flash-fading.png'});
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().flashOpacity===0,null,{timeout:5000});
  report.checks.push('short white hold transitions to visible fade and clears within four seconds');
  assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.failure=error.stack;report.status='failed';console.error(error);process.exitCode=1;}
finally{await browser.close();await writeFile('artifacts/utility-presentation-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
