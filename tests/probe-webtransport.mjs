import {fork} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('artifacts',{recursive:true});
const server=fork('tools/start-secure.mjs',[],{env:{...process.env,HOST:'127.0.0.1',PORT:'0'},silent:true});let browser,base,logs='';
try{
 base=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Server start timeout '+logs)),15000);server.stdout.on('data',b=>{logs+=b;const m=logs.match(/https:\/\/localhost:(\d+)/);if(m){clearTimeout(t);resolve('https://127.0.0.1:'+m[1]);}});server.stderr.on('data',b=>{logs+=b;});server.on('exit',code=>reject(Error('Server exited '+code+' '+logs)));});
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({ignoreHTTPSErrors:true});const page=await context.newPage();page.on('console',m=>console.log('BROWSER',m.type(),m.text()));page.on('pageerror',e=>console.error('PAGEERROR',e));
 await page.goto(base,{waitUntil:'domcontentloaded'});
 const result=await page.evaluate(async()=>{const cfg=await(await fetch('/transport-config')).json();const w=new WebTransport(new URL(cfg.path,location.origin),{requireUnreliable:true,serverCertificateHashes:[{algorithm:'sha-256',value:new Uint8Array(cfg.certificateHash)}]});w.closed.catch(e=>console.error('NATIVE_WT_CLOSED',String(e)));await Promise.race([w.ready,new Promise((_,r)=>setTimeout(()=>r(Error('WT_READY_TIMEOUT')),8000))]);const stream=await w.createBidirectionalStream();const reader=stream.readable.getReader(),writer=stream.writable.getWriter();const read=await reader.read();await writer.write(new TextEncoder().encode(JSON.stringify({type:'join',name:'NativeQuicProbe',team:'T'})+'\n'));const datagrams=w.datagrams.readable.getReader();const packet=await Promise.race([datagrams.read(),new Promise((_,r)=>setTimeout(()=>r(Error('DATAGRAM_TIMEOUT')),5000))]);const value={secure:isSecureContext,hello:new TextDecoder().decode(read.value),datagramBytes:packet.value?.length,maxDatagramSize:w.datagrams.maxDatagramSize};w.close();return value;});
 assert.equal(result.secure,true);assert.match(result.hello,/webtransport/);assert.ok(result.datagramBytes>16);console.log(JSON.stringify({status:'passed',base,...result}));await writeFile('artifacts/native-quic-handshake.json',JSON.stringify({status:'passed',base,...result},null,2));
}finally{await browser?.close();if(server.exitCode===null){const exit=once(server,'exit');server.kill('SIGTERM');await exit;}await writeFile('artifacts/native-quic-server.log',logs);}
