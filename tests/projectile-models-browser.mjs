// Isolated WebGL appearance/resource checks. No listening game service.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const report={status:'running',errors:[],checks:[],scope:'Isolated headless Chrome/WebGL with the current local converted grenade bodies and textures; no physical multiplayer or FPS claim.'};
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  await mkdir('artifacts',{recursive:true});const page=await browser.newPage({viewport:{width:1280,height:720}});
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  const html=`<!doctype html><meta charset="utf-8"><title>投掷物模型检查</title>
  <style>body{margin:0;background:#253340;color:#e4eceb;font:16px system-ui}canvas{position:absolute;inset:0}h1{position:absolute;z-index:1;left:40px;top:16px;font-size:24px}#labels{position:absolute;z-index:1;bottom:130px;left:12.5%;width:75%;display:flex;text-align:center}#labels span{flex:1}</style>
  <h1>投掷物模型</h1><div id="labels"><span>手雷</span><span>闪光弹</span><span>烟雾弹</span></div>
  <script type="module">
  import * as THREE from '/vendor/three.module.js';import {createWorldEffects} from '/effects.js';
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;document.body.append(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#253340');
  const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.01,10);camera.position.set(0,.15,.66);camera.lookAt(0,.06,0);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(4,4),new THREE.MeshBasicMaterial({color:'#566169',side:THREE.DoubleSide}));floor.rotation.x=-Math.PI/2;floor.position.y=-.025;scene.add(floor);
  const fx=createWorldEffects(THREE,scene);await fx.ready;
  let state={projectiles:['hegrenade','flashbang','smokegrenade'].map((kind,i)=>({id:String(i),kind,x:(i-1)*.2,y:0,z:0,bornAt:0})),smokes:[]};
  function render(time=0){fx.sync(state);fx.update(time,null);renderer.render(scene,camera);}
  render();window.projectileReview={fx,scene,renderer,state,render};
  </script>`;
  await page.route('https://projectiles.test/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/')return route.fulfill({contentType:'text/html',body:html});
    const name=pathname.slice(1);if(name.includes('..'))return route.abort();
    const file=name.startsWith('vendor/')?new URL(`../node_modules/three/build/${name.slice(7)}`,import.meta.url):new URL(`../public/${name}`,import.meta.url);
    const type=name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':name.endsWith('.png')?'image/png':'text/plain';
    try{await route.fulfill({contentType:type,body:await readFile(file)});}catch{await route.fulfill({status:404,body:'Missing local asset'});}
  });
  await page.goto('https://projectiles.test/');await page.waitForFunction(()=>window.projectileReview,null,{timeout:30000});
  const initial=await page.evaluate(()=>({info:window.projectileReview.fx.info(),calls:window.projectileReview.renderer.info.render.calls}));
  assert.ok(initial.info.projectileModels.models.every(m=>m.source==='viewmodel-weapon-body'&&!m.error));assert.ok(initial.calls<=10);
  await page.screenshot({path:'artifacts/projectile-models.png'});report.checks.push('three textured grenade bodies rendered with no hands or sphere placeholder');
  const stress=await page.evaluate(()=>{const r=window.projectileReview,geometry=r.renderer.info.memory.geometries;
    r.state.projectiles=Array.from({length:500},(_,i)=>({id:String(i),kind:['hegrenade','flashbang','smokegrenade'][i%3],x:(i%8-4)*.06,y:.05,z:-Math.floor(i/8)*.04,bornAt:0}));
    for(let i=0;i<100;i++)r.render(i/60);
    return {info:r.fx.info(),geometryBefore:geometry,geometryAfter:r.renderer.info.memory.geometries,calls:r.renderer.info.render.calls};
  });
  assert.equal(stress.info.projectilePool,64);assert.equal(stress.geometryBefore,stress.geometryAfter);assert.ok(stress.calls<=10);
  report.checks.push('crowded repeated snapshots retain bounded instance/batch and geometry counts');report.stress=stress;
  const cleanup=await page.evaluate(()=>{const r=window.projectileReview;r.state.projectiles=[];r.render(3);r.fx.dispose();return r.scene.children.filter(o=>o.name.startsWith('projectile:')).length;});
  assert.equal(cleanup,0);assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{await browser.close();await writeFile('artifacts/projectile-models-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks,errors:report.errors},null,2));}
