// Actual client, WebSocket and Game on a synthetic map; visual assets are test stand-ins.
// Fixture control exists only over the temporary server's parent IPC channel.
import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import WebSocket from 'ws';
import {FLAT_MAP} from './fixtures/flat-map.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),temporary=await mkdtemp(path.join(tmpdir(),'lan-strike-round-browser-'));
let server,browser,peer,base;
async function control(action){
  const received=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{server.off('message',onMessage);reject(Error('IPC timeout'));},5000);
    function onMessage(message){clearTimeout(timeout);server.off('message',onMessage);if(message.error)reject(Error(message.error));else resolve(message);}
    server.on('message',onMessage);
  });server.send({action});return received;
}
try{
  for(const name of ['server.mjs','event-visibility.mjs','ballistics.mjs','hitboxes.mjs','server-telemetry.mjs','lag-compensation.mjs','game.mjs','inventory.mjs','grenades.mjs','package.json','public'])await cp(path.join(root,name),path.join(temporary,name),{recursive:true,filter:source=>!source.startsWith(path.join(root,'public/assets'))&&source!==path.join(root,'public/map-data.js')});
  await symlink(path.join(root,'node_modules'),path.join(temporary,'node_modules'),'dir');
  await writeFile(path.join(temporary,'public/map-data.js'),'export const MAP_DATA='+JSON.stringify(FLAT_MAP)+';\n');
  await writeFile(path.join(temporary,'fixture-server.mjs'),`import {game} from './server.mjs';
    if(!process.send||process.env.HOST!=='127.0.0.1')throw Error('Requires parent IPC and loopback');
    process.on('message',({action})=>{try{
      if(action==='finish'){game.finish('CT','browser fixture','timeout');game.bomb={state:'planted',x:0,y:3.2,z:0,endAt:game.time+45,site:'A'};}
      else if(action==='expire')game.endAt=game.time+.2;
      else throw Error('Unknown action');process.send({ok:true});
    }catch(e){process.send({error:e.message});}});`);
  server=fork(path.join(temporary,'fixture-server.mjs'),{cwd:temporary,env:{...process.env,HOST:'127.0.0.1',PORT:'0'},stdio:['ignore','pipe','pipe','ipc']});
  base=await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(Error('Startup timeout')),10000);
    server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timeout);resolve(`http://127.0.0.1:${match[1]}`);}});
    server.stderr.on('data',chunk=>process.stderr.write(chunk));server.once('exit',code=>{clearTimeout(timeout);reject(Error('Server exited '+code));});
  });
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-timer-throttling']});
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error('PAGE ERROR',error.message,error.stack);});
  await page.route(base+'/map-render.js',route=>route.fulfill({contentType:'text/javascript',body:`import * as THREE from '/vendor/three.module.js';
    export async function loadOriginalMap(scene){const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshBasicMaterial({color:0x666666}));floor.rotation.x=-Math.PI/2;floor.position.y=3.2;scene.add(floor);
      return {faces:1,triangles:2,textures:0,sourceSHA256:'synthetic',minimap:document.createElement('canvas'),minimapPoint:()=>[100,100],groundSoundSurface:()=>({material:'concrete',texture:'synthetic'})};}` }));
  await page.route(base+'/weapon-model.js',route=>route.fulfill({contentType:'text/javascript',body:`export async function loadWeaponManifest(){throw Error('Synthetic fixture: no original weapon assets');}export async function loadConvertedWeapon(){throw Error('Synthetic fixture: no original weapon assets');}export async function createWeaponView(THREE,camera){const group=new THREE.Group();camera.add(group);return {group,setWeapon(){},update(){},dispose(){},info:()=>({source:'test-stand-in'})};}` }));
  await page.route(base+'/player-model.js',route=>route.fulfill({contentType:'text/javascript',body:`export function createPlayerActor(THREE){const group=new THREE.Group();return {group,setCharacter(){},update(dt,p){group.position.set(p.x,p.y,p.z);},dispose(){},info:()=>({source:'test-stand-in'})};}` }));
  await page.goto(base);await page.waitForFunction(()=>window.lanStrike);await page.click('#joinButton');await page.waitForFunction(()=>window.lanStrike.getId()&&window.lanStrike.getState()?.players.length===1);
  peer=new WebSocket(base.replace('http','ws'));await new Promise((resolve,reject)=>{peer.once('error',reject);peer.on('message',raw=>{const m=JSON.parse(String(raw));if(m.type==='hello')peer.send(JSON.stringify({type:'join',team:'CT',name:'round fixture opponent'}));if(m.type==='joined')resolve();});});
  await page.waitForFunction(()=>window.lanStrike.getState()?.phase==='countdown');await page.click('#openBuyButton');await page.locator('[data-item="ak47"]').click();await page.waitForFunction(()=>window.lanStrike.getDiagnostics().weapon==='ak47');await page.click('#buyResume');
  await page.waitForFunction(()=>window.lanStrike.getDiagnostics().locked&&window.lanStrike.getState()?.phase==='live');
  const self=()=>page.evaluate(()=>{const s=window.lanStrike.getState(),p=s.players.find(p=>p.id===window.lanStrike.getId());return {phase:s.phase,round:s.round,score:s.score,x:p.x,z:p.z,ammo:p.ammo,reserve:p.reserve,alive:p.alive,ack:p.ackInputSeq,local:window.lanStrike.getDiagnostics().localPosition};});
  await page.keyboard.down('KeyW');await page.mouse.down();await page.waitForFunction(()=>window.lanStrike.getState().players.find(p=>p.id===window.lanStrike.getId()).ammo<30);
  await control('finish');await page.waitForFunction(()=>window.lanStrike.getState()?.phase==='ended');const before=await self();await page.waitForTimeout(650);const after=await self();
  assert.equal(after.alive,true);assert.equal(after.phase,'ended');assert.ok(Math.hypot(after.x-before.x,after.z-before.z)>1);assert.ok(after.ammo<before.ammo);assert.ok(after.ack>before.ack);
  assert.ok(Math.hypot(after.local.x-after.x,after.local.z-after.z)<1);assert.deepEqual(after.score,before.score);assert.match(await page.locator('#hint').textContent(),/继续移动和开火/);
  const timer=await page.locator('#timer').textContent();assert.ok(Number(timer.split(':')[1])<=6,timer);
  console.log('PASS actual client keeps prediction, acknowledged inputs, movement and automatic fire during the post-round countdown; score and countdown stay fixed');
  await page.mouse.up();await page.keyboard.up('KeyW');await control('expire');await page.waitForFunction(()=>window.lanStrike.getState()?.round===2);const next=await self();
  assert.equal(next.phase,'countdown');assert.equal(next.ammo,30);assert.equal(next.reserve,90);assert.deepEqual(next.score,before.score);assert.ok(Math.hypot(next.x-FLAT_MAP.spawns.T[0].x,next.z-FLAT_MAP.spawns.T[0].z)<.01);
  assert.deepEqual(errors,[]);console.log('PASS automatic next-round reset restores the spawn and ammunition with no page errors (synthetic map and stand-in visual assets)');
}finally{
  peer?.terminate();await browser?.close();
  if(server&&server.exitCode===null){const closed=once(server,'exit');server.kill('SIGTERM');await closed;}
  if(base){let reachable=false;try{await fetch(base+'/health',{signal:AbortSignal.timeout(1000)});reachable=true;}catch{}assert.equal(reachable,false);}
  await rm(temporary,{recursive:true,force:true});
}
