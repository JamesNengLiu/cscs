// Native first-person framing regression. This test owns a temporary loopback
// server; it never connects to, restarts, or changes the persistent 3001 server.
// Run explicitly: node tests/cs2-viewmodel-browser.mjs [--headed] [--framing-smoke]
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createExperimentalServer} from '../cs2-server.mjs';
import {CS2_WEAPON_PROFILE} from '../public/cs2-weapon-profile.js';
import {createCS2WeaponBehavior} from '../public/cs2-weapon-behavior.js';

const headed=process.argv.includes('--headed'),framingSmoke=process.argv.includes('--framing-smoke'),artifactRoot='artifacts/cs2-viewmodel';
const report={status:'running',headed,framingSmoke,scope:'Native Chrome, temporary loopback authority, and skinned weapon geometry framing. This is not physical LAN, retail animation-graph, or FPS certification.',errors:[],requests:[],checks:[],weapons:[],knife:[],optics:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const behavior=createCS2WeaponBehavior(),events=[],selections=[];
let server,browser,page,p;
const diagnostics=()=>page.evaluate(()=>window.lanStrike?.getDiagnostics());
async function until(predicate,label,timeout=5000){const end=performance.now()+timeout;while(performance.now()<end){if(predicate())return;await pause(10);}throw Error('Fixture timeout: '+label);}

// Capture the actual attached model, not a second imported copy or diagnostic
// metadata. Mesh.getVertexPosition applies morph targets and the live skeleton.
// The 320 x 200 CPU silhouette uses clipped triangles from that geometry only;
// neither the arms nor its unskinned bind-pose bounding box enters the result.
function installGeometryCapture(){
 if(!/^https?:$/.test(location.protocol))return;
 window.__viewmodelCaptureReady=import('/vendor/three.module.js').then(THREE=>{
  const add=THREE.Object3D.prototype.add;
  THREE.Object3D.prototype.add=function(...objects){
   for(const o of objects){
    if(this.isScene&&o.isPerspectiveCamera&&!window.__viewmodelWorldCamera)window.__viewmodelWorldCamera=o;
    if(o.name==='cs2-native-viewmodel-camera'&&!window.__viewmodelRenderCamera)window.__viewmodelRenderCamera=o;
    if(o.name==='source2-native-viewmodel'&&this.parent?.isCamera&&!window.__viewmodelNativeRoot)window.__viewmodelNativeRoot=o;
   }
   return add.apply(this,objects);
  };
  const width=320,height=200,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  const axes=['x','y','z'],clipPlanes=[v=>v.w+v.x,v=>v.w-v.x,v=>v.w+v.y,v=>v.w-v.y,v=>v.w+v.z,v=>v.w-v.z];
  function visible(o){for(;o;o=o.parent)if(!o.visible)return false;return true;}
  function clipTriangle(vertices){let polygon=vertices;for(const distance of clipPlanes){const next=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],da=distance(a),db=distance(b),insideA=da>=0,insideB=db>=0;if(insideA)next.push(a);if(insideA!==insideB)next.push(a.clone().lerp(b,da/(da-db)));}polygon=next;if(!polygon.length)break;}return polygon;}
  function silhouette(meshes,camera,{blade=false}={}){
   context.clearRect(0,0,width,height);context.fillStyle='#fff';let vertices=0,skinnedVertices=0,triangles=0,clippedTriangles=0,frontVertices=0,meshCount=0;const selection=[];
   for(const mesh of meshes){
    if(!visible(mesh)||!mesh.geometry?.attributes.position)continue;
    const geometry=mesh.geometry,position=geometry.attributes.position,index=geometry.index;
    const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    if(!materials.some(m=>m?.visible!==false&&(m?.opacity??1)>0))continue;
    meshCount++;vertices+=position.count;if(mesh.isSkinnedMesh)skinnedVertices+=position.count;
    geometry.computeBoundingBox();const box=geometry.boundingBox,size=box.getSize(new THREE.Vector3()),axis=axes.reduce((best,key)=>size[key]>size[best]?key:best,'x'),threshold=box.min[axis]+size[axis]*.55;
    if(blade)selection.push({mesh:mesh.name,axis,threshold,range:[box.min[axis],box.max[axis]],method:'positive 45% of authored knife long axis, before live skinning'});
    const projected=new Array(position.count),selected=new Uint8Array(position.count),point=new THREE.Vector3();
    for(let i=0;i<position.count;i++){
     point.fromBufferAttribute(position,i);selected[i]=!blade||point[axis]>=threshold;
     mesh.getVertexPosition(i,point);point.applyMatrix4(mesh.matrixWorld);
     const v=new THREE.Vector4(point.x,point.y,point.z,1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);projected[i]=v;
     if(selected[i]&&v.w>0&&v.z>=-v.w&&v.z<=v.w)frontVertices++;
    }
    const count=index?.count??position.count,start=Math.max(0,geometry.drawRange.start||0),end=Math.min(count,start+(geometry.drawRange.count??Infinity));
    const ranges=geometry.groups.length?geometry.groups:[{start:0,count,materialIndex:0}];
    for(const range of ranges){
     const material=materials[range.materialIndex||0];if(!material||material.visible===false||material.opacity===0)continue;
     for(let offset=Math.max(start,range.start);offset+2<Math.min(end,range.start+range.count);offset+=3){
      const a=index?index.getX(offset):offset,b=index?index.getX(offset+1):offset+1,c=index?index.getX(offset+2):offset+2;
      if(!selected[a]||!selected[b]||!selected[c])continue;triangles++;
      const polygon=clipTriangle([projected[a],projected[b],projected[c]]);if(polygon.length<3)continue;
      const ndc=polygon.map(v=>({x:v.x/v.w,y:v.y/v.w}));
      const area=(ndc[1].x-ndc[0].x)*(ndc[2].y-ndc[0].y)-(ndc[1].y-ndc[0].y)*(ndc[2].x-ndc[0].x),front=area*Math.sign(mesh.matrixWorld.determinant())>=0;
      if(material.side===THREE.FrontSide&&!front||material.side===THREE.BackSide&&front)continue;
      clippedTriangles++;context.beginPath();ndc.forEach((v,i)=>context[i?'lineTo':'moveTo']((v.x+1)*width/2,(1-v.y)*height/2));context.closePath();context.fill();
     }
    }
   }
   const pixels=context.getImageData(0,0,width,height).data;let occupied=0,minX=width,minY=height,maxX=-1,maxY=-1,sumX=0,sumY=0;
   for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(pixels[(y*width+x)*4+3]>0){occupied++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);sumX+=x+.5;sumY+=y+.5;}
   return{meshCount,vertices,skinnedVertices,frontVertices,triangles,clippedTriangles,raster:{width,height,occupied,fraction:occupied/(width*height)},bounds:occupied?{minX:minX/width,minY:minY/height,maxX:(maxX+1)/width,maxY:(maxY+1)/height,width:(maxX+1-minX)/width,height:(maxY+1-minY)/height,centerX:(minX+maxX+1)/width/2,centerY:(minY+maxY+1)/height/2}:null,centroid:occupied?{x:sumX/occupied/width,y:sumY/occupied/height}:null,...(blade?{selection}:{})};
  }
  window.__captureViewmodelGeometry=()=>{
   const d=window.lanStrike.getDiagnostics(),root=window.__viewmodelNativeRoot,group=root?.parent;
   const camera=window.__viewmodelRenderCamera;
   const worldCamera=window.__viewmodelWorldCamera;
   if(!root||!group||!camera||!worldCamera)throw Error('Actual native root/cameras were not captured');
   camera.updateWorldMatrix(true,true);worldCamera.updateWorldMatrix(true,false);root.updateWorldMatrix(true,true);
   const active=root.children[0],socket=active?.getObjectByName('wpn'),weapons=socket?.children.filter(o=>o.getObjectByName('weapon'))||[];
   const meshes=[];for(const weapon of weapons)weapon.traverse(o=>{if(o.isMesh)meshes.push(o);});
   const lenses=meshes.filter(o=>(Array.isArray(o.material)?o.material:[o.material]).some(m=>/scope_lens/i.test(m?.name||'')));
   // ADS replaces lens materials, so remember the actual lens mesh identity.
   window.__viewmodelLensMeshes??=new Map();if(lenses.length)window.__viewmodelLensMeshes.set(d.weapon,lenses);
   const knownLenses=window.__viewmodelLensMeshes.get(d.weapon)||lenses;
   const cameraRecord=c=>({uuid:c.uuid,fov:c.fov,aspect:c.aspect,near:c.near,far:c.far,position:c.position.toArray(),quaternion:c.quaternion.toArray(),world:c.matrixWorld.toArray(),projection:c.projectionMatrix.toArray(),direction:c.getWorldDirection(new THREE.Vector3()).toArray()});
   return{weapon:d.weapon,hand:d.weaponHand,sequence:d.weaponModel.sequence,viewVisible:visible(root),roots:root.children.length,weaponRoots:weapons.length,camera:cameraRecord(camera),worldCamera:cameraRecord(worldCamera),weaponGeometry:silhouette(meshes,camera),...(d.weapon==='knife'?{bladeGeometry:silhouette(meshes,camera,{blade:true})}:{}),lensGeometry:silhouette(knownLenses,camera),diagnostics:{localPosition:d.localPosition,cameraPosition:d.cameraPosition,recoilYaw:d.recoilYaw,recoilPitch:d.recoilPitch,fov:d.fov,projection:d.viewmodelProjection,presentation:d.weaponModel.presentation,ads:d.weaponModel.ads,weaponModelSource:d.weaponModel.source}};
  };
 });
}

async function geometry(){return page.evaluate(async()=>{await window.__viewmodelCaptureReady;return window.__captureViewmodelGeometry();});}
async function sampleAction(sequence,{milliseconds=1200,minimumSamples=2,screenshotLabel=null}={}){
 const end=performance.now()+milliseconds,samples=[];let captured=false;
 do{const sample=await geometry();if(sample.sequence===sequence){samples.push(sample);if(screenshotLabel&&!captured&&sample.bladeGeometry?.raster.occupied>=15){sample.screenshot=await screenshot(screenshotLabel);captured=true;}}if(samples.length>=minimumSamples&&sample.sequence!==sequence)break;await pause(80);}while(performance.now()<end);
 return samples;
}
async function screenshot(label){const path=artifactRoot+'/'+label+'.png';await page.screenshot({path});return path;}
function assertVisibleGeometry(value,label,{minimumPixels=15,minimumWidth=.025,minimumHeight=.025}={}){
 assert.ok(value.skinnedVertices>0,label+' has real skinned weapon vertices');
 assert.ok(value.triangles>0,label+' has weapon triangles');
 assert.ok(value.raster.occupied>=minimumPixels,`${label} visible silhouette is too small: ${value.raster.occupied}`);
 assert.ok(value.bounds?.width>=minimumWidth&&value.bounds?.height>=minimumHeight,label+' has a visible projected extent');
}
function assertHeld(sample,id,hand){
 assert.equal(sample.roots,1,id+' keeps one active native root');assert.equal(sample.weaponRoots,1,id+' keeps one weapon scene');assert.equal(sample.viewVisible,true,id+' foreground visible');
 const shape=sample.weaponGeometry;assertVisibleGeometry(shape,id+' '+hand);
 assert.ok(shape.bounds.centerY>.56&&shape.bounds.maxY>.70,id+' is held in the lower screen');
 // Pinned native pistol poses are relatively central. Do not force a rifle
 // offset onto their authored grip just to satisfy a single framing threshold.
 const pistol=CS2_WEAPON_PROFILE.guns[id]?.slot===2,minimum=pistol?.49:.54;
 assert.ok(hand==='right'?shape.bounds.centerX>minimum:shape.bounds.centerX<1-minimum,`${id} ${hand} horizontal framing ${shape.bounds.centerX}`);
}
function nearArrays(a,b,tolerance,label){assert.equal(a.length,b.length,label);for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<=tolerance,`${label}[${i}]: ${a[i]} vs ${b[i]}`);}
async function setHand(hand){await page.locator('#weaponHand').evaluate((select,hand)=>{select.value=hand;select.dispatchEvent(new Event('change',{bubbles:true}));},hand);await page.waitForFunction(hand=>window.lanStrike.getDiagnostics().weaponHand===hand,hand);await pause(180);}
async function waitWeapon(id,round){
 await page.waitForFunction(({id,round})=>{const s=window.lanStrike,d=s?.getDiagnostics();return s?.getState()?.round===round&&d?.weapon===id&&d.weaponModel.id===id&&d.weaponModel.source==='source2-native-gltf'&&!d.weaponModel.loading;},{id,round});
 const d=await diagnostics();assert.equal(d.weaponModel.error,null);return d;
}
async function readyWeapon(id){
 await page.evaluate(()=>{window.cs2Automation.fire(false);window.cs2Automation.setKeys([]);});
 p.team=CS2_WEAPON_PROFILE.guns[id]?.teams[0]||'T';p.character=p.team==='T'?'terror':'urban';
 const game=server.game;game.begin();game.phase='live';game.endAt=game.time+1000;game.buyEndAt=game.time+1000;p.money=16000;
 if(id!=='knife'&&!p.inventory[id]&&!p.grenades?.[id])game.buy(p.id,id);
 game.equip(p.id,id);Object.assign(p,{nextAttackAt:0,nextSecondaryAt:0,nextShotAt:game.time,reloadAt:0,recoilYaw:0,recoilPitch:0,lastShot:game.time-10});
 server.broadcastState();await page.evaluate(({yaw,pitch})=>window.cs2Automation.look(yaw,pitch),{yaw:p.yaw,pitch:.03});await waitWeapon(id,game.round);return game.round;
}
async function waitIdle(){await page.waitForFunction(()=>window.lanStrike.getDiagnostics().weaponModel.sequence==='idle');await pause(180);}
async function pulse(){await page.evaluate(()=>{window.cs2Automation.fire(true);setTimeout(()=>window.cs2Automation.fire(false),25);});}
function authorityRecord(){return{x:p.x,y:p.y,z:p.z,yaw:p.yaw,pitch:p.pitch,recoilYaw:p.recoilYaw,recoilPitch:p.recoilPitch,ammo:p.ammo,shotsFired:p.shotsFired||0};}
function resetShot(){Object.assign(p,{nextAttackAt:0,nextSecondaryAt:0,nextShotAt:server.game.time,recoilYaw:0,recoilPitch:0,cs2RecoilIndex:0,cs2AccuracyPenalty:0,cs2JumpPenalty:0,cs2LandPenalty:0,lastShot:server.game.time-10,cs2RecoilDecayActive:false});server.broadcastState();}
async function assertShotGeometry(hand){
 await setHand(hand);resetShot();await pause(160);const before=authorityRecord(),expected=behavior.shotProfile({...p},()=>.5,server.game.time,false,p.grounded),start=events.length;
 await pulse();await until(()=>events.slice(start).some(e=>e.type==='shot'&&e.id===p.id),'authoritative '+hand+' shot');
 const shot=events.slice(start).find(e=>e.type==='shot'&&e.id===p.id),direction=['x','y','z'].map(k=>shot.to[k]-shot.from[k]),length=Math.hypot(...direction);
 nearArrays(direction.map(n=>n/length),['x','y','z'].map(k=>expected.direction[k]),1e-6,hand+' shot direction');
 nearArrays(['x','y','z'].map(k=>shot.from[k]),[before.x,before.y+server.world.movement.eyeHeight(p),before.z],1e-5,hand+' eye shot origin');
 await pause(200);assert.equal(p.ammo,before.ammo-1,hand+' pulse consumes exactly one bullet');
 return{hand,before,event:shot,expectedDirection:expected.direction,after:authorityRecord()};
}

try{
 await mkdir(artifactRoot,{recursive:true});
 server=await createExperimentalServer({port:0,host:'127.0.0.1',presentation:'native',gameOptions:{weaponProfile:'cs2',random:()=>.5,audioRandom:()=>.5}});
 const emit=server.game.emit.bind(server.game);server.game.emit=event=>{events.push({...event,time:server.game.time});emit(event);};
 const equip=server.game.equip.bind(server.game);server.game.equip=(id,key)=>{const before=server.game.players.get(id)?.weapon,ok=equip(id,key),after=server.game.players.get(id)?.weapon;selections.push({id,key,before,after,ok,time:server.game.time});return ok;};
 const address=server.address();assert.equal(address.address,'127.0.0.1');assert.notEqual(address.port,3001);const url='http://127.0.0.1:'+address.port;report.server=url;
 browser=await chromium.launch({headless:!headed,executablePath:process.env.CS2_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
 const context=await browser.newContext({viewport:{width:1280,height:800}});await context.addInitScript(installGeometryCapture);page=await context.newPage();page.setDefaultTimeout(120000);
 page.on('pageerror',error=>report.errors.push(error.stack||error.message));page.on('console',message=>{if(message.type()==='error'&&/WebGL|shader|OUT_OF_MEMORY|Native .*weapon|PropertyBinding/i.test(message.text()))report.errors.push(message.text());});page.on('response',response=>{if(response.status()>=400&&!/favicon/.test(response.url()))report.requests.push({url:response.url(),status:response.status()});});
 const start=performance.now();await page.goto(url+'/?transport=websocket&automation=1');await page.waitForFunction(()=>window.lanStrike&&!document.querySelector('#joinButton').disabled||document.querySelector('#error').textContent);assert.equal(await page.locator('#error').textContent(),'');report.readyMs=performance.now()-start;
 await page.locator('#joinButton').click();await page.waitForFunction(()=>window.lanStrike.getState()?.players.find(p=>p.id===window.lanStrike.getId())?.alive);await page.locator('#resumeButton').click();await page.evaluate(()=>window.cs2Automation.start());p=server.game.players.get(await page.evaluate(()=>window.lanStrike.getId()));assert.ok(p);

 await readyWeapon('knife');const draw=await sampleAction('draw',{milliseconds:1600,screenshotLabel:'knife-draw'});report.knife.push({action:'draw',samples:draw});assert.ok(draw.length,'knife draw sequence observed');const visibleDraw=draw.filter(s=>s.bladeGeometry.raster.occupied>=15);assert.ok(visibleDraw.length,'knife blade is visible during draw');await waitIdle();
 const knifeIdle=await geometry();assertVisibleGeometry(knifeIdle.bladeGeometry,'knife idle blade',{minimumPixels:25,minimumWidth:.025,minimumHeight:.04});report.knife.push({action:'idle',sample:knifeIdle,screenshot:await screenshot('knife-idle')});
 for(const action of ['shoot1','heavy']){
  Object.assign(p,{nextAttackAt:0,nextSecondaryAt:0});server.broadcastState();const before=events.length;
  if(action==='heavy')await page.mouse.click(600,400,{button:'right'});else await pulse();
  await until(()=>events.slice(before).some(e=>e.type==='melee'&&e.id===p.id&&e.secondary===(action==='heavy')),'knife '+action+' authority');
  await page.waitForFunction(action=>window.lanStrike.getDiagnostics().weaponModel.sequence===action,action);
  const samples=await sampleAction(action,{milliseconds:1600,screenshotLabel:'knife-'+action});report.knife.push({action,samples});assert.ok(samples.length,'knife '+action+' sequence sampled');assert.ok(samples.some(s=>s.bladeGeometry.raster.occupied>=15),'knife '+action+' has a visible blade during its action');await waitIdle();
 }
 report.checks.push('knife draw, idle, light and heavy use visible live-skinned blade triangles');

 for(const id of framingSmoke?['ak47','usp','awp']:['ak47','usp','awp','m4a1','deagle','hegrenade','flashbang','smokegrenade']){
  await setHand('right');await readyWeapon(id);await waitIdle();const right=await geometry();assertHeld(right,id,'right');const rightImage=await screenshot(id+'-right-idle');
  const beforeAuthority=authorityRecord();await setHand('left');const left=await geometry();assertHeld(left,id,'left');const afterAuthority=authorityRecord();
  assert.ok(Math.abs(right.weaponGeometry.bounds.centerX+left.weaponGeometry.bounds.centerX-1)<.035,id+' mirrors weapon horizontal bounds');assert.ok(Math.abs(right.weaponGeometry.bounds.centerY-left.weaponGeometry.bounds.centerY)<.035,id+' mirror preserves height');
  nearArrays(right.worldCamera.projection,left.worldCamera.projection,1e-10,id+' world projection');nearArrays(right.worldCamera.position,left.worldCamera.position,.002,id+' world camera position');nearArrays(right.worldCamera.direction,left.worldCamera.direction,1e-5,id+' world camera direction');
  for(const key of ['x','y','z','yaw','pitch','recoilYaw','recoilPitch'])assert.ok(Math.abs(beforeAuthority[key]-afterAuthority[key])<1e-5,id+' hand setting preserves authority '+key);
  report.weapons.push({id,right,left,beforeAuthority,afterAuthority,screenshots:[rightImage,await screenshot(id+'-left-idle')]});console.log('viewmodel framing passed: '+id);
 }
 report.checks.push((framingSmoke?'AK-47, USP-S and AWP':'rifles, AWP, pistols and all grenades')+' have lower-screen framing and mirrored hands; world projection, pose and recoil stay unchanged');

 if(!framingSmoke){
 await setHand('right');
 for(const id of ['aug','sg552']){
  await readyWeapon(id);await waitIdle();const hip=await geometry();assertHeld(hip,id,'right');await page.mouse.click(600,400,{button:'right'});await until(()=>p.zoom<90,id+' ADS authority');await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics().weaponModel;return d.sequence==='zoomIdle'&&d.ads?.amount>.98;});await pause(250);
  const ads=await geometry();assertVisibleGeometry(ads.lensGeometry,id+' ADS lens',{minimumPixels:8,minimumWidth:.015,minimumHeight:.015});assert.ok(Math.abs(ads.lensGeometry.bounds.centerX-.5)<.04&&Math.abs(ads.lensGeometry.bounds.centerY-.5)<.04,id+' live-skinned lens is screen-centred');assert.equal(await page.locator('#scopeOverlay').evaluate(e=>e.hidden),true);
  const adsImage=await screenshot(id+'-ads');await until(()=>server.game.time>=p.nextSecondaryAt,id+' ADS exit readiness');await page.mouse.click(600,400,{button:'right'});await until(()=>p.zoom===90,id+' ADS exit authority');await page.waitForFunction(()=>{const ads=window.lanStrike.getDiagnostics().weaponModel.ads;return ads.amount<.01&&!ads.reticle;});await waitIdle();const exit=await geometry();assertHeld(exit,id,'right');assert.ok(Math.abs(hip.weaponGeometry.bounds.centerX-exit.weaponGeometry.bounds.centerX)<.04&&Math.abs(hip.weaponGeometry.bounds.centerY-exit.weaponGeometry.bounds.centerY)<.04,id+' ADS exit restores hip framing');report.optics.push({id,hip,ads,exit,screenshots:[adsImage,await screenshot(id+'-ads-exit')]});
 }
 report.checks.push('AUG and SG 553 centre the actual skinned lens and restore hip framing after ADS');

 const awpRound=await readyWeapon('awp');await waitIdle();
 // Establish a still-owned previous weapon through the real ordered input
 // path. Otherwise Q could be a no-op after the preceding rifle purchases.
 const sidearm=p.pistol;assert.ok(sidearm&&p.inventory[sidearm]);await page.keyboard.press('2');await until(()=>p.weapon===sidearm,'AWP Q fixture sidearm');await waitWeapon(sidearm,awpRound);await page.keyboard.press('1');await until(()=>p.weapon==='awp','AWP Q fixture return');await waitWeapon('awp',awpRound);await waitIdle();assert.equal(p.previousWeapon,sidearm);
 await page.mouse.click(600,400,{button:'right'});await until(()=>p.zoom<90,'AWP zoom authority');await page.waitForFunction(()=>!document.querySelector('#scopeOverlay').hidden);const scoped=await geometry();assert.equal(scoped.viewVisible,false,'AWP scope hides the complete native viewmodel');assert.equal(scoped.weaponGeometry.raster.occupied,0,'AWP scope draws no weapon silhouette');const scopedImage=await screenshot('awp-scope');
 resetShot();await pause(150);const awpAmmo=p.ammo,awpShots=p.shotsFired||0,awpStart=events.length,switchStart=selections.length;await page.evaluate(()=>{window.__awpQuickSwitchSamples=[];window.__awpQuickSwitchTimer=setInterval(()=>{const d=window.lanStrike.getDiagnostics();window.__awpQuickSwitchSamples.push({at:performance.now(),weapon:d.weapon,model:d.weaponModel.id,sequence:d.weaponModel.sequence});},16);window.cs2Automation.fire(true);});await pause(30);await page.keyboard.press('q');await pause(35);await page.keyboard.press('q');const returnedAt=await page.evaluate(()=>{window.cs2Automation.fire(false);return performance.now();});await pause(900);assert.equal(p.ammo,awpAmmo-1,'AWP shot through QQ consumes one bullet');assert.equal((p.shotsFired||0)-awpShots,1,'AWP QQ produces one authoritative shot');assert.equal(p.weapon,'awp');assert.equal(p.zoom,90);await waitIdle();const quickSwitchSamples=await page.evaluate(()=>{clearInterval(window.__awpQuickSwitchTimer);return window.__awpQuickSwitchSamples;}),quickSwitches=selections.slice(switchStart).filter(s=>s.id===p.id&&s.ok);assert.ok(quickSwitches.some(s=>s.before==='awp'&&s.after===sidearm),'first Q really equips the sidearm');assert.ok(quickSwitches.some(s=>s.before===sidearm&&s.after==='awp'),'second Q really returns to AWP');const returnDrawAt=quickSwitchSamples.find(s=>s.at>=returnedAt&&s.model==='awp'&&s.sequence==='draw')?.at;assert.ok(returnDrawAt,'AWP QQ redeploy animation observed');assert.ok(!quickSwitchSamples.some(s=>s.at>returnDrawAt&&s.model==='awp'&&['shoot1','fireAlt'].includes(s.sequence)),'AWP return does not replay a ghost shot animation');const awpReturn=await geometry();assertHeld(awpReturn,'awp','right');const tokens=new Set(events.slice(awpStart).filter(e=>e.type==='shot'&&e.id===p.id).map(e=>e.shotId));assert.equal(tokens.size,1,'AWP QQ does not create a second shot token');report.awp={scoped,return:awpReturn,ammoBefore:awpAmmo,ammoAfter:p.ammo,shotTokens:[...tokens],quickSwitches,quickSwitchSamples,screenshots:[scopedImage,await screenshot('awp-qq-return')]};report.checks.push('AWP scope hides the native model; shot and rapid QQ really switch away and back with one authoritative bullet and no replayed shot animation');

 await readyWeapon('deagle');await waitIdle();report.shots=[await assertShotGeometry('right'),await assertShotGeometry('left')];report.checks.push('right and left viewmodels retain authority eye origins, deterministic ballistic directions, and exactly one bullet per input pulse');
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.requests,[]);report.status='completed';
}catch(error){report.status='failed';report.failure=error.stack;try{report.failureDiagnostics=await diagnostics();report.failureGeometry=await geometry();report.failureScreenshot=await screenshot('failure');}catch{}process.exitCode=1;console.error(error.stack);}
finally{await browser?.close();await server?.close();report.fixtureClosed=true;await mkdir(artifactRoot,{recursive:true});await writeFile(artifactRoot+'/'+(framingSmoke?'report-smoke':'report')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,readyMs:report.readyMs,weapons:report.weapons.length,knifeActions:report.knife.map(k=>k.action),checks:report.checks,errors:report.errors,requests:report.requests,failure:report.failure,fixtureClosed:true},null,2));}
