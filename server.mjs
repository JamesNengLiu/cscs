import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {Game} from './game.mjs';
import {RULES,MAP_VERSION,MAP_DATA} from './public/shared.js';
import {GUNS} from './public/arsenal.js';
import {ECONOMY} from './public/economy.js';
const root=path.dirname(fileURLToPath(import.meta.url)),port=Number(process.env.PORT||3000),host=process.env.HOST||'0.0.0.0';
export const game=new Game();
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png'};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,version:'0.4.0',startMoney:ECONOMY.startMoney,gunCount:Object.keys(GUNS).length,arsenal:'cs16-catalog-v1',movementSync:'ack-replay-v1',mapVersion:MAP_VERSION,sourceSHA256:MAP_DATA.sourceSHA256,players:game.players.size,phase:game.phase}));return;}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    const vendor={'/vendor/three.module.js':'three.module.js','/vendor/three.core.js':'three.core.js'};
    const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    const file=vendor[relative]?path.join(root,'node_modules/three/build',vendor[relative]):path.resolve(root,'public','.'+relative);
    if(!vendor[relative]&&!file.startsWith(path.join(root,'public')+path.sep)){res.writeHead(403);res.end();return;}
    const bytes=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream',
      'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404);res.end('Not found');}
});
const wss=new WebSocketServer({server,maxPayload:2048});
const send=(ws,obj)=>{if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<128000)ws.send(JSON.stringify(obj));};
function broadcast(obj){for(const c of wss.clients)send(c,obj);}
function broadcastState(){for(const c of wss.clients)if(c.playerId)send(c,game.snapshot(c.playerId));}
function broadcastEvents(events){for(const c of wss.clients){const visible=events.filter(e=>!['money','purchase','flash','damage'].includes(e.type)||e.id===c.playerId);if(visible.length)send(c,{type:'events',events:visible});}}
wss.on('connection',(ws,req)=>{
  const host=req.headers.host,origin=req.headers.origin;
  if(origin&&origin!==`http://${host}`&&origin!==`https://${host}`){ws.close(1008,'Origin rejected');return;}
  const id=randomUUID();let joined=false,windowAt=Date.now(),messages=0;
  send(ws,{type:'hello',id});
  const deadline=setTimeout(()=>{if(!joined)ws.close(1008,'Join timeout');},30000);
  ws.on('message',buffer=>{
    if(Date.now()-windowAt>1000){windowAt=Date.now();messages=0;}if(++messages>120){ws.close(1008,'Rate limit');return;}
    try{const m=JSON.parse(buffer.toString());
      if(m.type==='join'&&!joined){game.add(id,m.name,m.team);joined=true;ws.playerId=id;clearTimeout(deadline);send(ws,{type:'joined',id});send(ws,game.snapshot(id));}
      else if(m.type==='input'&&joined)game.input(id,m.input);
      else if(m.type==='reload'&&joined)game.reload(id);
      else if(m.type==='equip'&&joined)game.equip(id,m.weapon);
      else if(m.type==='buy'&&joined){game.buy(id,m.item);send(ws,game.snapshot(id));}
      else if(m.type==='drop'&&joined)game.drop(id);
      else if(m.type==='secondary'&&joined)game.secondary(id);
      else if(m.type==='nightvision'&&joined)game.toggleNightvision(id);
      else if(m.type==='ping')send(ws,{type:'pong',sent:m.sent});
    }catch(e){send(ws,{type:'error',message:e.message||'无效消息'});}
  });
  ws.on('close',()=>{clearTimeout(deadline);game.remove(id);});ws.on('error',()=>{});
});
let tick=0,previous=performance.now(),accumulator=0;
const timer=setInterval(()=>{const now=performance.now();accumulator+=Math.min(.15,(now-previous)/1000);previous=now;
  while(accumulator>=1/RULES.tick){game.step();accumulator-=1/RULES.tick;
    if(game.events.length)broadcastEvents(game.events.splice(0));if(++tick%4===0)broadcastState();}
},1000/RULES.tick);
server.listen(port,host,()=>{
  const actualPort=server.address().port;
  console.log(`LAN Strike v0.4: http://localhost:${actualPort}`);
  if(host==='0.0.0.0')for(const addresses of Object.values(os.networkInterfaces()))for(const a of addresses||[])if(a.family==='IPv4'&&!a.internal)console.log(`局域网候选地址: http://${a.address}:${actualPort}`);
  console.log('仅供可信局域网试玩；不要配置公网端口转发。Ctrl+C 停止。');
});
let stopping=false;
function shutdown(){if(stopping)return;stopping=true;clearInterval(timer);for(const c of wss.clients)c.terminate();wss.close();server.close(()=>process.exit(0));server.closeAllConnections();setTimeout(()=>process.exit(0),1000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
