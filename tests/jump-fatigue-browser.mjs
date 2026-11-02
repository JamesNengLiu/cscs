// Production client, native GPU, offline authority. The command queue is gated
// to avoid manufacturing neutral commands in the fixed 30-command curve check.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {Game} from '../game.mjs';
import {flatSlowdownPose} from './fixtures/hit-slowdown-cases.mjs';
const g=new Game(),p=g.add('local','Fatigue regression','T');g.begin();g.phase='live';g.endAt=1000;
let browser,page,timer,running=false,closed=false,busy=false,previous=performance.now(),accumulator=0,legacy=false,label=null,applied=new Map(),received=new Set(),firstMove=null;
const report={scope:'Native Chrome, production client and offline Game over IPC; fixed 30-command flat landing-fatigue curve and absent-capability fallback. No live room or retail-client capture.',errors:[],cases:[]};
function state(){const s={...g.snapshot(p.id),fatigueFixture:label};if(legacy)delete s.jumpFatigueVersion;return s;}
try{
 await mkdir('artifacts',{recursive:true});browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>report.errors.push(e.message));
 await page.exposeFunction('toGame',m=>{
  if(m.type==='join')return [{type:'joined',id:p.id},state()];
  if(m.type==='inputBatch'||m.type==='inputCritical'){
   const commands=m.commands.filter(c=>c.round===g.round&&(!label||c.f===1));g.inputBatch(p.id,commands);for(const c of commands)received.add(c.seq);
   if(label&&!running&&commands.length){running=true;previous=performance.now();accumulator=0;}
  }else if(m.type==='ping')return [{type:'pong',sent:m.sent}];return [];
 });
 await page.addInitScript(()=>{
  window.fatigueAudit=[];const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{cb(t);if(cb.name==='frame'&&window.lanStrike){const s=window.lanStrike,state=s.getState(),d=s.getDiagnostics();if(state?.fatigueFixture)window.fatigueAudit.push({label:state.fatigueFixture,t,seq:d.inputSeq,position:d.localPosition,correction:d.lastCorrection,version:state.players.find(p=>p.id===s.getId())?.jumpFatigueVersion});}});
  window.WebSocket=class{static OPEN=1;constructor(){this.readyState=1;this.bufferedAmount=0;window.fixtureSocket=this;setTimeout(()=>{this.onopen?.();this.emit({type:'hello',id:'local'});},0);}emit(m){this.onmessage?.({data:JSON.stringify(m)});}send(raw){window.toGame(JSON.parse(raw)).then(ms=>ms.forEach(m=>this.emit(m)));}};
 });
 await page.route('https://fatigue-audit.test/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1)||'index.html';if(name.includes('..'))return route.abort();const file=name.startsWith('vendor/')?new URL('../node_modules/three/build/'+name.slice(7),import.meta.url):new URL('../public/'+name,import.meta.url);
  try{await route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':name.endsWith('.wav')?'audio/wav':'text/html',body:await readFile(file)});}catch{await route.fulfill({status:404,body:'Missing local fixture asset'});}
 });
 timer=setInterval(async()=>{
  const now=performance.now();accumulator+=Math.min(.1,(now-previous)/1000);previous=now;if(closed||!running){accumulator=0;return;}let steps=0;
  while(accumulator>=1/60&&received.has((p.ackInputSeq||0)+1)){
   const seq=(p.ackInputSeq||0)+1;g.step();accumulator-=1/60;received.delete(seq);steps++;
   if(p.ackInputSeq&&!applied.has(p.ackInputSeq)){const sample={x:p.x,y:p.y,z:p.z,vx:p.vx,vz:p.vz,fatigue:p.jumpFatigue};applied.set(p.ackInputSeq,sample);firstMove??={seq:p.ackInputSeq,...sample};}
  }
  g.events=[];if(!steps||busy)return;busy=true;try{await page.evaluate(s=>window.fixtureSocket.emit(s),state());}catch(e){if(!closed)report.errors.push(e.message);}finally{busy=false;}
 },1000/60);
 await page.goto('https://fatigue-audit.test/?transport=websocket');await page.waitForFunction(()=>window.lanStrike);await page.click('#joinButton');await page.click('#resumeButton');await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.locked&&!d.weaponModel.loading;});await page.waitForTimeout(1000);
 for(const mode of ['new-fatigue','old-server']){
  running=false;while(busy)await new Promise(r=>setTimeout(r,5));g.begin();g.phase='live';g.time=10;g.endAt=1000;legacy=mode==='old-server';label=mode;applied=new Map();received=new Set();firstMove=null;
  Object.assign(p,flatSlowdownPose({id:'local',x:-21,vx:6.25,jumpFatigue:650,yaw:-Math.PI/2}));if(legacy)p.jumpFatigueVersion=0;else delete p.jumpFatigueVersion;g.events=[];
  await page.evaluate(s=>{window.fixtureSocket.emit(s);document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',key:'w',bubbles:true}));},state());
  const deadline=performance.now()+5000;while(!applied.has(30)&&performance.now()<deadline)await page.waitForTimeout(20);assert.ok(applied.has(30),'thirty forward commands applied');await page.waitForTimeout(100);
  const rows=await page.evaluate(label=>window.fatigueAudit.filter(r=>r.label===label),label),first=rows.find(r=>r.seq>0),authoritative=applied.get(first.seq);assert.ok(authoritative);
  for(const k of ['x','y','z'])assert.ok(Math.abs(first.position[k]-authoritative[k])<1e-8,`${mode} first predicted ${k}`);assert.equal(first.version,legacy?0:1);
  const half=applied.get(30),distance=(half.x+21)*40;assert.ok(Math.abs(distance-(legacy?115.94355709876581:62.21969137138089))<1e-7);assert.ok(Math.abs(half.vx*40-(legacy?242.875:147.6947760504546))<1e-7);
  const maxCorrection=Math.max(...rows.map(r=>r.correction));assert.ok(maxCorrection<.15,`${mode}: prediction divergence ${maxCorrection}`);report.cases.push({mode,firstMove,firstPredicted:first.position,firstAuthoritative:authoritative,halfSecond:{distanceUnits:distance,speedUnits:half.vx*40,fatigue:half.fatigue},maxCorrection,performance:await page.evaluate(()=>window.lanStrike.getPerformance())});
  running=false;await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',key:'w',bubbles:true})));
 }
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(e){report.status='failed';report.failure=e.stack;process.exitCode=1;}
finally{closed=true;clearInterval(timer);await browser?.close();await writeFile('artifacts/jump-fatigue-browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
