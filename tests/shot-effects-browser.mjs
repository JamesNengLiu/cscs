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
const native=process.env.FX_NATIVE_GPU==='1';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args:native?['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
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
      send(raw){const m=JSON.parse(raw);if(m.type==='join')setTimeout(()=>{this.emit({type:'joined',id:'local'});this.emit(window.impactFixture.snapshot);},0);
        else if(['inputBatch','inputCritical'].includes(m.type))window.advanceImpactFixture?.(m.commands);}
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
  // Echo simulated movement ACKs: a silent fixture otherwise fills the client's
  // bounded unacknowledged queue after two seconds and prevents the camera test.
  await page.evaluate(async()=>{
    const {movePlayer}=await import('/shared.js');let round=null,player=null,seq=0;
    window.advanceImpactFixture=commands=>{
      const source=window.impactFixture.snapshot;
      if(round!==source.round){round=source.round;player=structuredClone(source.players[0]);seq=0;}
      let changed=false;
      for(const c of commands)if(c.round===round&&c.seq>seq){movePlayer(player,c,1/60,[player]);seq=c.seq;changed=true;}
      if(changed){const state={...source,time:source.time+seq/60,players:[{...player,ackInputSeq:seq}]};queueMicrotask(()=>window.impactSocket.emit(state));}
    };
  });
  await page.click('#joinButton');await page.click('#resumeButton');
  await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.locked&&!d.weaponModel.loading&&d.weaponModel.id===d.weapon&&d.weaponModel.sequence?.startsWith('idle');});
  // Loading metadata can complete before the new model has rendered its frame.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const baseline=await page.evaluate(()=>window.lanStrike.getRenderInfo());
  await page.evaluate(events=>window.impactSocket.emit({type:'events',events}),shots);
  await page.waitForFunction(n=>window.lanStrike.getDiagnostics().shotEffects.decals===n,shots.length);
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().shotEffects.debris>0);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const burst=await page.evaluate(()=>({fx:window.lanStrike.getDiagnostics().shotEffects,render:window.lanStrike.getRenderInfo()}));
  assert.ok(burst.fx.debris>0&&burst.fx.debris<=SHOT_FX_LIMITS.debris);assert.ok(burst.render.calls<=baseline.calls+6);
  await page.screenshot({path:'artifacts/shot-effects-chips.png'});
  check('wall chips render in world space in one reusable extra batch',burst);
  await page.waitForFunction(()=>{const f=window.lanStrike.getDiagnostics().shotEffects;return f.dust===0&&f.debris===0;});
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
  await page.waitForFunction(()=>{const f=window.lanStrike.getDiagnostics().shotEffects;return f.dust===0&&f.debris===0;});
  const stress=await page.evaluate(()=>({fx:window.lanStrike.getDiagnostics().shotEffects,render:window.lanStrike.getRenderInfo()}));
  assert.ok(stress.fx.decals<=SHOT_FX_LIMITS.decals);assert.ok(stress.render.calls<=baseline.calls+5);
  check('misses create no holes and sustained shooting stays within the decal and draw-batch limits',stress);
  await page.evaluate(()=>{window.impactFixture.snapshot.round++;window.impactSocket.emit(window.impactFixture.snapshot);});
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().shotEffects.decals===0);
  check('a new authoritative round clears all holes and dust');
  await page.evaluate(shot=>{
    const s=window.impactFixture.snapshot;s.round++;s.players[0].z=22;window.impactSocket.emit(s);
    window.impactSocket.emit({type:'events',events:[{...shot,round:s.round}]});
  },shots[Math.floor(shots.length/2)]);
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().shotEffects.debris===8);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:'artifacts/shot-effects-single-impact.png'});
  check('a single wall hit emits two prominent chips, six smaller fragments and dust without new batches');
  await page.evaluate(()=>{
    const s=window.impactFixture.snapshot;s.round++;Object.assign(s.players[0],{x:-18.4,z:22,yaw:0,pitch:0});window.impactSocket.emit(s);
    window.impactSocket.emit({type:'events',events:[{type:'explosion',kind:'hegrenade',id:'review-he',x:-18.4,y:s.players[0].y+.1,z:18.5}]});
  });
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().worldEffects.explosions.active===1);
  await page.waitForTimeout(160);await page.screenshot({path:'artifacts/he-explosion-expanded.png'});
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().worldEffects.explosions.active===0);
  check('larger HE fire and smoke render at the detonation point and clean up');
  if(native){
    report.scope='Native GPU Chrome, 1280x800, one real map/client; synthetic offline visual events, not physical multiplayer.';
    await page.waitForTimeout(4200);
    const baseline=await page.evaluate(()=>({performance:window.lanStrike.getPerformance(),render:window.lanStrike.getRenderInfo()}));
    await page.evaluate(shot=>{let i=0;window.fxStress=setInterval(()=>{
      const round=window.impactFixture.snapshot.round;
      window.impactSocket.emit({type:'events',events:[{...shot,id:'remote',round,shotId:`pressure:${i}`,eventId:1000+i}]});
      if(i%18===0)window.impactSocket.emit({type:'events',events:[{type:'explosion',kind:'hegrenade',round,id:`pressure-he:${i}`,x:-18.4,y:window.impactFixture.snapshot.players[0].y+.1,z:18.5}]});i++;
    },50);},shots[0]);
    await page.waitForTimeout(5000);
    const pressure=await page.evaluate(()=>{clearInterval(window.fxStress);return {performance:window.lanStrike.getPerformance(),render:window.lanStrike.getRenderInfo(),fx:window.lanStrike.getDiagnostics().shotEffects};});
    assert.ok(pressure.render.calls<=baseline.render.calls+9);assert.ok(pressure.fx.debris<=SHOT_FX_LIMITS.debris);
    const graphics=await page.evaluate(()=>{const gl=document.querySelector('#game').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(e?e.UNMASKED_RENDERER_WEBGL:gl.RENDERER);});
    report.profile={graphics,baseline,pressure};check('native visual pressure stays within nine extra draw batches',report.profile);
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{await browser.close();await writeFile('artifacts/shot-effects-report.json',JSON.stringify(report,null,2));}
