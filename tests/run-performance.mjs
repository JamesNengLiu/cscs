import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:'0'},stdio:['ignore','pipe','pipe']});
const defaultRenderer=process.env.PERF_RENDERER==='default',tag=defaultRenderer?'default-':'';
let browser,base,output='';const report={status:'running',errors:[],scope:`Automated Chrome/${defaultRenderer?'default renderer':'SwiftShader'} correctness and synthetic 9-character stage; not physical-device LAN FPS`};
try{
  await mkdir('artifacts',{recursive:true});
  base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),10000);server.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/http:\/\/localhost:(\d+)/);if(m){clearTimeout(timer);resolve(`http://127.0.0.1:${m[1]}`);}});server.stderr.on('data',chunk=>process.stderr.write(chunk));server.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code));});});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:[...(defaultRenderer?[]:['--use-angle=swiftshader','--enable-unsafe-swiftshader']),'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
  const page=await browser.newPage({viewport:{width:640,height:360}});page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.route('**/performance-fixture.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0;background:#141e28"></body></html>'}));
  await page.goto(base+'/performance-fixture.html');
  report.graphics=await page.evaluate(async()=>{
    const THREE=await import('/vendor/three.module.js');const {createPlayerActor,PLAYER_MODEL_IDS}=await import('/player-model.js');const {createWeaponView,WEAPON_MODEL_IDS}=await import('/weapon-model.js');
    const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(256,256);renderer.setPixelRatio(1);document.body.append(renderer.domElement);
    const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
    const gpu={version:gl.getParameter(gl.VERSION),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
    const target=new THREE.WebGLRenderTarget(256,256),scene=new THREE.Scene();scene.background=new THREE.Color('#141e28');
    const camera=new THREE.PerspectiveCamera(40,1,.02,100);camera.position.set(0,1,-3.8);camera.lookAt(0,.85,0);scene.add(camera);
    const capture=()=>{renderer.setRenderTarget(target);renderer.render(scene,camera);const p=new Uint8Array(256*256*4);renderer.readRenderTargetPixels(target,0,0,256,256,p);return p;};
    const comparisons=[];
    function compare(a,b,label){
      let sum=0,bad=0,max=0,foreground=0;
      for(let i=0;i<a.length;i++) {const d=Math.abs(a[i]-b[i]);sum+=d;max=Math.max(max,d);if(d>3)bad++;}
      for(let i=0;i<a.length;i+=4)if(a[i]!==a[0]||a[i+1]!==a[1]||a[i+2]!==a[2])foreground++;
      const result={label,meanChannelDifference:sum/a.length,channelsDifferingAbove3:bad/a.length,maxChannelDifference:max,foregroundPixels:foreground};
      if(foreground<40||result.meanChannelDifference>.5||result.channelsDifferingAbove3>.02)throw Error('CPU/GPU image mismatch '+JSON.stringify(result));comparisons.push(result);
    }
    const waitWeapon=async actor=>{const end=performance.now()+20000;while(!actor.info().thirdPersonWeapon.loaded){if(performance.now()>end)throw Error(actor.info().thirdPersonWeapon.status);await new Promise(r=>setTimeout(r,10));}};
    for(const id of PLAYER_MODEL_IDS){
      const cpu=createPlayerActor(THREE,{skinning:'cpu'}),gpu=createPlayerActor(THREE);await Promise.all([cpu.setCharacter(id),gpu.setCharacter(id)]);
      if(cpu.info().error||gpu.info().error)throw Error('Player load failed '+id);
      for(const a of [cpu,gpu])a.update(0,{weapon:'ak47'});await Promise.all([waitWeapon(cpu),waitWeapon(gpu)]);
      const sequence=gpu.info().availableSequences.find(s=>/reload/i.test(s.name)&&s.imported&&s.frames>2)||gpu.info().availableSequences.find(s=>s.imported);
      for(const state of [{playerSequence:sequence.name,playerFrame:0},{playerSequence:sequence.name,playerFrame:(sequence.frames-1)/2,pitch:.6},{animation:'crouch',crouch:true,pitch:-.4}]){
        for(const a of [cpu,gpu])a.update(0,{...state,weapon:'ak47',alive:true});
        for(const angle of [0,Math.PI/2]){
          camera.position.set(Math.sin(angle)*3.8,1,-Math.cos(angle)*3.8);camera.lookAt(0,.85,0);
          scene.add(cpu.group);const c=capture();scene.remove(cpu.group);scene.add(gpu.group);const g=capture();scene.remove(gpu.group);compare(c,g,`${id}:${state.playerFrame??'crouch'}:${angle}`);
        }
      }
      cpu.dispose();gpu.dispose();
    }
    camera.position.set(0,0,0);camera.rotation.set(0,0,0);camera.fov=80;camera.updateProjectionMatrix();camera.layers.set(1);
    const cpuView=await createWeaponView(THREE,camera,{skinning:'cpu'}),gpuView=await createWeaponView(THREE,camera);
    for(const id of WEAPON_MODEL_IDS){
      await Promise.all([cpuView.setWeapon(id),gpuView.setWeapon(id)]);if(cpuView.info().error||gpuView.info().error)throw Error('Viewmodel load failed '+id);
      if(cpuView.info().cachedModels>4||gpuView.info().cachedModels>4)throw Error('Unbounded viewmodel cache');
      const sequences=gpuView.info().availableSequences.filter(s=>s.imported);
      const selected=[sequences.find(s=>/^idle/i.test(s.name))||sequences[0],sequences.find(s=>/reload|attack|throw/i.test(s.name))||sequences[0]];
      for(const seq of selected){const state={weaponSequence:seq.name,weaponFrame:(seq.frames-1)/2};cpuView.update(0,state);gpuView.update(0,state);
        cpuView.group.visible=true;gpuView.group.visible=false;const c=capture();cpuView.group.visible=false;gpuView.group.visible=true;const g=capture();compare(c,g,`${id}:${seq.name}`);
      }
    }
    cpuView.dispose();gpuView.dispose();target.dispose();renderer.setRenderTarget(null);renderer.setSize(640,360);camera.aspect=640/360;camera.fov=60;camera.position.set(0,3.5,-9);camera.lookAt(0,1,0);camera.updateProjectionMatrix();
    const benchmark=[];
    for(const mode of ['cpu','gpu']){
      const actors=[];for(let i=0;i<9;i++){const a=createPlayerActor(THREE,{skinning:mode});actors.push(a);await a.setCharacter(i%2?'urban':'terror_trump');a.update(0,{weapon:'ak47',alive:true,x:(i%3-1)*1.7,z:Math.floor(i/3)*2});scene.add(a.group);}await Promise.all(actors.map(waitWeapon));
      const view=await createWeaponView(THREE,camera,{skinning:mode});await view.setWeapon('ak47');
      const cpuTimes=[],wallTimes=[],intervals=[];let previous;
      for(let i=0;i<150;i++){
        const now=await new Promise(requestAnimationFrame),start=performance.now();
        for(let n=0;n<actors.length;n++)actors[n].update(1/60,{x:(n%3-1)*1.7,z:Math.floor(n/3)*2,alive:true,grounded:true,weapon:'ak47',animation:'walk',pitch:Math.sin(i*.03)*.5});view.update(1/60,{ammo:30});
        const cpu=performance.now()-start;renderer.info.autoReset=false;renderer.info.reset();camera.layers.set(0);renderer.render(scene,camera);const background=scene.background;scene.background=null;renderer.autoClear=false;renderer.clearDepth();camera.layers.set(1);renderer.render(scene,camera);renderer.autoClear=true;scene.background=background;
        gl.finish();if(i>=30){cpuTimes.push(cpu);wallTimes.push(performance.now()-start);intervals.push(now-previous);}previous=now;
      }
      const stats=values=>{values.sort((a,b)=>a-b);return {median:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],mean:values.reduce((a,b)=>a+b,0)/values.length};};
      benchmark.push({mode,samples:cpuTimes.length,animationCpuMs:stats(cpuTimes),synchronizedRenderWallMs:stats(wallTimes),rafIntervalMs:stats(intervals),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles});
      for(const a of actors)a.dispose();view.dispose();
    }
    // Measure the automation/display scheduler floor separately from game work.
    const emptyIntervals=[];let emptyPrevious;
    for(let i=0;i<150;i++){const now=await new Promise(requestAnimationFrame);if(i>=30)emptyIntervals.push(now-emptyPrevious);emptyPrevious=now;}
    emptyIntervals.sort((a,b)=>a-b);
    const emptyRafControl={samples:emptyIntervals.length,meanMs:emptyIntervals.reduce((a,b)=>a+b,0)/emptyIntervals.length,medianMs:emptyIntervals[Math.floor(emptyIntervals.length*.5)],p95Ms:emptyIntervals[Math.floor(emptyIntervals.length*.95)],visibility:document.visibilityState,focused:document.hasFocus(),scope:'No animation, no draw submissions; browser/display scheduling baseline, not game FPS'};
    window.performanceRenderer=renderer;return {gpu,comparisons,benchmark,emptyRafControl,modelCount:PLAYER_MODEL_IDS.length,weaponCount:WEAPON_MODEL_IDS.length};
  });
  assert.equal(report.graphics.comparisons.length,132);assert.equal(report.graphics.modelCount,12);assert.equal(report.graphics.weaponCount,30);
  await page.screenshot({path:`artifacts/smooth-${tag}nine-actors.png`});assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{
  await browser?.close();const closed=once(server,'exit');server.kill('SIGTERM');const graceful=await Promise.race([closed.then(()=>true),new Promise(r=>setTimeout(()=>r(false),3000))]);if(!graceful){server.kill('SIGKILL');await closed;}
  let reachable=false;try{await fetch(base+'/health',{signal:AbortSignal.timeout(1000)});reachable=true;}catch{}
  report.serverClosed=!reachable;assert.equal(report.serverClosed,true);await writeFile(`artifacts/smooth-${tag}browser-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,comparisons:report.graphics?.comparisons.length,gpu:report.graphics?.gpu,benchmark:report.graphics?.benchmark,emptyRafControl:report.graphics?.emptyRafControl,errors:report.errors,serverClosed:report.serverClosed},null,2));
}
