// Browser-worker API adapter for real worker_threads tests, no listening server.
import {parentPort,workerData} from 'node:worker_threads';import {readFile} from 'node:fs/promises';
const pending=[];let ready=false,corrupted=false;
globalThis.fetch=async url=>{try{if(typeof url!=='string'||!url.startsWith('/assets/players/')||url.includes('..'))throw Error('Unsafe fixture URL');const bytes=await readFile(new URL('../../public'+url,import.meta.url));if(workerData?.corruptURL===url&&!corrupted){corrupted=true;return new Response(Buffer.concat([bytes,Buffer.from(' ')]));}return new Response(bytes);}catch{return new Response('Missing local fixture asset',{status:404});}};
globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);
parentPort.on('message',data=>{if(ready)globalThis.onmessage({data});else pending.push(data);});
await import('../../public/player-asset-worker.js');ready=true;for(const data of pending)globalThis.onmessage({data});
