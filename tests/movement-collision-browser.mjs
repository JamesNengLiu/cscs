// Isolated production client with offline authority. The first command crosses
// the real CT crate rim; absent capability simulates an unchanged old server.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {Game} from '../game.mjs';
import {flatSlowdownPose} from './fixtures/hit-slowdown-cases.mjs';

const g=new Game(),p=g.add('local','Collision regression','CT');g.begin();g.phase='live';g.endAt=1000;
let browser,page,timer,running=false,closed=false,busy=false,previous=performance.now(),accumulator=0,legacy=false,label=null,applied=new Map(),firstMove=null;
const report={scope:'Native Chrome / production client / offline authoritative Game over IPC; real Dust2 BSP CT crate rim, modern and absent-capability prediction. No live service or physical multiplayer.',errors:[],cases:[]};
function state(){const s={...g.snapshot(p.id),collisionFixture:label};if(legacy)delete s.collisionVersion;return s;}
try{
 await mkdir('artifacts',{recursive:true});
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
 page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>report.errors.push(e.message));
 await page.exposeFunction('toGame',m=>{
  if(m.type==='join')return [{type:'joined',id:p.id},state()];
  if(m.type==='inputBatch'||m.type==='inputCritical'){
   g.inputBatch(p.id,m.commands);
   if(label&&!running&&m.commands.some(c=>c.round===g.round)){running=true;previous=performance.now();accumulator=0;}
  }else if(m.type==='ping')return [{type:'pong',sent:m.sent}];return [];
 });
 await page.addInitScript(()=>{
  window.collisionAudit=[];const raf=requestAnimationFrame.bind(window);
  window.requestAnimationFrame=cb=>raf(t=>{cb(t);if(cb.name==='frame'&&window.lanStrike){const s=window.lanStrike,state=s.getState(),d=s.getDiagnostics();if(state?.collisionFixture)window.collisionAudit.push({label:state.collisionFixture,t,seq:d.inputSeq,position:d.localPosition,correction:d.lastCorrection,version:state.players.find(p=>p.id===s.getId())?.collisionVersion});}});
  window.WebSocket=class{static OPEN=1;constructor(){this.readyState=1;this.bufferedAmount=0;window.fixtureSocket=this;setTimeout(()=>{this.onopen?.();this.emit({type:'hello',id:'local'});},0);}emit(m){this.onmessage?.({data:JSON.stringify(m)});}send(raw){window.toGame(JSON.parse(raw)).then(ms=>ms.forEach(m=>this.emit(m)));}};
 });
 await page.route('https://collision-audit.test/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1)||'index.html';if(name.includes('..'))return route.abort();
  const file=name.startsWith('vendor/')?new URL('../node_modules/three/build/'+name.slice(7),import.meta.url):new URL('../public/'+name,import.meta.url);
  try{await route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':name.endsWith('.wav')?'audio/wav':'text/html',body:await readFile(file)});}catch{await route.fulfill({status:404,body:'Missing local fixture asset'});}
 });
 timer=setInterval(async()=>{
  const now=performance.now();accumulator+=Math.min(.1,(now-previous)/1000);previous=now;if(closed||!running){accumulator=0;return;}
  let steps=0;while(accumulator>=1/60){g.step();accumulator-=1/60;steps++;if(p.ackInputSeq&&!applied.has(p.ackInputSeq))applied.set(p.ackInputSeq,{x:p.x,y:p.y,z:p.z});if(p.ackInputSeq&&!firstMove)firstMove={seq:p.ackInputSeq,x:p.x,y:p.y,z:p.z,vx:p.vx,vy:p.vy};}
  g.events=[];if(!steps||busy)return;busy=true;try{await page.evaluate(s=>window.fixtureSocket.emit(s),state());}catch(e){if(!closed)report.errors.push(e.message);}finally{busy=false;}
 },1000/60);
 await page.goto('https://collision-audit.test/?transport=websocket');await page.waitForFunction(()=>window.lanStrike);await page.click('#joinButton');await page.click('#resumeButton');await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.locked&&!d.weaponModel.loading;});await page.waitForTimeout(1000);
 for(const mode of ['new-collision','old-server']){
  running=false;while(busy)await new Promise(r=>setTimeout(r,5));g.begin();g.phase='live';g.time=10;g.endAt=1000;legacy=mode==='old-server';label=mode;applied=new Map();firstMove=null;
  Object.assign(p,flatSlowdownPose({id:'local',x:18.85,y:-.005,z:-58.8,vx:-6.25,vy:6,grounded:false,yaw:Math.PI/2}));if(legacy)p.collisionVersion=0;else delete p.collisionVersion;g.events=[];
  await page.evaluate(s=>window.fixtureSocket.emit(s),state());await page.waitForFunction(label=>window.collisionAudit.some(r=>r.label===label&&r.seq>0),label);await page.waitForTimeout(800);
  const rows=await page.evaluate(label=>window.collisionAudit.filter(r=>r.label===label),label),first=rows.find(r=>r.seq>0),authoritative=applied.get(first.seq);assert.ok(authoritative);
  for(const k of ['x','y','z'])assert.ok(Math.abs(first.position[k]-authoritative[k])<1e-8,`${mode} first predicted ${k}`);
  assert.equal(first.version,legacy?0:1);assert.equal(firstMove.seq,1);assert.equal(firstMove.vx,legacy?0:-6.25);
  const maxCorrection=Math.max(...rows.map(r=>r.correction));assert.ok(maxCorrection<.15,`${mode}: prediction divergence ${maxCorrection}`);
  report.cases.push({mode,firstMove,firstPredicted:first.position,firstAuthoritative:authoritative,maxCorrection,performance:await page.evaluate(()=>window.lanStrike.getPerformance())});
 }
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(e){report.status='failed';report.failure=e.stack;process.exitCode=1;}
finally{closed=true;clearInterval(timer);await browser?.close();await writeFile('artifacts/movement-collision-browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
