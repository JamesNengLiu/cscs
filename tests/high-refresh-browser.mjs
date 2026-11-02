// Native pacing controls + production client/renderer with offline Game IPC.
// Test-only CPU/GPU pressure is explicitly injected, never shipped to the game.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {chromium} from 'playwright';
import {Game} from '../game.mjs';
import {supportHeight} from '../public/shared.js';
import {installUncapturedPointerLock} from './fixtures/frame-clock.mjs';
const before=process.argv.includes('--before'),baseline=process.env.FRAME_TEST_BASELINE,headed=process.env.FRAME_TEST_HEADLESS!=='1';
if(before)assert.ok(baseline,'--before requires the saved public source directory');
const tag=process.env.FRAME_TEST_TAG||(before?'before':'after');assert.match(tag,/^[a-z0-9-]+$/);
const stats=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b),at=q=>a[Math.floor((a.length-1)*q)]||0;return {samples:a.length,mean:a.length?a.reduce((s,x)=>s+x,0)/a.length:0,median:at(.5),p95:at(.95),p99:at(.99),max:a.at(-1)||0};};
const frameStats=values=>{const r=stats(values),a=values.filter(Number.isFinite).sort((a,b)=>b-a).slice(0,Math.max(1,Math.ceil(values.length*.01)));return {...r,onePercentLowFps:a.length?1000/(a.reduce((s,x)=>s+x,0)/a.length):0};};
const g=new Game({random:()=>.5}),p=g.add('local','Frame probe','T');
for(let i=0;i<9;i++)g.add('actor-'+i,'Render actor '+i,i<4?'T':'CT');g.begin();g.phase='live';g.time=10;g.endAt=1000;g.buy(p.id,'ak47');
for(const [i,a]of [...g.players.values()].entries())Object.assign(a,{x:-18.4-i%4*1.2,z:22-Math.floor(i/4)*2,y:supportHeight(-18.4-i%4*1.2,22-Math.floor(i/4)*2,3.3),yaw:0,pitch:0,hp:10000});
const report={status:'running',before,headed,scope:'Native WebGL/real rAF; offline authoritative Game and nine render actors over IPC. GPU pressure is an artificial fullscreen shader; CPU pressure is a controlled main-thread busy interval. Not physical multiplayer or mouse-to-photon certification.',errors:[],phases:[]};
let browser,page,timer,joined=false,closed=false,busy=false,last=performance.now(),remainder=0,tick=0;
try{
 await mkdir('artifacts',{recursive:true});
 browser=await chromium.launch({headless:!headed,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:[...(headed?['--window-position=0,0']:[]),'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
 page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(30000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('about:blank');await page.bringToFront();
 report.empty=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=1280;c.height=800;document.body.append(c);const ctx=c.getContext('2d'),rows=[];let previous;for(let i=0;i<160;i++){const t=await new Promise(requestAnimationFrame),start=performance.now();ctx.fillStyle=i%2?'#21313d':'#23343f';ctx.fillRect(0,0,c.width,c.height);if(i>30)rows.push({interval:t-previous,lag:start-t});previous=t;}return rows;});
 if(headed)await page.addInitScript(installUncapturedPointerLock);
 await page.addInitScript(()=>{
  localStorage.setItem('lan-strike-frame-target','120');
  window.frameProbe={phase:null,rows:[],gpu:[],resizeEvents:[],scaleEvents:[],passes:0,cpuLoad:0,stress:null,scale(surface,ratio,options){const start=performance.now(),before=surface.diagnostics().backbuffer,result=surface.setRatio(ratio,options);this.scaleEvents.push({at:start,ms:performance.now()-start,ratio,phase:this.phase,before,after:surface.diagnostics().backbuffer});return result;},resize(renderer,ratio){const start=performance.now();performance.mark('budget-resize-start');renderer.setPixelRatio(ratio);performance.mark('budget-resize-end');this.resizeEvents.push({at:start,ms:performance.now()-start,ratio,phase:this.phase});}};
  const native=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>native(t=>{const start=performance.now();cb(t);const work=performance.now()-start,a=window.frameProbe;if(cb.name==='frame'&&a.phase)a.rows.push({t,start,cpu:work,lag:start-t,ratio:Number(document.getElementById('game').dataset.renderRatio)||document.getElementById('game').width/innerWidth});});
  window.WebSocket=class{static OPEN=1;constructor(){this.readyState=1;this.bufferedAmount=0;window.frameSocket=this;setTimeout(()=>{this.onopen?.();this.emit({type:'hello',id:'local'});},0);}emit(m){this.onmessage?.({data:JSON.stringify(m)});}send(raw){window.sendFrameInput(JSON.parse(raw)).then(ms=>ms.forEach(m=>this.emit(m)));}};
 });
 await page.exposeFunction('sendFrameInput',m=>{if(m.type==='join'){joined=true;last=performance.now();return [{type:'joined',id:p.id},g.snapshot(p.id)];}if(m.type==='inputBatch'||m.type==='inputCritical')g.inputBatch(p.id,m.commands);else if(m.type==='ping')return [{type:'pong',sent:m.sent}];return [];});
 await page.route('https://frame-budget.test/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1)||'index.html';if(name.includes('..'))return route.abort();
  let file=name.startsWith('vendor/')?new URL('../node_modules/three/build/'+name.slice(7),import.meta.url):new URL('../public/'+name,import.meta.url);
  if(before&&['client.js','performance.js','gpu-timer.js','index.html'].includes(name))file=new URL(name,'file://'+baseline.replace(/\/$/,'')+'/');
  try{let body=await readFile(file);
   if(name==='client.js'){let source=body.toString();assert.ok(source.includes('gpuTimer.end(now'));source=source.replace('gpuTimer.end(now','window.frameProbe.stress?.(renderer);gpuTimer.end(now');assert.ok(source.includes('const me=player(),time=serverTime();'));source=source.replace('const me=player(),time=serverTime();','if(window.frameProbe.cpuLoad){const until=performance.now()+window.frameProbe.cpuLoad;while(performance.now()<until){}}const me=player(),time=serverTime();');source=source.replace(/renderer\.setPixelRatio\(([^)]+)\)/g,'window.frameProbe.resize(renderer,$1)').replaceAll('renderSurface.setRatio(','window.frameProbe.scale(renderSurface,');body=source;}
   if(name==='gpu-timer.js'){let source=body.toString();const anchor=/if\s*\(Number\.isFinite\(ns\)&&ns>=0\)\s*\{/;assert.ok(anchor.test(source));body=source.replace(anchor,'if(Number.isFinite(ns)&&ns>=0){window.frameProbe.gpu.push({ms:ns/1e6,at:item.at,completed:now});');}
   await route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':name.endsWith('.wav')?'audio/wav':'text/html',body});
  }catch(e){if(name.endsWith('.js'))report.errors.push(name+': '+e.message);await route.fulfill({status:404,body:'Missing test resource'});}
 });
 timer=setInterval(async()=>{const now=performance.now();remainder+=Math.min(.1,(now-last)/1000);last=now;if(!joined||closed){remainder=0;return;}let steps=0;while(remainder>=1/60){g.step();for(const a of g.players.values())if(a!==p){a.vx=3;a.grounded=true;a.gaitDistance=(a.gaitDistance||0)+3/60;}remainder-=1/60;tick++;steps++;}if(!steps||busy)return;busy=true;try{const messages=[],events=g.events.splice(0);if(events.length)messages.push({type:'events',events});if(tick%2===0)messages.push(g.snapshot(p.id));if(messages.length)await page.evaluate(ms=>ms.forEach(m=>window.frameSocket.emit(m)),messages);}catch(e){if(!closed)report.errors.push(e.message);}finally{busy=false;}},1000/60);
 await page.goto('https://frame-budget.test/?transport=websocket&camera='+(process.env.CAMERA_TEST_MODE||'baseline'));
 await page.waitForFunction(()=>window.lanStrike);await page.click('#joinButton');await page.click('#resumeButton');
 await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.locked&&!d.weaponModel.loading&&d.remoteModels.length===9&&d.remoteModels.every(x=>!x.loading);});
 await page.waitForTimeout(2000);
 await page.evaluate(async()=>{const THREE=await import('/vendor/three.module.js'),a=window.frameProbe,scene=new THREE.Scene(),camera=new THREE.Camera();const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({depthTest:false,depthWrite:false,transparent:true,vertexShader:'void main(){gl_Position=vec4(position,1.0);}',fragmentShader:'void main(){vec2 p=gl_FragCoord.xy*.001;float x=0.;for(int i=0;i<256;i++){p=fract(sin(p.yx*vec2(17.13,13.71)+float(i))*.725+vec2(.31,.17));x+=dot(p,p);}gl_FragColor=vec4(vec3(fract(x)),.01);}'}));mesh.frustumCulled=false;scene.add(mesh);a.stress=renderer=>{const clear=renderer.autoClear;renderer.autoClear=false;for(let i=0;i<a.passes;i++)renderer.render(scene,camera);renderer.autoClear=clear;};});
 const phase=async(name,ms,{passes=0,cpu=0}={})=>{
  const at=await page.evaluate(({name,passes,cpu})=>{const a=window.frameProbe;a.rows=[];a.gpu=[];a.passes=passes;a.cpuLoad=cpu;a.phase=name;return performance.now();},{name,passes,cpu});await page.waitForTimeout(ms);
  const raw=await page.evaluate(()=>{const a=window.frameProbe;a.phase=null;return {rows:a.rows,gpu:a.gpu,performance:window.lanStrike.getPerformance(),render:window.lanStrike.getRenderInfo(),resizes:a.resizeEvents,scales:a.scaleEvents};});
  const intervals=raw.rows.slice(1).map((r,i)=>r.t-raw.rows[i].t),row={name,passes,cpuLoad:cpu,frames:raw.rows.length,intervalMs:frameStats(intervals),callbackLagMs:stats(raw.rows.map(r=>Math.max(0,r.lag))),cpuMs:stats(raw.rows.map(r=>r.cpu)),gpuMs:stats(raw.gpu.filter(r=>r.at>=at).map(r=>r.ms)),ratios:[...new Set(raw.rows.map(r=>r.ratio))],settled:{intervalMs:frameStats(intervals.slice(-(raw.rows.filter(r=>r.t>=raw.rows.at(-1).t-2000).length-1))),gpuMs:stats(raw.gpu.filter(r=>r.at>=raw.rows.at(-1).t-2000&&r.at>=at).map(r=>r.ms))},final:raw.performance,render:raw.render,resizes:raw.resizes.filter(e=>e.phase===name),scales:raw.scales.filter(e=>e.phase===name),longCpuFrames:raw.rows.filter(r=>r.cpu>8).map(r=>({t:r.t,cpu:r.cpu,ratio:r.ratio,lag:r.lag}))};report.phases.push(row);console.log(name,JSON.stringify({interval:row.intervalMs.p99,cpu:row.cpuMs.p99,gpu:row.gpuMs.p95,ratios:row.ratios}));return row;
 };
 const normal=await phase('nine-actors',3000);
 await page.evaluate(()=>{const c=document.querySelector('[data-quality]');c.value='sharp';c.dispatchEvent(new Event('change'));});
 const calibration=await phase('gpu-calibration',1600,{passes:1});
 const passes=Number(process.env.FRAME_TEST_PASSES)||Math.max(1,Math.min(12,Math.round((10.5-normal.gpuMs.median)/Math.max(.1,calibration.gpuMs.median-normal.gpuMs.median))));report.pressurePasses=passes;
 await page.evaluate(()=>{const c=document.querySelector('[data-quality]');c.value='auto';c.dispatchEvent(new Event('change'));});
 const pressure=await phase('gpu-pressure',8000,{passes});
 const recovery=process.env.FRAME_TEST_RECOVERY==='1'?await phase('gpu-recovery',23000):null;
 await page.evaluate(()=>{const c=document.querySelector('[data-quality]');c.value='auto';c.dispatchEvent(new Event('change'));});
 const cpu=await phase('cpu-pressure',3000,{cpu:9});
 await phase('normal-again',2000);
 if(!before){assert.ok(pressure.gpuMs.p95>pressure.final.renderBudget.budgetMs*.9,'GPU fixture must demonstrate actual budget pressure');assert.ok(pressure.ratios.some(r=>r<normal.ratios[0]),'GPU pressure must lower resolution');assert.ok(cpu.ratios.every(r=>r===normal.ratios[0]),'CPU pressure must preserve clarity');if(pressure.final.renderSurface){assert.deepEqual(pressure.final.renderSurface.backbuffer,normal.final.renderSurface.backbuffer);for(const e of pressure.scales)assert.deepEqual(e.before,e.after,'automatic scaling must not reallocate the backbuffer');}assert.equal(cpu.final.renderBudget.classification,'cpu-pressure');if(recovery)assert.equal(recovery.final.pixelRatio,normal.ratios[0]);}
 report.emptyIntervalMs=frameStats(report.empty.map(x=>x.interval));report.emptyCallbackLagMs=stats(report.empty.map(x=>Math.max(0,x.lag)));delete report.empty;
 report.graphics=await page.evaluate(()=>{const gl=document.getElementById('game').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(e?e.UNMASKED_RENDERER_WEBGL:gl.RENDERER);});
 assert.deepEqual(report.errors,[]);assert.ok(report.phases.every(p=>p.frames>30&&p.gpuMs.samples>20),'all measured scenes need real frames and completed GPU queries');report.status='passed';
}catch(e){report.failure=e.stack;report.status='failed';process.exitCode=1;console.error(e);}
finally{closed=true;clearInterval(timer);await browser?.close();await writeFile(`artifacts/high-refresh-${tag}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,empty:report.emptyIntervalMs,errors:report.errors,failure:report.failure,pressurePasses:report.pressurePasses},null,2));}
