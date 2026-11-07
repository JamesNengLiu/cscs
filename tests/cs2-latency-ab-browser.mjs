// Isolated presentation experiment. Does not attach to the user's browser or
// production service. Default invocation prepares/checks only; --run is explicit.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createExperimentalServer} from '../cs2-server.mjs';
import {analyzeChromiumPresentationTrace,parseChromiumTraceJson} from './fixtures/chromium-presentation-trace.mjs';
import {runProductionWeaponSmoke,runProductionMovementSmoke} from './fixtures/cs2-production-weapon-smoke.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),args=new Set(process.argv.slice(2));
const option=(key,fallback)=>process.argv.find(a=>a.startsWith('--'+key+'='))?.slice(key.length+3)??fallback;
const seconds=Number(option('seconds','10')),headed=args.has('--headed');
const productionHeadroom=args.has('--production-headroom'),productionSmoke=args.has('--production-smoke'),productionSmokeOnly=args.has('--production-smoke-only');
const variants=option('variants',productionHeadroom?'baseline,headroom,baseline-repeat':'baseline,scale75,noaa,baseline-repeat').split(',');
const configs={baseline:{antialias:true,ratio:1},headroom:{antialias:true,ratio:.75,profile:'headroom'},scale75:{antialias:true,ratio:.75},'scale75-repeat':{antialias:true,ratio:.75},noaa:{antialias:false,ratio:1},'baseline-repeat':{antialias:true,ratio:1},desync:{antialias:true,ratio:1,desynchronized:true},opaque:{antialias:true,ratio:1,contextAlpha:false},preserve:{antialias:true,ratio:1,preserveDrawingBuffer:true},flush:{antialias:true,ratio:1,submissionControl:'flush'},'finish-control':{antialias:true,ratio:1,submissionControl:'finish',diagnosticOnly:true},'raw-input':{antialias:true,ratio:1,inputEventType:'pointerrawupdate',diagnosticOnly:true}};
const requestedHeight=option('native-height',null),nativeHeight=requestedHeight===null?null:Number(requestedHeight);
assert.ok(nativeHeight===null||(headed&&Number.isInteger(nativeHeight)&&nativeHeight>=600&&nativeHeight<=1200),'--native-height requires a headed run and a 600–1200px integer height');
assert.ok(seconds>=3&&seconds<=30&&Number.isFinite(seconds),'Measurement must be 3–30 seconds');
assert.ok(variants.length>0&&variants.every(v=>Object.hasOwn(configs,v)),'Unknown or missing experiment variant');
assert.equal(new Set(variants).size,variants.length,'Variant names must be unique');
assert.ok(!productionHeadroom||variants.every(v=>['baseline','headroom','baseline-repeat'].includes(v)),'Production mode only measures the real baseline/headroom query profiles');
assert.ok(productionHeadroom||!variants.includes('headroom'),'headroom requires --production-headroom; test-only scale75 is a different mode');
assert.ok(!productionSmoke||productionHeadroom,'--production-smoke requires --production-headroom');
assert.ok(!productionSmoke||configs[variants.at(-1)].profile!=='headroom','Production menu regression must follow a measured baseline case to verify its cached cadence');
assert.ok(!productionSmokeOnly||(productionHeadroom&&productionSmoke&&variants.length===1&&variants[0]==='baseline'),'--production-smoke-only requires production-headroom, production-smoke and --variants=baseline');
const output=path.resolve(root,option('output','artifacts/cs2-latency-ab/'+new Date().toISOString().replace(/[:.]/g,'-')));
const nativePosition={x:Number(option('window-x','1512')),y:Number(option('window-y','0'))};
const sha=value=>createHash('sha256').update(value).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,ms)));
const stats=values=>{const a=values.filter(Number.isFinite).sort((x,y)=>x-y),q=p=>a.length?a[Math.ceil((a.length-1)*p)]:null;return{samples:a.length,min:a[0]??null,p50:q(.5),p95:q(.95),p99:q(.99),max:a.at(-1)??null,mean:a.length?a.reduce((sum,x)=>sum+x,0)/a.length:null};};
const categories=['toplevel','benchmark','cc','viz','gpu','input','latency','blink.user_timing','devtools.timeline','disabled-by-default-devtools.timeline','disabled-by-default-devtools.timeline.frame','disabled-by-default-latencyInfo'];
const original=await readFile(path.join(root,'public/cs2-client.js'),'utf8');
function replaceOnce(source,anchor,replacement){assert.equal(source.split(anchor).length-1,1,'Client anchor changed: '+anchor.slice(0,100));return source.replace(anchor,replacement);}
function instrument(config){
  let source=original;const inputEventType=config.inputEventType??'mousemove';
  if(inputEventType!=='mousemove')source=replaceOnce(source,"document.addEventListener('mousemove',e=>{if(locked",`document.addEventListener('${inputEventType}',e=>{if(locked`);
  const rendererAnchor="const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});";
  const extraAttributes=config.preserveDrawingBuffer?',preserveDrawingBuffer:true':'';
  // Three r186's renderer alpha option defaults to false, but its actual
  // getContext attributes force alpha:true. Match observed baseline GL attrs;
  // do not accidentally combine desync with an opaque-context experiment.
  const explicitContext=config.desynchronized||config.contextAlpha!==undefined;
  const rendererSource=explicitContext?`const testWebGLContext=canvas.getContext('webgl2',{alpha:${config.contextAlpha??true},depth:true,stencil:false,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:false,powerPreference:'high-performance',failIfMajorPerformanceCaveat:false${config.desynchronized?',desynchronized:true':''}});if(!testWebGLContext)throw Error('WebGL2 diagnostic context unavailable');const renderer=new THREE.WebGLRenderer({canvas,context:testWebGLContext,antialias:true,powerPreference:'high-performance'});`:`const renderer=new THREE.WebGLRenderer({canvas,antialias:${config.antialias},powerPreference:'high-performance'${extraAttributes}});`;
  source=replaceOnce(source,rendererAnchor,rendererSource);
  const surface='const renderSurface=createRenderSurface(renderer,canvas,{width:innerWidth,height:innerHeight,ratio:resolution.ratio});';
  if(config.ratio!==1&&!productionHeadroom)source=replaceOnce(source,surface,surface+`\nrenderSurface.setRatio(${config.ratio});`);
  const attach="const viewmodelProjection=createViewmodelCamera(THREE,camera),viewmodelCamera=viewmodelProjection.camera;";
  source=replaceOnce(source,attach,attach+`\nwindow.__latencyCapture.attach({renderer,worldCamera:camera,viewmodelCamera,readMotion:()=>({input:input(),local:local?{x:local.x,y:local.y,z:local.z,vx:local.vx,vy:local.vy,vz:local.vz,grounded:local.grounded}:null}),read:()=>({yaw,pitch,cameraYaw:camera.rotation.y,cameraPitch:camera.rotation.x,fov:camera.fov,aspect:camera.aspect,position:local?{x:local.x,y:local.y,z:local.z}:null,ratio:renderSurface.ratio,programs:renderer.info.programs?.length??0})});${productionSmoke?'window.__pointerTrace={refs:window.__latencyCapture.refs};':''}`);
  source=replaceOnce(source,'onSample:sample=>{if(sample.tag?.active','onSample:sample=>{window.__latencyCapture.gpu(sample);if(sample.tag?.active');
  const mouseEnd="document.addEventListener('mousedown',e=>{";
  source=replaceOnce(source,mouseEnd,`document.addEventListener('${inputEventType}',event=>window.__latencyCapture.afterMouse(event));\n`+mouseEnd);
  const frameEnd='    frameMetrics.add(interval,performance.now()-started,animationMs,submitted-renderStarted,lastCameraMs,Math.max(0,started-now),resizeMs+performance.now()-adaptStarted);';
  if(config.submissionControl){
    // Diagnostic-only synchronization is deliberately outside the original GPU
    // query. finish can block; its cost must remain visible in both CPU and the
    // separate control metric. Never promote it based on FPS or attrs alone.
    const gpuEnd='gpuTimer.end(now,{ratio:renderSurface.ratio,epoch:frameMetrics.epoch,active:locked&&!document.hidden});';
    source=replaceOnce(source,gpuEnd,gpuEnd+`const testControlStarted=performance.now();renderer.getContext().${config.submissionControl}();const testControlWaitMs=performance.now()-testControlStarted;`);
  }
  source=replaceOnce(source,frameEnd,frameEnd+`\n    window.__latencyCapture.frame({now,started,ended:performance.now(),interval,animationMs,renderSubmitMs:submitted-renderStarted,submissionControlMs:${config.submissionControl?'testControlWaitMs':'0'},draws:renderer.info.render.calls,triangles:renderer.info.render.triangles});`);
  execFileSync(process.execPath,['--check','--input-type=module'],{input:source,stdio:['pipe','pipe','pipe']});
  return source;
}
const sources=Object.fromEntries(variants.map(v=>[v,instrument(configs[v])]));
const renderProfileSource=productionHeadroom?await readFile(path.join(root,'public/cs2-render-profile.js')):null;
const plan={seconds,headed,productionHeadroom,productionSmoke,productionSmokeOnly,productionRenderProfileSha256:renderProfileSource?sha(renderProfileSource):null,variants:variants.map(name=>({name,...configs[name],sourceSha256:sha(sources[name])})),output,nativeViewport:true,nativePosition,nativeHeight,nativeWindowMode:nativeHeight===null?'fullscreen':'normal-calibrated',originalSha256:sha(original),harnessSha256:sha(await readFile(fileURLToPath(import.meta.url))),captureObserverSha256:sha(installCapture.toString()),scope:'Own Chrome/profile and loopback ephemeral server; trusted CDP mouse input, native browser feedback. No physical mouse-to-photon certification; shader warmup and read-only observation are identical across variants.'};
if(!args.has('--run')||args.has('--dry-run')){console.log(JSON.stringify({status:'prepared-not-run',...plan},null,2));process.exit(0);}

// No RAF, GL draw/upload, world or physics functions are wrapped. The source
// route adds one small read-only observation at the end of the app callback.
function installCapture({inputEventType='mousemove'}={}){
  const capture={refs:null,active:null,lastInputId:0,latestGpu:null,inputEventType};window.__latencyCapture=capture;
  capture.attach=refs=>{capture.refs=refs;};
  // Registering raw updates can itself affect browser input scheduling. A pure
  // baseline must never request the raw reference stream merely to observe it.
  const eventTypes=inputEventType==='pointerrawupdate'?['mousemove','pointerrawupdate']:['mousemove'];
  for(const type of eventTypes)document.addEventListener(type,event=>{const active=capture.active;if(!active)return;const record={type,ts:performance.now(),eventTimestamp:event.timeStamp,movementX:event.movementX,movementY:event.movementY,trusted:event.isTrusted};active.referenceInputs.push(record);if(type===inputEventType)active.inputs.push({...record,id:++capture.lastInputId,beforeYaw:capture.refs.read().yaw});},true);
  capture.afterMouse=event=>{const active=capture.active;if(!active)return;const input=active.inputs.at(-1);if(!input||input.movementX!==event.movementX||input.movementY!==event.movementY)throw Error('Mouse observation ordering changed');input.afterYaw=capture.refs.read().yaw;input.yawResidual=input.afterYaw-input.beforeYaw+event.movementX*.00035;};
  capture.gpu=sample=>{capture.latestGpu=sample;const active=capture.active;if(active&&sample.submittedAt>=active.at)active.gpuSamples.push(sample);};
  capture.frame=data=>{const active=capture.active;if(!active)return;const input=active.inputs.at(-1);active.frames.push({...data,...capture.refs.read(),lastInputId:capture.lastInputId,lastSelectedInputEventTimestamp:input?.eventTimestamp??null,lastSelectedInputReceivedAt:input?.ts??null,pointerLocked:document.pointerLockElement?.id??null,focused:document.hasFocus(),visibility:document.visibilityState});};
  capture.start=()=>{capture.active={at:performance.now(),inputEventType,frames:[],inputs:[],referenceInputs:[],gpuSamples:[]};performance.mark('cs2-latency-measurement-start');};
  capture.stop=()=>{performance.mark('cs2-latency-measurement-end');const result=capture.active;if(result)result.endedAt=performance.now();capture.active=null;return result;};
}
let server,context,browser,page,profile,traceCDP,traceRunning=false,cancelled=false;
const report={status:'running',startedAt:new Date().toISOString(),...plan,cases:[],errors:[],fixtureConnections:[]};
const cancel=()=>{cancelled=true;void context?.close().catch(()=>{});};process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
async function closeCase(){
  if(traceRunning)try{await traceCDP.send('Tracing.end');}catch{}
  traceRunning=false;try{await page?.keyboard.press('Escape');}catch{}
  try{await context?.close();}finally{context=browser=page=traceCDP=null;if(profile){await rm(profile,{recursive:true,force:true});profile=null;}}
  if(server){const deadline=performance.now()+5000;while(server.game.players.size&&performance.now()<deadline)await pause(10);assert.equal(server.game.players.size,0,'Old client must leave before the next case selects spawn T0');}
}
async function configureNativeWindow(){
  if(!headed)return null;
  const cdp=await browser.newBrowserCDPSession(),target=await context.newCDPSession(page);
  const calibration=[];if(nativeHeight!==null)report.cases.at(-1).nativeWindowCalibration=calibration;
  try{
    await page.bringToFront();
    const info=await target.send('Target.getTargetInfo'),w=await cdp.send('Browser.getWindowForTarget',{targetId:info.targetInfo.targetId});
    if(nativeHeight===null){await cdp.send('Browser.setWindowBounds',{windowId:w.windowId,bounds:{windowState:'fullscreen'}});await pause(1000);const actual=await cdp.send('Browser.getWindowBounds',{windowId:w.windowId});assert.equal(actual.bounds.windowState,'fullscreen');assert.equal(actual.bounds.left,nativePosition.x,'Own browser must remain on requested display');return actual;}
    await cdp.send('Browser.setWindowBounds',{windowId:w.windowId,bounds:{windowState:'normal'}});
    for(let attempt=0;attempt<=3;attempt++){
      const actual=await cdp.send('Browser.getWindowBounds',{windowId:w.windowId}),viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,outerWidth,outerHeight,resizeEvents:window.__nativeWindowResizes??null,focused:document.hasFocus(),visibility:document.visibilityState}));calibration.push({attempt,...actual,viewport});console.log(JSON.stringify({event:'native-window-calibration',case:report.cases.at(-1).name,attempt,...actual,viewport}));
      if(viewport.width===1920&&viewport.height===nativeHeight){assert.equal(actual.bounds.windowState,'normal');assert.equal(actual.bounds.left,nativePosition.x,'Own browser must remain on requested external display');assert.equal(viewport.dpr,1,'Native external DPR must be 1');assert.equal(page.viewportSize(),null,'Viewport emulation must remain disabled');return{...actual,calibration};}
      assert.ok(attempt<3,'Native content size did not settle within three bounds calibrations');
      const requested={left:nativePosition.x,top:nativePosition.y,width:actual.bounds.width+1920-viewport.width,height:actual.bounds.height+nativeHeight-viewport.height};calibration.at(-1).requestedBounds=requested;await cdp.send('Browser.setWindowBounds',{windowId:w.windowId,bounds:requested});
      // Read actual native resize completion on the lightweight calibration
      // page; do not poll during the game's map/model compilation work.
      try{await page.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,{width:1920,height:nativeHeight},{timeout:1200});}catch(error){if(error.name!=='TimeoutError')throw error;}
    }
  }catch(error){error.nativeWindowCalibration=calibration;console.error(JSON.stringify({event:'native-window-calibration-failed',case:report.cases.at(-1).name,message:error.message,calibration}));throw error;}finally{await cdp.detach();await target.detach();}
}
async function inspect(){return page.evaluate(()=>{const refs=window.__latencyCapture.refs,gl=refs.renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');return{diagnostics:window.lanStrike.getDiagnostics(),performance:window.lanStrike.getPerformance(),draw:window.lanStrike.getRenderInfo(),memory:{...refs.renderer.info.memory},context:{attributes:gl.getContextAttributes(),samples:gl.getParameter(gl.SAMPLES),renderer:gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER),viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},screen:{width:screen.width,height:screen.height,availWidth:screen.availWidth,availHeight:screen.availHeight},drawingBuffer:{width:gl.drawingBufferWidth,height:gl.drawingBufferHeight}},view:refs.read(),focused:document.hasFocus(),pointerLocked:document.pointerLockElement?.id??null};});}
async function alignYaw(inputCDP){
  await page.mouse.move(960,418);const view=await page.evaluate(()=>window.__latencyCapture.refs.read()),dx=Math.round(view.yaw/.00035),dy=Math.round(view.pitch/.00035),origin={x:960+dx,y:418+dy};
  await inputCDP.send('Input.dispatchMouseEvent',{type:'mouseMoved',...origin,button:'none',buttons:0,pointerType:'mouse'});
  await page.waitForFunction(()=>{const p=window.__latencyCapture.refs.read();return Math.abs(p.yaw)<.00035*.51&&Math.abs(p.pitch)<.00035*.51;});return origin;
}
async function drive(inputCDP,origin,durationMs,commands=[]){
  const began=performance.now(),period=1000/120;let index=0;
  while(performance.now()-began<durationMs){
    if(cancelled)throw Error('Cancelled');const t=Math.min(durationMs,performance.now()-began),half=durationMs/2,fast=t>=half,phase=fast?(t-half)/half:t/half,counts=Math.round((fast?3600:1800)*Math.sin(phase*Math.PI*2*(fast?3:1))),sent=performance.now();
    await inputCDP.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:origin.x+counts,y:origin.y,button:'none',buttons:0,pointerType:'mouse'});commands.push({atMs:sent-began,completedAtMs:performance.now()-began,counts});index++;if(began+index*period<performance.now()-period)index=Math.ceil((performance.now()-began)/period);await pause(began+index*period-performance.now());
  }
  await inputCDP.send('Input.dispatchMouseEvent',{type:'mouseMoved',...origin,button:'none',buttons:0,pointerType:'mouse'});return{durationMs:performance.now()-began,commands};
}
async function stopTrace(caseName){
  const complete=new Promise(resolve=>traceCDP.once('Tracing.tracingComplete',resolve));await traceCDP.send('Tracing.end');const done=await complete;traceRunning=false;let outputText='';
  try{for(;;){const data=await traceCDP.send('IO.read',{handle:done.stream,size:1048576});outputText+=data.base64Encoded?Buffer.from(data.data,'base64').toString():data.data;if(data.eof)break;}}finally{await traceCDP.send('IO.close',{handle:done.stream});}
  const filename=path.join(output,caseName+'-trace.json.gz');await writeFile(filename,gzipSync(outputText));return{trace:parseChromiumTraceJson(outputText),filename,bytes:Buffer.byteLength(outputText)};
}
async function connectionContext(){
  let client=null;try{client=await page.evaluate(()=>{const s=window.lanStrike,d=s?.getDiagnostics();return{id:s?.getId(),connection:d?.connection,locked:d?.locked,inputSeq:d?.inputSeq,ackInputSeq:d?.ackInputSeq,statePlayerIds:s?.getState()?.players.map(p=>p.id),error:document.querySelector('#error')?.textContent,resume:document.querySelector('#resumeButton')?.textContent};});}catch(error){client={inspectionError:error.message};}
  return{client,authorityIds:[...server.game.players.keys()],authorityPresent:server.game.players.has(client?.id),serverPeers:[...server.peers].map(peer=>({playerId:peer.playerId,readyState:peer.readyState,bufferedAmount:peer.bufferedAmount})),connections:report.fixtureConnections};
}
async function runProfileMenuSmoke(){
  const context=await connectionContext();report.cases.at(-1).smokeConnectionBefore=context;assert.equal(context.authorityPresent,true,'Smoke requires a live joined authority: '+JSON.stringify(context));
  const id=context.client.id,player=server.game.players.get(id);
  const authority=()=>Object.fromEntries(['x','y','z','vx','vy','vz','grounded','hp','ammo','weapon','duckAmount'].map(key=>[key,player[key]]));
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.pointerLockElement===null&&!document.querySelector('#resume').hidden);
  const before=await inspect(),state=authority(),checks=[];
  assert.equal(before.performance.renderBudget.presentationAB.profile,'baseline');
  for(const profile of ['headroom','baseline','headroom']){
    await page.locator('#renderProfile').selectOption(profile);await page.waitForFunction(profile=>window.lanStrike.getPerformance().renderBudget.presentationAB.profile===profile,profile);
    const actual=await inspect(),exported=await page.evaluate(()=>window.lanStrike.getDiagnosticReport());
    assert.equal(actual.performance.pixelRatio,profile==='headroom'?.75:1);assert.equal(actual.performance.samples,0,'Switching presentation must clear the old active metric window');assert.equal(exported.performance.samples,0,'Old gameplay snapshots must not masquerade as the new profile');
    assert.equal(actual.performance.quality,before.performance.quality);assert.equal(actual.performance.renderBudget.target,before.performance.renderBudget.target);
    if(profile==='baseline'){assert.equal(actual.performance.renderBudget.targetHz,before.performance.renderBudget.targetHz,'Returning to A must keep its learned cadence');assert.equal(actual.performance.renderBudget.cadenceCalibrated,before.performance.renderBudget.cadenceCalibrated);}
    for(const key of ['yaw','pitch','fov','aspect'])assert.equal(actual.view[key],before.view[key],'Menu profile must preserve '+key);assert.deepEqual(authority(),state,'Menu profile must preserve authority movement/ammo/state');assert.equal(actual.pointerLocked,null);
    const glError=await page.evaluate(()=>window.__latencyCapture.refs.renderer.getContext().getError());assert.equal(glError,0);checks.push({profile,ratio:actual.performance.pixelRatio,metricsSamples:actual.performance.samples,exportedSamples:exported.performance.samples,targetHz:actual.performance.renderBudget.targetHz,webglError:glError});
  }
  return{checks,beforeProfile:before.performance.renderBudget.presentationAB,finalProfile:'headroom',authorityUnchanged:true};
}
async function runProductionValidation(entry){
  entry.productionMenuSmoke=await runProfileMenuSmoke();entry.productionWeaponSmoke=await runProductionWeaponSmoke({page,server,artifactRoot:output});entry.productionMovementSmoke=await runProductionMovementSmoke({page,artifactRoot:output});entry.smokeConnectionAfter=await connectionContext();assert.equal(entry.smokeConnectionAfter.authorityPresent,true);assert.deepEqual(entry.errors,[]);
}
try{
  await mkdir(output,{recursive:true});server=await createExperimentalServer({port:0,host:'127.0.0.1',presentation:'native',gameOptions:{weaponProfile:'cs2'}});const address=server.address();assert.equal(address.address,'127.0.0.1');assert.notEqual(address.port,3001);report.server='http://127.0.0.1:'+address.port;
  server.wss.on('connection',ws=>{const record={openedAt:new Date().toISOString(),receivedMessages:0,receivedBytes:0};report.fixtureConnections.push(record);ws.on('message',bytes=>{record.receivedMessages++;record.receivedBytes+=bytes.length;});ws.on('close',(code,reason)=>{Object.assign(record,{closedAt:new Date().toISOString(),playerId:ws.playerId,code,reason:reason.toString()});});});
  for(const name of variants){
    const config=configs[name],entry={name,config,errors:[],startedAt:new Date().toISOString()};report.cases.push(entry);console.log(JSON.stringify({event:'case-start',name}));
    profile=await mkdtemp(path.join(os.tmpdir(),'cscs-latency-ab-'));
    context=await chromium.launchPersistentContext(profile,{headless:!headed,executablePath:process.env.CS2_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',viewport:null,handleSIGINT:false,handleSIGTERM:false,args:['--window-position='+nativePosition.x+','+nativePosition.y,'--window-size=1920,1000','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});browser=context.browser();page=context.pages()[0];page.setDefaultTimeout(120000);page.on('pageerror',error=>entry.errors.push(error.stack||error.message));let profileResponsePromise=null;if(productionHeadroom)page.on('response',response=>{if(new URL(response.url()).pathname==='/cs2-render-profile.js')profileResponsePromise=response.body().then(bytes=>({url:response.url(),status:response.status(),sha256:sha(bytes)}));});
    await context.addInitScript(()=>{localStorage.setItem('lan-strike-quality','sharp');localStorage.setItem('lan-strike-mouse-sensitivity','.35');localStorage.setItem('lan-strike-weapon-hand','left');localStorage.setItem('lan-strike.presentation.v1',JSON.stringify({rawMouse:true,dpi:800}));});await context.addInitScript(installCapture,{inputEventType:config.inputEventType??'mousemove'});await context.route('**/cs2-client.js',route=>route.fulfill({status:200,contentType:'text/javascript; charset=utf-8',body:sources[name]}));
    if(nativeHeight!==null){await context.route('**/__cs2-latency-window.html',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<!doctype html><html><head><title>CS2 native viewport calibration</title><script>window.__nativeWindowResizes=0;window.addEventListener("resize",()=>{window.__nativeWindowResizes++;});</script></head><body>Native window calibration; no WebGL or emulated viewport.</body></html>'}));await page.goto(report.server+'/__cs2-latency-window.html');}
    entry.browserWindow=await configureNativeWindow();entry.requestedRenderProfile=productionHeadroom?(config.profile??'baseline'):null;await page.goto(report.server+'/?transport=websocket&camera=baseline'+(productionHeadroom?'&present='+entry.requestedRenderProfile:''));await page.waitForFunction(()=>window.lanStrike&&!document.querySelector('#joinButton').disabled||document.querySelector('#error').textContent);assert.equal(await page.locator('#error').textContent(),'');assert.equal(await page.evaluate(()=>typeof window.cs2Automation),'undefined');if(productionHeadroom){assert.ok(profileResponsePromise,'Actual public CS2 render-profile module must load');entry.productionModuleResponse=await profileResponsePromise;assert.equal(entry.productionModuleResponse.status,200);assert.equal(entry.productionModuleResponse.sha256,plan.productionRenderProfileSha256);entry.testRatioOverrideUsed=false;}await page.locator('#team').selectOption('T');await page.locator('#joinButton').click();
    await page.waitForFunction(()=>window.lanStrike.getState()?.players.find(p=>p.id===window.lanStrike.getId())?.alive);const id=await page.evaluate(()=>window.lanStrike.getId()),authority=server.game.players.get(id);assert.ok(authority);server.game.begin();server.game.phase='live';server.game.endAt=server.game.time+10000;server.game.buyEndAt=server.game.time+10000;authority.money=16000;if(!authority.inventory.ak47)assert.equal(server.game.buy(id,'ak47'),true);server.game.equip(id,'ak47');server.broadcastState();
    await page.waitForFunction(round=>window.lanStrike.getState()?.round===round,server.game.round);await page.bringToFront();await page.locator('#resumeButton').click();await page.waitForFunction(()=>document.pointerLockElement===document.querySelector('#game')&&document.hasFocus()&&window.lanStrike.getDiagnostics().locked);
    const inputCDP=await context.newCDPSession(page),origin=await alignYaw(inputCDP);await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.weaponModel.id==='ak47'&&d.weaponModel.sequence==='idle'&&d.mapStreaming.remaining===0;});
    entry.prewarm=await drive(inputCDP,origin,seconds*1000);await page.waitForFunction(()=>{const v=window.__latencyCapture.refs.read();return window.lanStrike.getDiagnostics().mapStreaming.remaining===0&&Math.abs(v.cameraYaw)<.00035*.51&&Math.abs(v.cameraPitch)<.00035*.51;});const programA=await page.evaluate(()=>window.__latencyCapture.refs.read().programs);await pause(1000);const programB=await page.evaluate(()=>window.__latencyCapture.refs.read().programs);assert.equal(programA,programB,'Programs must settle before measurement');entry.warmPrograms=programB;entry.before=await inspect();
    assert.equal(entry.before.pointerLocked,'game');assert.equal(entry.before.focused,true);assert.equal(entry.before.diagnostics.pointerInput.mode,'raw-accepted');assert.equal(entry.before.view.ratio,config.ratio);assert.equal(entry.before.context.attributes.antialias,config.antialias);assert.equal(entry.before.context.attributes.alpha,config.contextAlpha??true);assert.equal(entry.before.context.attributes.preserveDrawingBuffer,!!config.preserveDrawingBuffer);entry.desynchronizedRequested=!!config.desynchronized;entry.desynchronizedActual=entry.before.context.attributes.desynchronized??null;entry.submissionControlScope=config.submissionControl?{method:config.submissionControl,position:'Immediately after original gpuTimer.end; before frame metrics; no GPU query ordering change',diagnosticOnly:true}:null;assert.doesNotMatch(entry.before.context.renderer,/swiftshader|llvmpipe|software rasterizer/i);assert.match(entry.before.context.renderer,/Apple.*M\d|ANGLE Metal Renderer: Apple/i);if(headed){assert.equal(entry.before.context.viewport.width,1920);assert.equal(entry.before.context.viewport.dpr,1);if(nativeHeight!==null)assert.equal(entry.before.context.viewport.height,nativeHeight);}entry.browserVersion=browser.version();
    if(productionHeadroom){entry.productionRenderProfile=entry.before.performance.renderBudget.presentationAB;assert.equal(entry.productionRenderProfile.profile,entry.requestedRenderProfile);}
    if(productionSmokeOnly){
      await inputCDP.detach();entry.performanceScope='Short same-instance production UI/weapon/movement smoke only; no trace or timed performance inference. Reuse the previously completed timed A/B/A receipts.';await runProductionValidation(entry);entry.status='completed';entry.finishedAt=new Date().toISOString();await writeFile(path.join(output,name+'-report.json'),JSON.stringify(entry,null,2));console.log(JSON.stringify({event:'production-smoke-only-complete',name,menu:entry.productionMenuSmoke,weapon:entry.productionWeaponSmoke.checks,movement:entry.productionMovementSmoke}));await closeCase();continue;
    }
    traceCDP=await context.newCDPSession(page);await traceCDP.send('Tracing.start',{categories:categories.join(','),transferMode:'ReturnAsStream',options:'record-continuously'});traceRunning=true;await pause(2500);await page.evaluate(()=>window.__latencyCapture.start());entry.input=await drive(inputCDP,origin,seconds*1000);entry.inputSettle={durationMs:100,reason:'Static prefix and suffix prevent pending/coalesced event boundaries from invalidating the dual-stream count comparison.'};await pause(entry.inputSettle.durationMs);entry.raw=await page.evaluate(()=>window.__latencyCapture.stop());await pause(2500);entry.after=await inspect();entry.webglError=await page.evaluate(()=>window.__latencyCapture.refs.renderer.getContext().getError());await inputCDP.detach();
    // The fixture authority shares this Node event loop. Stop active gameplay
    // input before gzip/JSON/offline analysis, otherwise queued 60Hz commands
    // can be delivered in a burst after the synchronous work and trip the
    // unchanged server's 180 message/s limiter. This is test orchestration only.
    await page.keyboard.press('Escape');await page.waitForFunction(()=>document.pointerLockElement===null&&!document.querySelector('#resume').hidden);entry.connectionBeforeAnalysis=await connectionContext();assert.equal(entry.connectionBeforeAnalysis.authorityPresent,true);
    const saved=await stopTrace(name);entry.traceFile=saved.filename;entry.traceBytes=saved.bytes;const trace=saved.trace,start=trace.traceEvents.find(e=>e.name==='cs2-latency-measurement-start'),end=trace.traceEvents.find(e=>e.name==='cs2-latency-measurement-end');assert.ok(start&&end);entry.traceWindow={rendererPid:start.pid,mainThreadId:start.tid,startTsUs:start.ts,endTsUs:end.ts};
    const preliminary=analyzeChromiumPresentationTrace(trace,{rendererPid:start.pid}),layers=preliminary.candidates.layerTrees.filter(layer=>String(layer.rendererPid)===String(start.pid));assert.equal(layers.length,1,'Unique page compositor layer required');entry.traceWindow.layerTreeHostId=layers[0].layerTreeHostId;
    try{const {analyzeCS2PresentationMetrics}=await import('./fixtures/cs2-presentation-metrics.mjs');entry.presentation=analyzeCS2PresentationMetrics(trace,{rendererPid:start.pid,mainThreadId:start.tid,layerTreeHostId:layers[0].layerTreeHostId,window:{startTsUs:start.ts,endTsUs:end.ts}});}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND')entry.presentationUnavailable='Metrics helper is not present yet; saved trace is authoritative';else throw error;}
    const raw=entry.raw;entry.summary={frames:raw.frames.length,windowMs:raw.endedAt-raw.at,fps:raw.frames.length*1000/(raw.endedAt-raw.at),cpuMs:stats(raw.frames.map(f=>f.ended-f.started)),renderSubmitMs:stats(raw.frames.map(f=>f.renderSubmitMs)),submissionControlMs:stats(raw.frames.map(f=>f.submissionControlMs)),intervalMs:stats(raw.frames.map(f=>f.interval)),gpuMs:stats(raw.gpuSamples.map(sample=>sample.ms)),inputs:raw.inputs.length,nonzeroInputs:raw.inputs.filter(i=>i.movementX||i.movementY).length,mouseHandlerYawResidual:stats(raw.inputs.map(i=>Math.abs(i.yawResidual))),inputEventAgeAtFrameStartMs:stats(raw.frames.filter(f=>f.lastSelectedInputEventTimestamp!==null).map(f=>f.started-f.lastSelectedInputEventTimestamp)),inputReceivedAgeAtFrameStartMs:stats(raw.frames.filter(f=>f.lastSelectedInputReceivedAt!==null).map(f=>f.started-f.lastSelectedInputReceivedAt)),programCounts:[...new Set(raw.frames.map(f=>f.programs))],renderRatios:[...new Set(raw.frames.map(f=>f.ratio))],unlockedFrames:raw.frames.filter(f=>f.pointerLocked!=='game').length,unfocusedFrames:raw.frames.filter(f=>!f.focused).length,hiddenFrames:raw.frames.filter(f=>f.visibility!=='visible').length};
    entry.inputStreams=Object.fromEntries(['mousemove','pointerrawupdate'].map(type=>{const events=raw.referenceInputs.filter(input=>input.type===type);return[type,{listenerRegistered:type==='mousemove'||raw.inputEventType==='pointerrawupdate',events:events.length,movementX:events.reduce((sum,input)=>sum+input.movementX,0),movementY:events.reduce((sum,input)=>sum+input.movementY,0),absoluteMovementX:events.reduce((sum,input)=>sum+Math.abs(input.movementX),0),absoluteMovementY:events.reduce((sum,input)=>sum+Math.abs(input.movementY),0),allTrusted:events.every(input=>input.trusted)}];}));
    if(raw.inputEventType==='pointerrawupdate'){entry.inputProbeScope='Semantic/count-conservation probe; earlier eventTimestamp or handler dispatch does not establish earlier presentation or physical input-to-photon improvement.';assert.ok(entry.inputStreams.pointerrawupdate.events>seconds*30,'Raw-update experiment requires actual trusted raw events');assert.ok(entry.inputStreams.mousemove.events>seconds*10,'Raw-update reference requires actual trusted mousemove events');for(const field of ['movementX','movementY'])assert.equal(entry.inputStreams.pointerrawupdate[field],entry.inputStreams.mousemove[field],'Stable dual-stream cumulative relative counts must match: '+field);assert.equal(entry.inputStreams.mousemove.allTrusted,true);assert.equal(entry.inputStreams.pointerrawupdate.allTrusted,true);}
    assert.equal(entry.webglError,0);assert.deepEqual(entry.errors,[]);assert.ok(raw.inputs.length>seconds*30&&raw.inputs.every(i=>i.trusted));assert.ok(raw.inputs.some(i=>i.movementX>0)&&raw.inputs.some(i=>i.movementX<0));assert.ok(entry.summary.mouseHandlerYawResidual.max<1e-8);assert.equal(entry.summary.unlockedFrames,0);assert.equal(entry.summary.unfocusedFrames,0);assert.equal(entry.summary.hiddenFrames,0);assert.deepEqual(entry.summary.renderRatios,[config.ratio]);assert.deepEqual(entry.summary.programCounts,[programB]);assert.ok(raw.frames.every(f=>f.fov===entry.before.view.fov&&f.aspect===entry.before.view.aspect),'Resolution experiment must not change FOV or aspect');assert.ok(raw.frames.every(f=>Math.hypot(f.position.x-entry.before.view.position.x,f.position.y-entry.before.view.position.y,f.position.z-entry.before.view.position.z)<1e-5),'Stationary test must not move player');
    if(report.cases.length>1){const reference=report.cases[0];assert.deepEqual(entry.before.context.viewport,reference.before.context.viewport,'Native viewport must match the baseline');assert.deepEqual(entry.before.context.screen,reference.before.context.screen,'Actual screen must match the baseline');assert.deepEqual(entry.before.view.position,reference.before.view.position,'T0 position must match the baseline');for(const field of ['yaw','pitch','cameraYaw','cameraPitch'])assert.ok(Math.abs(entry.before.view[field]-reference.before.view[field])<1e-7,'Initial view must match: '+field);assert.equal(entry.before.view.aspect,reference.before.view.aspect);assert.equal(entry.before.view.fov,reference.before.view.fov);assert.equal(entry.before.draw.calls,reference.before.draw.calls,'Same stable viewpoint must submit the same draw count');assert.equal(entry.before.draw.triangles,reference.before.draw.triangles,'Same stable viewpoint must submit the same geometry');}
    entry.screenshot=path.join(output,name+'.png');await page.screenshot({path:entry.screenshot});
    if(productionSmoke&&name===variants.at(-1))await runProductionValidation(entry);
    entry.status='completed';entry.finishedAt=new Date().toISOString();await writeFile(path.join(output,name+'-report.json'),JSON.stringify(entry,null,2));console.log(JSON.stringify({event:'case-complete',name,summary:entry.summary,presentation:entry.presentation?.summary??entry.presentation}));await closeCase();
    await pause(500);
  }
  assert.equal(sha(await readFile(path.join(root,'public/cs2-client.js'))),plan.originalSha256,'Production source must remain unchanged during experiment');report.status='completed';
}catch(error){report.status=cancelled?'cancelled':'failed';report.failure=error.stack;if(error.nativeWindowCalibration)report.failureNativeWindowCalibration=error.nativeWindowCalibration;if(page&&server)report.failureConnectionContext=await connectionContext();process.exitCode=1;console.error(error.stack);}
finally{try{await closeCase();}catch(error){report.errors.push('Case cleanup: '+error.message);}try{await server?.close();report.fixtureClosed=true;}catch(error){report.errors.push('Authority cleanup: '+error.message);}if(report.errors.length&&report.status==='completed'){report.status='cleanup-failed';process.exitCode=1;}process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);report.finishedAt=new Date().toISOString();await mkdir(output,{recursive:true});await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,output,fixtureClosed:report.fixtureClosed,ownChromeProfileRemoved:profile===null,failure:report.failure},null,2));}
