// Native-GPU production client + authoritative offline Game over IPC. No live room.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {chromium} from 'playwright';
import * as THREE from 'three';
import {Game} from '../game.mjs';
import {GUNS} from '../public/arsenal.js';
import {supportHeight,eyeHeight,direction} from '../public/shared.js';
import {playerHitboxes} from '../hitboxes.mjs';
const before=process.argv.includes('--before'),visualOnly=process.argv.includes('--visual-only'),tag=visualOnly?'visual':before?'before':'after';
const g=new Game({random:()=>.5,audioRandom:()=>.5}),p=g.add('local','P2 Shooter','T'),q=g.add('target','P2 Target','CT');g.begin();g.time=10;
let page,browser,timer,joined=false,closed=false,busy=false,previous=performance.now(),accumulator=0,tick=0;
const report={status:'running',scope:'Native-GPU Chrome 1280x800, actual client/local assets, two offline Game actors. Cold/warm presentation measurement; no physical multiplayer or retail-client timing claim.',errors:[],missing:[],cases:[]};
function grant(weapon){const w=GUNS[weapon];p.inventory[weapon]={ammo:w.clip,silenced:false,burstMode:false};p.ammoPool[w.ammoType]=w.reserve;if(w.slot===1)p.primary=weapon;else p.pistol=weapon;g.activate(p,weapon);p.nextAttackAt=0;}
function place(){for(const [a,z]of [[p,22],[q,18]])Object.assign(a,{x:-18.4,z,y:supportHeight(-18.4,z,3.3),vx:0,vy:0,vz:0,yaw:0,pitch:0,grounded:true,hp:10000,armour:0,helmet:false,flinchAt:-100,gaitDistance:0,airTime:0});q.input={f:0,s:0,yaw:0,pitch:0,fire:false};g.phase='live';g.endAt=g.time+1000;}
place();grant('ak47');p.yaw=.4;
const summary=a=>{const s=a.filter(Number.isFinite).sort((x,y)=>x-y);return {samples:s.length,mean:s.length?s.reduce((x,y)=>x+y,0)/s.length:0,p99:s[Math.max(0,Math.ceil(s.length*.99)-1)]||0,max:s.at(-1)||0};};
try{
 await mkdir('artifacts',{recursive:true});browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
 page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.missing.push(r.url());});
 await page.exposeFunction('sendP2',m=>{if(m.type==='join'){joined=true;previous=performance.now();return[{type:'joined',id:p.id},g.snapshot(p.id)];}if(['inputBatch','inputCritical'].includes(m.type))g.inputBatch(p.id,m.commands);else if(m.type==='input')g.input(p.id,m.input);else if(m.type==='equip')g.equip(p.id,m.weapon);else if(m.type==='ping')return[{type:'pong',sent:m.sent}];return[];});
 await page.addInitScript(()=>{
  window.p2={stage:null,rows:[],gpu:[],events:[],longTasks:[],muzzles:{},captureMuzzle:null};
  const raf=requestAnimationFrame.bind(window);let last;
  window.requestAnimationFrame=cb=>raf(t=>{const start=performance.now();cb(t);if(cb.name==='frame'){if(window.p2.stage)window.p2.rows.push({stage:window.p2.stage,t,interval:last===undefined?null:t-last,cpu:performance.now()-start,model:window.lanStrike?.getDiagnostics().weaponModel.id});if(window.p2.captureMuzzle&&window.lanStrike?.getDiagnostics().weaponModel.muzzleVisible){window.p2.muzzles[window.p2.captureMuzzle]=document.querySelector('#game').toDataURL('image/png');window.p2.captureMuzzle=null;}last=t;}});
  const queries=new WeakMap(),proto=WebGL2RenderingContext.prototype,begin=proto.beginQuery,get=proto.getQueryParameter;
  proto.beginQuery=function(target,query){if(target===0x88bf)queries.set(query,window.p2.stage);return begin.call(this,target,query);};
  proto.getQueryParameter=function(query,name){const value=get.call(this,query,name);if(name===0x8866&&queries.has(query)){const stage=queries.get(query);if(stage&&typeof value==='number')window.p2.gpu.push({stage,ms:value/1e6});queries.delete(query);}return value;};
  if(PerformanceObserver.supportedEntryTypes?.includes('longtask'))new PerformanceObserver(list=>window.p2.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
  window.WebSocket=class{static OPEN=1;constructor(){this.readyState=1;this.bufferedAmount=0;window.p2socket=this;setTimeout(()=>{this.onopen?.();this.emit({type:'hello',id:'local'});},0);}emit(m){if(m.type==='events')window.p2.events.push(...m.events);this.onmessage?.({data:JSON.stringify(m)});}send(raw){window.sendP2(JSON.parse(raw)).then(ms=>ms.forEach(m=>this.emit(m)));}};
 });
 await page.route('https://p2.test/**',async route=>{const path=new URL(route.request().url()).pathname,name=path==='/'?'index.html':path.slice(1);if(name.includes('..'))return route.abort();const file=name.startsWith('vendor/')?new URL('../node_modules/three/build/'+name.slice(7),import.meta.url):new URL('../public/'+name,import.meta.url);try{await route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':name.endsWith('.wav')?'audio/wav':'text/html',body:await readFile(file)});}catch{await route.fulfill({status:404,body:'Local fixture asset unavailable'});}});
 timer=setInterval(async()=>{const now=performance.now();accumulator+=Math.min(.1,(now-previous)/1000);previous=now;if(!joined||closed){accumulator=0;return;}let steps=0;while(accumulator>=1/60){g.step();accumulator-=1/60;tick++;steps++;}if(!steps||busy)return;busy=true;try{const ms=[],events=g.events.splice(0);if(events.length)ms.push({type:'events',events});if(tick%2===0)ms.push(g.snapshot(p.id));if(ms.length)await page.evaluate(ms=>ms.forEach(m=>window.p2socket.emit(m)),ms);}catch(e){if(!closed)report.errors.push(e.message);}finally{busy=false;}},1000/60);
 await page.goto('https://p2.test/?transport=websocket');await page.waitForFunction(()=>window.lanStrike);await page.click('#joinButton');await page.click('#resumeButton');await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.locked&&d.weaponModel.id==='ak47'&&!d.weaponModel.loading&&d.remoteModels.every(m=>!m.loading);});await page.waitForTimeout(700);
 const stage=async(label,action)=>{const start=await page.evaluate(label=>{window.p2.stage=label;return performance.now();},label);await action();await page.waitForTimeout(350);const end=await page.evaluate(()=>{window.p2.stage=null;return performance.now();});const data=await page.evaluate(label=>({frames:window.p2.rows.filter(r=>r.stage===label),gpu:window.p2.gpu.filter(r=>r.stage===label).map(r=>r.ms),diagnostics:window.lanStrike.getDiagnostics()}),label);report.cases.push({label,elapsedMs:end-start,frames:summary(data.frames.map(x=>x.interval)),cpu:summary(data.frames.map(x=>x.cpu)),gpu:summary(data.gpu),model:data.diagnostics.weaponModel,hit:data.diagnostics.playerHitEffects,warmup:data.diagnostics.presentationWarmup});return data;};
 const setup=async(weapon,group='chest',effect='blood',silenced=false)=>{joined=false;while(busy)await new Promise(r=>setTimeout(r,2));g.begin();place();grant(weapon);p.silenced=silenced;p.inventory[weapon].silenced=silenced;q.armour=effect==='blood'?0:100;q.helmet=effect==='helmet';
  const box=playerHitboxes(q,g.time).find(b=>b.group===group),target=new THREE.Vector3(...box.min.map((x,i)=>(x+box.max[i])/2)).applyMatrix4(new THREE.Matrix4().fromArray(box.inverse).invert());const dx=target.x-p.x,dz=target.z-p.z;p.yaw=Math.atan2(-dx,-dz);p.pitch=Math.atan2(target.y+(group==='head'?.05:0)-p.y-eyeHeight(p),Math.hypot(dx,dz));assert.equal(g.targetRay(p,direction(p.yaw,p.pitch),200).target?.id,q.id);
  g.events=[];await page.evaluate(s=>window.p2socket.emit(s),g.snapshot(p.id));joined=true;previous=performance.now();await page.waitForFunction(w=>{const d=window.lanStrike.getDiagnostics();return d.weapon===w&&d.weaponModel.id===w&&!d.weaponModel.loading;},weapon);await page.waitForTimeout(100);
 };
 const shoot=async()=>{const count=p.shotsFired;await page.mouse.down();await page.mouse.up();await page.waitForFunction(n=>{const s=window.lanStrike;return s.getState().players.find(p=>p.id===s.getId()).shotsFired>n;},count);};
 if(!visualOnly){
 await stage('first-wall-shot',shoot);await page.waitForTimeout(850);await stage('warm-wall-shot',shoot);
 await setup('ak47');await stage('first-body-hit',shoot);await page.waitForTimeout(700);await stage('warm-body-hit',shoot);
 for(const weapon of ['m4a1','mp5navy','p90','awp']){await stage('first-switch-'+weapon,async()=>{await setup(weapon);});await stage('first-hit-'+weapon,shoot);}
 await setup('ak47','head');await stage('head-hit-ak47',shoot);await setup('ak47','head','helmet');await stage('helmet-hit',shoot);await setup('ak47','chest','armour');await stage('armour-hit',shoot);
 }
 if(!before){
  if(!visualOnly){
  const cases=Object.fromEntries(report.cases.map(c=>[c.label,c]));
  for(const [label,count]of [['first-body-hit',12],['first-hit-mp5navy',8],['first-hit-awp',18],['head-hit-ak47',16],['helmet-hit',14],['armour-hit',8]])assert.equal(cases[label].hit.lastProfile.count,count,label);
  for(const c of report.cases){assert.equal(c.warmup.errors,0);assert.ok(c.model.cachedModels<=4);assert.ok(c.warmup.queued<=c.warmup.capacity);}
  }
  for(const [weapon,group,effect]of [['ak47','chest','blood'],['awp','chest','blood'],['ak47','head','blood'],['ak47','head','helmet'],['ak47','chest','armour']]){
   await setup(weapon,group,effect);await shoot();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));await page.screenshot({path:`artifacts/p2-hit-${weapon}-${group}-${effect}.png`});
  }
  const capture=async label=>{await page.evaluate(label=>window.p2.captureMuzzle=label,label);await shoot();await page.waitForFunction(label=>!!window.p2.muzzles[label],label);const data=await page.evaluate(label=>window.p2.muzzles[label],label);await writeFile(`artifacts/p2-muzzle-game-${label}.png`,Buffer.from(data.split(',')[1],'base64'));};
  for(const [weapon,silenced]of [['ak47',false],['mp5navy',false],['awp',false],['m4a1',true]]){await setup(weapon,'chest','blood',silenced);await capture(weapon+(silenced?'-suppressed':''));}
  await page.keyboard.press('Escape');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().gameMenuOpen);await page.selectOption('#weaponHand','left');await page.click('#resumeButton');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().locked);await capture('left-suppressed');assert.equal(await page.evaluate(()=>window.lanStrike.getDiagnostics().weaponHand),'left');
  const gallery=await browser.newPage({viewport:{width:1100,height:550}});await gallery.route('https://gallery.test/**',async route=>{const name=new URL(route.request().url()).pathname.slice(1);if(!name)return route.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0;background:#101d25;color:#e8e7dc;font:14px sans-serif"><div id="labels" style="position:absolute;inset:0;pointer-events:none"></div></body>'});try{await route.fulfill({contentType:'text/javascript',body:await readFile(name.startsWith('vendor/')?new URL('../node_modules/three/build/'+name.slice(7),import.meta.url):new URL('../public/'+name,import.meta.url))});}catch{await route.abort();}});
  await gallery.goto('https://gallery.test/');await gallery.evaluate(async()=>{
   const THREE=await import('/vendor/three.module.js'),{createMuzzleFlash}=await import('/muzzle-flash.js'),renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1100,550);renderer.setPixelRatio(1);document.body.append(renderer.domElement);
   const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1.5,1.5,.75,-.75,.01,10);camera.position.z=3;
   const entries=[['AK-47',{weapon:'ak47'}],['M4A1',{weapon:'m4a1'}],['M4A1 / 消音',{weapon:'m4a1',silenced:true}],['MP5',{weapon:'mp5navy'}],['AWP',{weapon:'awp'}],['USP / 消音',{weapon:'usp',silenced:true}]];
   for(let i=0;i<entries.length;i++){const [label,state]=entries[i],flash=createMuzzleFlash(THREE);flash.update({...state,weaponShotToken:String(i),weaponShotAt:1},1);flash.mesh.visible=true;flash.mesh.position.set((i%3-1)*.95,i<3?.36:-.36,0);flash.mesh.scale.multiplyScalar(3.6);scene.add(flash.mesh);const text=document.createElement('div');text.textContent=label;text.style.cssText=`position:absolute;left:${(i%3)*33.3}%;top:${i<3?42:91}%;width:33%;text-align:center`;document.querySelector('#labels').append(text);}
   renderer.render(scene,camera);window.galleryCalls=renderer.info.render.calls;
  });assert.equal(await gallery.evaluate(()=>window.galleryCalls),6);await gallery.screenshot({path:'artifacts/p2-muzzle-flashes.png'});await gallery.close();
 }
 report.graphics=await page.evaluate(()=>{const gl=document.querySelector('#game').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(e?e.UNMASKED_RENDERER_WEBGL:gl.RENDERER);});report.raw=await page.evaluate(()=>{const {muzzles,...rest}=window.p2;return rest;});
 assert.ok(report.raw.events.some(e=>e.hitImpact?.effect==='blood'));assert.ok(report.raw.events.some(e=>e.hitImpact?.effect==='helmet'));assert.ok(report.raw.events.some(e=>e.hitImpact?.effect==='armour'));assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);report.status='passed';
}catch(e){report.status='failed';report.failure=e.stack;console.error(e);process.exitCode=1;}
finally{closed=true;clearInterval(timer);await browser?.close();await writeFile(`artifacts/p2-presentation-${tag}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,graphics:report.graphics,cases:report.cases.map(c=>({label:c.label,elapsedMs:c.elapsedMs,frames:c.frames,cpu:c.cpu,gpu:c.gpu})),errors:report.errors,failure:report.failure},null,2));}
