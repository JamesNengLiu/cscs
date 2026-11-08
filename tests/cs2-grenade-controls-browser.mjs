// Explicit native-map regression and hardware-render A/B/A. Owns a temporary
// loopback authority and Chrome; never attaches to the persistent 3001 service.
// node tests/cs2-grenade-controls-browser.mjs --run [--seconds=5] [--headed]
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {createExperimentalServer} from '../cs2-server.mjs';
import {createGrenadeRuntime} from '../cs2-grenades.mjs';
import {CS2_GRENADE_PROFILE} from '../public/cs2-grenade-profile.js';

const seconds=Number(process.argv.find(a=>a.startsWith('--seconds='))?.split('=')[1]||5);
assert.ok(Number.isFinite(seconds)&&seconds>=2&&seconds<=30);
const artifactRoot='.local/cs2/'+(CS2_GRENADE_PROFILE.trajectoryVersion?'grenade-trajectory-2026-11-07':'grenade-controls-2026-11-07');
const counts=(process.argv.find(a=>a.startsWith('--counts='))?.split('=')[1]||'0,4').split(',').map(Number);assert.ok(counts.length&&counts.every(n=>[0,4,32,64].includes(n)));
const output=artifactRoot+'/'+(process.argv.includes('--performance-only')?'browser-performance.json':'browser.json'),sha=b=>createHash('sha256').update(b).digest('hex');
const baselineCommit='46dd5103c692d200d2ae849ad221fb790f94594b';
const client=await readFile('public/cs2-client.js','utf8'),clientBefore=execFileSync('git',['show',baselineCommit+':public/cs2-client.js'],{encoding:'utf8'}),viewBefore=execFileSync('git',['show',baselineCommit+':public/cs2-native-viewmodel.js'],{encoding:'utf8'}),effectsBefore=execFileSync('git',['show',baselineCommit+':public/cs2-effects.js'],{encoding:'utf8'});
const marker='onSample:sample=>{if(sample.tag?.active';assert.ok(client.includes(marker));
const viewTickEnd='motion:viewmodelMotion(local,now,presentationSettings.values)});}',viewTickStart='weaponView.update(dt,visual,';assert.ok(client.includes(viewTickEnd)&&client.includes(viewTickStart));
function instrument(source){return source.replace(viewTickStart,'const viewTick=performance.now();'+viewTickStart).replace(viewTickEnd,'motion:viewmodelMotion(local,now,presentationSettings.values)});window.__grenadeCheck.view(performance.now()-viewTick);}').replace(marker,'onSample:sample=>{window.__grenadeCheck?.gpu(sample);if(sample.tag?.active').replace('const viewmodelProjection=createViewmodelCamera(THREE,camera),viewmodelCamera=viewmodelProjection.camera;', 'const viewmodelProjection=createViewmodelCamera(THREE,camera),viewmodelCamera=viewmodelProjection.camera;window.__grenadeCheck.renderer=renderer;');}
const injected=instrument(client),injectedBefore=instrument(clientBefore);
for(const input of [injected,injectedBefore])execFileSync(process.execPath,['--check','--input-type=module'],{input});
if(!process.argv.includes('--run')){console.log(JSON.stringify({status:'prepared-not-run',seconds,syntaxChecked:true,output}));process.exit(0);}
const fingerprintFiles=['public/cs2-client.js','public/cs2-native-viewmodel.js','public/cs2-grenade-presentation.js','public/cs2-grenade-controls.js','public/cs2-grenade-intent.js','public/cs2-grenade-profile.js','cs2-game.mjs','cs2-grenades.mjs','cs2-grenade-flight.mjs','cs2-grenade-launch.mjs','public/cs2-effects.js','public/cs2-projectile-buffer.js','tests/cs2-grenade-controls-browser.mjs'];
async function fingerprints(){return Object.fromEntries(await Promise.all(fingerprintFiles.map(async file=>[file,sha(await readFile(file))])));}
const report={status:'running',scope:'Native map, one Chrome hardware renderer and loopback authority. Scripted DOM input; not physical mouse, panel or multi-machine LAN certification.',checks:[],equips:[],screenshots:[],phases:[],errors:[],requests:[],baselineCommit,sourceHashesBefore:await fingerprints(),sources:{client:sha(client),baselineClient:sha(clientBefore),baselineView:sha(viewBefore),baselineEffects:sha(effectsBefore),effects:sha(await readFile('public/cs2-effects.js')),view:sha(await readFile('public/cs2-native-viewmodel.js'))}};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function stats(values){const a=values.filter(Number.isFinite).sort((a,b)=>a-b),q=p=>a[Math.ceil((a.length-1)*p)]??null;return{samples:a.length,p50:q(.5),p95:q(.95),p99:q(.99),max:a.at(-1)??null};}
function installCapture(){
 const c={sample:null,start(){this.sample={at:performance.now(),frames:[],gpu:[],tasks:[],view:[]};},stop(){const s=this.sample;this.sample=null;return{...s,ms:performance.now()-s.at};},view(ms){if(this.sample)this.sample.view.push(ms);},gpu(s){if(this.sample&&s.submittedAt>=this.sample.at)this.sample.gpu.push(s.ms);}};window.__grenadeCheck=c;
 const native=requestAnimationFrame.bind(window);window.requestAnimationFrame=fn=>native(function(at){if(fn.name!=='frame'||!c.sample)return fn(at);const start=performance.now(),sample=c.sample;try{return fn(at);}finally{sample.frames.push({at:performance.now(),rafAt:at,cpu:performance.now()-start,calls:window.lanStrike?.getRenderInfo().calls});}});
 if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>{if(c.sample)for(const e of list.getEntries())if(e.startTime>=c.sample.at)c.sample.tasks.push({at:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:false});
 localStorage.setItem('lan-strike-quality','sharp');
}
let server,browser,page,p,baseline=false;const events=[];
async function until(fn,label){const end=performance.now()+4000;while(performance.now()<end){if(fn())return;await pause(10);}throw Error('Timeout '+label);}
async function prepare(weapon){
 const requests=[],track=request=>{if(/\.(gltf|bin|png|webp|jpg)(?:\?|$)/.test(request.url()))requests.push(request.url());};page.on('request',track);
 await page.evaluate(()=>{window.cs2Automation.fire(false);window.cs2Automation.setKeys([]);});
 const g=server.game;g.begin();g.phase='live';g.endAt=g.buyEndAt=g.time+1000;p.money=16000;
 if(weapon!=='knife'&&!p.inventory[weapon]&&!p.grenades?.[weapon])assert.ok(g.buy(p.id,weapon));
 g.equip(p.id,'knife');g.equip(p.id,weapon);Object.assign(p,{vx:0,vy:0,vz:0,pitch:0,nextAttackAt:0,nextShotAt:g.time,nextSecondaryAt:0});server.broadcastState();
 await page.waitForFunction(({weapon,round})=>{const d=window.lanStrike.getDiagnostics();return window.lanStrike.getState()?.round===round&&d.weapon===weapon&&d.weaponModel.id===weapon&&!d.weaponModel.loading&&d.weaponModel.source==='source2-native-gltf';},{weapon,round:g.round});
 await page.evaluate(yaw=>{window.cs2Automation.look(yaw,0);window.cs2Automation.start();},p.yaw);
 await page.waitForFunction(()=>window.lanStrike.getDiagnostics().weaponModel.sequence==='idle');
 page.off('request',track);if(['hegrenade','flashbang','smokegrenade'].includes(weapon)){assert.deepEqual(requests,[],'Grenades and all modes are preloaded before joining');report.equips.push({weapon,assetRequests:requests.length});}
}
async function load(){
 await page.goto('http://127.0.0.1:'+server.address().port+'/?transport=websocket&automation=1');
 await page.waitForFunction(()=>window.lanStrike&&!document.querySelector('#joinButton').disabled||document.querySelector('#error').textContent,undefined,{timeout:120000});assert.equal(await page.locator('#error').textContent(),'');
 await page.locator('#joinButton').click();await page.waitForFunction(()=>window.lanStrike.getState()?.players.find(p=>p.id===window.lanStrike.getId())?.alive);p=server.game.players.get(await page.evaluate(()=>window.lanStrike.getId()));assert.ok(p);
 await page.evaluate(()=>window.cs2Automation.start());
}
try{
 await mkdir(artifactRoot,{recursive:true});
 server=await createExperimentalServer({port:0,host:'127.0.0.1',presentation:'native',gameOptions:{weaponProfile:'cs2',random:()=>.5,audioRandom:()=>.5}});assert.notEqual(server.address().port,3001);
 const emit=server.game.emit.bind(server.game);server.game.emit=e=>{events.push({...e,time:server.game.time});emit(e);};
 browser=await chromium.launch({headless:!process.argv.includes('--headed'),executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
 const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});await context.addInitScript(installCapture);
 await context.route('**/cs2-client.js',r=>r.fulfill({contentType:'text/javascript',body:baseline?injectedBefore:injected}));
 await context.route('**/cs2-native-viewmodel.js',r=>baseline?r.fulfill({contentType:'text/javascript',body:viewBefore}):r.continue());
 await context.route('**/cs2-effects.js',r=>baseline?r.fulfill({contentType:'text/javascript',body:effectsBefore}):r.continue());
 page=await context.newPage();page.setDefaultTimeout(120000);page.on('pageerror',e=>report.errors.push(e.stack||e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/favicon.ico'))report.requests.push({url:r.url(),status:r.status()});});
 await load();
 report.renderer=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER);});assert.match(report.renderer,/Apple|Metal/i);assert.doesNotMatch(report.renderer,/SwiftShader|llvmpipe/i);
 if(!process.argv.includes('--performance-only')){for(const kind of ['hegrenade','flashbang','smokegrenade'])for(const [mask,strength,hold]of [[1,1,'hold'],[2,0,'holdLow'],[3,.5,'holdMid']]){
  await prepare(kind);console.log('native throw '+kind+' buttons='+mask);const count=p.grenades[kind],start=events.length,programs=await page.evaluate(()=>window.__grenadeCheck.renderer.info.programs.length),requests=[];const track=request=>{if(/\.(gltf|bin|png|webp|jpg)(?:\?|$)/.test(request.url()))requests.push(request.url());};page.on('request',track);
  if(mask&1)await page.mouse.down({button:'left'});if(mask&2)await page.mouse.down({button:'right'});
  await page.waitForFunction(hold=>window.lanStrike.getDiagnostics().weaponModel.sequence===hold,hold);
  assert.equal(server.game.projectiles.length,0);if(kind==='hegrenade'&&mask!==1){const file=artifactRoot+'/native-hold-'+mask+'.png';await page.screenshot({path:file});report.screenshots.push({kind,mask,phase:'hold',file});}const available=await page.evaluate(()=>window.lanStrike.getDiagnostics().weaponModel.availableSequences);for(const key of ['holdLow','holdMid','fireUnderhand'])assert.ok(available.includes(key));
  if(mask===3){await page.mouse.up({button:'left'});await pause(25);assert.equal(server.game.projectiles.length,0);await page.mouse.up({button:'right'});}
  else await page.mouse.up({button:mask===1?'left':'right'});
  await until(()=>events.slice(start).some(e=>e.type==='throw'),'native throw');const thrown=events.slice(start).filter(e=>e.type==='throw');assert.equal(thrown.length,1);assert.equal(thrown[0].strength,strength);assert.equal(p.grenades[kind],count-1);
  const sequence=strength===0?'fireUnderhand':'fire';await page.waitForFunction(sequence=>window.lanStrike.getDiagnostics().weaponModel.sequence===sequence,sequence);
  page.off('request',track);assert.deepEqual(requests,[], 'No action-time model/texture fetch');assert.equal(await page.evaluate(()=>window.__grenadeCheck.renderer.info.programs.length),programs,'No first-throw shader compilation');report.checks.push({kind,mask,strength,hold,sequence,actionTimeAssetRequests:requests.length,shaderPrograms:programs});
 }
 await prepare('flashbang');let start=events.length,count=p.grenades.flashbang;await page.mouse.down({button:'right'});await pause(25);await page.mouse.up({button:'right'});await until(()=>events.slice(start).some(e=>e.type==='throw'),'quick right tap');assert.equal(p.grenades.flashbang,count-1);assert.equal(events.slice(start).find(e=>e.type==='throw').strength,0);await page.waitForFunction(()=>window.lanStrike.getDiagnostics().weaponModel.sequence==='fireUnderhand');report.checks.push('quick right tap before pin completes throws once with underhand animation');
 await prepare('flashbang');if(p.grenades.flashbang<2)assert.ok(server.game.buy(p.id,'flashbang'));server.broadcastState();await pause(100);start=events.length;await page.mouse.down({button:'left'});await page.waitForFunction(()=>window.lanStrike.getDiagnostics().weaponModel.sequence==='hold');await page.mouse.up({button:'left'});await until(()=>events.slice(start).some(e=>e.type==='throw'),'first flash');await page.mouse.down({button:'right'});await page.waitForFunction(()=>window.lanStrike.getDiagnostics().weaponModel.sequence==='holdLow');assert.equal(events.slice(start).filter(e=>e.type==='throw').length,1);assert.equal(p.grenades.flashbang,1);await page.mouse.up({button:'right'});await until(()=>events.slice(start).filter(e=>e.type==='throw').length===2,'follow-up flash');assert.deepEqual(events.slice(start).filter(e=>e.type==='throw').map(e=>e.strength),[1,0]);assert.equal(p.grenades.flashbang,0);report.checks.push('two-flash recovery: immediate right press queues and holds the second flash, consumes exactly two');
 await prepare('flashbang');await page.mouse.down({button:'right'});await page.waitForFunction(()=>window.lanStrike.getDiagnostics().weaponModel.sequence==='holdLow');const before=events.filter(e=>e.type==='throw').length;
 await page.keyboard.press('Escape');await page.mouse.up({button:'right'});await pause(150);assert.equal(events.filter(e=>e.type==='throw').length,before);assert.equal(p.grenadePhase,'');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().weaponModel.sequence==='idle');report.checks.push('menu cancellation followed by late right release produces no grenade');
 await prepare('awp');await page.mouse.click(960,540,{button:'right'});await until(()=>p.zoom<90,'AWP secondary');const ammo=p.ammo,shots=events.length;await page.mouse.down({button:'left'});await pause(30);await page.keyboard.press('q');await pause(30);await page.keyboard.press('q');await page.mouse.up({button:'left'});await pause(500);assert.equal(p.weapon,'awp');assert.equal(p.ammo,ammo-1);assert.equal(p.zoom,90);assert.equal(events.slice(shots).filter(e=>e.type==='shot').length,1);report.checks.push('AWP right scope, shot and QQ: one bullet, one shot, returns unscoped');
 }
 // Rendering comparison isolates the changed client, viewmodel and FX interpolation. Both
 // arms use the current authority, input and map, so this is not a full old-build FPS claim.
 for(const variant of ['before','after','before']){
  console.log('render comparison '+variant);baseline=variant==='before';if(server.game.players.has(p.id))server.game.remove(p.id);await load();await prepare('ak47');
  await page.evaluate(()=>window.cs2Automation.stop());await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.mapStreaming.remaining===0&&d.presentationWarmup.queued===0&&!d.presentationWarmup.running;});await page.evaluate(()=>window.cs2Automation.start());
  for(const count of counts){
   server.game.projectiles=[];const runtime=createGrenadeRuntime(server.world,{profile:CS2_GRENADE_PROFILE});for(let n=0;n<count;n++){const q=runtime.createGrenade(p,'smokegrenade',server.game.time);assert.ok(q);Object.assign(q,{detonateAt:server.game.time+100,resting:true,grounded:true,vx:0,vy:0,vz:0});server.game.projectiles.push(q);}
   if(count){Object.assign(p,{ammo:30,reloadAt:0,nextShotAt:server.game.time,nextAttackAt:0});await page.evaluate(()=>window.cs2Automation.fire(true));}await pause(500);const state=await page.evaluate(()=>({performance:window.lanStrike.getPerformance(),render:window.lanStrike.getRenderInfo()}));assert.equal(state.performance.pixelRatio,1);assert.deepEqual(state.performance.drawingBuffer,{width:1920,height:1080});
   await page.evaluate(()=>{window.cs2Automation.resetMetrics();window.__grenadeCheck.start();});await pause(seconds*1000);const raw=await page.evaluate(()=>{window.cs2Automation.fire(false);return window.__grenadeCheck.stop();}),frames=raw.frames,intervals=frames.slice(1).map((f,i)=>f.at-frames[i].at);assert.ok(frames.length>20);
   report.phases.push({variant,count,scope:'client + native-viewmodel + FX interpolation A/B/A on the same current complete-map authority',scenario:count?'AK continuous fire with '+count+' projectiles':'AK idle without projectiles',ms:raw.ms,callbacks:frames.length,callbacksPerSecond:frames.length*1000/raw.ms,cpuMs:stats(frames.map(f=>f.cpu)),viewCpuMs:stats(raw.view),intervalMs:stats(intervals),gpuMs:stats(raw.gpu),drawCalls:stats(frames.map(f=>f.calls)),longFramesOver50ms:intervals.filter(v=>v>50).length,longTasks:raw.tasks,raw});
  }
 }
 assert.equal(sha(await readFile('public/cs2-client.js')),report.sources.client);assert.equal(sha(await readFile('public/cs2-native-viewmodel.js')),report.sources.view);report.sourceHashesAfter=await fingerprints();assert.deepEqual(report.sourceHashesBefore,report.sourceHashesAfter);report.sourcesStable=true;assert.deepEqual(report.errors,[]);assert.deepEqual(report.requests,[]);report.status='completed';
}catch(e){report.status='failed';report.failure=e.stack;process.exitCode=1;console.error(e.stack);}finally{
 await browser?.close();await server?.close();report.fixtureClosed=true;await mkdir(artifactRoot,{recursive:true});await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,phases:report.phases.map(({raw,...phase})=>phase)},null,2));
}
