// Production client + offline authoritative Game via IPC. No listening service
// or live-room connection. Checks both the new rule and older-server fallback.
import assert from 'node:assert/strict';import {chromium} from 'playwright';import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {Game} from '../game.mjs';import {flatSlowdownPose} from './fixtures/hit-slowdown-cases.mjs';
const g=new Game({random:()=>.5,audioRandom:()=>.5}),p=g.add('local','Tagging regression','T'),a=g.add('attacker','Attacker','CT');g.begin();g.phase='live';g.endAt=1000;
let browser,page,timer,joined=false,running=false,primed=false,legacy=false,closed=false,busy=false,previous=performance.now(),accumulator=0,tick=0,wireSeq=0,label=null,applied=new Map(),takeoff=null;
const report={scope:'Isolated native Chrome production client, real pointer lock and synthetic jump key, offline Game over IPC. Full-command tagging and legacy server fallback; not physical network timing.',errors:[],cases:[]};
function state(){const m={...g.snapshot(p.id),fixtureCase:label,net:{seq:++wireSeq,emittedAtMs:performance.now(),snapshotHz:30}};if(legacy)delete m.hitSlowdownVersion;return m;}
try{
 await mkdir('artifacts',{recursive:true});browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>report.errors.push(e.message));
 await page.exposeFunction('toGame',m=>{
  if(m.type==='join'){joined=true;return [{type:'joined',id:p.id},state()];}
  if(m.type==='inputBatch'||m.type==='inputCritical'){
   if(!primed||m.commands.some(c=>c.round===g.round&&c.jump))g.inputBatch(p.id,m.commands);
   if(primed&&m.commands.some(c=>c.round===g.round&&c.jump)){primed=false;running=true;previous=performance.now();accumulator=0;}
  }else if(m.type==='input')g.input(p.id,m.input);else if(m.type==='ping')return[{type:'pong',sent:m.sent}];return[];
 });
 await page.addInitScript(()=>{
  window.audit={rows:[]};const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{cb(t);if(cb.name==='frame'&&window.lanStrike){const s=window.lanStrike,d=s.getDiagnostics(),state=s.getState();if(state?.fixtureCase)window.audit.rows.push({t,label:state.fixtureCase,seq:d.inputSeq,position:d.localPosition,correction:d.lastCorrection,ack:d.ackInputSeq,pending:d.unackedInputs,version:state.players.find(p=>p.id===s.getId())?.hitSlowdownVersion});}});
  window.WebSocket=class{static OPEN=1;constructor(){this.readyState=1;this.bufferedAmount=0;window.fixtureSocket=this;setTimeout(()=>{this.onopen?.();this.emit({type:'hello',id:'local'});},0);}emit(m){this.onmessage?.({data:JSON.stringify(m)});}send(raw){window.toGame(JSON.parse(raw)).then(ms=>ms.forEach(m=>this.emit(m)));}};
 });
 await page.route('https://hit-slowdown.test/**',async route=>{const name=new URL(route.request().url()).pathname.slice(1)||'index.html';if(name.includes('..'))return route.abort();const file=name.startsWith('vendor/')?new URL('../node_modules/three/build/'+name.slice(7),import.meta.url):new URL('../public/'+name,import.meta.url);try{await route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':name.endsWith('.wav')?'audio/wav':'text/html',body:await readFile(file)});}catch{await route.fulfill({status:404,body:'Missing local asset'});}});
 timer=setInterval(async()=>{const now=performance.now();accumulator+=Math.min(.1,(now-previous)/1000);previous=now;if(!joined||closed||!running){accumulator=0;return;}let steps=0;while(accumulator>=1/60){const grounded=p.grounded;g.step();accumulator-=1/60;tick++;steps++;if(p.ackInputSeq&&!applied.has(p.ackInputSeq))applied.set(p.ackInputSeq,{x:p.x,y:p.y,z:p.z});if(grounded&&!p.grounded&&!takeoff)takeoff={seq:p.ackInputSeq,vx:p.vx,vz:p.vz,modifier:p.velocityModifier};}g.events=[];if(!steps||tick%2||busy)return;busy=true;try{await page.evaluate(m=>window.fixtureSocket.emit(m),state());}catch(e){if(!closed)report.errors.push(e.message);}finally{busy=false;}},1000/60);
 await page.goto('https://hit-slowdown.test/?transport=websocket');await page.waitForFunction(()=>window.lanStrike);await page.click('#joinButton');await page.click('#resumeButton');await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.locked&&!d.weaponModel.loading&&d.remoteModels.every(p=>!p.loading);});await page.waitForTimeout(1200);
 for(const mode of ['new-rule','old-server']){
  running=false;primed=false;while(busy)await new Promise(r=>setTimeout(r,5));g.begin();g.phase='live';g.time=10;g.endAt=1000;legacy=mode==='old-server';label=mode;applied=new Map();takeoff=null;
  Object.assign(p,flatSlowdownPose({id:'local',vx:0,vz:-6.25,hp:1000}));if(legacy)p.hitSlowdownVersion=0;else delete p.hitSlowdownVersion;Object.assign(a,flatSlowdownPose({id:'attacker',x:-22,hp:1000}));g.damage(p,1,a,{kind:'usp',hitgroup:'chest'});g.events=[];primed=true;
  await page.evaluate(m=>{window.fixtureSocket.emit(m);document.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true}));},state());
  await page.waitForFunction(label=>window.audit.rows.some(r=>r.label===label&&r.seq>0),label);await page.waitForTimeout(120);await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keyup',{code:'Space',key:' ',bubbles:true})));await page.waitForTimeout(800);
  const rows=await page.evaluate(label=>window.audit.rows.filter(r=>r.label===label),label),first=rows.find(r=>r.seq>0),expected=applied.get(first.seq);assert.ok(expected,'server applied the predicted first frame sequence');
  for(const k of ['x','y','z'])assert.ok(Math.abs(first.position[k]-expected[k])<1e-8,k+' first-frame prediction');assert.ok(takeoff);assert.equal(takeoff.seq,1);assert.ok(Math.abs(takeoff.modifier-(legacy?.5:.51))<1e-10);assert.ok(Math.abs(takeoff.vz-(-6.25*(legacy?1:.51)))<1e-10);assert.equal(first.version,legacy?0:1);
  const maxCorrection=Math.max(...rows.map(r=>r.correction));assert.ok(maxCorrection<.15,'tagged jump stays coordinated');report.cases.push({mode,takeoff,firstPredicted:first.position,firstAuthoritative:expected,maxCorrection,performance:await page.evaluate(()=>window.lanStrike.getPerformance())});
 }
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(e){report.status='failed';report.failure=e.stack;process.exitCode=1;}
finally{closed=true;clearInterval(timer);await browser?.close();await writeFile('artifacts/hit-slowdown-browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
