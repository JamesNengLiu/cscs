// Native Chrome GPU/depth fixture. No game service or persistent port is used.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createStaticFixture} from '../tools/cs2-static-fixture.mjs';
await mkdir('artifacts',{recursive:true});let fixture,browser,page;const report={status:'running',errors:[],checks:[]};
try{
 fixture=await createStaticFixture();browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});page=await browser.newPage({viewport:{width:512,height:256}});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|shader|GL_INVALID/i.test(m.text()))report.errors.push(m.text());});
 await page.goto(fixture.url+'/cs2-smoke-renderer.js');await page.setContent('<canvas id="c" width="512" height="256"></canvas>');
 report.gpu=await page.evaluate(async origin=>{
  const THREE=await import(origin+'/vendor/three.module.js'),{createSmokeRenderer}=await import(origin+'/cs2-smoke-renderer.js'),{createSmokeVolume}=await import(origin+'/cs2-smoke-field.js');
  const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('c'),antialias:false,preserveDrawingBuffer:true});renderer.setSize(512,256);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#103070');const camera=new THREE.PerspectiveCamera(60,2,.1,100);camera.position.set(0,1.5,8);camera.lookAt(0,1.5,0);
  const wall=new THREE.Mesh(new THREE.BoxGeometry(20,10,.2),new THREE.MeshBasicMaterial({color:'#c42f19'}));wall.position.set(0,1.5,4.5);scene.add(wall);
  const smoke=createSmokeRenderer(THREE,{renderer,scene,camera}),gl=renderer.getContext(),pixel=()=>{const p=new Uint8Array(4);gl.readPixels(256,128,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];};
  renderer.render(scene,camera);const wallBaseline=pixel(),noSmoke=smoke.render(1);smoke.prewarm();smoke.sync({smokes:[createSmokeVolume({id:'test',x:0,y:0,z:0,bornAt:0,endAt:18})]});smoke.render(1);const occluded=pixel();
  scene.remove(wall);renderer.render(scene,camera);const background=pixel();smoke.render(1);const filled=pixel();
  smoke.shot({type:'shot',shotId:'test-shot',time:1,from:{x:0,y:1.5,z:8},to:{x:0,y:1.5,z:-8}});smoke.render(1);const bulletHole=pixel();
  smoke.explode({kind:'hegrenade',id:'he',x:0,y:1.44,z:0,time:1},1);smoke.render(1.6);const heClear=pixel();
  const frames=[];for(let i=0;i<60;i++){const at=performance.now();smoke.render(2+i/120);gl.finish();frames.push(performance.now()-at);}frames.sort((a,b)=>a-b);
  const diagnostics=smoke.diagnostics(),near=[[-2,4],[2,4],[-2,3],[2,3]].map(([x,z],i)=>createSmokeVolume({id:'near'+i,x,y:1.14,z,radius:.5,height:.8,bornAt:0,endAt:18}));smoke.sync({smokes:near});smoke.render(1);const onlyNear=pixel();
  smoke.sync({smokes:[...near,createSmokeVolume({id:'fifth',x:0,y:.6,z:-2,radius:1,height:2,bornAt:0,endAt:18})]});smoke.render(1);const fifthOnlyOccluder=pixel(),overflowDiagnostics=smoke.diagnostics();wall.position.z=0;scene.add(wall);renderer.render(scene,camera);const overflowWallBaseline=pixel();smoke.render(1);const overflowBehindWall=pixel();scene.remove(wall);smoke.render(1);
  const result={wallBaseline,occluded,background,filled,bulletHole,heClear,noSmoke,diagnostics,onlyNear,fifthOnlyOccluder,overflowWallBaseline,overflowBehindWall,overflowDiagnostics,webglError:gl.getError(),cpuAndFinishP50Ms:frames[30],cpuAndFinishP95Ms:frames[57]};window.smokeFixture={renderer,smoke};return result;
 },fixture.url);
 const g=report.gpu,diff=(a,b)=>Math.max(...a.slice(0,3).map((v,i)=>Math.abs(v-b[i])));
 assert.equal(g.noSmoke,false);assert.ok(diff(g.wallBaseline,g.occluded)<=2,JSON.stringify(g));report.checks.push('actual DepthTexture prevents smoke behind an opaque wall from changing pixels');
 assert.ok(diff(g.background,g.filled)>40);report.checks.push('raymarched visible field changes the scene');assert.ok(diff(g.background,g.bulletHole)<diff(g.background,g.filled));report.checks.push('confirmed bullet opens a short visible channel');assert.ok(diff(g.background,g.heClear)<diff(g.background,g.filled));report.checks.push('HE temporarily clears density');assert.equal(g.webglError,0);assert.deepEqual(report.errors,[]);report.checks.push('shader compiles and renders without WebGL errors');
 assert.ok(diff(g.onlyNear,g.background)<=2);assert.ok(diff(g.fifthOnlyOccluder,g.background)>40);assert.equal(g.overflowDiagnostics.degradedVolumes,1);assert.equal(g.overflowDiagnostics.droppedVolumes,0);report.checks.push('fifth confirmed smoke remains an opaque line-of-sight blocker when the nearest four miss that pixel');assert.ok(diff(g.overflowWallBaseline,g.overflowBehindWall)<=2);report.checks.push('overflow analytic occlusion also respects real scene depth');
 await page.screenshot({path:'artifacts/cs2-smoke-pilot.png'});report.status='completed';
}catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;}
finally{await browser?.close();await fixture?.close();report.fixtureClosed=true;await writeFile('artifacts/cs2-smoke-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
