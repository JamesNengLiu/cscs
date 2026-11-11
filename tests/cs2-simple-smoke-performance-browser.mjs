// Complete-map hardware A/B/A. Only the smoke-renderer module is replaced.
// --prepare performs syntax checks only; --run owns one loopback server and
// one fresh Chrome. No connection to or restart of persistent port 3001.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {chromium} from 'playwright';
import {createExperimentalServer} from '../cs2-server.mjs';
import {createSmokeVolume} from '../public/cs2-smoke-field.js';
import {direction} from '../public/math.js';
import {instrumentCS2FrameBody} from './fixtures/cs2-frame-observer.mjs';

const args=new Set(process.argv.slice(2));
const option=(name,fallback)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
const seconds=Number(option('seconds','5')),warmupMs=Number(option('warmup-ms','1000'));
assert.ok(Number.isFinite(seconds)&&seconds>=2&&seconds<=30);assert.ok(Number.isFinite(warmupMs)&&warmupMs>=0&&warmupMs<=10000);
const allCases=[{name:'none',count:0},{name:'single',count:1},{name:'four-overlap',count:4},{name:'inside',count:1,inside:true},{name:'thirty-two-overlap',count:32}];
const cases=option('cases',allCases.map(c=>c.name).join(',')).split(',').map(name=>{const c=allCases.find(c=>c.name===name);assert.ok(c,'Unknown case '+name);return c;});
const baselineCommit='53b2a7bf1d293f91e6a19ee304994dda1c43e9f4';
const output=path.resolve(option('output','.local/cs2/simple-smoke-2026-11-08/performance.json')),artifactRoot=path.dirname(output),sha=b=>createHash('sha256').update(b).digest('hex');
const source=await readFile('public/cs2-client.js','utf8'),nextSmoke=await readFile('public/cs2-smoke-renderer.js','utf8'),oldSmoke=execFileSync('git',['show',baselineCommit+':public/cs2-smoke-renderer.js'],{encoding:'utf8'});
const gpuMarker='onSample:sample=>{if(sample.tag?.active',attachMarker='const smokeRenderer=createSmokeRenderer(THREE,{renderer,scene,camera});';
assert.equal(source.split(gpuMarker).length,2);assert.equal(source.split(attachMarker).length,2);
const injected=instrumentCS2FrameBody(source.replace(gpuMarker,'onSample:sample=>{window.__simpleSmokePerf.gpu(sample);if(sample.tag?.active').replace(attachMarker,attachMarker+'window.__simpleSmokePerf.refs={renderer,smokeRenderer,camera,scene};'),{before:'window.__simpleSmokePerf.beforeFrame(now)',after:'window.__simpleSmokePerf.afterFrame(__cs2ObservedFrame,now);'});
execFileSync(process.execPath,['--check','--input-type=module'],{input:injected});
for(const body of [oldSmoke,nextSmoke])execFileSync(process.execPath,['--check','--input-type=module'],{input:body});
if(!args.has('--run')||args.has('--prepare')){console.log(JSON.stringify({status:'prepared-not-run',baselineCommit,seconds,warmupMs,cases,viewport:{width:1920,height:1080,dpr:1,quality:'sharp'},output,injectedSyntaxChecked:true}));process.exit(0);}
assert.notEqual(sha(nextSmoke),sha(oldSmoke),'New renderer is still identical to the raymarch baseline');

const sourceFiles=['public/cs2-client.js','public/cs2-smoke-renderer.js','public/cs2-smoke-field.js','public/cs2-effects.js','public/cs2-native-viewmodel.js','cs2-game.mjs','cs2-grenades.mjs','tests/cs2-simple-smoke-performance-browser.mjs','tests/fixtures/cs2-frame-observer.mjs'];
const fingerprints=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,sha(await readFile(file))])));
const report={status:'running',startedAt:new Date().toISOString(),scope:'One actual Chrome hardware renderer on the complete native map, identical scripted view and fields. A/B/A changes only the smoke renderer; no physical LAN, panel refresh, hardware mouse latency or multi-device FPS certification.',baselineCommit,oldSmokeSHA256:sha(oldSmoke),newSmokeSHA256:sha(nextSmoke),clientSHA256:sha(source),injectedClientSHA256:sha(injected),seconds,warmupMs,cases,viewport:{width:1920,height:1080,dpr:1,quality:'sharp'},sourceHashesBefore:await fingerprints(),phases:[],errors:[],requests:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function stats(values){const a=values.filter(Number.isFinite).sort((a,b)=>a-b),at=p=>a.length?a[Math.ceil((a.length-1)*p)]:null;return{samples:a.length,min:a[0]??null,p50:at(.5),p95:at(.95),p99:at(.99),max:a.at(-1)??null,mean:a.length?a.reduce((s,v)=>s+v,0)/a.length:null};}
function installCapture(){
 const c={refs:null,active:null,start(){this.active={at:performance.now(),frames:[],gpu:[],longTasks:[]};},stop(){const s=this.active;this.active=null;return{...s,durationMs:performance.now()-s.at};},gpu(s){if(this.active&&s.submittedAt>=this.active.at)this.active.gpu.push({ms:s.ms,submittedAt:s.submittedAt,completedAt:s.completedAt,serial:s.serial});},beforeFrame(){return this.active?{sample:this.active,start:performance.now()}:null;},afterFrame(mark,stamp){if(!mark)return;const {sample,start}=mark,end=performance.now();sample.frames.push({start,end,rafAt:stamp,cpuMs:end-start,render:window.lanStrike?.getRenderInfo(),programs:this.refs?.renderer.info.programs.length,visibility:document.visibilityState,focused:document.hasFocus()});}};window.__simpleSmokePerf=c;
 if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>{if(c.active)for(const entry of list.getEntries())if(entry.startTime>=c.active.at)c.active.longTasks.push({at:entry.startTime,ms:entry.duration});}).observe({type:'longtask',buffered:false});
 localStorage.setItem('lan-strike-cs2:lan-strike-quality','sharp');
}
function summarize(raw){const frames=raw.frames,intervals=frames.slice(1).map((f,i)=>f.start-frames[i].start);return{windowMs:raw.durationMs,callbacks:frames.length,callbacksPerWallSecond:frames.length*1000/raw.durationMs,firstCallbackOffsetMs:frames[0]?.start-raw.at,lastCallbackToWindowEndMs:frames.length?raw.durationMs-(frames.at(-1).end-raw.at):null,cpuMs:stats(frames.map(f=>f.cpuMs)),callbackIntervalMs:stats(intervals),rafIntervalMs:stats(frames.slice(1).map((f,i)=>f.rafAt-frames[i].rafAt)),gpuMs:stats(raw.gpu.map(s=>s.ms)),drawCalls:stats(frames.map(f=>f.render?.calls)),triangles:stats(frames.map(f=>f.render?.triangles)),programCounts:stats(frames.map(f=>f.programs)),longFramesOver33ms:intervals.filter(ms=>ms>33).length,longFramesOver50ms:intervals.filter(ms=>ms>50).length,longTasks:raw.longTasks,hiddenCallbacks:frames.filter(f=>f.visibility!=='visible').length};}

let server,browser,context,page,player,variant='before';
const inspect=()=>page.evaluate(()=>({performance:window.lanStrike.getPerformance(),diagnostics:window.lanStrike.getDiagnostics(),render:window.lanStrike.getRenderInfo(),programs:window.__simpleSmokePerf.refs.renderer.info.programs.length,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}}));
async function chooseRoute(world){
 const candidates=[];try{const stations=JSON.parse(await readFile('.local/cs2/yellow-car-audit/stations.json','utf8'));for(const name of ['T-ramp-middle','yellow-car-road']){const s=stations.find(s=>s.name===name);if(s)candidates.push({name:s.name,x:s.x,z:s.z,y:world.collision.supportHeight(s.x,s.z,s.maxFeet),yaw:s.yaw,source:'existing T-to-A diagnostic station'});}}catch{}
 for(const team of ['T','CT'])for(let i=0;i<world.spawns[team].length;i++)candidates.push({...world.resolveSpawn(team,i),name:team+'-spawn-'+i,source:'validated spawn search'});
 const eye=world.movement.rules.eye,offsets=[0,...Array.from({length:16},(_,i)=>[(i+1)*Math.PI/16,-(i+1)*Math.PI/16]).flat()];
 for(const c of candidates){if(![c.x,c.y,c.z,c.yaw].every(Number.isFinite))continue;for(const offset of offsets){const yaw=c.yaw+offset,d=direction(yaw,0),from={x:c.x,y:c.y+eye,z:c.z},to={x:from.x+d.x*7,y:from.y,z:from.z+d.z*7},hit=world.collision.trace(from,to,0,{radius:0,channel:'bullet'});if(!hit.startSolid&&hit.fraction===1)return{point:{x:c.x,y:c.y,z:c.z},yaw,pitch:0,forward:d,outsideOrigin:{x:to.x,y:c.y,z:to.z},eye,source:c.source,station:c.name,sourceYaw:c.yaw,yawOffset:offset,centerRayClearMetres:7};}}
 throw Error('No valid seven-metre clear smoke comparison route found');
}
async function load(){
 await page.goto('http://127.0.0.1:'+server.address().port+'/?transport=websocket&automation=1');
 await page.waitForFunction(()=>window.lanStrike&&!document.querySelector('#joinButton').disabled||document.querySelector('#error').textContent,undefined,{timeout:120000});assert.equal(await page.locator('#error').textContent(),'');
 await page.locator('#joinButton').click();await page.waitForFunction(()=>window.lanStrike.getState()?.players.some(p=>p.id===window.lanStrike.getId()));player=server.game.players.get(await page.evaluate(()=>window.lanStrike.getId()));assert.ok(player);
 const g=server.game;g.begin();g.phase='live';g.endAt=g.buyEndAt=g.time+10000;player.money=16000;if(!player.inventory.ak47)assert.ok(g.buy(player.id,'ak47'));g.equip(player.id,'ak47');
 Object.assign(player,{...report.route.point,yaw:report.route.yaw,pitch:0,vx:0,vy:0,vz:0,grounded:true,hp:1e9,nextAttackAt:0,nextShotAt:g.time,reloadAt:0,recoilYaw:0,recoilPitch:0});g.smokes=[];g.projectiles=[];g.drops=[];server.broadcastState();
 await page.waitForFunction(round=>{const s=window.lanStrike.getState(),d=window.lanStrike.getDiagnostics();return s?.round===round&&d.weapon==='ak47'&&d.weaponModel.source==='source2-native-gltf'&&!d.weaponModel.loading;},g.round);
 await page.evaluate(yaw=>{window.cs2Automation.look(yaw,0);window.cs2Automation.stop();},report.route.yaw);
 await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.mapStreaming.remaining===0&&d.presentationWarmup.queued===0&&!d.presentationWarmup.running;});
 await page.evaluate(()=>window.cs2Automation.start());await page.waitForFunction(()=>window.lanStrike.getDiagnostics().weaponModel.sequence==='idle');
 const setup=await inspect();assert.equal(setup.viewport.width,1920);assert.equal(setup.viewport.height,1080);assert.equal(setup.viewport.dpr,1);assert.equal(setup.performance.pixelRatio,1);assert.deepEqual(setup.performance.drawingBuffer,{width:1920,height:1080});
 assert.equal(setup.diagnostics.smokeRenderer.mode,variant==='after'?'simple-depth-fog':'depth-aware-raymarch-pilot');
 return setup;
}
async function setCase(c){
 const g=server.game,origin=c.inside?report.route.point:report.route.outsideOrigin;
 g.smokes=Array.from({length:c.count},(_,i)=>createSmokeVolume({id:'smoke-perf-'+g.round+'-'+c.name+'-'+i,x:origin.x,y:origin.y,z:origin.z,bornAt:g.time-1,endAt:g.time+17,radius:3.8,height:3.2}));assert.ok(g.smokes.every(Boolean));server.broadcastState();
 await page.waitForFunction(count=>window.lanStrike.getState()?.smokes?.length===count,c.count);await pause(100);
 const before=await inspect(),startRenders=before.diagnostics.smokeRenderer.renderCount;assert.equal(before.diagnostics.smokeRenderer.volumes,c.count);if(c.count)assert.equal(before.diagnostics.smokeRenderer.visibleVolumes,c.count);
 await page.waitForTimeout(warmupMs);
 const after=await inspect();if(c.count){assert.ok(after.diagnostics.smokeRenderer.renderCount>startRenders);assert.equal(after.diagnostics.smokeRenderer.firstRender.programsBefore,after.diagnostics.smokeRenderer.firstRender.programsAfterComposite,'First smoke must use its warmed composite program');}else assert.equal(after.diagnostics.smokeRenderer.extraDraws,0);
 assert.equal(after.programs,before.programs,'Steady case warmup unexpectedly compiled a program');return after;
}
async function measure(c,arm){
 const before=await setCase(c);assert.equal(before.performance.pixelRatio,1);assert.equal(before.performance.drawingBuffer.width,1920);assert.equal(before.performance.drawingBuffer.height,1080);
 console.log(JSON.stringify({event:'phase-start',arm,variant,case:c.name,count:c.count,seconds,mode:before.diagnostics.smokeRenderer.mode}));
 await page.evaluate(()=>{window.cs2Automation.resetMetrics();window.__simpleSmokePerf.start();});await page.waitForTimeout(seconds*1000);const raw=await page.evaluate(()=>window.__simpleSmokePerf.stop()),after=await inspect(),summary=summarize(raw);
 assert.ok(raw.frames.length>=20,'Actual application frames must be measured');assert.ok(raw.gpu.length>=10,'Actual non-disjoint hardware GPU samples required');assert.equal(after.performance.pixelRatio,1);assert.deepEqual(after.performance.drawingBuffer,{width:1920,height:1080});assert.equal(after.programs,before.programs,'Shaders compiled during measured smoke');assert.ok(summary.drawCalls.min>0&&summary.triangles.min>0);assert.equal(summary.hiddenCallbacks,0);
 assert.ok(Math.hypot(...['x','y','z'].map(k=>after.diagnostics.cameraPosition[k]-before.diagnostics.cameraPosition[k]))<.01,'Stationary camera drifted during comparison');assert.ok(Math.abs(after.diagnostics.input.yaw-before.diagnostics.input.yaw)<1e-8&&Math.abs(after.diagnostics.input.pitch-before.diagnostics.input.pitch)<1e-8,'Camera turn changed during comparison');
 const calls=after.diagnostics.smokeRenderer.renderCount-before.diagnostics.smokeRenderer.renderCount;if(c.count)assert.ok(calls>0);else assert.equal(calls,0,'No-smoke window must not composite');
 const phase={arm,variant,case:c.name,count:c.count,inside:!!c.inside,before,after,summary,smokeDrawsDuringWindow:calls,raw};report.phases.push(phase);
 if(variant==='after'&&['single','inside'].includes(c.name)){const file=path.join(artifactRoot,'simple-'+c.name+'.png');await page.screenshot({path:file});phase.screenshot=file;}
 await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({event:'phase-complete',arm,variant,case:c.name,summary}));
}
try{
 await mkdir(artifactRoot,{recursive:true});
 server=await createExperimentalServer({port:0,host:'127.0.0.1',presentation:'native',gameOptions:{weaponProfile:'cs2',random:()=>.5,audioRandom:()=>.5}});assert.equal(server.address().address,'127.0.0.1');assert.notEqual(server.address().port,3001);report.server='http://127.0.0.1:'+server.address().port;report.worldContract=server.world.contract;report.route=await chooseRoute(server.world);
 browser=await chromium.launch({headless:!args.has('--headed'),executablePath:process.env.CS2_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
 context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});await context.addInitScript(installCapture);
 await context.route('**/cs2-client.js',r=>r.fulfill({contentType:'text/javascript; charset=utf-8',body:injected}));await context.route('**/cs2-smoke-renderer.js',r=>r.fulfill({contentType:'text/javascript; charset=utf-8',body:variant==='after'?nextSmoke:oldSmoke}));
 page=await context.newPage();page.setDefaultTimeout(120000);page.on('pageerror',e=>report.errors.push(e.stack||e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|shader|OUT_OF_MEMORY|GL_INVALID/i.test(m.text()))report.errors.push(m.text());});page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/favicon.ico'))report.requests.push({url:r.url(),status:r.status()});});
 for(const [arm,name]of ['before','after','before'].entries()){
  variant=name;if(player&&server.game.players.has(player.id))server.game.remove(player.id);report.setups??=[];report.setups.push({arm,variant,setup:await load()});
  if(!report.renderer)report.renderer=await page.evaluate(()=>{const gl=window.__simpleSmokePerf.refs.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER);});assert.match(report.renderer,/Apple|Metal/i);assert.doesNotMatch(report.renderer,/SwiftShader|llvmpipe|software rasterizer/i);assert.equal((await inspect()).performance.gpuTimerSupported,true);
  for(const c of cases)await measure(c,arm);
 }
 report.sourceHashesAfter=await fingerprints();assert.deepEqual(report.sourceHashesBefore,report.sourceHashesAfter);assert.deepEqual(report.errors,[]);assert.deepEqual(report.requests,[]);report.sourcesStable=true;report.status='completed';
}catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;console.error(error.stack);try{report.failureDiagnostics=await inspect();}catch{}}
finally{
 try{await page?.evaluate(()=>window.cs2Automation?.stop());}catch{}
 await context?.close();await browser?.close();await server?.close();report.fixtureClosed=true;report.finishedAt=new Date().toISOString();await mkdir(artifactRoot,{recursive:true});await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,phases:report.phases.length,renderer:report.renderer,fixtureClosed:report.fixtureClosed,output,failure:report.failure}));
}
