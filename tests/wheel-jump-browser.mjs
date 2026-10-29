import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {performance} from 'node:perf_hooks';
import {Game} from '../game.mjs';import {supportHeight} from '../public/shared.js';
const root=fileURLToPath(new URL('..',import.meta.url)),g=new Game(),p=g.add('local','Read-only audit','T');g.begin();g.time=10;Object.assign(p,{x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),yaw:0,pitch:0});
let browser,timer,joined=false,closed=false,busy=false,previous=performance.now(),accumulator=0,tick=0;const report={scope:'Moving ramp/step wheel-jump regression; native-GPU isolated headless Chrome, offline authoritative Game over IPC. No live-room join or listening service.',errors:[],cases:[]};
try{
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
 await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
 const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('about:blank');report.emptyRaf=await page.evaluate(async()=>{const a=[];let last;for(let i=0;i<100;i++){const t=await new Promise(requestAnimationFrame);if(i>10)a.push(t-last);last=t;}return a;});
 await page.exposeFunction('sendToGame',m=>{
  if(m.type==='join'){joined=true;previous=performance.now();return [{type:'joined',id:p.id},g.snapshot(p.id)];}
  if(m.type==='inputBatch'||m.type==='inputCritical')g.inputBatch(p.id,m.commands);else if(m.type==='input')g.input(p.id,m.input);else if(m.type==='ping')return [{type:'pong',sent:m.sent}];return [];
 });
 await page.addInitScript(()=>{
  window.auditSamples=[];window.auditCase=null;
  const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{cb(t);if(cb.name==='frame'&&window.auditCase&&window.lanStrike){const d=window.lanStrike.getDiagnostics(),s=window.lanStrike.getState(),p=s?.players[0];window.auditSamples.push({x:d.localPosition?.x,z:d.localPosition?.z,viewX:d.cameraPosition?.x,viewZ:d.cameraPosition?.z,serverGrounded:p?.grounded,serverVx:p?.vx,serverVz:p?.vz,case:window.auditCase,t,cameraY:d.cameraY,y:d.localPosition?.y,serverY:p?.y,serverVy:p?.vy,correction:d.lastCorrection,visualY:d.visualCorrection.y,ack:d.ackInputSeq,seq:d.inputSeq,pending:d.unackedInputs,fire:d.input.fire,crouch:d.input.crouch,jump:d.input.jump,calls:window.lanStrike.getRenderInfo().calls,decals:d.impacts,explosions:d.worldEffects.explosions.active,projectiles:d.worldEffects.projectiles});}});
  window.WebSocket=class{static OPEN=1;constructor(){this.readyState=1;this.bufferedAmount=0;window.auditSocket=this;setTimeout(()=>{this.onopen?.();this.emit({type:'hello',id:'local'});},0);}emit(m){this.onmessage?.({data:JSON.stringify(m)});}send(raw){window.sendToGame(JSON.parse(raw)).then(ms=>ms.forEach(m=>this.emit(m)));}};
 });
 await page.route('https://readonly-audit.test/**',async route=>{const pathname=new URL(route.request().url()).pathname,name=pathname==='/'?'index.html':pathname.slice(1);if(name.includes('..'))return route.abort();const file=name.startsWith('vendor/')?root+'/node_modules/three/build/'+name.slice(7):root+'/public/'+name;const type=name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':name.endsWith('.wav')?'audio/wav':'text/html';try{await route.fulfill({contentType:type,body:await readFile(file)});}catch{await route.fulfill({status:404,body:'Missing fixture asset'});}});
 timer=setInterval(async()=>{
  const now=performance.now();accumulator+=Math.min(.1,(now-previous)/1000);previous=now;if(!joined||closed){accumulator=0;return;}let steps=0;while(accumulator>=1/60){g.step();accumulator-=1/60;tick++;steps++;}
  if(!steps||busy)return;busy=true;try{const messages=[],events=g.events.splice(0);if(events.length)messages.push({type:'events',events});if(tick%2===0)messages.push(g.snapshot(p.id));if(messages.length)await page.evaluate(ms=>ms.forEach(m=>window.auditSocket.emit(m)),messages);}catch(e){if(!closed)report.errors.push(e.message);}finally{busy=false;}
 },1000/60);
 await page.goto('https://readonly-audit.test/?transport=websocket');await page.waitForFunction(()=>window.lanStrike);await page.click('#joinButton');await page.click('#resumeButton');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().locked);
 await page.evaluate(()=>new Promise(r=>setTimeout(r,3000)));
 report.graphics=await page.evaluate(()=>{const gl=document.getElementById('game').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),performance:window.lanStrike.getPerformance()};});
 const start=label=>page.evaluate(label=>{window.auditCase=label;},label);
 const end=async label=>{report.cases.push({label,metrics:await page.evaluate(()=>window.lanStrike.getPerformance())});await page.evaluate(()=>{window.auditCase=null;});};

 const {DOWNHILL_CASES,slopeStart,sampleSlope}=await import('./downhill-fixtures.mjs');
 const routes=[['flat-walk',null,false,false],['flat-moving-wheel',null,false,true],['stand-then-moving-wheel',null,false,true,true],['t-ramp-down-wheel',DOWNHILL_CASES[0],false,true],['t-ramp-up-wheel',DOWNHILL_CASES[0],true,true],['ct-ramp-down-wheel',DOWNHILL_CASES[2],false,true],['ct-ramp-up-wheel',DOWNHILL_CASES[2],true,true]];
 for(const [label,route,uphill,wheel,stand] of routes){
  await page.keyboard.up('KeyW');joined=false;while(busy)await new Promise(r=>setTimeout(r,5));
  g.begin();let pose;
  if(!route)pose={x:-18.4,z:18,y:supportHeight(-18.4,18,3.3),yaw:Math.PI,pitch:0,vx:0,vy:0,vz:0,crouch:false,grounded:true};
  else if(!uphill)pose={...slopeStart(route),grounded:true};
  else{const point=sampleSlope(route,120).samples.find(s=>Math.hypot(s.x-route.start[0],s.z-route.start[2])>=route.distance*.85);const dir=route.direction.map(x=>-x);pose={...point,vx:0,vy:0,vz:0,crouch:false,yaw:Math.atan2(-dir[0],-dir[1]),pitch:0,grounded:true};}
  Object.assign(p,pose);g.events.length=0;await page.evaluate(m=>window.auditSocket.emit(m),g.snapshot(p.id));joined=true;previous=performance.now();
  await page.waitForFunction(round=>window.lanStrike.getState().round===round,g.round);await page.evaluate(()=>new Promise(r=>setTimeout(r,100)));
  if(stand){await page.keyboard.down('ControlLeft');await page.evaluate(()=>new Promise(r=>setTimeout(r,500)));}
  await start(label);await page.keyboard.down('KeyW');await page.evaluate(()=>new Promise(r=>setTimeout(r,250)));
  if(stand)await page.keyboard.up('ControlLeft');
  await page.evaluate(async wheel=>{let roll;if(wheel)roll=setInterval(()=>document.dispatchEvent(new WheelEvent('wheel',{deltaY:120,cancelable:true})),1000/30);await new Promise(r=>setTimeout(r,1500));if(roll)clearInterval(roll);},wheel);
  await end(label);await page.keyboard.up('KeyW');
 }
 report.samples=await page.evaluate(()=>window.auditSamples);
 report.regressions=[];
 for(const {label} of report.cases){
  const rows=report.samples.filter(s=>s.case===label);let maxUp=0,maxHorizontalSpeed=0,flatFrames=0,flatStalls=0;
  for(let i=1;i<rows.length;i++){
   const a=rows[i-1],b=rows[i],dt=(b.t-a.t)/1000;
   if(dt<=0)continue;
   const speed=Math.hypot(b.viewX-a.viewX,b.viewZ-a.viewZ)/dt;
   maxUp=Math.max(maxUp,(b.cameraY-a.cameraY)/dt);maxHorizontalSpeed=Math.max(maxHorizontalSpeed,speed);
   if(label==='flat-walk'&&i>20&&Math.abs(b.y-rows[0].y)<.001&&Math.abs(a.y-rows[0].y)<.001&&Math.abs(b.serverVz)>6.2&&Math.abs(b.visualY)<.001&&Math.abs(a.visualY)<.001){flatFrames++;if(speed<1)flatStalls++;}
  }
  report.regressions.push({label,maxUp,maxHorizontalSpeed,flatFrames,flatStalls});
  assert.ok(maxUp<10,`${label}: excessive upward camera speed ${maxUp}`);
  assert.ok(maxHorizontalSpeed<8,`${label}: horizontal double-step ${maxHorizontalSpeed}`);
  if(label==='flat-walk'){assert.ok(flatFrames>10);assert.equal(flatStalls,0,'steady flat motion stalled for a render frame');}
 }
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(e){report.status='failed';report.failure=e.stack;console.error(e);process.exitCode=1;}
finally{closed=true;clearInterval(timer);await browser?.close();await writeFile(new URL('../artifacts/wheel-jump-browser-report.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,regressions:report.regressions,graphics:report.graphics,cases:report.cases,errors:report.errors,failure:report.failure},null,2));}
