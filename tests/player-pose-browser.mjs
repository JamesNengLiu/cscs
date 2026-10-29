// Isolated pose inspection: local original assets, shared authoritative pose
// metadata, neutral floor and real WebGL. No room, socket or production service.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {Game} from '../game.mjs';
import {hitboxAnimation} from '../hitboxes.mjs';
const plain=(weapon,extra={})=>{const p={id:'pose',alive:true,weapon,x:0,y:0,z:0,yaw:0,pitch:0,vx:0,vy:0,vz:0,grounded:true,gaitYaw:0,gaitDistance:0,lastShot:-100,...extra};return {...p,...hitboxAnimation(p,10)};};
const g=new Game(),p=g.add('p','Switch','T');g.begin();g.time=10;g.buy(p.id,'ak47');g.time=11;g.equip(p.id,2);
const switchPose=t=>({...p,x:0,y:0,z:0,yaw:0,gaitYaw:0,...hitboxAnimation(p,11+t)});
const cases=[
 {label:'AK 静止持枪',state:plain('ak47')},
 {label:'M4 向上瞄准 30°',state:plain('m4a1',{pitch:Math.PI/6})},
 {label:'M4 向下瞄准 30°',state:plain('m4a1',{pitch:-Math.PI/6})},
 {label:'M4 向前跑',state:plain('m4a1',{vz:-6.25,playerGaitSequence:'run'}),speed:6.25},
 {label:'M4 向左横移，仍朝前瞄准',state:plain('m4a1',{vx:-6.25,gaitYaw:Math.PI/2,playerGaitSequence:'run'}),speed:6.25},
 {label:'AK 倒退',state:plain('ak47',{vz:6.25,playerGaitSequence:'run'}),speed:-6.25},
 {label:'AK → 手枪：开始',state:switchPose(0)},
 {label:'AK → 手枪：0.1 秒',state:switchPose(.1)},
 {label:'AK → 手枪：0.2 秒',state:switchPose(.2)},
];
const legacy=process.env.POSE_LEGACY_BLEND==='1',report={status:'running',scope:'Neutral-scene pose inspection of original local models and current shared server pose metadata; no game-room connection or physical FPS claim.',legacy,errors:[]};
let browser;
try{
 await mkdir('artifacts',{recursive:true});browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
 const page=await browser.newPage({viewport:{width:1440,height:1120}});page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('https://pose-review.test/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1);if(name.includes('..'))return route.abort();
  if(!name){return route.fulfill({contentType:'text/html',body:`<!doctype html><html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#dee2df;font:15px system-ui;color:#19241e}main{display:grid;grid-template-columns:repeat(3,1fr)}section{height:372px;border:1px solid #8d9b91;position:relative}h3{margin:10px 16px;font-size:17px}canvas{display:block;width:100%;height:320px}</style><main></main></html>`});}
  const file=name.startsWith('vendor/')?new URL(`../node_modules/three/build/${name.slice(7)}`,import.meta.url):new URL(`../public/${name}`,import.meta.url);
  try{let body=await readFile(file);if(legacy&&name==='bone-pose.js'){body=body.toString().replace(/const x=count===9\?[^\n]+;/,"const x=normalized(0,.5);").replace(/const y=count===9\?[^\n]+;/,"const y=normalized(1,.5);");}
   await route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':name.endsWith('.png')?'image/png':'application/octet-stream',body});
  }catch{await route.fulfill({status:404,body:'Missing fixture asset'});}
 });
 await page.goto('https://pose-review.test/');
 await page.evaluate(async cases=>{
  const THREE=await import('/vendor/three.module.js'),{createPlayerActor}=await import('/player-model.js');window.poseReview={items:[],ready:false,paused:false};
  for(const item of cases){
   const panel=document.createElement('section'),title=document.createElement('h3'),canvas=document.createElement('canvas');title.textContent=item.label;panel.append(title,canvas);document.querySelector('main').append(panel);
   const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setSize(478,320);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
   const scene=new THREE.Scene();scene.background=new THREE.Color('#c4ccc6');const camera=new THREE.PerspectiveCamera(34,478/320,.05,30);camera.position.set(3,1.8,-4.2);camera.lookAt(0,.95,0);
   const grid=new THREE.GridHelper(6,12,0x738078,0xa3afa5);scene.add(grid);
   const actor=createPlayerActor(THREE);scene.add(actor.group);await actor.setCharacter('urban');actor.update(0,item.state);
   window.poseReview.items.push({...item,actor,renderer,scene,camera});
  }
  const start=performance.now();function frame(now){requestAnimationFrame(frame);const t=window.poseReview.paused?.12:(now-start)/1000;
   for(const item of window.poseReview.items){const state={...item.state};if(item.speed){state.gaitDistance=item.speed*t;state.playerGaitSequence='run';}item.actor.update(1/60,state);item.renderer.render(item.scene,item.camera);}}
  requestAnimationFrame(frame);window.poseReview.ready=true;
 },cases);
 await page.waitForFunction(()=>window.poseReview.ready&&window.poseReview.items.every(i=>i.actor.info().thirdPersonWeapon.loaded),null,{timeout:30000});
 await page.evaluate(()=>window.poseReview.paused=true);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const path=legacy?'artifacts/player-poses-before.png':'artifacts/player-poses-after.png';await page.screenshot({path});report.image=path;
 report.poses=await page.evaluate(()=>window.poseReview.items.map(i=>({label:i.label,sequence:i.actor.info().sequence,weapon:i.actor.info().thirdPersonWeapon,gait:i.actor.info().gait,blend:i.state.playerPoseBlend,rotation:i.actor.group.rotation.y})));
 assert.deepEqual(report.errors,[]);assert.equal(report.poses.length,9);assert.ok(report.poses.every(p=>p.weapon.loaded));report.status='passed';
}catch(e){report.status='failed';report.failure=e.stack;console.error(e);process.exitCode=1;}
finally{await browser?.close();await writeFile(legacy?'artifacts/player-pose-before-report.json':'artifacts/player-pose-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
