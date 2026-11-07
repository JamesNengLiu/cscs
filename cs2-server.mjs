// Isolated CS2 experimental authority. Importing this module never listens on a
// port and never imports the v1.0 server or its BSP-backed shared entry point.
import http from 'node:http';
import https from 'node:https';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID,X509Certificate,createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {WebSocketServer,WebSocket} from 'ws';
import {createCS2Game} from './cs2-game.mjs';
import {loadNativeHitboxes} from './cs2-native-hitboxes.mjs';
import {createExperimentalWorld} from './public/cs2-world.js';
import {compileCollisionData} from './public/cs2-collision.js';
import {CS2_MOVEMENT_PROFILE} from './public/cs2-movement-profile.js';
import {getWeaponProfile,isCS2WeaponProfile} from './public/cs2-weapon-profile.js';
import {assertWorldCompatible} from './public/experimental-world-contract.js';
import {applyScopeAwareAction} from './cs2-scope-actions.mjs';
import {GUNS} from './public/arsenal.js';
import {ECONOMY} from './public/economy.js';
import {CHARACTER_PRESETS} from './public/characters-config.js';
import {createServerTelemetry} from './server-telemetry.mjs';
import {createLagCompensation} from './cs2-lag-compensation.mjs';
import {MAX_INPUT_BATCH,INPUT_VIEW_PROTOCOL,COMBAT_ORDER_VERSION} from './public/cs2-input-protocol.js';
import {GRENADE_PROTOCOL} from './public/cs2-grenade-intent.js';
import {WEAPON_SWITCH_VIEW_PROTOCOL} from './public/cs2-weapon-switch-view.js';
import {WEAPON_ACTION_PROTOCOL} from './public/cs2-weapon-action-order.js';
import {eventVisibleTo} from './event-visibility.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg','.txt':'text/plain; charset=utf-8','.glb':'model/gltf-binary','.gltf':'model/gltf+json'};
export async function loadExperimentalWorld({assetRoot=path.join(root,'public','assets'),movementProfile,compiled=true}={}){
 const physicsRoot=path.join(assetRoot,'cs2-physics');
 const packageManifest=JSON.parse(await readFile(path.join(physicsRoot,'manifest.json'),'utf8'));
 if(packageManifest.schema!=='cs2-physics-package-v1'||packageManifest.file!=='physics.json.gz'||!Number.isSafeInteger(packageManifest.bytes)||packageManifest.bytes<=0||packageManifest.bytes>128*1024*1024||!/^[a-f0-9]{64}$/.test(packageManifest.sha256))throw Error('Invalid experimental physics manifest');
 const bytes=gunzipSync(await readFile(path.join(physicsRoot,packageManifest.file)),{maxOutputLength:packageManifest.bytes+1});
 const digest=createHash('sha256').update(bytes).digest('hex');
 if(bytes.byteLength!==packageManifest.bytes||digest!==packageManifest.sha256)throw Error('Experimental physics integrity mismatch');
 const data=JSON.parse(bytes.toString('utf8')),renderManifest=JSON.parse(await readFile(path.join(assetRoot,'cs2-optimized','map.json'),'utf8'));
 return createExperimentalWorld(compiled?compileCollisionData(data):data,{packageManifest,renderManifest,verifiedPhysicsSHA256:digest,movementProfile});
}

export async function createExperimentalServer({world=null,port=0,host='127.0.0.1',gameOptions={},movementProfile,presentation='legacy',tls=null,webtransport=false,snapshotHz=30,joinTimeoutMs=120000,autoTick=true}={}){
 if(![15,30,60].includes(snapshotHz))throw Error('snapshotHz must be 15, 30 or 60');
 if(webtransport&&!tls)throw Error('WebTransport requires TLS');
 if(!Number.isFinite(joinTimeoutMs)||joinTimeoutMs<100||joinTimeoutMs>600000)throw Error('Invalid asset-ready deadline');
 const requestedProfile=typeof gameOptions.weaponProfile==='string'?getWeaponProfile(gameOptions.weaponProfile):gameOptions.weaponProfile;
 if(requestedProfile)getWeaponProfile(requestedProfile.id);
 const requestedCS2=isCS2WeaponProfile(requestedProfile);
 movementProfile=movementProfile||(requestedCS2?CS2_MOVEMENT_PROFILE:undefined);
 world=world||await loadExperimentalWorld({movementProfile});
 if(requestedCS2&&world.contract.rulesVersion!==CS2_MOVEMENT_PROFILE.id)throw Error('CS2 weapon and movement profile must share the same world contract');
 let contentManifest=null,presentationProfileId='legacy-rig-v1';
 if(presentation==='native'){
  const bytes=await readFile(path.join(root,'public/assets/cs2-content/runtime.json'));contentManifest=JSON.parse(bytes.toString());
  if(contentManifest.schema!=='cscs.cs2.content.v1'||!contentManifest.actorRigs)throw Error('Complete native content package required');
  presentationProfileId='source2-native-'+createHash('sha256').update(bytes).digest('hex').slice(0,16);
  gameOptions={...gameOptions,hitboxes:await loadNativeHitboxes(contentManifest.actorRigs)};
 }else if(presentation!=='legacy')throw Error('Unknown presentation profile');
 const game=createCS2Game(world,gameOptions),RULES=world.movement.rules;
 game.lagComp=createLagCompensation();
 const sourceFingerprint=createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).update(await readFile(new URL('./cs2-game.mjs',import.meta.url))).update(JSON.stringify(world.contract)).update(game.weaponProfileId).digest('hex');
 const certDigest=tls?Array.from(createHash('sha256').update(new X509Certificate(tls.cert).raw).digest()):null;
 const telemetry=createServerTelemetry({tickHz:RULES.tick,snapshotHz}),peers=new Set();
 const networkStats=()=>({...telemetry.snapshot(),sourceFingerprint});

 let wt=null,eventSequence=0,timer=null,stopping=false,tick=0;
 const json=(res,data)=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 async function handler(req,res){
  try{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/transport-config')return json(res,{webtransport:!!wt,path:'/wt',certificateHash:certDigest,protocol:'lan-strike-wt-v1',snapshotHz,experimental:true,worldContract:world.contract,weaponProfileId:game.weaponProfileId,movementProfileId:world.contract.rulesVersion});
   if(url.pathname==='/experimental-config')return json(res,{experimental:true,worldContract:world.contract,weaponProfileId:game.weaponProfileId,movementProfileId:world.contract.rulesVersion,physicsManifest:'/assets/cs2-physics/manifest.json',renderManifest:'/assets/cs2-optimized/map.json',gameVersion:'cs2-experimental-v1',presentationProfileId,contentManifest:contentManifest?'/assets/cs2-content/runtime.json':null});
   if(url.pathname==='/health')return json(res,{ok:true,version:'cs2-experimental-v1',experimental:true,worldContract:world.contract,weaponProfileId:game.weaponProfileId,movementProfileId:world.contract.rulesVersion,characterPresets:CHARACTER_PRESETS.length,presentationProfileId,playerModels:contentManifest?'source2-native-weighted-capsules':'canonical-legacy-rig-transitional',startMoney:ECONOMY.startMoney,gunCount:Object.keys(gameOptions.guns||GUNS).length,arsenal:game.weaponProfileId,movementSync:'command-queue-v2',inputViewProtocol:INPUT_VIEW_PROTOCOL,combatOrderVersion:COMBAT_ORDER_VERSION,weaponSwitchViewProtocol:WEAPON_SWITCH_VIEW_PROTOCOL,hitRecoveryProfile:game.hitRecovery.name,hitRecoveryVersion:game.hitRecovery.version,mapVersion:world.contract.mapId,players:game.players.size,phase:game.phase,network:{...networkStats(),transport:wt?'webtransport+websocket':'websocket',webtransportReady:!!wt}});
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
   const vendor={'/vendor/three.module.js':'three.module.js','/vendor/three.core.js':'three.core.js'},relative=decodeURIComponent(url.pathname==='/'?'/cs2-play.html':url.pathname),publicRoot=path.join(root,'public'),addonsRoot=path.join(root,'node_modules/three/examples/jsm');
   const addon=relative.startsWith('/vendor/three-addons/')?path.resolve(addonsRoot,relative.slice('/vendor/three-addons/'.length)):null;
   const file=vendor[relative]?path.join(root,'node_modules/three/build',vendor[relative]):addon||path.resolve(publicRoot,'.'+relative);
   if(addon?!file.startsWith(addonsRoot+path.sep):!vendor[relative]&&!file.startsWith(publicRoot+path.sep)){res.writeHead(403);res.end();return;}
   const info=await stat(file);if(req.aborted||res.destroyed)return;if(!info.isFile()){res.writeHead(404).end('Not found');return;}const etag='W/"'+info.size.toString(16)+'-'+Math.trunc(info.mtimeMs).toString(16)+'"';if(req.headers['if-none-match']===etag){res.writeHead(304,{'ETag':etag,'Cache-Control':'no-cache'});res.end();return;}res.writeHead(200,{'ETag':etag,'Last-Modified':info.mtime.toUTCString(),'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});if(req.method==='HEAD'){res.end();return;}const stream=createReadStream(file);stream.on('error',()=>res.destroy());req.once('aborted',()=>stream.destroy());res.once('close',()=>stream.destroy());stream.pipe(res);
  }catch{res.writeHead(404);res.end('Not found');}
 }
 const server=tls?https.createServer(tls,handler):http.createServer(handler),wss=new WebSocketServer({server,maxPayload:8192});
 // ws forwards the HTTP server's startup errors. The listen promise below owns
 // rejection/cleanup; keep that forwarded event from becoming unhandled first.
 wss.on('error',()=>{});
 function send(ws,obj){
  if(ws.readyState!==WebSocket.OPEN)return;
  if(['hello','assetReadyAck','joined','state'].includes(obj.type))obj={...obj,presentationProfileId};
  const c=ws.netCounters;c.maxBufferedBytes=Math.max(c.maxBufferedBytes,ws.bufferedAmount);
  if(obj.type==='state')c.stateSequence++;
  if(ws.bufferedAmount>=128000){c.skippedMessages++;if(obj.type==='state')c.skippedStates++;else ws.close();return;}
  if(obj.type==='state')obj={...obj,net:{seq:c.stateSequence,emittedAtMs:performance.now(),serverLoopMaxMs:networkStats().serverLoopMaxMs,skippedStates:c.skippedStates,transport:ws.transport||'websocket',snapshotHz}};
  const payload=JSON.stringify(obj);c.sentBytes+=Buffer.byteLength(payload);c.sentMessages++;ws.send(payload);
 }
 function broadcastState(){for(const c of peers)if(c.playerId)send(c,game.snapshot(c.playerId));}
 function broadcastEvents(events){const tagged=events.map(e=>({...e,eventId:++eventSequence,round:game.round}));for(const c of peers){if(!c.playerId)continue;const visible=tagged.filter(e=>eventVisibleTo(e,game.players.get(c.playerId)));if(visible.length)send(c,{type:'events',events:visible});}}
 function connect(ws,req){
  const requestHost=req.headers.host,origin=req.headers.origin;
  if(origin&&origin!==`http://${requestHost}`&&origin!==`https://${requestHost}`){ws.close(1008,'Origin rejected');return;}
  peers.add(ws);ws.netCounters={sentMessages:0,sentBytes:0,skippedMessages:0,skippedStates:0,maxBufferedBytes:0,stateSequence:0};
  const id=randomUUID();let joined=false,assetReady=false,windowAt=Date.now(),messages=0,lastAction=0,probe=null;
  send(ws,{type:'hello',id,experimental:true,worldContract:world.contract,weaponProfileId:game.weaponProfileId,movementProfileId:world.contract.rulesVersion,transport:ws.transport||'websocket',protocol:'lan-strike-wt-v1',weaponActionProtocol:WEAPON_ACTION_PROTOCOL,inputViewProtocol:INPUT_VIEW_PROTOCOL,combatOrderVersion:COMBAT_ORDER_VERSION,weaponSwitchViewProtocol:WEAPON_SWITCH_VIEW_PROTOCOL});
  const deadline=setTimeout(()=>{if(!joined)ws.close(1008,'Asset-ready/join timeout');},joinTimeoutMs);deadline.unref();
  const probeTimer=setInterval(()=>{if(ws.readyState!==1)return;probe={token:randomUUID(),at:performance.now()};send(ws,{type:'clockProbe',token:probe.token});},1000);probeTimer.unref();
  function verify(received,weaponProfileId,clientPresentation){try{if(contentManifest&&clientPresentation!==presentationProfileId)throw Error('Native rig/presentation mismatch');assertWorldCompatible(world.contract,received);if(game.weaponProfileId!=='legacy-cs16-v1'&&weaponProfileId!==game.weaponProfileId)throw Error('Experimental weapon profile mismatch');}catch(error){send(ws,{type:'error',code:'WORLD_CONTRACT_MISMATCH',message:error.message});ws.close(1008,'World contract mismatch');return false;}return true;}
  ws.on('message',buffer=>{
   if(Date.now()-windowAt>1000){windowAt=Date.now();messages=0;}if(++messages>180||buffer.length>8192){ws.close(1008,'Rate limit');return;}
   try{const m=JSON.parse(buffer.toString());if(!m||typeof m!=='object'||Array.isArray(m))throw Error('Invalid message');
    if(m.actionSeq!==undefined){if(!Number.isSafeInteger(m.actionSeq)||m.actionSeq<=lastAction)return;lastAction=m.actionSeq;}
    if(m.type==='assetReady'&&!joined){if(!verify(m.worldContract,m.weaponProfileId,m.presentationProfileId))return;assetReady=true;send(ws,{type:'assetReadyAck',ok:true,experimental:true,worldContract:world.contract,weaponProfileId:game.weaponProfileId,movementProfileId:world.contract.rulesVersion});}
    else if(m.type==='join'&&!joined){
     if(!assetReady){send(ws,{type:'error',code:'ASSETS_NOT_READY',message:'请先校验地图和规则资源'});ws.close(1008,'Assets not ready');return;}
     if(!verify(m.worldContract,m.weaponProfileId,m.presentationProfileId))return;
     game.add(id,m.name,m.team,m.character);if(m.grenadeProtocol===GRENADE_PROTOCOL)game.enableGrenadeIntents(id);joined=true;ws.playerId=id;clearTimeout(deadline);send(ws,{type:'joined',id,experimental:true,worldContract:world.contract,weaponProfileId:game.weaponProfileId,movementProfileId:world.contract.rulesVersion});send(ws,game.snapshot(id));
    }
    else if(m.type==='grenadeIntent'&&joined){const ack=game.grenadeIntent(id,m,{onAck:ack=>send(ws,ack),onError:error=>send(ws,{type:'error',message:error.message||'无效消息'})});if(ack)send(ws,ack);}
    else if((m.type==='inputBatch'||m.type==='inputCritical')&&joined){if(!Array.isArray(m.commands)||m.commands.length>MAX_INPUT_BATCH)throw Error('Invalid input batch');const accepted=[];game.inputBatch(id,m.commands,accepted);game.lagComp.view(id,accepted,{viewTime:m.viewTime,interpDelayMs:m.interpDelayMs,viewAgeMs:m.viewAgeMs,now:game.time,round:game.round});}
    else if(m.type==='input'&&joined)game.input(id,m.input);
    else if(['reload','equip','drop','secondary'].includes(m.type)&&joined){const ack=applyScopeAwareAction(game,id,m,{onAck:ack=>send(ws,ack),onError:error=>send(ws,{type:'error',message:error.message||'无效消息'})});if(ack)send(ws,ack);}
    else if(m.type==='buy'&&joined){game.buy(id,m.item);send(ws,game.snapshot(id));}
    else if(m.type==='nightvision'&&joined)game.toggleNightvision(id);
    else if(m.type==='radio'&&joined)game.radio(id,m.menu,m.slot);
    else if(m.type==='clockReply'&&probe&&m.token===probe.token){game.lagComp.timing(id,performance.now()-probe.at);probe=null;}
    else if(m.type==='ping'&&Number.isFinite(m.sent))send(ws,{type:'pong',sent:m.sent,net:{...networkStats(),transport:ws.transport||'websocket',connection:{...ws.netCounters},datagrams:ws.transportCounters||null,lagCompensation:game.lagComp.diagnostics(),bufferedBytes:ws.bufferedAmount}});
   }catch(e){send(ws,{type:'error',message:e.message||'无效消息'});}
  });
  ws.on('close',()=>{clearTimeout(deadline);clearInterval(probeTimer);peers.delete(ws);game.remove(id);game.lagComp.remove(id);});ws.on('error',()=>{});
 }
 wss.on('connection',connect);
 function step(){game.step();game.lagComp.record({time:game.time,round:game.round,players:[...game.players.values()]});if(game.events.length)broadcastEvents(game.events.splice(0));tick++;}
 let previous=performance.now(),accumulator=0;
 const close=async()=>{if(stopping)return;stopping=true;clearInterval(timer);telemetry.dispose();for(const c of peers)c.terminate();wt?.close();await new Promise(resolve=>wss.close(()=>resolve()));await new Promise(resolve=>{server.close(()=>resolve());server.closeAllConnections();});};
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  if(webtransport){const {startWebTransport}=await import('./cs2-webtransport-server.mjs');wt=await startWebTransport({port:server.address().port,host,cert:tls.cert.toString(),key:tls.key.toString(),onPeer:connect});}
  if(autoTick)timer=setInterval(()=>{const now=performance.now(),gap=now-previous;let steps=0;accumulator+=Math.min(.1,gap/1000);previous=now;while(accumulator>=1/RULES.tick){step();accumulator-=1/RULES.tick;steps++;}if(steps&&Math.floor(tick/(RULES.tick/snapshotHz))!==Math.floor((tick-steps)/(RULES.tick/snapshotHz)))broadcastState();telemetry.record(gap,performance.now()-now,steps);},1000/RULES.tick);
 }catch(error){await close();throw error;}
 return{server,wss,game,world,peers,telemetry,address:()=>server.address(),step,broadcastState,close};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const secure=process.env.WEBTRANSPORT==='1';
 const tls=secure?{cert:await readFile(process.env.TLS_CERT||path.join(root,'.local/wt-cert.pem')),key:await readFile(process.env.TLS_KEY||path.join(root,'.local/wt-key.pem'))}:null;
 const instance=await createExperimentalServer({presentation:process.env.CS2_PRESENTATION||'native',port:Number(process.env.PORT||3001),host:process.env.HOST||'127.0.0.1',snapshotHz:Number(process.env.SNAPSHOT_HZ||30),tls,webtransport:secure,gameOptions:{weaponProfile:process.env.CS2_WEAPON_PROFILE||'cs2',hitRecovery:process.env.HIT_RECOVERY_PROFILE||'baseline'}});
 console.log(`CS2 独立验证版：${secure?'https':'http'}://localhost:${instance.address().port}/`);
 const shutdown=()=>instance.close().then(()=>process.exit(0));process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
