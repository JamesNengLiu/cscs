// Native production client with offline Game and transport fault scheduling.
// No live-room connection, public port, or source-physics substitutions.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {Game as CurrentGame} from '../game.mjs';
import {supportHeight,trace} from '../public/shared.js';
import {DOWNHILL_CASES,slopeStart} from './downhill-fixtures.mjs';
const before=process.argv.includes('--before'),baseline=process.env.NET_CONTINUITY_BASELINE;
const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7);
assert.ok(!only||/^[a-z0-9-]+$/.test(only),'invalid fixture name');
if(before)assert.ok(baseline,'--before requires a saved NET_CONTINUITY_BASELINE directory');
const Game=before?(await import(pathToFileURL(baseline+'/baseline-game.mjs'))).Game:CurrentGame;
const g=new Game({random:()=>.5,audioRandom:()=>.5}),p=g.add('local','Network continuity','T'),q=g.add('remote','Remote','CT');
g.begin();g.phase='live';g.time=10;g.endAt=1000;
let browser,page,timer,closed=false,running=false,busy=false,last=performance.now(),accumulator=0,tick=0,wireSeq=0,label=null,caseStarted=0,fault={},deliveries=[],serverRows=[],commandRows=[];
const report={scope:'Native Chrome production client / offline 60 Hz Game / controlled IPC transport delays and main-thread stalls; not physical Wi-Fi or mouse-to-photon timing.',before,errors:[],cases:[]};
function place(){for(const [player,x,z]of [[p,-21,22],[q,-18.4,20.8]])Object.assign(player,{x,z,y:supportHeight(x,z,3.3),vx:0,vy:0,vz:0,yaw:-Math.PI/2,pitch:0,crouch:false,grounded:true,velocityModifier:1,jumpFatigue:0,hp:10000});}
place();
function snapshot(){return {...g.snapshot(p.id),net:{seq:++wireSeq,emittedAtMs:performance.now(),snapshotHz:30},continuityFixture:label};}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 await mkdir('artifacts',{recursive:true});browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
 page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>report.errors.push(e.message));
 await page.exposeFunction('toGame',m=>{
  if(m.type==='join'){running=true;last=performance.now();return [{type:'joined',id:p.id},snapshot()];}
  if(m.type==='inputBatch'||m.type==='inputCritical'){
   const elapsed=performance.now()-caseStarted,dropped=m.type==='inputBatch'&&fault.uplink&&elapsed>=450&&elapsed<800;
   if(label)commandRows.push({t:elapsed,type:m.type,dropped,seqs:m.commands.map(c=>c.seq)});
   if(!dropped)g.inputBatch(p.id,m.commands);
  }else if(m.type==='input')g.input(p.id,m.input);else if(m.type==='ping')return [{type:'pong',sent:m.sent}];return [];
 });
 await page.addInitScript(()=>{
  window.continuityRows=[];window.continuityLabel=null;const raf=requestAnimationFrame.bind(window);
  window.requestAnimationFrame=cb=>raf(t=>{cb(t);if(cb.name==='frame'&&window.continuityLabel&&window.lanStrike){const s=window.lanStrike,d=s.getDiagnostics(),state=s.getState(),me=state.players.find(p=>p.id===s.getId()),remote=d.remoteModels.find(p=>p.playerId==='remote');window.continuityRows.push({label:window.continuityLabel,t,local:d.localPosition,view:d.cameraPosition,remote:remote?.position,server:{x:me.x,y:me.y,z:me.z,vx:me.vx,vy:me.vy,vz:me.vz,tick:state.serverTick,time:state.time,skipped:me.skippedInputCommands},seq:d.inputSeq,ack:d.ackInputSeq,pending:d.unackedInputs,correction:d.lastCorrection,visual:d.visualCorrection,interpolation:d.interpolation,connection:d.connection});}});
  window.WebSocket=class{static OPEN=1;constructor(){this.readyState=1;this.bufferedAmount=0;window.fixtureSocket=this;setTimeout(()=>{this.onopen?.();this.emit({type:'hello',id:'local'});},0);}emit(m){this.onmessage?.({data:JSON.stringify(m)});}send(raw){window.toGame(JSON.parse(raw)).then(ms=>ms.forEach(m=>this.emit(m)));}};
 });
 await page.route('https://continuity-audit.test/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1)||'index.html';if(name.includes('..'))return route.abort();
  let file=name.startsWith('vendor/')?new URL('../node_modules/three/build/'+name.slice(7),import.meta.url):new URL('../public/'+name,import.meta.url);
  if(before&&existsSync(baseline+'/before/public/'+name))file=baseline+'/before/public/'+name;
  try{await route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':name.endsWith('.wav')?'audio/wav':'text/html',body:await readFile(file)});}catch{await route.fulfill({status:404,body:'Missing local fixture asset'});}
 });
 timer=setInterval(async()=>{
  const now=performance.now();accumulator+=Math.min(.1,(now-last)/1000);last=now;if(closed||!running){accumulator=0;return;}
  while(accumulator>=1/60){
   const dir=q.x>-15.5?-1:q.x<-20?1:(q.input.s||1);g.input(q.id,{s:dir,yaw:0});g.step();accumulator-=1/60;tick++;
   if(label)serverRows.push({t:now-caseStarted,tick:g.serverTick,x:p.x,y:p.y,z:p.z,vx:p.vx,vy:p.vy,vz:p.vz,ack:p.ackInputSeq,applied:p.appliedInputCommands,skipped:p.skippedInputCommands});
   g.events=[];
   if(tick%2===0){const m=snapshot(),elapsed=now-caseStarted;const dropped=(fault.burst&&wireSeq%24>=10&&wireSeq%24<=12)||(fault.downlink&&elapsed>=450&&elapsed<700);if(!dropped){const delay=fault.jitter?[0,15,70,5,30][wireSeq%5]:0;deliveries.push({at:now+delay,m});}}
  }
  if(busy)return;const due=deliveries.filter(e=>e.at<=now);deliveries=deliveries.filter(e=>e.at>now);if(!due.length)return;
  busy=true;try{await page.evaluate(ms=>ms.forEach(m=>window.fixtureSocket.emit(m)),due.map(e=>e.m));}catch(e){if(!closed)report.errors.push(e.message);}finally{busy=false;}
 },1000/60);
 await page.goto('https://continuity-audit.test/?transport=websocket');await page.waitForFunction(()=>window.lanStrike);await page.click('#joinButton');await page.click('#resumeButton');await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.locked&&!d.weaponModel.loading&&d.remoteModels.length===1&&!d.remoteModels[0].loading;});await page.waitForTimeout(1200);
 for(const [name,options]of [['clean',{walk:true}],['remote-loss',{burst:true}],['remote-jitter',{jitter:true}],['downlink-outage',{downlink:true}],['uplink-outage',{walk:true,uplink:true}],['stall-150',{walk:true,stall:150}],['stall-350',{walk:true,stall:350}],['wheel-ramp-stall',{walk:true,stall:150,wheel:true}]]){
  if(only&&name!==only)continue;
  running=false;await page.keyboard.up('KeyW');while(busy)await sleep(5);deliveries=[];g.begin();g.phase='live';g.time=10;g.endAt=1000;place();fault=options;label=name;serverRows=[];commandRows=[];caseStarted=performance.now();
  if(options.wheel)Object.assign(p,slopeStart(DOWNHILL_CASES[0]));
  await page.evaluate(({m,label})=>{window.fixtureSocket.emit(m);window.continuityLabel=label;}, {m:snapshot(),label});running=true;last=performance.now();accumulator=0;
  if(options.walk)await page.keyboard.down('KeyW');
  if(options.wheel)await page.evaluate(()=>{window.wheelTimer=setInterval(()=>document.dispatchEvent(new WheelEvent('wheel',{deltaY:120,cancelable:true})),1000/30);});
  await page.waitForTimeout(400);
  if(options.stall)await page.evaluate(ms=>{window.stallAt=performance.now();const end=performance.now()+ms;while(performance.now()<end){}window.stallEnded=performance.now();},options.stall);
  await page.waitForTimeout(options.stall?650:options.walk?1100:1800);
  running=false;await page.keyboard.up('KeyW');const rows=await page.evaluate(label=>window.continuityRows.filter(r=>r.label===label),label);
  if(options.wheel)await page.evaluate(()=>clearInterval(window.wheelTimer));
  let backwards=0,maxBackwards=0,maxCorrection=0,maxPending=0,maxFrame=0,maxUp=0,remoteHolds=0,remoteFrames=0,maxRemoteJump=0;
  for(let i=1;i<rows.length;i++){
   const a=rows[i-1],b=rows[i],dt=b.t-a.t;maxFrame=Math.max(maxFrame,dt);maxCorrection=Math.max(maxCorrection,b.correction);maxPending=Math.max(maxPending,b.pending);
   if(dt>0)maxUp=Math.max(maxUp,(b.view.y-a.view.y)/(dt/1000));
   assert.equal(trace(b.view,b.view).startSolid,false,'rendered eye must remain outside BSP solids');
   const dx=b.view.x-a.view.x;if(options.walk&&dx<-.002){backwards++;maxBackwards=Math.max(maxBackwards,-dx);}
   if(!options.walk&&a.remote&&b.remote&&dt<40){const d=Math.hypot(...b.remote.map((v,j)=>v-a.remote[j]));remoteFrames++;remoteHolds+=d<.0001;maxRemoteJump=Math.max(maxRemoteJump,d);}
  }
  if(options.wheel&&!before)assert.ok(maxUp<10,'ramp wheel jump must not pop the camera after a long frame');
  report.cases.push({name,options,summary:{frames:rows.length,backwards,maxBackwards,maxCorrection,maxPending,maxFrame,maxUp,remoteHolds,remoteFrames,maxRemoteJump,serverSkipped:p.skippedInputCommands},rows,serverRows,commandRows,performance:await page.evaluate(()=>window.lanStrike.getPerformance())});
  await page.evaluate(()=>window.continuityLabel=null);
 }
 if(!before&&!only){
  const by=name=>report.cases.find(c=>c.name===name).summary;
  assert.equal(by('clean').backwards,0);assert.ok(by('clean').maxCorrection<.15,'clean movement stays coordinated');
  assert.ok(by('uplink-outage').maxBackwards<.25,'skipped input recovery must not jump backwards by a body width');
  assert.ok(by('downlink-outage').maxRemoteJump<.3,'safe remote recovery must not jump across a missing interval');
  for(const c of report.cases)for(let i=1;i<c.serverRows.length;i++)assert.ok(c.serverRows[i].applied-c.serverRows[i-1].applied<=c.serverRows[i].tick-c.serverRows[i-1].tick,'recovery cannot accelerate authoritative commands');
 }
 assert.ok(report.cases.length>0,'at least one named fixture must run');assert.deepEqual(report.errors,[]);report.status='passed';
}catch(e){report.status='failed';report.failure=e.stack;process.exitCode=1;}
finally{closed=true;clearInterval(timer);await browser?.close();await writeFile('artifacts/network-continuity-'+(before?'before':'after')+(only?'-'+only:'')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,scope:report.scope,cases:report.cases.map(c=>({name:c.name,summary:c.summary})),errors:report.errors,failure:report.failure},null,2));}
