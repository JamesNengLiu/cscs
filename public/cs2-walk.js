import * as THREE from '/vendor/three.module.js';
import {loadOptimizedMap} from './cs2-optimized-renderer.js';
import {loadPhysicsPackage} from './cs2-physics-loader.js';
import {createExperimentalWorld} from './cs2-world.js';
import {createWalkCamera} from './cs2-walk-camera.js';
import {createPointerInput} from './pointer-input.js';
import {createInputSampler,crouchPressed} from './controls.js';
import {createMouseSettings} from './mouse-settings.js';
import {PITCH_LIMIT} from './view-settings.js';
import {createGpuTimer} from './gpu-timer.js';

const $=id=>document.getElementById(id),automation=new URLSearchParams(location.search).get('automation')==='1';
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(74,innerWidth/innerHeight,.06,600),renderer=new THREE.WebGLRenderer({canvas:$('world'),antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;scene.add(new THREE.HemisphereLight('#e4f0ff','#82735a',0));const sun=new THREE.DirectionalLight('#fff0ce',1);sun.position.set(-30,90,15);scene.add(sun);camera.rotation.order='YXZ';
const controller=new AbortController();
const load={},errors=[],longTasks=[],keys=new Set(),inputSampler=createInputSampler(),pointer=createPointerInput(renderer.domElement),mouse=createMouseSettings({getItem:key=>localStorage.getItem(key)}),gpuSamples=[],frames=[];
let phase='loading',scriptedInput=null,ready=false,disposed=false,locked=false,testMode=false,player=null,context=null,walkCamera=null,mapRuntime=null,physicsAccumulator=0,previous=performance.now(),ticks=0,yaw=0,pitch=0,lastHud=0,physicsPeakMs=0,lastPhysicsMs=0,cameraPeakMs=0,lastSourceSpawn=null,observer;
try{observer=new PerformanceObserver(list=>{for(const item of list.getEntries())longTasks.push({at:item.startTime,ms:item.duration,stage:ready?'walking':'loading'});});observer.observe({type:'longtask',buffered:true});}catch{}
const gpu=createGpuTimer(renderer.getContext(),{onSample:s=>{gpuSamples.push(s.ms);if(gpuSamples.length>600)gpuSamples.shift();}});
const stat=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return{samples:a.length,mean:a.length?a.reduce((s,x)=>s+x,0)/a.length:null,p99:a[Math.floor((a.length-1)*.99)]??null,max:a.at(-1)??null};};
const input=()=>({f:Number(keys.has('KeyW'))-Number(keys.has('KeyS')),s:Number(keys.has('KeyD'))-Number(keys.has('KeyA')),yaw,pitch,jump:keys.has('Space'),crouch:crouchPressed(keys),walk:keys.has('ShiftLeft')||keys.has('ShiftRight'),fire:false,use:false});
function clearInput(){keys.clear();inputSampler.reset();physicsAccumulator=0;if(player)player.jumpHeld=false;if(player&&walkCamera){walkCamera.reset(player);walkCamera.update(player,{fractionSeconds:context.movement.fixedDt});}}
function suspend(){locked=false;scriptedInput=null;clearInput();document.body.classList.remove('locked');$('hint').textContent='已暂停 · 点击开始行走';if(document.pointerLockElement===renderer.domElement)document.exitPointerLock();}
function fail(error){if(disposed||phase==='failed')return;ready=false;phase='failed';suspend();controller.abort(error);mapRuntime?.dispose();errors.push(error.message);$('error').textContent=error.stack||error.message;$('progress').textContent=error.message;$('start').disabled=true;$('reset').disabled=true;}
function dispose(){if(disposed)return;disposed=true;phase='disposed';ready=false;suspend();controller.abort(new DOMException('Page closed','AbortError'));observer?.disconnect();mapRuntime?.dispose();gpu.dispose();const geometry=new Set(),materials=new Set();scene.traverse(o=>{if(o.geometry)geometry.add(o.geometry);for(const material of Array.isArray(o.material)?o.material:o.material?[o.material]:[])materials.add(material);});for(const g of geometry)g.dispose();for(const m of materials)m.dispose();scene.background?.dispose?.();renderer.dispose();renderer.forceContextLoss();}
window.addEventListener('pagehide',dispose);renderer.domElement.addEventListener('webglcontextlost',()=>{if(!disposed)fail(Error('显卡上下文已丢失，请刷新独立行走页。'));});
function spawn(team=$('team').value,index=Number($('spawn').value)||0){
 const resolved=context.resolveSpawn(team,index);lastSourceSpawn=resolved;player={...resolved,id:'local-walk',alive:true,weapon:'knife',zoom:90,vx:0,vy:0,vz:0,velocityModifier:1,jumpFatigue:0,jumpHeld:false,duckElapsed:0,duckAmount:0,ducking:false,collisionVersion:1,jumpFatigueVersion:1,hitSlowdownVersion:1,hitRecoveryVersion:0};
 yaw=resolved.yaw;pitch=resolved.pitch;clearInput();walkCamera.reset(player);walkCamera.update(player,{fractionSeconds:context.movement.fixedDt});camera.position.set(walkCamera.position.x,walkCamera.position.y,walkCamera.position.z);camera.rotation.set(pitch,yaw,0,'YXZ');mapRuntime?.update(performance.now());$('status').textContent=`${team} 出生点 ${index+1} · 已验证身体落地`;
}
function populateSpawns(){const points=context.spawns[$('team').value];$('spawn').replaceChildren(...points.map((_,i)=>{const o=document.createElement('option');o.value=i;o.textContent='出生点 '+(i+1);return o;}));}
function step(command){
 const started=performance.now();context.movement.step(player,context.movement.sanitizedInput(command));walkCamera.push(player);lastPhysicsMs=performance.now()-started;physicsPeakMs=Math.max(physicsPeakMs,lastPhysicsMs);ticks++;
 if(!['x','y','z','vx','vy','vz'].every(k=>Number.isFinite(player[k])))throw Error('物理状态出现无效数值');
}
function frame(now){if(disposed)return;requestAnimationFrame(frame);const interval=now-previous,dt=Math.min(.1,interval/1000),cpuAt=performance.now();previous=now;if(phase==='failed')return;
 try{gpu.poll(now);if(!ready){if(phase==='loading')mapRuntime?.update(now);return;}
  if((locked||scriptedInput)&&!testMode&&!document.hidden){physicsAccumulator=Math.min(.1,physicsAccumulator+dt);while(physicsAccumulator>=context.movement.fixedDt){step(inputSampler.sample(scriptedInput?{...input(),...scriptedInput,yaw,pitch}:input()).input);physicsAccumulator-=context.movement.fixedDt;}}
  const at=performance.now();walkCamera.update(player,{fractionSeconds:(locked||scriptedInput)&&!testMode?physicsAccumulator:context.movement.fixedDt,dt});cameraPeakMs=Math.max(cameraPeakMs,performance.now()-at);camera.position.set(walkCamera.position.x,walkCamera.position.y,walkCamera.position.z);camera.rotation.set(pitch,yaw,0,'YXZ');mapRuntime.update(now);
  gpu.begin();renderer.render(scene,camera);gpu.end(now);
  if(now-lastHud>500){lastHud=now;const timing=stat(frames.map(f=>f.interval)),queries=context.collision.stats(),speed=Math.hypot(player.vx,player.vz),surface=lastSourceSpawn?.support?.material||lastSourceSpawn?.support?.materialHash||'未知';
   $('metrics').textContent=`${timing.mean?(1000/timing.mean).toFixed(1):'—'} FPS · P99 ${timing.p99?.toFixed(2)??'—'} ms\n物理峰值 ${physicsPeakMs.toFixed(2)} ms / tick\nGPU P99 ${stat(gpuSamples).p99?.toFixed(2)??'—'} ms\n速度 ${speed.toFixed(2)} m/s · ${player.crouch?'蹲下':player.grounded?'接地':'空中'}\n脚底 ${player.x.toFixed(2)}, ${player.y.toFixed(2)}, ${player.z.toFixed(2)}\n碰撞查询 ${queries.queries} · BVH候选 ${queries.candidates}\n地图 ${renderer.info.render.calls} 次绘制\n完整加载 ${load.readyMs?.toFixed(0)??'—'} ms`;
   const support=context.collision.findSupport(player.x,player.z,player.y+.05,{height:context.movement.bodyHeight(player),radius:context.movement.rules.radius});const name=support?.material??support?.materialHash??surface;const site=context.siteAt(player);$('surface').textContent=`表面：${typeof name==='object'?JSON.stringify(name):name} · ${site?site.name+'点':context.buyZoneAt(player)?'本方购买区':'普通区域'}`;
  }frames.push({interval,cpu:performance.now()-cpuAt});if(frames.length>600)frames.shift();
 }catch(error){fail(error);}
}
requestAnimationFrame(frame);

void(async()=>{try{
 const physicsPromise=loadPhysicsPackage({load,signal:controller.signal,progress:text=>$('progress').textContent=text});
 const mapPromise=loadOptimizedMap({scene,renderer,camera,progress:text=>$('progress').textContent=text,load,signal:controller.signal,initialView:async renderManifest=>{
  const {manifest,data,verifiedPhysicsSHA256}=await physicsPromise;$('progress').textContent='构建共享 CPU 碰撞索引…';await new Promise(requestAnimationFrame);const built=performance.now();if(controller.signal.aborted)throw controller.signal.reason;
  context=createExperimentalWorld(data,{packageManifest:manifest,renderManifest,verifiedPhysicsSHA256});load.collisionBuildMs=performance.now()-built;
  const start=context.resolveSpawn('T',0),eye=[start.x,start.y+context.movement.eyeHeight(start),start.z],cp=Math.cos(start.pitch);return{eye,target:[eye[0]-Math.sin(start.yaw)*cp*8,eye[1]+Math.sin(start.pitch)*8,eye[2]-Math.cos(start.yaw)*cp*8]};
 }});
 const [,map]=await Promise.all([physicsPromise,mapPromise]);if(controller.signal.aborted){map.dispose();throw controller.signal.reason;}mapRuntime=map;
 walkCamera=createWalkCamera({world:context.collision,movement:context.movement});populateSpawns();spawn();await mapRuntime.settled();
 if(controller.signal.aborted)throw controller.signal.reason;load.readyMs=performance.now();phase='ready';ready=true;$('start').disabled=false;$('reset').disabled=false;$('loading').hidden=true;
}catch(error){if(!disposed){fail(error);console.error(error);}}})();
$('start').onclick=async()=>{if(!ready)return;const accepted=await pointer.request(true);if(!accepted)$('error').textContent='未能捕获鼠标，请再次点击开始。';};
$('reset').onclick=()=>{if(ready)spawn();};$('team').onchange=()=>{if(ready){populateSpawns();spawn();}};$('spawn').onchange=()=>{if(ready)spawn();};
document.addEventListener('pointerlockchange',()=>{locked=ready&&document.pointerLockElement===renderer.domElement;document.body.classList.toggle('locked',locked);$('hint').textContent=locked?'Esc 暂停 · Ctrl 蹲下 · 滚轮向下跳':'已暂停 · 点击开始行走';clearInput();});
document.addEventListener('mousemove',event=>{if(!locked||!ready)return;if(pointer.observe(event.movementX,event.movementY)){yaw-=event.movementX*mouse.radiansPerPixel;pitch=Math.max(-PITCH_LIMIT,Math.min(PITCH_LIMIT,pitch-event.movementY*mouse.radiansPerPixel));}});
window.addEventListener('keydown',event=>{if(!locked||!ready)return;if(['Space','KeyW','KeyA','KeyS','KeyD','ControlLeft','ControlRight','ShiftLeft','ShiftRight','KeyC'].includes(event.code))event.preventDefault();keys.add(event.code);inputSampler.observe(input());});window.addEventListener('keyup',event=>{keys.delete(event.code);inputSampler.observe(input());});
renderer.domElement.addEventListener('wheel',event=>{if(locked&&ready&&event.deltaY>0){event.preventDefault();inputSampler.wheel(input());}},{passive:false});window.addEventListener('blur',suspend);document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
function diagnostics(){return{ready,phase,locked,inputMode:scriptedInput?'scripted-frame-input':testMode?'explicit-command-test':'native-controls',load,contract:context?.contract,integrityVerified:context?.integrityVerified,player:player?{...player}:null,spawn:lastSourceSpawn,physics:context?.collision.stats(),profile:context?.movement.profile,camera:{position:camera.position.toArray(),...walkCamera?.diagnostics()},frame:stat(frames.map(f=>f.interval)),cpu:stat(frames.map(f=>f.cpu)),gpu:stat(gpuSamples),physicsPeakMs,cameraPeakMs,ticks,streaming:mapRuntime?.info(),pointer:pointer.diagnostics(),memory:performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize,scope:'JS heap including retained collision/render buffers; not total physical RAM or GPU memory'}:null,longTasks,errors:[...errors],scope:'Independent real-collision walk sample, no Game/WebSocket, no CS2 gameplay-number calibration'};}
window.cs2Walk={get ready(){return ready;},diagnostics,settled:async()=>{await mapRuntime?.settled();},...(automation?{setScriptedInput:command=>{if(!scriptedInput||!command)clearInput();testMode=false;scriptedInput=command?{...context.movement.blankInput(),...command}:null;},useLiveInput:()=>{testMode=false;scriptedInput=null;clearInput();},spawn:(team,index)=>{testMode=true;$('team').value=team;populateSpawns();$('spawn').value=String(index);spawn(team,index);return diagnostics();},run:commands=>{testMode=true;for(const command of commands)step({...context.movement.blankInput(),yaw:player.yaw,pitch:player.pitch,...command});yaw=player.yaw;pitch=player.pitch;walkCamera.update(player,{fractionSeconds:context.movement.fixedDt});camera.position.set(walkCamera.position.x,walkCamera.position.y,walkCamera.position.z);camera.rotation.set(pitch,yaw,0,'YXZ');mapRuntime.update(performance.now());return diagnostics();},resetMetrics:()=>{frames.length=0;gpuSamples.length=0;physicsPeakMs=0;context.collision.resetStats();}}:{})};
