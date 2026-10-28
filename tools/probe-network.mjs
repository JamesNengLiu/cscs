// Actual TCP/WebSocket measurements against an isolated authoritative server.
import {fork} from 'node:child_process';
import {once} from 'node:events';
import WebSocket from 'ws';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const option=(name,fallback)=>process.argv.find(x=>x.startsWith(name+'='))?.slice(name.length+1)??fallback;
const output=option('--output','artifacts/network-probe.json');
const server=fork('tests/network-fixture-server.mjs',[],{env:{...process.env,HOST:'127.0.0.1',PORT:'0'},silent:true});
const peers=[],rtt=[],intervals=[],loop=[],states=[];let base,stdout='',lastAt=null,bytes=0,pinger,inputTimer;
const report={scope:'10 real local WebSocket clients; isolated server; injected server stalls; no browser, remote Wi-Fi or physical multi-device measurement'};
try{
  base=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Startup timeout')),10000);server.stdout.on('data',b=>{stdout+=b;const m=stdout.match(/http:\/\/localhost:(\d+)/);if(m){clearTimeout(t);resolve('http://127.0.0.1:'+m[1]);}});server.stderr.on('data',b=>process.stderr.write(b));});
  let measuring=false;
  for(let i=0;i<10;i++){
    const ws=new WebSocket(base.replace('http','ws'));peers.push(ws);
    await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Join timeout')),5000);ws.on('error',reject);ws.on('message',b=>{
      const m=JSON.parse(String(b)),now=performance.now();
      if(m.type==='hello')ws.send(JSON.stringify({type:'join',name:'Network '+i,team:i<5?'T':'CT'}));
      if(m.type==='joined'){clearTimeout(t);resolve();}
      if(i===0&&measuring){if(m.type==='pong')rtt.push(now-m.sent);if(m.type==='state'){bytes+=b.length;if(lastAt!==null)intervals.push(now-lastAt);lastAt=now;states.push({seq:m.net?.seq,at:now});if(Number.isFinite(m.net?.serverLoopMaxMs))loop.push(m.net.serverLoopMaxMs);}}
    });});
  }
  const ready=once(server,'message');server.send({type:'start-load'});assert.equal((await ready)[0].type,'load-ready');
  await delay(500);measuring=true;
  pinger=setInterval(()=>peers[0].send(JSON.stringify({type:'ping',sent:performance.now()})),200);
  inputTimer=setInterval(()=>peers.forEach(ws=>ws.send(JSON.stringify({type:'input',input:{f:0,s:0,fire:false,yaw:0,pitch:0}}))),100);
  const started=performance.now();
  for(let i=0;i<4;i++){await delay(1100);const done=once(server,'message');server.send({type:'stall',ms:120});assert.equal((await done)[0].type,'stall-done');}
  await delay(1000);const elapsed=performance.now()-started;measuring=false;
  const stats=a=>{const x=[...a].sort((a,b)=>a-b);return {samples:x.length,median:x[Math.floor((x.length-1)*.5)]??null,p95:x[Math.floor((x.length-1)*.95)]??null,max:x.at(-1)??null};};
  Object.assign(report,{status:'passed',connectedClients:peers.length,injectedStalls:{count:4,durationMs:120},elapsedMs:elapsed,receivedStates:states.length,snapshotHz:states.length*1000/elapsed,stateIntervalMs:stats(intervals),applicationRttMs:stats(rtt),burstPairsUnder5ms:intervals.filter(x=>x<5).length,stateBytesPerSecond:bytes*1000/elapsed,reportedServerLoopMaxMs:loop.length?Math.max(...loop):null});
  assert.equal((await(await fetch(base+'/health')).json()).players,10);assert.ok(rtt.length>=20);assert.ok(states.length>=50);
}finally{
  clearInterval(pinger);clearInterval(inputTimer);for(const ws of peers)ws.terminate();
  const closed=once(server,'exit');server.kill('SIGTERM');await closed;
  try{await fetch(base+'/health',{signal:AbortSignal.timeout(500)});report.serverClosed=false;}catch{report.serverClosed=true;}
  assert.equal(report.serverClosed,true);await mkdir('artifacts',{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
