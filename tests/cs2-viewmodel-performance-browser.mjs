// Real-render A/B receipt. Owns one native Chrome profile and a port:0 loopback
// authority. It never attaches to, stops, or restarts the persistent 3001 service.
// Preparation only: node tests/cs2-viewmodel-performance-browser.mjs --dry-run
// Explicit GPU run: node tests/cs2-viewmodel-performance-browser.mjs --run
// Optional: --headless --seconds=10 --warmup-ms=2000 --cpu-probe-ms=1000
//           --cases=ak47,knife,awp,aug-ads,sg552-ads --repeat=1 --order=balanced
// Moving receipt: --run --motion (AK/knife, 15 seconds each camera, three jumps)
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createExperimentalServer} from '../cs2-server.mjs';
import {CS2_WEAPON_PROFILE} from '../public/cs2-weapon-profile.js';
import {instrumentCS2FrameBody} from './fixtures/cs2-frame-observer.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const args=new Set(process.argv.slice(2));
const option=(name,fallback)=>process.argv.find(v=>v.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
const frameMode=option('frame-mode','deferred');assert.ok(['inline','deferred'].includes(frameMode));
const numeric=(name,fallback,min,max)=>{const n=Number(option(name,fallback));assert.ok(Number.isFinite(n)&&n>=min&&n<=max,'Invalid --'+name);return n;};
const motion=args.has('--motion');
const seconds=numeric('seconds',motion?15:10,1,120),warmupMs=numeric('warmup-ms',2000,0,60000),cpuProbeMs=numeric('cpu-probe-ms',motion?0:1000,0,5000),repeat=numeric('repeat',1,1,10);
assert.ok(Number.isInteger(repeat),'--repeat must be an integer');
const order=option('order','balanced');assert.ok(['balanced','current-first','legacy-first'].includes(order),'Invalid --order');
const allCases=[{name:'ak47',weapon:'ak47'},{name:'knife',weapon:'knife'},{name:'awp',weapon:'awp'},{name:'aug-ads',weapon:'aug',ads:true},{name:'sg552-ads',weapon:'sg552',ads:true}];
const names=option('cases',motion?'ak47,knife':allCases.map(v=>v.name).join(',')).split(','),cases=names.map(name=>{const c=allCases.find(v=>v.name===name);assert.ok(c,'Unknown --cases value '+name);return c;});
const headed=!args.has('--headless'),runId=new Date().toISOString().replace(/[:.]/g,'-');
const artifactRoot=path.resolve(root,option('output','artifacts/cs2-viewmodel-performance/'+runId));
const variants=['current','legacy-world-camera'];
const plan={headed,motion,frameMode,observerTarget:'actual-frame-body',viewport:{width:1920,height:1080,dpr:1,quality:'sharp'},seconds,warmupMs,cpuProbeMs,repeat,order,cases,variants,artifactRoot,
  comparison:'Current native poses, knife visibility and presentation offsets in both arms. Only the foreground renderer camera changes: independent viewmodel camera versus the same world camera temporarily on layer 1. This is not a checkout of all historical code.',
  metrics:['whole-window RAF timestamp and actual frame-body entry cadence, including all stalls','whole-window callbacks / elapsed wall seconds','actual app frame-body CPU elapsed','actual WebGL draw* calls and renderer triangles per pass','CPU submission elapsed per renderer.render pass, not GPU pass time','existing non-nested whole-frame GPU timer','long tasks','renderer program counts','separate short matrix-call CPU probe, excluded from baseline'],
  ownership:'One new port:0 server bound to 127.0.0.1 and one mkdtemp Chrome profile; finally closes only these fixtures. No connection to production 3001.'};
if(!args.has('--run')||args.has('--dry-run')||args.has('--help')){
  const injected=injectClient(await readFile(path.join(root,'public/cs2-client.js'),'utf8'));
  execFileSync(process.execPath,['--check','--input-type=module'],{input:injected,stdio:['pipe','pipe','pipe']});
  console.log(JSON.stringify({status:'prepared-not-run',testOnlyRouteSyntaxChecked:true,...plan},null,2));process.exit(0);
}

const report={status:'running',startedAt:new Date().toISOString(),...plan,scope:'One actual native Chrome renderer and one actual loopback player on the complete native map. Scripted input; no physical panel, mouse, LAN or multi-machine certification.',errors:[],requests:[],setups:[],phases:[]};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fingerprints(){
  const files=[...(await readdir(path.join(root,'public'),{recursive:true})).filter(n=>!n.startsWith('assets/')&&/\.(?:js|html|css)$/.test(n)).map(n=>'public/'+n),...(await readdir(root)).filter(n=>n.endsWith('.mjs')),
    'tests/cs2-viewmodel-performance-browser.mjs','tests/fixtures/cs2-frame-observer.mjs','package.json','package-lock.json','public/assets/cs2-content/runtime.json','public/assets/cs2-physics/manifest.json','public/assets/cs2-optimized/map.json','public/assets/cs2-optimized/textures.json'];
  return Object.fromEntries(await Promise.all([...new Set(files)].sort().map(async file=>[file,sha(await readFile(path.join(root,file)))])));
}
function screenState(){try{const raw=execFileSync('python3',['-c',"import subprocess,plistlib,json;d=plistlib.loads(subprocess.check_output(['/usr/sbin/ioreg','-n','Root','-d','1','-a']));print(json.dumps({'locked':any(x.get('CGSSessionScreenIsLocked') is True for x in d[0].get('IOConsoleUsers',[]))}))"],{encoding:'utf8',timeout:3000,stdio:['ignore','pipe','pipe']});return{available:true,...JSON.parse(raw)};}catch(e){return{available:false,locked:null,error:e.message.slice(0,150)};}}
function stats(values){const a=values.filter(Number.isFinite).sort((x,y)=>x-y),q=p=>a.length?a[Math.ceil((a.length-1)*p)]:null;return{samples:a.length,min:a[0]??null,p50:q(.5),p95:q(.95),p99:q(.99),max:a.at(-1)??null,mean:a.length?a.reduce((s,v)=>s+v,0)/a.length:null};}
function summarize(raw){
  const passes=raw.frames.flatMap(f=>f.passes),byPass={};
  for(const kind of [...new Set(passes.map(p=>p.kind))]){const items=passes.filter(p=>p.kind===kind);byPass[kind]={samples:items.length,cpuSubmissionMs:stats(items.map(p=>p.cpuMs)),actualGLDrawCalls:stats(items.map(p=>p.glDraws)),rendererDrawCalls:stats(items.map(p=>p.calls)),triangles:stats(items.map(p=>p.triangles)),programCounts:stats(items.map(p=>p.programs))};}
  const callbackIntervals=raw.frames.slice(1).map(f=>f.callbackIntervalMs),rafIntervals=raw.frames.slice(1).map(f=>f.rafIntervalMs);
  const trajectory=raw.frames.filter(f=>f.camera&&f.motion),steps=trajectory.slice(1).map((f,i)=>{const previous=trajectory[i],dt=(f.callbackOffsetMs-previous.callbackOffsetMs)/1000;return{atMs:f.callbackOffsetMs,distance:Math.hypot(f.camera.x-previous.camera.x,f.camera.y-previous.camera.y,f.camera.z-previous.camera.z),localDistance:Math.hypot(f.motion.local.x-previous.motion.local.x,f.motion.local.y-previous.motion.local.y,f.motion.local.z-previous.motion.local.z),yawDelta:Math.abs(Math.atan2(Math.sin(f.camera.yaw-previous.camera.yaw),Math.cos(f.camera.yaw-previous.camera.yaw))),dt};});
  return{observerTarget:'actual-frame-body',frameSchedulingModes:[...new Set(raw.frames.map(f=>f.motion?.frameScheduling?.mode))],windowMs:raw.durationMs,callbacks:raw.frames.length,callbacksPerWallSecond:raw.frames.length*1000/raw.durationMs,firstCallbackOffsetMs:raw.frames[0]?.callbackOffsetMs??null,lastCallbackToWindowEndMs:raw.frames.length?raw.durationMs-raw.frames.at(-1).callbackOffsetMs:null,
    callbackWallIntervalMs:stats(callbackIntervals),rafTimestampIntervalMs:stats(rafIntervals),callbackCpuMs:stats(raw.frames.map(f=>f.cpuMs)),actualGLDrawCallsPerCallback:stats(raw.frames.map(f=>f.glDraws)),rendererPassesPerCallback:stats(raw.frames.map(f=>f.passes.length)),
    callbackIntervalsOver33ms:callbackIntervals.filter(v=>v>33).length,callbackIntervalsOver50ms:callbackIntervals.filter(v=>v>50).length,noRenderCallbacks:raw.frames.filter(f=>!f.passes.length).length,
    hiddenCallbacks:raw.frames.filter(f=>f.visibility!=='visible').length,unfocusedCallbacks:raw.frames.filter(f=>!f.focused).length,longTaskCount:raw.longTasks.length,longTaskTotalMs:raw.longTasks.reduce((s,t)=>s+t.ms,0),longTaskMs:stats(raw.longTasks.map(t=>t.ms)),wholeWindowGpuMs:stats(raw.gpuSamples.map(s=>s.ms)),passes:byPass,programsBefore:raw.programsBefore,programsAfter:raw.programsAfter,
    textureUploadCalls:raw.textureUploads.length,textureUploadsByMethod:Object.fromEntries([...new Set(raw.textureUploads.map(t=>t.method))].map(method=>[method,raw.textureUploads.filter(t=>t.method===method).length])),resourceCompletions:raw.resources.length,
    trajectory:{samples:trajectory.length,travelledMetres:steps.reduce((s,v)=>s+v.distance,0),cameraStepMetres:stats(steps.map(v=>v.distance)),localStepMetres:stats(steps.map(v=>v.localDistance)),cameraYawStepRadians:stats(steps.map(v=>v.yawDelta)),visualCorrectionMetres:stats(trajectory.map(f=>Math.hypot(f.motion.correction.x,f.motion.correction.y,f.motion.correction.z))),lastPredictionCorrectionMetres:stats(trajectory.map(f=>f.motion.lastCorrection)),cameraMinusPredictedHorizontalMetres:stats(trajectory.map(f=>Math.hypot(f.camera.x-f.motion.local.x,f.camera.z-f.motion.local.z))),takeoffs:trajectory.slice(1).filter((f,i)=>trajectory[i].motion.grounded&&!f.motion.grounded).length,largeSteps:steps.filter(f=>f.distance>.25||f.yawDelta>.05)}};
}

// Install only small counters in baseline. The expensive matrix traversal
// counters are installed and restored separately after each baseline window.
function installCapture(){
  const control={variant:'current',active:null,frame:null,refs:null,glDraws:0,objectCapture:{},matrixRestore:null,scriptedControls:false,motion:null};
  window.__viewmodelPerf=control;
  // A real mouse move reached the first receipt's final SG phase. Isolate only
  // this test page's scripted controls; production input handlers are unchanged.
  for(const type of ['mousemove','mousedown','mouseup','keydown','keyup'])document.addEventListener(type,event=>{if(control.scriptedControls&&event.isTrusted)event.stopImmediatePropagation();},true);
  control.beforeFrame=timestamp=>{
      const sample=control.active;
      if(!sample){if(control.matrixRestore)control.matrixFrames++;return null;}
      const start=performance.now(),frame={timestamp,observerTarget:'actual-frame-body',callbackOffsetMs:start-sample.at,rafIntervalMs:sample.lastRAF===null?null:timestamp-sample.lastRAF,callbackIntervalMs:sample.lastWall===null?null:start-sample.lastWall,visibility:document.visibilityState,focused:document.hasFocus(),passes:[]},drawBefore=control.glDraws;
      if(control.motion){const m=control.motion,t=Math.max(0,start-m.at),fraction=Math.min(1,t/m.durationMs),segments=[['KeyW'],['KeyW','KeyD'],['KeyD'],['KeyS'],['KeyS','KeyA'],['KeyA'],['KeyW','KeyA']],segment=Math.min(segments.length-1,Math.floor(fraction*segments.length)),keys=segments[segment].slice();if([.12,.45,.78].some(at=>fraction>=at&&fraction<at+.008))keys.push('Space');const signature=keys.join(',');if(signature!==m.keys){window.cs2Automation.setKeys(keys);m.keys=signature;sample.inputEdges.push({atMs:t,keys});}const yaw=m.yaw+Math.sin(fraction*2*Math.PI)*Math.PI/6;window.cs2Automation.look(yaw,m.pitch);frame.expectedYaw=yaw;}
      sample.lastRAF=timestamp;sample.lastWall=start;control.frame=frame;return{sample,start,frame,drawBefore};
  };
  control.afterFrame=record=>{if(!record)return;const{sample,start,frame,drawBefore}=record;try{frame.cpuMs=performance.now()-start;frame.glDraws=control.glDraws-drawBefore;const camera=control.refs.worldCamera;frame.camera={x:camera.position.x,y:camera.position.y,z:camera.position.z,yaw:camera.rotation.y,pitch:camera.rotation.x,roll:camera.rotation.z};frame.motion=control.refs.readMotion();frame.programs=control.refs.renderer.info.programs?.length??null;sample.frames.push(frame);}finally{control.frame=null;}};
  for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','drawRangeElements']){
    const prototype=window.WebGL2RenderingContext?.prototype,original=prototype?.[name];if(!original)continue;
    prototype[name]=function(...values){if(control.active)control.glDraws++;return Reflect.apply(original,this,values);};
  }
  for(const method of ['texImage2D','texSubImage2D','compressedTexImage2D','compressedTexSubImage2D','texImage3D','texSubImage3D','compressedTexImage3D','compressedTexSubImage3D']){const prototype=window.WebGL2RenderingContext?.prototype,original=prototype?.[method];if(!original)continue;prototype[method]=function(...values){const s=control.active;if(s)s.textureUploads.push({method,atMs:performance.now()-s.at,level:values[1],arguments:values.slice(2,6).map(v=>typeof v==='number'?v:null)});return Reflect.apply(original,this,values);};}
  control.captureReady=import('/vendor/three.module.js').then(THREE=>{
    control.THREE=THREE;const add=THREE.Object3D.prototype.add;
    THREE.Object3D.prototype.add=function(...objects){for(const o of objects){if(this.isScene&&o.isPerspectiveCamera&&!control.objectCapture.worldCamera)control.objectCapture.worldCamera=o;if(o.name==='cs2-native-viewmodel-camera'&&!control.objectCapture.viewmodelCamera)control.objectCapture.viewmodelCamera=o;if(o.name==='source2-native-viewmodel'&&this.parent?.isCamera&&!control.objectCapture.nativeRoot)control.objectCapture.nativeRoot=o;}return Reflect.apply(add,this,objects);};
  });
  control.attach=refs=>{
    control.refs=refs;const render=refs.renderer.render;
    refs.renderer.render=function(scene,camera){
      const sample=control.active;if(!sample)return Reflect.apply(render,this,arguments);
      const kind=camera===refs.viewmodelCamera||camera===refs.worldCamera&&camera.layers.mask===2?'foreground':camera===refs.worldCamera?'world':'other';
      const before={calls:this.info.render.calls,triangles:this.info.render.triangles,gl:control.glDraws},start=performance.now();
      try{return Reflect.apply(render,this,arguments);}finally{const pass={kind,cameraName:camera.name,cameraFov:camera.fov,layerMask:camera.layers.mask,cpuMs:performance.now()-start,calls:this.info.render.calls-before.calls,triangles:this.info.render.triangles-before.triangles,glDraws:control.glDraws-before.gl,programs:this.info.programs?.length??null};if(control.frame)control.frame.passes.push(pass);else sample.outOfFramePasses.push(pass);}
    };
  };
  control.start=()=>{
    if(control.active)throw Error('Overlapping measurement');
    const sample={at:performance.now(),lastRAF:null,lastWall:null,frames:[],longTasks:[],gpuSamples:[],textureUploads:[],resources:[],inputEdges:[],outOfFramePasses:[],programsBefore:control.refs.renderer.info.programs?.length??null};
    sample.observer=new PerformanceObserver(list=>sample.longTasks.push(...list.getEntries().filter(e=>e.startTime>=sample.at).map(e=>({atMs:e.startTime-sample.at,ms:e.duration}))));sample.observer.observe({type:'longtask'});control.active=sample;
    sample.resourceObserver=new PerformanceObserver(list=>sample.resources.push(...list.getEntries().filter(e=>e.startTime>=sample.at).map(e=>({url:e.name,startAtMs:e.startTime-sample.at,durationMs:e.duration,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize,initiator:e.initiatorType}))));sample.resourceObserver.observe({type:'resource'});
  };
  control.recordGpu=sample=>{const active=control.active;if(active&&sample.submittedAt>=active.at&&sample.tag?.active&&sample.completedAt-sample.submittedAt<=500)active.gpuSamples.push({ms:sample.ms,submittedAtMs:sample.submittedAt-active.at,completedAtMs:sample.completedAt-active.at,serial:sample.serial,ratio:sample.tag.ratio});};
  control.stop=()=>{
    const s=control.active;if(!s)throw Error('No measurement');control.active=null;
    s.durationMs=performance.now()-s.at;s.programsAfter=control.refs.renderer.info.programs?.length??null;
    s.longTasks.push(...s.observer.takeRecords().filter(e=>e.startTime>=s.at).map(e=>({atMs:e.startTime-s.at,ms:e.duration})));s.observer.disconnect();s.resources.push(...s.resourceObserver.takeRecords().filter(e=>e.startTime>=s.at).map(e=>({url:e.name,startAtMs:e.startTime-s.at,durationMs:e.duration,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize,initiator:e.initiatorType})));s.resourceObserver.disconnect();delete s.observer;delete s.resourceObserver;delete s.lastRAF;delete s.lastWall;return s;
  };
  control.identity=()=>{
    const r=control.refs,o=control.objectCapture;
    return{attached:!!r,capturedWorldCamera:o.worldCamera===r?.worldCamera,capturedNamedViewmodelCamera:o.viewmodelCamera===r?.viewmodelCamera,nativeRoot:!!o.nativeRoot,viewmodelParentIsWorld:o.viewmodelCamera?.parent===r?.worldCamera,variant:control.variant,
      worldCamera:r?{fov:r.worldCamera.fov,near:r.worldCamera.near,far:r.worldCamera.far,layers:r.worldCamera.layers.mask,position:r.worldCamera.position.toArray()}:null,
      viewmodelCamera:r?{fov:r.viewmodelCamera.fov,near:r.viewmodelCamera.near,far:r.viewmodelCamera.far,layers:r.viewmodelCamera.layers.mask}:null,nativeGroup:o.nativeRoot?.parent?{position:o.nativeRoot.parent.position.toArray(),scale:o.nativeRoot.parent.scale.toArray(),visible:o.nativeRoot.parent.visible}:null};
  };
  control.beginMatrixProbe=async()=>{
    await control.captureReady;if(control.active||control.matrixRestore)throw Error('Matrix probe overlaps baseline');
    const result={at:performance.now(),methods:{}},originals={},prototype=control.THREE.Object3D.prototype;control.matrixFrames=0;
    for(const name of ['updateWorldMatrix','updateMatrixWorld']){
      const original=prototype[name];originals[name]=original;const counters={total:0,scene:0,worldCamera:0,viewmodelCamera:0,nativeGroup:0,updateParentsTrue:0,updateChildrenTrue:0,types:{}};result.methods[name]=counters;
      prototype[name]=function(...values){counters.total++;if(this===control.refs.scene)counters.scene++;if(this===control.refs.worldCamera)counters.worldCamera++;if(this===control.refs.viewmodelCamera)counters.viewmodelCamera++;if(this===control.objectCapture.nativeRoot?.parent)counters.nativeGroup++;if(name==='updateWorldMatrix'&&values[0]===true)counters.updateParentsTrue++;if(name==='updateWorldMatrix'&&values[1]===true)counters.updateChildrenTrue++;const type=this.type||'unknown';counters.types[type]=(counters.types[type]||0)+1;return Reflect.apply(original,this,values);};
    }
    control.matrixRestore=()=>{for(const [name,original]of Object.entries(originals))prototype[name]=original;result.durationMs=performance.now()-result.at;result.callbacks=control.matrixFrames;control.matrixRestore=null;return result;};
  };
}

function injectClient(source){
  const attachment='const viewmodelProjection=createViewmodelCamera(THREE,camera),viewmodelCamera=viewmodelProjection.camera;';
  const foreground='renderer.render(scene,viewmodelCamera);';
  const warmup='const presentationWarmup=createPresentationWarmup(THREE,renderer,scene,camera,{canRun:()=>!preparingRenderPass&&!locked&&!preview&&!document.hidden});';
  const gpu='onSample:sample=>{if(sample.tag?.active';
  assert.equal(source.split(attachment).length-1,1,'Client camera attachment anchor changed');
  assert.equal(source.split(foreground).length-1,1,'Client foreground render anchor changed');
  assert.equal(source.split(warmup).length-1,1,'Client warmup anchor changed');
  assert.equal(source.split(gpu).length-1,1,'Client GPU sample anchor changed');
  const injected=source.replace(attachment,attachment+'\nwindow.__viewmodelPerf.attach({renderer,scene,worldCamera:camera,viewmodelCamera,readMotion:()=>{const authority=player();return{local:local?{x:local.x,y:local.y,z:local.z,vx:local.vx,vy:local.vy,vz:local.vz}:null,authority:authority?{x:authority.x,y:authority.y,z:authority.z,vx:authority.vx,vy:authority.vy,vz:authority.vz,grounded:authority.grounded}:null,grounded:local?.grounded??null,correction:{...correction},lastCorrection,predictionRecoveryActive:recoveryCorrection,fractionSeconds:physicsAccumulator,inputSeq,ackInputSeq:authority?.ackInputSeq,renderY,cameraEyeOffset:local?renderY-local.y-RULES.eye:null,cameraSmoothing:playerCamera.diagnostics(),frameScheduling:typeof frameScheduler==="undefined"?null:frameScheduler.diagnostics(),yaw,pitch};}});')
    .replace(warmup,warmup+'\nwindow.__viewmodelPerf.warmup=presentationWarmup;')
    .replace(gpu,'onSample:sample=>{window.__viewmodelPerf.recordGpu(sample);if(sample.tag?.active')
    .replace(foreground,"if(window.__viewmodelPerf.variant==='legacy-world-camera'){const savedMask=camera.layers.mask;camera.layers.set(1);try{renderer.render(scene,camera);}finally{camera.layers.mask=savedMask;}}else{renderer.render(scene,viewmodelCamera);}");
  return instrumentCS2FrameBody(injected,{before:'window.__viewmodelPerf.beforeFrame(now)',after:'window.__viewmodelPerf.afterFrame(__cs2ObservedFrame);'});
}

let server,browser,context,page,profile,p,cancelled=false,setupIndex=null,activeNetworkPhase=null;
const cancel=()=>{cancelled=true;void context?.close().catch(()=>{});};
process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
const inspect=()=>page.evaluate(()=>({identity:window.__viewmodelPerf.identity(),diagnostics:window.lanStrike.getDiagnostics(),performance:window.lanStrike.getPerformance(),draw:window.lanStrike.getRenderInfo(),focused:document.hasFocus(),visibility:document.visibilityState,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}}));
async function prepareCase(c){
  await page.evaluate(()=>{window.cs2Automation.fire(false);window.cs2Automation.setKeys([]);window.__viewmodelPerf.scriptedControls=true;window.__viewmodelPerf.start();});
  const g=server.game;p.team=CS2_WEAPON_PROFILE.guns[c.weapon]?.teams[0]||'T';p.character=p.team==='T'?'terror':'urban';g.begin();g.phase='live';g.endAt=g.time+10000;g.buyEndAt=g.time+10000;g.smokes=[];g.projectiles=[];g.drops=[];g.bomb={state:'none'};p.money=16000;
  if(c.weapon!=='knife'&&!p.inventory[c.weapon])assert.ok(g.buy(p.id,c.weapon),'Fixture purchase '+c.weapon);g.equip(p.id,c.weapon);assert.equal(p.weapon,c.weapon,'Fixture equip '+c.weapon);g.drops=[];
  // Keep one identical map view across CT/T-only weapon purchases.
  const spawn=server.world.resolveSpawn('T',0);Object.assign(p,{x:spawn.x,y:spawn.y,z:spawn.z,yaw:spawn.yaw,pitch:.03,vx:0,vy:0,vz:0,grounded:true,hp:1e9,nextAttackAt:0,nextSecondaryAt:0,nextShotAt:g.time,reloadAt:0,recoilYaw:0,recoilPitch:0,lastShot:g.time-10});
  server.broadcastState();await page.waitForFunction(({weapon,round})=>{const d=window.lanStrike.getDiagnostics();return window.lanStrike.getState()?.round===round&&d.weapon===weapon&&d.weaponModel.id===weapon&&d.weaponModel.source==='source2-native-gltf'&&!d.weaponModel.loading;},{weapon:c.weapon,round:g.round});
  await page.evaluate(({yaw,pitch})=>{window.cs2Automation.look(yaw,pitch);window.cs2Automation.start();},{yaw:p.yaw,pitch:p.pitch});
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().weaponModel.sequence==='idle');
  if(c.ads){assert.ok(g.secondary(p.id),'Fixture ADS '+c.weapon);server.broadcastState();await page.waitForFunction(()=>{const w=window.lanStrike.getDiagnostics().weaponModel;return w.sequence==='zoomIdle'&&w.ads?.amount>.98;});}
  await page.evaluate(()=>{window.cs2Automation.stop();window.__viewmodelPerf.warmup.resume();});
  await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return(d.mapStreaming.remaining??0)===0&&d.presentationWarmup.queued===0&&!d.presentationWarmup.running;});
  await page.evaluate(()=>window.cs2Automation.start());
  assert.equal(server.game.players.size,1);const d=await inspect();assert.equal(d.diagnostics.remoteModels.length,0);assert.equal(d.diagnostics.weaponModel.error,null);assert.equal(d.identity.nativeGroup.visible,true);const raw=await page.evaluate(()=>window.__viewmodelPerf.stop());setupIndex=report.setups.length;report.setups.push({case:c.name,summary:summarize(raw),raw});return d;
}
async function measure(c,variant,iteration){
  if(cancelled)throw Error('Cancelled');await page.bringToFront();await page.evaluate(variant=>{window.__viewmodelPerf.variant=variant;window.cs2Automation.resetMetrics();},variant);await page.waitForTimeout(warmupMs);
  const before=await inspect(),osBefore=screenState();console.log(JSON.stringify({event:'phase-start',case:c.name,variant,iteration,seconds}));
  assert.equal(before.diagnostics.frameScheduling.mode,frameMode);assert.equal(before.viewport.width,1920);assert.equal(before.viewport.height,1080);assert.equal(before.viewport.dpr,1);assert.equal(before.performance.pixelRatio,1);assert.equal(before.performance.drawingBuffer.width,1920);assert.equal(before.performance.drawingBuffer.height,1080);assert.equal(before.identity.capturedNamedViewmodelCamera,true);assert.equal(before.identity.capturedWorldCamera,true);
  const nodeStarted=performance.now(),networkRequests=[];activeNetworkPhase={at:nodeStarted,requests:networkRequests};await page.evaluate(({motion,durationMs})=>{window.cs2Automation.resetMetrics();window.__viewmodelPerf.start();if(motion){const c=window.__viewmodelPerf;const m=c.refs.readMotion();c.motion={at:c.active.at,durationMs,yaw:m.yaw,pitch:.03,keys:null};}},{motion,durationMs:seconds*1000});await page.waitForTimeout(seconds*1000);const raw=await page.evaluate(()=>{const c=window.__viewmodelPerf;c.motion=null;window.cs2Automation.setKeys([]);return c.stop();}),nodeElapsedMs=performance.now()-nodeStarted;activeNetworkPhase=null;const after=await inspect(),summary=summarize(raw);
  assert.ok(raw.frames.length>0,'Actual application frame bodies required');assert.ok(raw.frames.every(f=>f.motion?.frameScheduling?.mode===frameMode),'Actual frame scheduling mode must match the requested mode');assert.ok(raw.frames.every(f=>f.passes.some(p=>p.kind==='world')&&f.passes.some(p=>p.kind==='foreground')),'Every sampled callback renders actual world and foreground');assert.ok(summary.passes.world.triangles.min>0&&summary.passes.foreground.triangles.min>0,'Both passes submit actual triangles');assert.ok(summary.passes.foreground.actualGLDrawCalls.min>0,'Foreground submits actual GL draw calls');assert.equal(after.performance.pixelRatio,1);
  const phase={case:c.name,weapon:c.weapon,ads:!!c.ads,variant,iteration,motion,setupIndex,nodeElapsedMs,summary,raw,networkRequests,before,after,osBefore,osAfter:screenState()};report.phases.push(phase);
  assert.equal(after.diagnostics.pointerInput.events,before.diagnostics.pointerInput.events,'Real mouse input must not contaminate scripted measurement');if(motion){assert.ok(summary.trajectory.travelledMetres>5,'Real authority/prediction movement must travel through map');assert.ok(summary.trajectory.takeoffs>=3,'Three real movement jump takeoffs required');}else{assert.ok(Math.abs(before.diagnostics.input.yaw-after.diagnostics.input.yaw)<1e-8&&Math.abs(before.diagnostics.input.pitch-after.diagnostics.input.pitch)<1e-8,'Static A/B must preserve camera yaw and pitch');}
  if(cpuProbeMs){await page.evaluate(()=>window.__viewmodelPerf.beginMatrixProbe());try{await page.waitForTimeout(cpuProbeMs);}finally{phase.separateCpuMatrixProbe=await page.evaluate(()=>window.__viewmodelPerf.matrixRestore?.());}}
  const screenshot=path.join(artifactRoot,iteration+'-'+c.name+'-'+variant+'.png');await page.screenshot({path:screenshot});phase.screenshot=screenshot;await writeFile(path.join(artifactRoot,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({event:'phase-complete',case:c.name,variant,iteration,summary}));
}

try{
  await mkdir(artifactRoot,{recursive:true});report.sourceHashesBefore=await fingerprints();
  const source=await readFile(path.join(root,'public/cs2-client.js'),'utf8'),injected=injectClient(source);report.testOnlyClientRoute={sourceSHA256:sha(source),injectedSHA256:sha(injected),diskSourceWritten:false};
  server=await createExperimentalServer({port:0,host:'127.0.0.1',presentation:'native',gameOptions:{weaponProfile:'cs2',random:()=>.5,audioRandom:()=>.5}});const address=server.address();assert.equal(address.address,'127.0.0.1');assert.notEqual(address.port,3001);const base='http://127.0.0.1:'+address.port;report.server=base;report.worldContract=server.world.contract;
  profile=await mkdtemp(path.join(os.tmpdir(),'cscs-viewmodel-perf-'));report.ownChromeProfile=profile;
  context=await chromium.launchPersistentContext(profile,{headless:!headed,executablePath:process.env.CS2_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',viewport:{width:1920,height:1080},deviceScaleFactor:1,handleSIGINT:false,handleSIGTERM:false,args:['--window-size=1920,1080','--enable-precise-memory-info','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});browser=context.browser();
  await context.addInitScript(()=>{localStorage.setItem('lan-strike-quality','sharp');});await context.addInitScript(installCapture);await context.route('**/cs2-client.js',route=>route.fulfill({status:200,contentType:'text/javascript; charset=utf-8',body:injected}));page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(120000);
  const requestRecords=new WeakMap();page.on('pageerror',e=>report.errors.push(e.stack||e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|shader|OUT_OF_MEMORY|PropertyBinding/i.test(m.text()))report.errors.push(m.text());});page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/favicon.ico'))report.requests.push({url:r.url(),status:r.status()});const entry=requestRecords.get(r.request());if(entry){entry.status=r.status();entry.responseAtMs=performance.now()-entry.phaseAt;}});page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))report.requests.push({external:r.url()});if(activeNetworkPhase){const entry={url:r.url(),resourceType:r.resourceType(),atMs:performance.now()-activeNetworkPhase.at,phaseAt:activeNetworkPhase.at};requestRecords.set(r,entry);activeNetworkPhase.requests.push(entry);}});page.on('requestfinished',r=>{const e=requestRecords.get(r);if(e)e.finishedAtMs=performance.now()-e.phaseAt;});page.on('requestfailed',r=>{const e=requestRecords.get(r);if(e)e.failure=r.failure();});
  const startup=performance.now();await page.goto(base+'/?transport=websocket&automation=1&frame='+frameMode);await page.waitForFunction(()=>window.lanStrike&&!document.querySelector('#joinButton').disabled||document.querySelector('#error').textContent);assert.equal(await page.locator('#error').textContent(),'');report.coldReadyMs=performance.now()-startup;
  await page.evaluate(()=>window.__viewmodelPerf.captureReady);const cdp=await browser.newBrowserCDPSession();try{report.gpuSystem=await cdp.send('SystemInfo.getInfo');}finally{await cdp.detach();}report.browser={version:browser.version(),headed};
  report.renderEnvironment=await page.evaluate(()=>{const gl=window.__viewmodelPerf.refs.renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');return{renderer:gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER),vendor:gl.getParameter(debug?debug.UNMASKED_VENDOR_WEBGL:gl.VENDOR),webglVersion:gl.getParameter(gl.VERSION)};});assert.doesNotMatch(report.renderEnvironment.renderer,/swiftshader|llvmpipe|software rasterizer/i,'A hardware GPU is required');report.nativeAppleMetal=/Apple.*M\d|ANGLE Metal Renderer: Apple/i.test(report.renderEnvironment.renderer);if(!headed)assert.equal(report.nativeAppleMetal,true,'Headless run must confirm the actual Apple Metal renderer');console.log(JSON.stringify({event:'renderer-confirmed',headed,...report.renderEnvironment}));
  await page.locator('#joinButton').click();await page.waitForFunction(()=>window.lanStrike.getState()?.players.find(p=>p.id===window.lanStrike.getId())?.alive);p=server.game.players.get(await page.evaluate(()=>window.lanStrike.getId()));assert.ok(p);await page.evaluate(()=>window.cs2Automation.start());
  for(let iteration=1;iteration<=repeat;iteration++)for(const [index,c]of cases.entries()){
    if(!motion)await prepareCase(c);const reverse=order==='legacy-first'||order==='balanced'&&(index+iteration-1)%2===1;
    for(const variant of reverse?variants.slice().reverse():variants){if(motion)await prepareCase(c);await measure(c,variant,iteration);}
  }
  report.sourceHashesAfter=await fingerprints();report.sourcesStable=JSON.stringify(report.sourceHashesBefore)===JSON.stringify(report.sourceHashesAfter);assert.equal(report.sourcesStable,true,'Sources/manifests changed while measuring; receipt cannot identify one stable build');assert.deepEqual(report.errors,[]);assert.deepEqual(report.requests,[]);report.status='completed';
}catch(error){report.status=cancelled?'cancelled':'failed';report.failure=error.stack;process.exitCode=1;console.error(error.stack);try{report.failureDiagnostics=await inspect();}catch{}}
finally{
  try{await page?.evaluate(()=>{window.__viewmodelPerf?.matrixRestore?.();});}catch{}
  for(const [name,close]of [['chrome',()=>context?.close()],['authority',()=>server?.close()]])try{await close();}catch(e){report.errors.push(name+' cleanup: '+e.message);}
  if(profile)try{await rm(profile,{recursive:true,force:true});report.ownChromeProfileRemoved=true;}catch(e){report.errors.push('profile cleanup: '+e.message);}
  process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);report.finishedAt=new Date().toISOString();report.fixtureClosed=true;await mkdir(artifactRoot,{recursive:true});await writeFile(path.join(artifactRoot,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,phases:report.phases.length,artifactRoot,fixtureClosed:report.fixtureClosed,ownChromeProfileRemoved:report.ownChromeProfileRemoved,failure:report.failure},null,2));
}
