// Actual client/assets, real mouse/keyboard and two offline Game players over IPC.
// No production room, listening socket or service restart. GPU/CPU reported separately.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
import {chromium} from 'playwright';
import {Game} from '../game.mjs';
import {supportHeight,eyeHeight,direction} from '../public/shared.js';
import {playerHitboxes} from '../hitboxes.mjs';
const g=new Game({random:()=>.5}),p=g.add('local','Shooter','T'),q=g.add('target','Opponent','CT');g.begin();g.phase='live';g.time=10;g.buy(p.id,'ak47');g.buy(q.id,'m4a1');
const report={status:'running',checks:[],errors:[],externalRequests:[],scope:'Isolated native-GPU Chrome at 1280x800 with production client and two authoritative offline Game players over IPC. No physical multiplayer or retail-client parity claim.'};
let page,browser,timer,joined=false,closed=false,busy=false,previous=performance.now(),accumulator=0,tick=0,moving=false,moveDir=1,stress=false,extras=[];
function place(){
 for(const [a,z] of [[p,22],[q,18]])Object.assign(a,{x:-18.4,z,y:supportHeight(-18.4,z,3.3),yaw:0,pitch:0,vx:0,vy:0,vz:0,grounded:true,hp:10000,armour:0,helmet:false,flinchAt:-100,gaitDistance:0,airTime:0,nextAttackAt:0,lastShot:-100});
 g.phase='live';g.endAt=g.time+1000;q.input={f:0,s:0,yaw:0,pitch:0,fire:false};
}
place();
try{
 await mkdir('artifacts',{recursive:true});
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
 page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(15000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('https://player-feedback.test/')&&!r.url().startsWith('data:'))report.externalRequests.push(r.url());});
 await page.exposeFunction('sendToGame',m=>{
  if(m.type==='join'){joined=true;previous=performance.now();return [{type:'joined',id:p.id},g.snapshot(p.id)];}
  if(m.type==='inputBatch'||m.type==='inputCritical')g.inputBatch(p.id,m.commands);else if(m.type==='input')g.input(p.id,m.input);else if(m.type==='equip')g.equip(p.id,m.weapon);else if(m.type==='ping')return [{type:'pong',sent:m.sent}];return [];
 });
 await page.addInitScript(()=>{
  window.feedback={events:[],batches:[],samples:[],case:null};
  const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{cb(t);if(cb.name==='frame'&&window.feedback.case&&window.lanStrike){const d=window.lanStrike.getDiagnostics();window.feedback.samples.push({t,case:window.feedback.case,seq:d.inputSeq,camera:d.cameraPosition,correction:d.lastCorrection,remote:d.remoteModels.map(p=>({sequence:p.sequence,gait:p.gait,position:p.position})),fx:d.playerHitEffects});}});
  window.WebSocket=class{static OPEN=1;constructor(){this.readyState=1;this.bufferedAmount=0;window.feedbackSocket=this;setTimeout(()=>{this.onopen?.();this.emit({type:'hello',id:'local'});},0);}
   emit(m){if(m.type==='events')window.feedback.events.push(...m.events);this.onmessage?.({data:JSON.stringify(m)});}
   send(raw){const m=JSON.parse(raw);if(m.type==='inputBatch')window.feedback.batches.push({at:performance.now(),case:window.feedback.case,seq:m.commands.at(-1)?.seq});window.sendToGame(m).then(ms=>ms.forEach(m=>this.emit(m)));}
  };
 });
 await page.route('https://player-feedback.test/**',async route=>{
  const pathname=new URL(route.request().url()).pathname,name=pathname==='/'?'index.html':pathname.slice(1);if(name.includes('..'))return route.abort();
  const file=name.startsWith('vendor/')?new URL(`../node_modules/three/build/${name.slice(7)}`,import.meta.url):new URL(`../public/${name}`,import.meta.url);
  const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':name.endsWith('.png')?'image/png':name.endsWith('.wav')?'audio/wav':'text/html';
  try{await route.fulfill({contentType:type,body:await readFile(file)});}catch{await route.fulfill({status:404,body:'Missing fixture asset'});}
 });
 timer=setInterval(async()=>{
  const now=performance.now();accumulator+=Math.min(.1,(now-previous)/1000);previous=now;if(!joined||closed){accumulator=0;return;}let steps=0;
  while(accumulator>=1/60){
   if(moving){if(q.x>-19.2)moveDir=-1;if(q.x<-22.2)moveDir=1;g.input(q.id,{s:moveDir,yaw:0,fire:true});}
   g.step();if(stress)for(const a of [q,...extras]){a.vx=3;a.vz=0;a.grounded=true;a.gaitDistance=(a.gaitDistance||0)+3/60;}accumulator-=1/60;tick++;steps++;
  }
  if(!steps||busy)return;busy=true;
  try{const messages=[],events=g.events.splice(0);if(events.length)messages.push({type:'events',events});if(tick%2===0)messages.push(g.snapshot(p.id));if(messages.length)await page.evaluate(ms=>ms.forEach(m=>window.feedbackSocket.emit(m)),messages);}
  catch(e){if(!closed)report.errors.push(e.message);}finally{busy=false;}
 },1000/60);
 await page.goto('https://player-feedback.test/?transport=websocket');await page.waitForFunction(()=>window.lanStrike);await page.click('#joinButton');await page.click('#resumeButton');
 await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.locked&&!d.weaponModel.loading&&d.remoteModels.length===1&&!d.remoteModels[0].loading;});
 await page.evaluate(()=>new Promise(r=>setTimeout(r,1200)));
 const reset=async effect=>{
  joined=false;while(busy)await new Promise(r=>setTimeout(r,5));g.begin();place();q.armour=effect==='armour'||effect==='helmet'?100:0;q.helmet=effect==='helmet';
  const group=effect==='helmet'?'head':'chest',box=playerHitboxes(q,g.time).find(b=>b.group===group),target=new THREE.Vector3(...box.min.map((x,i)=>(x+box.max[i])/2)).applyMatrix4(new THREE.Matrix4().fromArray(box.inverse).invert());
  const dx=target.x-p.x,dz=target.z-p.z;p.yaw=Math.atan2(-dx,-dz);p.pitch=Math.atan2(target.y+(group==='head'?.05:0)-p.y-eyeHeight(p),Math.hypot(dx,dz));
  report.fixtures||=[];const r=g.targetRay(p,direction(p.yaw,p.pitch),200);report.fixtures.push({effect,time:g.time,point:target.toArray(),eye:p.y+eyeHeight(p),pitch:p.pitch,actualTarget:r.target?.id,group:r.hitgroup,q:{x:q.x,y:q.y,z:q.z,pitch:q.pitch,yaw:q.yaw,weapon:q.weapon,alive:q.alive,crouch:q.crouch,airTime:q.airTime,gaitDistance:q.gaitDistance,flinchAt:q.flinchAt}});
  g.events=[];await page.evaluate(m=>window.feedbackSocket.emit(m),g.snapshot(p.id));joined=true;previous=performance.now();await page.waitForFunction(round=>window.lanStrike.getState().round===round,g.round);await page.evaluate(()=>new Promise(r=>setTimeout(r,100)));
 };
 for(const effect of ['blood','helmet','armour']){
  await reset(effect);await page.evaluate(effect=>window.feedback.case=effect,effect);const impactSounds=await page.evaluate(()=>window.lanStrike.getDiagnostics().audio.impactPlayed);await page.mouse.down();await page.mouse.up();
  await page.waitForFunction(effect=>window.lanStrike.getDiagnostics().playerHitEffects[effect]>0,effect);
  await page.screenshot({path:`artifacts/player-hit-${effect}.png`});
  const d=await page.evaluate(()=>window.lanStrike.getDiagnostics());assert.equal(d.playerHitEffects.batches,1);assert.equal(await page.locator('#hitmarker').evaluate(e=>getComputedStyle(e).opacity),'0');
  await page.waitForFunction(before=>window.lanStrike.getDiagnostics().audio.impactPlayed>before,impactSounds);report.checks.push(`${effect}: a real mouse shot triggers confirmed world feedback and positional sound`);
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().playerHitEffects.blood+window.lanStrike.getDiagnostics().playerHitEffects.helmet+window.lanStrike.getDiagnostics().playerHitEffects.armour===0);
 }
 await reset('blood');joined=false;while(busy)await new Promise(r=>setTimeout(r,5));q.x=-20.5;q.z=18.5;q.y=supportHeight(q.x,q.z,3.3);p.yaw=0;p.pitch=0;
 await page.evaluate(m=>window.feedbackSocket.emit(m),g.snapshot(p.id));joined=true;moving=true;previous=performance.now();
 await page.evaluate(()=>window.feedback.case='moving');await page.keyboard.down('KeyD');await page.evaluate(()=>new Promise(r=>setTimeout(r,900)));await page.keyboard.up('KeyD');
 await page.evaluate(()=>window.feedback.case='remote-moving-fire');await page.evaluate(()=>new Promise(r=>setTimeout(r,1800)));moving=false;
 await page.screenshot({path:'artifacts/player-gait-moving-fire.png'});
 report.motion=await page.evaluate(()=>({samples:window.feedback.samples.filter(s=>s.case==='moving'||s.case==='remote-moving-fire'),batches:window.feedback.batches.filter(s=>s.case==='moving'),performance:window.lanStrike.getPerformance()}));
 const rows=report.motion.samples.filter(s=>s.case==='moving'),commands=rows.at(-1).seq-rows[0].seq;
 assert.ok(commands>35);const sent=new Set(report.motion.batches.map(b=>b.seq));
 let producingFrames=0;for(let i=1;i<rows.length;i++)if(rows[i].seq>rows[i-1].seq){producingFrames++;assert.ok(sent.has(rows[i].seq),`producing frame left command ${rows[i].seq} unsent`);}
 report.commandCadence={commands,producingFrames,packets:report.motion.batches.length};
 const gait=report.motion.samples.flatMap(s=>s.remote).filter(r=>r.gait?.sequence==='run'),frames=new Set(gait.map(r=>r.gait.frame.toFixed(2)));
 assert.ok(frames.size>25,'lower-body gait must keep advancing while the upper body shoots');assert.ok(gait.some(r=>r.sequence?.includes('shoot')));
 report.checks.push('local fixed-step commands are sent on the producing frame; remote running gait continues through repeated shooting');
 // Render-only pressure fixture: all nine remote actors advance gait; this
 // deliberately does not represent nine physical/networked human clients.
 joined=false;while(busy)await new Promise(r=>setTimeout(r,5));
 extras=Array.from({length:8},(_,i)=>g.add('extra'+i,'Render '+i,i<4?'T':'CT'));g.begin();place();g.events=[];stress=true;
 await page.evaluate(m=>window.feedbackSocket.emit(m),g.snapshot(p.id));joined=true;previous=performance.now();
 await page.waitForFunction(()=>{const a=window.lanStrike.getDiagnostics().remoteModels;return a.length===9&&a.every(m=>!m.loading);});
 await page.evaluate(()=>window.feedback.case=null);await page.evaluate(()=>new Promise(r=>setTimeout(r,4500)));
 report.renderStress={scope:'One local view plus nine animated remote render actors; no physical multiplayer throughput claim.',performance:await page.evaluate(()=>window.lanStrike.getPerformance()),render:await page.evaluate(()=>window.lanStrike.getRenderInfo())};
 report.checks.push('nine remote animated actors render with the new shared gait layer in the isolated native-GPU scene');
 report.graphics=await page.evaluate(()=>{const gl=document.getElementById('game').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.status='passed';
}catch(e){report.status='failed';report.failure=e.stack;report.debug={p:{weapon:p.weapon,ammo:p.ammo,input:p.input,yaw:p.yaw,pitch:p.pitch,x:p.x,y:p.y,z:p.z},q:{x:q.x,y:q.y,z:q.z,yaw:q.yaw,hp:q.hp},events:await page?.evaluate(()=>window.feedback?.events.slice(-25)),diagnostics:await page?.evaluate(()=>window.lanStrike?.getDiagnostics())};console.error(e);process.exitCode=1;}
finally{closed=true;clearInterval(timer);await browser?.close();await writeFile('artifacts/player-feedback-browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks,graphics:report.graphics,performance:report.motion?.performance,renderStress:report.renderStress,errors:report.errors,failure:report.failure,fixtures:report.fixtures,debug:report.debug},null,2));}
