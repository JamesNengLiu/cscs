// Explicit native-transport smoke test. Never connects to the persistent 3001.
// --prepare only checks the injected module; --run owns a port:0 TLS authority
// and a fresh Chrome. Optional --peers=9 adds nine actual WSS protocol clients.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {WebSocket} from 'ws';
import {createExperimentalServer} from '../cs2-server.mjs';
import {GRENADE_PROTOCOL} from '../public/cs2-grenade-intent.js';
import {direction} from '../public/math.js';
import {CS2_GRENADE_PROFILE} from '../public/cs2-grenade-profile.js';

const args=new Set(process.argv.slice(2)),option=(key,value)=>process.argv.find(a=>a.startsWith('--'+key+'='))?.slice(key.length+3)??value;
const only=option('only','');assert.ok(['','direction'].includes(only));const directionOnly=only==='direction';
const peerCount=Number(option('peers','0')),transports=option('transports','webtransport,websocket').split(',');
assert.ok([0,9].includes(peerCount));assert.ok(transports.length&&transports.every(t=>['webtransport','websocket'].includes(t)));
const output=option('output','.local/cs2/grenade-trajectory-2026-11-07/network-browser.json'),sha=b=>createHash('sha256').update(b).digest('hex');
const connectionSource=await readFile('public/cs2-game-connection.js','utf8');

// Test-only faults preserve reliable order. Native WT datagram bytes are
// filtered before reassembly; WS gets explicit application-message faults.
// Neither is a claim about TCP packet loss or physical Wi-Fi conditions.
function installFaults(GameConnection){
 const nativeSend=GameConnection.prototype.send,nativeDeliver=GameConnection.prototype.deliver;
 const defaults=()=>({holdControls:false,controlDelayMs:0,outageUntil:0,dropEvery:0,duplicateEvery:0,reorderEvery:0,stateDropEvery:0,stateDuplicateEvery:0,stateReorderEvery:0,duplicateGrenade:false});
 const c={policy:defaults(),connection:null,controls:[],timers:new Set(),counters:{outgoing:0,incoming:0,dropped:0,duplicated:0,reordered:0,stateDropped:0,stateDuplicated:0,stateReordered:0,reliableQueued:0,reliableDuplicated:0,reliableBatches:0}};
 const later=(fn,ms)=>{const timer=setTimeout(()=>{c.timers.delete(timer);fn();},ms);c.timers.add(timer);return timer;};
 function flush(force=false){
  if(c.policy.holdControls&&!force)return;
  const now=performance.now();while(c.controls.length&&(force||c.controls[0].due<=now)){
   const q=c.controls.shift();if(q.connection.closed)continue;nativeSend.call(q.connection,q.message);
   if(c.policy.duplicateGrenade&&q.message.type==='grenadeIntent'){nativeSend.call(q.connection,q.message);c.counters.reliableDuplicated++;}
  }
  if(c.controls.length&&!c.policy.holdControls)later(()=>flush(),Math.max(1,c.controls[0].due-performance.now()));
 }
 c.configure=values=>{Object.assign(c.policy,values);flush();};
 c.flushControls=()=>{c.counters.reliableBatches++;flush(true);};
 c.reset=()=>{flush(true);for(const timer of c.timers)clearTimeout(timer);c.timers.clear();c.policy=defaults();};
 c.info=()=>({policy:{...c.policy},counters:{...c.counters},queuedControls:c.controls.length,transport:c.connection?.transport,connection:c.connection?.diagnostics()});
 GameConnection.prototype.send=function(payload){
  c.connection=this;const m=typeof payload==='string'?JSON.parse(payload):payload,p=c.policy;
  if(this.transport==='webtransport'&&(m.type==='inputBatch'||m.type==='ping'))return nativeSend.call(this,m);
  if(m.type==='inputBatch'||m.type==='ping'){
   if(m.type==='ping')return nativeSend.call(this,m);
   const n=++c.counters.outgoing;
   if(performance.now()<p.outageUntil||p.dropEvery&&n%p.dropEvery===0){c.counters.dropped++;return;}
   if(p.reorderEvery&&n%p.reorderEvery===0){c.counters.reordered++;later(()=>nativeSend.call(this,m),70);return;}
   nativeSend.call(this,m);if(p.duplicateEvery&&n%p.duplicateEvery===0){c.counters.duplicated++;later(()=>nativeSend.call(this,m),7);}return;
  }
  if(p.holdControls||p.controlDelayMs||c.controls.length){const due=Math.max(performance.now()+p.controlDelayMs,c.controls.at(-1)?.due||0);c.controls.push({connection:this,message:m,due});c.counters.reliableQueued++;flush();return;}
  nativeSend.call(this,m);
 };
 GameConnection.prototype.deliver=function(m){
  c.connection=this;if(m.type!=='state'||this.transport==='webtransport')return nativeDeliver.call(this,m);
  const p=c.policy,n=++c.counters.incoming;
  if(performance.now()<p.outageUntil||p.stateDropEvery&&n%p.stateDropEvery===0){c.counters.stateDropped++;return;}
  if(p.stateReorderEvery&&n%p.stateReorderEvery===0){c.counters.stateReordered++;later(()=>nativeDeliver.call(this,m),80);return;}
  nativeDeliver.call(this,m);if(p.stateDuplicateEvery&&n%p.stateDuplicateEvery===0){c.counters.stateDuplicated++;nativeDeliver.call(this,m);}
 };
 // Actual native HTTP/3 datagrams; no production framing is replaced.
 const Native=globalThis.WebTransport;
 if(Native)globalThis.WebTransport=class{
  constructor(...args){const w=new Native(...args);this.native=w;this.ready=w.ready;this.closed=w.closed;let writer;
   const writable=new WritableStream({write:async bytes=>{writer??=w.datagrams.writable.getWriter();const p=c.policy,seq=new DataView(bytes.buffer,bytes.byteOffset).getUint32(4);c.counters.outgoing++;
    if(performance.now()<p.outageUntil||p.dropEvery&&seq%p.dropEvery===0){c.counters.dropped++;return;}
    if(p.reorderEvery&&seq%p.reorderEvery===0){c.counters.reordered++;later(()=>writer.write(bytes).catch(()=>{}),70);return;}
    await writer.write(bytes);if(p.duplicateEvery&&seq%p.duplicateEvery===0){await writer.write(bytes);c.counters.duplicated++;}
   }});
   const readable=new ReadableStream({start:async controller=>{try{for await(const bytes of w.datagrams.readable){const p=c.policy,seq=new DataView(bytes.buffer,bytes.byteOffset).getUint32(4);c.counters.incoming++;
    if(performance.now()<p.outageUntil||p.stateDropEvery&&seq%p.stateDropEvery===0){c.counters.stateDropped++;continue;}
    if(p.stateReorderEvery&&seq%p.stateReorderEvery===0){c.counters.stateReordered++;later(()=>{try{controller.enqueue(bytes);}catch{}},80);continue;}
    controller.enqueue(bytes);if(p.stateDuplicateEvery&&seq%p.stateDuplicateEvery===0){c.counters.stateDuplicated++;controller.enqueue(bytes);}
   }controller.close();}catch(error){try{controller.error(error);}catch{}}}});
   this.datagrams={readable,writable,get maxDatagramSize(){return w.datagrams.maxDatagramSize;}};
  }
  createBidirectionalStream(...args){return this.native.createBidirectionalStream(...args);}
  close(...args){return this.native.close(...args);}
 };
 c.trace=[];const recordSend=GameConnection.prototype.send;GameConnection.prototype.send=function(payload){const m=typeof payload==='string'?JSON.parse(payload):payload;if(m.type!=='inputBatch'&&m.type!=='ping')c.trace.push({at:performance.now(),direction:'send',...m});return recordSend.call(this,payload);};const recordDeliver=GameConnection.prototype.deliver;GameConnection.prototype.deliver=function(m){if(m.type!=='state'&&m.type!=='pong'&&m.type!=='clockProbe')c.trace.push({at:performance.now(),direction:'receive',...m});return recordDeliver.call(this,m);};
 window.__cs2NetworkFaults=c;
}
const injected=connectionSource+'\n('+installFaults.toString()+')(GameConnection);\n';
execFileSync(process.execPath,['--check','--input-type=module'],{input:injected});
if(!args.has('--run')||args.has('--prepare')){console.log(JSON.stringify({status:'prepared-not-run',transports,peerCount,only,injectedSyntaxChecked:true,output}));process.exit(0);}

const fingerprintFiles=['public/cs2-client.js','public/cs2-game-connection.js','public/cs2-grenade-controls.js','public/cs2-grenade-intent.js','public/cs2-grenade-profile.js','cs2-game.mjs','cs2-grenades.mjs','cs2-grenade-flight.mjs','cs2-grenade-launch.mjs','public/cs2-projectile-buffer.js','public/cs2-effects.js','tests/cs2-grenade-network-browser.mjs'];
async function fingerprints(){return Object.fromEntries(await Promise.all(fingerprintFiles.map(async file=>[file,sha(await readFile(file))])));}
const report={status:'running',only,scope:'One real native Chrome renderer plus optional nine real WSS protocol peers on a temporary loopback native TLS/QUIC authority. Ordered control delay/batching; native QUIC datagram byte loss/duplication/reorder before reassembly, explicit application message faults for WSS. Not physical LAN, TCP packet loss, hardware mouse latency, FPS or GPU timing certification.',peerCount,transports,checks:[],errors:[],requests:[],sourceHashesBefore:await fingerprints(),injectedConnectionSHA256:sha(injected)};
let server,browser,context,page,player;const peers=[],events=[],authorityTrace=[];
function playerProbe(full=true){if(!player)return null;const p=player,snapshot=full?server.game.snapshot(p.id).players.find(q=>q.id===p.id):null;return{time:server.game.time,weapon:p.weapon,previousWeapon:p.previousWeapon,phase:p.grenadePhase,startedAt:p.grenadeStartedAt,released:p.grenadeReleased,thrownAt:p.grenadeThrownAt,status:p.grenadeIntentStatus,ack:p.grenadeAckSeq,action:p.grenadeActionId,rejected:p.grenadeRejectedActionId,grenades:{...p.grenades},nextAttackAt:p.nextAttackAt,pendingAction:snapshot?.pendingGrenadeActionId,pendingAt:snapshot?.pendingGrenadeLaunchAt,inputSeq:p.ackInputSeq};}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=5000){const end=performance.now()+timeout;while(performance.now()<end){if(fn())return;await pause(10);}throw Error('Fixture timeout: '+label);}
const fault=values=>page.evaluate(values=>window.__cs2NetworkFaults.configure(values),values);
const faultInfo=()=>page.evaluate(()=>window.__cs2NetworkFaults.info());
async function connectPeer(url,index,ca){
 return new Promise((resolve,reject)=>{const ws=new WebSocket(url,{ca}),p={ws,id:null};peers.push(p);const timer=setTimeout(()=>reject(Error('WSS peer join timeout')),5000);ws.on('error',reject);ws.on('message',bytes=>{const m=JSON.parse(bytes);if(m.type==='hello')ws.send(JSON.stringify({type:'assetReady',worldContract:m.worldContract,weaponProfileId:m.weaponProfileId,presentationProfileId:m.presentationProfileId}));if(m.type==='assetReadyAck')ws.send(JSON.stringify({type:'join',name:'network-peer-'+index,team:index<4?'T':'CT',character:index<4?'terror':'urban',grenadeProtocol:GRENADE_PROTOCOL,worldContract:m.worldContract,weaponProfileId:m.weaponProfileId,presentationProfileId:m.presentationProfileId}));if(m.type==='clockProbe')ws.send(JSON.stringify({type:'clockReply',token:m.token}));if(m.type==='joined'){p.id=m.id;clearTimeout(timer);resolve(p);}if(m.type==='error'){clearTimeout(timer);reject(Error(m.message));}});});
}
async function load(transport,base){
 await page.goto(base+'/?transport='+transport+'&automation=1');
 await page.waitForFunction(()=>window.lanStrike&&!document.querySelector('#joinButton').disabled||document.querySelector('#error').textContent,undefined,{timeout:120000});assert.equal(await page.locator('#error').textContent(),'');
 assert.equal(await page.evaluate(()=>window.lanStrike.getDiagnostics().transport),transport,'Requested native transport must not silently fall back');
 await page.locator('#joinButton').click();await page.waitForFunction(()=>window.lanStrike.getState()?.players.some(p=>p.id===window.lanStrike.getId()));
 player=server.game.players.get(await page.evaluate(()=>window.lanStrike.getId()));assert.ok(player);await page.evaluate(()=>window.cs2Automation.start());
}
async function prepare(weapon,{flashes=1}={}){
 await page.evaluate(()=>{window.__cs2NetworkFaults.reset();window.cs2Automation.fire(false);window.cs2Automation.setKeys([]);});
 const g=server.game;g.begin();g.phase='live';g.endAt=g.buyEndAt=g.time+10000;player.money=16000;player.hp=1e9;
 if(weapon!=='knife'&&!player.inventory[weapon]&&!player.grenades?.[weapon])assert.ok(g.buy(player.id,weapon),'buy '+weapon);
 if(weapon==='flashbang'&&flashes===2&&player.grenades.flashbang<2)assert.ok(g.buy(player.id,'flashbang'));
 g.equip(player.id,'knife');g.equip(player.id,weapon);Object.assign(player,{nextAttackAt:0,nextSecondaryAt:0,nextShotAt:g.time,vx:0,vy:0,vz:0,pitch:0});
 for(const [index,p]of [...g.players.values()].filter(p=>p.id!==player.id).entries())Object.assign(p,{x:player.x+25+index*2,z:player.z+25,hp:1e9});
 server.broadcastState();await page.waitForFunction(({weapon,round})=>{const d=window.lanStrike.getDiagnostics(),s=window.lanStrike.getState();return s?.round===round&&d.weapon===weapon&&d.weaponModel.id===weapon&&!d.weaponModel.loading&&d.weaponModel.source==='source2-native-gltf';},{weapon,round:g.round});
 await page.evaluate(yaw=>{window.cs2Automation.look(yaw,0);window.cs2Automation.start();},player.yaw);
 await page.waitForFunction(()=>window.lanStrike.getDiagnostics().weaponModel.sequence==='idle');
}
async function press(mask){if(mask&1)await page.mouse.down({button:'left'});if(mask&2)await page.mouse.down({button:'right'});}
async function release(mask){if(mask&1)await page.mouse.up({button:'left'});if(mask===3)await pause(25);if(mask&2)await page.mouse.up({button:'right'});}

try{
 const cert=await readFile('.local/cs2/certificate/wt-cert.pem'),key=await readFile('.local/cs2/certificate/wt-key.pem');
 server=await createExperimentalServer({port:0,host:'127.0.0.1',tls:{cert,key},webtransport:true,presentation:'native',gameOptions:{weaponProfile:'cs2',random:()=>.5,audioRandom:()=>.5}});assert.equal(server.address().address,'127.0.0.1');assert.notEqual(server.address().port,3001);
 const nativeIntent=server.game.grenadeIntent.bind(server.game);server.game.grenadeIntent=(id,raw,options)=>{const before=playerProbe(),ack=nativeIntent(id,raw,options);authorityTrace.push({kind:'intent',raw,before,after:playerProbe(),ack});return ack;};const nativeEquip=server.game.equip.bind(server.game);server.game.equip=(id,key)=>{const before=playerProbe(),result=nativeEquip(id,key);authorityTrace.push({kind:'equip',key,before,after:playerProbe(),result});return result;};const nativeStep=server.game.step.bind(server.game);server.game.step=(...args)=>{const before=playerProbe(false);nativeStep(...args);if(player&&before){const after=playerProbe(false);if(['weapon','phase','status','grenades'].some(key=>JSON.stringify(before[key])!==JSON.stringify(after[key]))||server.game.serverTick%10===0){authorityTrace.push({kind:'step',before,after});if(authorityTrace.length>600)authorityTrace.shift();}}};
 const base='https://127.0.0.1:'+server.address().port,emit=server.game.emit.bind(server.game);report.server=base;server.game.emit=e=>{const q=e.type==='throw'?server.game.projectiles.find(q=>q.id===e.projectileId):null,owner=e.type==='throw'?server.game.players.get(e.id):null;events.push({...e,time:server.game.time,...(q?{initialProjectile:{id:q.id,x:q.x,y:q.y,z:q.z,vx:q.vx,vy:q.vy,vz:q.vz,bornAt:q.bornAt},ownerAtCommit:{yaw:owner.yaw,pitch:owner.pitch,recoilYaw:owner.recoilYaw,recoilPitch:owner.recoilPitch,vx:owner.vx,vy:owner.vy,vz:owner.vz,ackInputSeq:owner.ackInputSeq}}:{})});emit(e);};
 for(let index=0;index<peerCount;index++)await connectPeer('wss://127.0.0.1:'+server.address().port,index,cert);
 const spki=createHash('sha256').update(new X509Certificate(cert).publicKey.export({format:'der',type:'spki'})).digest('base64');
 browser=await chromium.launch({headless:!args.has('--headed'),executablePath:process.env.CS2_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--ignore-certificate-errors-spki-list='+spki,'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
 context=await browser.newContext({viewport:{width:1280,height:800},ignoreHTTPSErrors:true});await context.route('**/cs2-game-connection.js',route=>route.fulfill({contentType:'text/javascript',body:injected}));page=await context.newPage();page.setDefaultTimeout(120000);
 page.on('pageerror',e=>report.errors.push(e.stack||e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/favicon.ico'))report.requests.push({url:r.url(),status:r.status()});});
 for(const transport of transports){
  console.log('network transport '+transport);let start;await load(transport,base);assert.equal(server.game.players.size,peerCount+1);
  report.renderer=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),debug=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER);});assert.match(report.renderer,/Apple|Metal/i);assert.doesNotMatch(report.renderer,/SwiftShader|llvmpipe/i);
  if(!args.has('--pending-only')&&!directionOnly){for(const [mask,strength]of [[1,1],[2,0],[3,.5]]){
   await prepare('hegrenade');const before=player.grenades.hegrenade,start=events.length;
   await fault({holdControls:true}); // Outage deadlines use only the browser clock.
   await page.evaluate(()=>window.__cs2NetworkFaults.configure({outageUntil:performance.now()+300}));
   await press(mask);await pause(650);assert.equal(events.slice(start).filter(e=>e.type==='throw').length,0);assert.equal(player.grenades.hegrenade,before);
   await page.evaluate(()=>window.__cs2NetworkFaults.flushControls());await until(()=>player.grenadePhase==='hold','batched press becomes held');await pause(100);assert.equal(player.grenades.hegrenade,before);
   await fault({holdControls:false,controlDelayMs:150,duplicateGrenade:true,dropEvery:7,duplicateEvery:6,reorderEvery:5,stateDropEvery:7,stateDuplicateEvery:6,stateReorderEvery:5});
   await release(mask);await until(()=>events.slice(start).some(e=>e.type==='throw'),'delayed final release');await pause(200);
   const throws=events.slice(start).filter(e=>e.type==='throw');assert.equal(throws.length,1);assert.equal(throws[0].strength,strength);assert.equal(player.grenades.hegrenade,before-1);const faults=await faultInfo();assert.ok(faults.counters.reliableQueued>=2&&faults.counters.reliableDuplicated>0);
   report.checks.push({transport,name:'held, batched press, delayed duplicated release',mask,strength,inventoryBefore:before,inventoryAfter:player.grenades.hegrenade,faults});
  }
  await prepare('flashbang',{flashes:2});await fault({controlDelayMs:100});start=events.length;await press(1);await until(()=>player.grenadePhase==='hold','first flash hold');await release(1);await until(()=>events.slice(start).some(e=>e.type==='throw'),'first flash commit');await press(2);await until(()=>player.grenadePhase==='hold'&&player.grenadeStrength===0,'follow-up right flash hold');assert.equal(player.grenades.flashbang,1);await release(2);await until(()=>events.slice(start).filter(e=>e.type==='throw').length===2,'second flash commit');assert.equal(player.grenades.flashbang,0);assert.deepEqual(events.slice(start).filter(e=>e.type==='throw').map(e=>e.strength),[1,0]);report.checks.push({transport,name:'two flash throws across recovery with delayed controls'});
  await prepare('hegrenade');await press(2);await until(()=>player.grenadePhase==='hold','right hold before cancel');start=events.length;const remaining=player.grenades.hegrenade;await page.keyboard.press('Escape');await release(2);await pause(250);assert.equal(player.grenades.hegrenade,remaining);assert.equal(events.slice(start).filter(e=>e.type==='throw').length,0);assert.equal(player.grenadePhase,'');report.checks.push({transport,name:'menu cancel and late right mouseup do not throw'});
  }
  if(!directionOnly){await prepare('hegrenade');if(!player.primary){player.money=16000;assert.ok(server.game.buy(player.id,'ak47'));server.game.equip(player.id,'hegrenade');server.broadcastState();}const primary=player.primary;assert.ok(primary);server.game.equip(player.id,primary);server.game.equip(player.id,'hegrenade');player.nextAttackAt=0;server.broadcastState();await pause(120);
  await press(1);await until(()=>player.grenadePhase==='hold','committed throw before Q');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().grenadePrediction.phase==='hold');await pause(20);start=events.length;const inventory=player.grenades.hegrenade;await fault({controlDelayMs:150});report.pendingBeforeRelease={authority:playerProbe(),browser:await page.evaluate(()=>({prediction:window.lanStrike.getDiagnostics().grenadePrediction,stateTime:window.lanStrike.getState()?.time,wallAt:performance.now()}))};await release(1);report.pendingAfterRelease={authority:playerProbe(),browser:await page.evaluate(()=>({prediction:window.lanStrike.getDiagnostics().grenadePrediction,stateTime:window.lanStrike.getState()?.time,wallAt:performance.now()}))};await page.keyboard.press('q');await until(()=>events.slice(start).some(e=>e.type==='throw'),'released grenade survives Q');await until(()=>player.weapon===primary,'Q keeps primary');assert.equal(player.grenades.hegrenade,inventory-1);assert.equal(events.slice(start).filter(e=>e.type==='throw').length,1);report.checks.push({transport,name:'release plus Q preserves delayed throw and selected primary'});}
  if(!args.has('--pending-only'))for(const switched of [false,true]){
   await prepare('hegrenade');
   if(switched){if(!player.primary){player.money=16000;assert.ok(server.game.buy(player.id,'ak47'));}server.game.equip(player.id,player.primary);server.game.equip(player.id,'hegrenade');player.nextAttackAt=0;server.broadcastState();await pause(120);}
   const previousWeapon=player.weapon,primary=player.primary,oldYaw=player.yaw,oldPitch=player.pitch,nextYaw=Math.atan2(Math.sin(oldYaw+Math.PI/2),Math.cos(oldYaw+Math.PI/2)),nextPitch=.3,remaining=player.grenades.hegrenade;
   await press(2);await until(()=>player.grenadePhase==='hold','direction probe authority hold');await page.waitForFunction(()=>window.lanStrike.getDiagnostics().grenadePrediction.phase==='hold');await pause(20);const start=events.length; // Right release has no reliable primary-fire edge to mask a missing grenade view.
   await page.evaluate(({yaw,pitch})=>{window.__cs2NetworkFaults.configure({outageUntil:performance.now()+300,controlDelayMs:0});window.cs2Automation.look(yaw,pitch);},{yaw:nextYaw,pitch:nextPitch});
   await release(2);if(switched)await page.keyboard.press('q');
   await until(()=>events.slice(start).some(e=>e.type==='throw'),'reliable release direction during datagram outage');const thrown=events.slice(start).filter(e=>e.type==='throw');assert.equal(thrown.length,1);const event=thrown[0];assert.equal(event.strength,0);const q=event.initialProjectile,owner=event.ownerAtCommit;assert.ok(q&&owner,'Capture initial velocity at authoritative emit, before flight integration');if(!switched){assert.ok(Math.abs(Math.atan2(Math.sin(owner.yaw-oldYaw),Math.cos(owner.yaw-oldYaw)))<1e-8&&Math.abs(owner.pitch-oldPitch)<1e-8,'Direction probe must leave the authoritative movement view stale during outage');}
   assert.ok(Math.abs(owner.recoilPitch||0)<1e-10&&Math.abs(owner.recoilYaw||0)<1e-10,'Stationary probe has no gun punch');
   const sourcePitch=-nextPitch*180/Math.PI,throwPitch=sourcePitch-(90-Math.abs(sourcePitch))*10/90,forward=direction(nextYaw,-throwPitch*Math.PI/180),speed=CS2_GRENADE_PROFILE.weapons.hegrenade.throwVelocity*CS2_GRENADE_PROFILE.throwVelocityScale*CS2_GRENADE_PROFILE.metresPerUnit*CS2_GRENADE_PROFILE.strengthSpeedFloor,inherit=CS2_GRENADE_PROFILE.inheritedVelocityScale;
   const expected={x:forward.x*speed+owner.vx*inherit,y:forward.y*speed+owner.vy*inherit,z:forward.z*speed+owner.vz*inherit},actual={x:q.vx,y:q.vy,z:q.vz},error=Math.hypot(actual.x-expected.x,actual.y-expected.y,actual.z-expected.z);
   assert.ok(error<1e-6,'Reliable view must determine initial velocity during missing movement inputs: '+error);assert.equal(player.grenades.hegrenade,remaining-1);if(switched){await until(()=>player.weapon===primary,'direction pending keeps selected primary');}else assert.equal(player.weapon,previousWeapon);
   const releaseMessage=await page.evaluate(()=>window.__cs2NetworkFaults.trace.filter(m=>m.direction==='send'&&m.type==='grenadeIntent'&&m.kind==='release').at(-1));assert.ok(Number.isSafeInteger(releaseMessage.afterInputSeq)&&releaseMessage.afterInputSeq>=0);assert.ok(Math.abs(releaseMessage.pitch-nextPitch)<1e-12);assert.ok(Math.abs(releaseMessage.yaw-nextYaw)<1e-12);
   report.checks.push({transport,name:switched?'reliable 90-degree release view survives Q during datagram outage':'reliable 90-degree release view during datagram outage',switched,button:2,strength:0,oldYaw,oldPitch,releaseView:{yaw:nextYaw,pitch:nextPitch,afterInputSeq:releaseMessage.afterInputSeq},initialProjectile:q,ownerAtCommit:owner,expectedVelocity:expected,velocityErrorMetresPerSecond:error,launchSource:event.launchSource,faults:await faultInfo()});
  }
  if(!args.has('--pending-only')&&!directionOnly){await prepare('awp');await fault({controlDelayMs:100,dropEvery:7,duplicateEvery:6,reorderEvery:5,stateDropEvery:7,stateDuplicateEvery:6,stateReorderEvery:5});await page.mouse.click(640,400,{button:'right'});await until(()=>player.zoom<90,'AWP scope');const ammo=player.ammo;start=events.length;await page.mouse.down({button:'left'});await pause(35);await page.keyboard.press('q');await pause(35);await page.keyboard.press('q');await page.mouse.up({button:'left'});await until(()=>events.slice(start).some(e=>e.type==='shot'),'AWP shot');await until(()=>player.weapon==='awp'&&player.zoom===90,'AWP QQ returns unscoped');await pause(300);assert.equal(player.ammo,ammo-1);assert.equal(events.slice(start).filter(e=>e.type==='shot').length,1);report.checks.push({transport,name:'AWP scoped shot and QQ with loss/reorder: exactly one bullet, manual rescope'});
  await prepare('ak47');const spawn={x:player.x,y:player.y,z:player.z},eye=server.world.movement.eyeHeight(player);let yaw=player.yaw;for(let i=0;i<8;i++){const candidate=yaw+i*Math.PI/4,d=direction(candidate,0),hit=server.world.collision.trace({...spawn,y:spawn.y+eye},{x:spawn.x+d.x*1.5,y:spawn.y+eye,z:spawn.z+d.z*1.5});if(hit.fraction===1){yaw=candidate;break;}}
  await page.evaluate(yaw=>window.cs2Automation.look(yaw,0),yaw);await fault({dropEvery:7,duplicateEvery:6,reorderEvery:5,stateDropEvery:7,stateDuplicateEvery:6,stateReorderEvery:5});const samples=[],timer=setInterval(()=>samples.push({x:player.x,y:player.y,z:player.z,ack:player.ackInputSeq}),10);
  try{await page.keyboard.down('w');await page.keyboard.down('Space');await pause(100);await page.keyboard.up('Space');await pause(100);await page.evaluate(()=>window.__cs2NetworkFaults.configure({outageUntil:performance.now()+300}));await pause(650);await page.keyboard.up('w');await page.waitForFunction(()=>{const d=window.lanStrike.getDiagnostics();return d.unackedInputs<12&&d.inputSeq-d.ackInputSeq<12&&d.lastCorrection<.3;},undefined,{timeout:6000});}finally{clearInterval(timer);await page.keyboard.up('w');await page.keyboard.up('Space');}
  const diagnostics=await page.evaluate(()=>window.lanStrike.getDiagnostics()),faults=await faultInfo();assert.ok(Math.hypot(player.x-spawn.x,player.z-spawn.z)>.2);assert.ok(Math.max(...samples.map(s=>s.y))-spawn.y>.1);assert.ok(faults.counters.dropped>0&&faults.counters.duplicated>0&&faults.counters.reordered>0);assert.ok(diagnostics.connection.staleStates>0);assert.ok(diagnostics.connection.reassembly.pending<=8);if(transport==='webtransport')assert.ok(diagnostics.connection.sentDatagrams>0&&diagnostics.connection.receivedDatagrams>0);
  report.checks.push({transport,name:'movement and jump recover after loss, duplicates, reorder and 300ms input/state outage',inputSeq:diagnostics.inputSeq,ackInputSeq:diagnostics.ackInputSeq,unackedInputs:diagnostics.unackedInputs,lastCorrection:diagnostics.lastCorrection,faults,trajectory:samples});}
  await page.evaluate(()=>{window.__cs2NetworkFaults.reset();window.cs2Automation.stop();});const id=player.id;await page.goto('about:blank');await until(()=>!server.game.players.has(id),'browser peer removed');
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.requests,[]);report.sourceHashesAfter=await fingerprints();assert.deepEqual(report.sourceHashesBefore,report.sourceHashesAfter);report.sourcesStable=true;report.status='completed';
}catch(error){report.status='failed';report.failure=error.stack;report.authorityFailure=playerProbe();report.authorityTrace=authorityTrace.slice(-200);report.recentEvents=events.slice(-20);try{report.browserFailure=await page.evaluate(()=>({diagnostics:window.lanStrike?.getDiagnostics(),stateTime:window.lanStrike?.getState()?.time,wallAt:performance.now(),faults:window.__cs2NetworkFaults?.info(),controlTrace:window.__cs2NetworkFaults?.trace}));}catch{}report.sourceHashesAfter=await fingerprints();report.sourcesStable=JSON.stringify(report.sourceHashesBefore)===JSON.stringify(report.sourceHashesAfter);process.exitCode=1;console.error(error.stack);}finally{
 try{await context?.close();}catch{}await browser?.close();for(const peer of peers)peer.ws.terminate();await server?.close();report.fixtureClosed=true;await mkdir(new URL('.',new URL(output,'file://'+process.cwd()+'/')),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,peerCount,transports,fixtureClosed:report.fixtureClosed,failure:report.failure,output},null,2));
}
