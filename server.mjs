import http from 'node:http';
import https from 'node:https';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,X509Certificate} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {Game} from './game.mjs';
import {RULES,MAP_VERSION,MAP_DATA} from './public/shared.js';
import {GUNS} from './public/arsenal.js';
import {ECONOMY} from './public/economy.js';
import {CHARACTER_PRESETS} from './public/characters-config.js';
import {createServerTelemetry} from './server-telemetry.mjs';
import {createLagCompensation} from './lag-compensation.mjs';
import {MAX_INPUT_BATCH} from './public/input-protocol.js';
const root=path.dirname(fileURLToPath(import.meta.url)),secure=process.env.WEBTRANSPORT==='1',port=Number(process.env.PORT||(secure?3443:3000)),host=process.env.HOST||'0.0.0.0';
const snapshotHz=Number(process.env.SNAPSHOT_HZ||30);if(![15,30,60].includes(snapshotHz))throw Error('SNAPSHOT_HZ must be 15, 30 or 60');
const tls=secure?{cert:await readFile(process.env.TLS_CERT||path.join(root,'.local/wt-cert.pem')),key:await readFile(process.env.TLS_KEY||path.join(root,'.local/wt-key.pem'))}:null;
const certificateHash=tls?Array.from(new X509Certificate(tls.cert).raw):null;
const certDigest=certificateHash?Array.from((await import('node:crypto')).createHash('sha256').update(Buffer.from(certificateHash)).digest()):null;
export const game=new Game();
game.lagComp=createLagCompensation();
const telemetry=createServerTelemetry({tickHz:RULES.tick,snapshotHz});
const peers=new Set();let wt=null,eventSequence=0;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png'};
async function handler(req,res){
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/transport-config'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({webtransport:secure,path:'/wt',certificateHash:certDigest,protocol:'lan-strike-wt-v1',snapshotHz}));return;}
    if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,version:'0.5.0',characterPresets:CHARACTER_PRESETS.length,playerModels:'mdl10-custom-face-v1',startMoney:ECONOMY.startMoney,gunCount:Object.keys(GUNS).length,arsenal:'cs16-catalog-v1',movementSync:'command-queue-v2',mapVersion:MAP_VERSION,sourceSHA256:MAP_DATA.sourceSHA256,players:game.players.size,phase:game.phase,network:{...telemetry.snapshot(),transport:secure?'webtransport+websocket':'websocket',webtransportReady:!!wt,sessions:[...peers].reduce((a,p)=>(a[p.transport||'websocket']=(a[p.transport||'websocket']||0)+1,a),{})}}));return;}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    const vendor={'/vendor/three.module.js':'three.module.js','/vendor/three.core.js':'three.core.js'};
    const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    const file=vendor[relative]?path.join(root,'node_modules/three/build',vendor[relative]):path.resolve(root,'public','.'+relative);
    if(!vendor[relative]&&!file.startsWith(path.join(root,'public')+path.sep)){res.writeHead(403);res.end();return;}
    const bytes=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404);res.end('Not found');}
}
const server=secure?https.createServer(tls,handler):http.createServer(handler);
const wss=new WebSocketServer({server,maxPayload:8192});
const send=(ws,obj)=>{
  if(ws.readyState!==WebSocket.OPEN)return;
  const counters=ws.netCounters;counters.maxBufferedBytes=Math.max(counters.maxBufferedBytes,ws.bufferedAmount);
  if(obj.type==='state')counters.stateSequence++;
  if(ws.bufferedAmount>=128000){counters.skippedMessages++;if(obj.type==='state')counters.skippedStates++;else ws.close();return;}
  if(obj.type==='state')obj={...obj,net:{seq:counters.stateSequence,emittedAtMs:performance.now(),serverLoopMaxMs:telemetry.snapshot().serverLoopMaxMs,skippedStates:counters.skippedStates,transport:ws.transport||'websocket',snapshotHz}};
  const payload=JSON.stringify(obj);counters.sentBytes+=Buffer.byteLength(payload);counters.sentMessages++;ws.send(payload);
};
function broadcastState(){for(const c of peers)if(c.playerId)send(c,game.snapshot(c.playerId));}
function broadcastEvents(events){const tagged=events.map(e=>({...e,eventId:++eventSequence,round:game.round}));for(const c of peers){const visible=tagged.filter(e=>!['money','purchase','flash','damage'].includes(e.type)||e.id===c.playerId);if(visible.length)send(c,{type:'events',events:visible});}}
function connect(ws,req){
  const requestHost=req.headers.host,origin=req.headers.origin;
  if(origin&&origin!==`http://${requestHost}`&&origin!==`https://${requestHost}`){ws.close(1008,'Origin rejected');return;}
  peers.add(ws);ws.netCounters={sentMessages:0,sentBytes:0,skippedMessages:0,skippedStates:0,maxBufferedBytes:0,stateSequence:0};
  const id=randomUUID();let joined=false,windowAt=Date.now(),messages=0,lastAction=0,probe=null;
  send(ws,{type:'hello',id,transport:ws.transport||'websocket',protocol:'lan-strike-wt-v1'});
  const deadline=setTimeout(()=>{if(!joined)ws.close(1008,'Join timeout');},30000);deadline.unref();
  const probeTimer=setInterval(()=>{if(ws.readyState!==1)return;probe={token:randomUUID(),at:performance.now()};send(ws,{type:'clockProbe',token:probe.token});},1000);probeTimer.unref();
  ws.on('message',buffer=>{
    if(Date.now()-windowAt>1000){windowAt=Date.now();messages=0;}if(++messages>180||buffer.length>8192){ws.close(1008,'Rate limit');return;}
    try{const m=JSON.parse(buffer.toString());
      if(m.actionSeq!==undefined){if(!Number.isSafeInteger(m.actionSeq)||m.actionSeq<=lastAction)return;lastAction=m.actionSeq;}
      if(m.type==='join'&&!joined){game.add(id,m.name,m.team,m.character);joined=true;ws.playerId=id;clearTimeout(deadline);send(ws,{type:'joined',id});send(ws,game.snapshot(id));}
      else if((m.type==='inputBatch'||m.type==='inputCritical')&&joined){if(!Array.isArray(m.commands)||m.commands.length>MAX_INPUT_BATCH)throw Error('Invalid input batch');game.inputBatch(id,m.commands);game.lagComp.view(id,m.commands,{viewTime:m.viewTime,interpDelayMs:m.interpDelayMs,now:game.time,round:game.round});}
      else if(m.type==='input'&&joined)game.input(id,m.input);
      else if(m.type==='reload'&&joined)game.reload(id);
      else if(m.type==='equip'&&joined)game.equip(id,m.weapon);
      else if(m.type==='buy'&&joined){game.buy(id,m.item);send(ws,game.snapshot(id));}
      else if(m.type==='drop'&&joined)game.drop(id);
      else if(m.type==='secondary'&&joined)game.secondary(id);
      else if(m.type==='nightvision'&&joined)game.toggleNightvision(id);
      else if(m.type==='clockReply'&&probe&&m.token===probe.token){game.lagComp.timing(id,performance.now()-probe.at);probe=null;}
      else if(m.type==='ping'&&Number.isFinite(m.sent))send(ws,{type:'pong',sent:m.sent,net:{...telemetry.snapshot(),transport:ws.transport||'websocket',connection:{...ws.netCounters},datagrams:ws.transportCounters||null,lagCompensation:game.lagComp.diagnostics(),bufferedBytes:ws.bufferedAmount}});
    }catch(e){send(ws,{type:'error',message:e.message||'无效消息'});}
  });
  ws.on('close',()=>{clearTimeout(deadline);clearInterval(probeTimer);peers.delete(ws);game.remove(id);game.lagComp.remove(id);});ws.on('error',()=>{});
}
wss.on('connection',connect);
let tick=0,previous=performance.now(),accumulator=0;
const timer=setInterval(()=>{const now=performance.now(),gap=now-previous;let steps=0;accumulator+=Math.min(.1,gap/1000);previous=now;
  while(accumulator>=1/RULES.tick){game.step();game.lagComp.record({time:game.time,round:game.round,players:[...game.players.values()]});accumulator-=1/RULES.tick;steps++;if(game.events.length)broadcastEvents(game.events.splice(0));tick++;}
  // After catch-up send only the freshest state, never burst stale snapshots.
  if(steps&&Math.floor(tick/(RULES.tick/snapshotHz))!==Math.floor((tick-steps)/(RULES.tick/snapshotHz)))broadcastState();
  telemetry.record(gap,performance.now()-now,steps);
},1000/RULES.tick);
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
if(secure){const {startWebTransport}=await import('./webtransport-server.mjs');wt=await startWebTransport({port:server.address().port,host,cert:tls.cert.toString(),key:tls.key.toString(),onPeer:connect});}
const actualPort=server.address().port,scheme=secure?'https':'http';
console.log(`LAN Strike WebTransport development: ${scheme}://localhost:${actualPort}`);
if(host==='0.0.0.0')for(const addresses of Object.values(os.networkInterfaces()))for(const a of addresses||[])if(a.family==='IPv4'&&!a.internal)console.log(`局域网候选地址: ${scheme}://${a.address}:${actualPort}`);
console.log(secure?'Native HTTP/3 WebTransport datagrams + WSS fallback; local test certificate.':'WebSocket fallback/test mode.');
console.log('仅供可信局域网试玩；不开放公网、不自动修改防火墙。');
let stopping=false;
function shutdown(){if(stopping)return;stopping=true;clearInterval(timer);telemetry.dispose();for(const c of peers)c.terminate();wt?.close();wss.close();server.close(()=>process.exit(0));server.closeAllConnections();setTimeout(()=>process.exit(0),1500).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
