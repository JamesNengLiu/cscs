// Resource-only browser integration. Requires an already-running loopback CS2
// static server; never opens the game page, joins a room or creates WebGL.
// Example: node tests/cs2-resource-browser.mjs --base-url=https://localhost:3001
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,X509Certificate} from 'node:crypto';
import path from 'node:path';
import {chromium} from 'playwright';

const option=(key,fallback)=>process.argv.find(v=>v.startsWith('--'+key+'='))?.slice(key.length+3)??fallback;
const base=new URL(option('base-url','https://localhost:3001'));
assert(['localhost','127.0.0.1','[::1]'].includes(base.hostname),'Use an existing loopback fixture/static server');
assert(['http:','https:'].includes(base.protocol));assert(!base.username&&!base.password);
const output=path.resolve(option('output','.local/cs2/resource-worker-browser/report.json'));
const modulePaths=['/cs2-resource-loader.js','/cs2-resource-worker.js','/cs2-resource-format.js'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const localHashes=async()=>Object.fromEntries(await Promise.all(modulePaths.map(async name=>[name,sha(await readFile('public'+name))])));
const beforeHashes=await localHashes(),report={status:'running',startedUTC:new Date().toISOString(),scope:'Headless browser functional resource-only integration. Real module Worker, original local map bytes and manifest SHA256 checks; no WebGL, gameplay, frame-rate or physical-display certification. Does not start/stop any server or use the user profile.',baseOrigin:base.origin,sourceHashes:beforeHashes,errors:[],workers:[],webSockets:[],requests:[]};
let browser,context,page;const moduleResponses=[];
try{
  const args=[];try{const certificate=new X509Certificate(await readFile('.local/cs2/certificate/wt-cert.pem'));args.push('--ignore-certificate-errors-spki-list='+createHash('sha256').update(certificate.publicKey.export({format:'der',type:'spki'})).digest('base64'));}catch{}
  browser=await chromium.launch({headless:true,executablePath:option('chrome-path','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),args});
  context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1000,height:700}});page=await context.newPage();
  page.setDefaultTimeout(120000);page.on('pageerror',error=>report.errors.push(error.stack||error.message));
  page.on('worker',worker=>report.workers.push({url:worker.url()}));page.on('websocket',socket=>report.webSockets.push(socket.url()));
  context.on('response',response=>{const name=new URL(response.url()).pathname;if(modulePaths.includes(name))moduleResponses.push(response.body().then(bytes=>({path:name,status:response.status(),sha256:sha(bytes)}),error=>({path:name,error:String(error)})));});
  context.on('request',request=>{const url=new URL(request.url());if(url.pathname.endsWith('.gz'))report.requests.push({path:url.pathname,type:request.resourceType()});});
  await context.addInitScript(()=>{
    const audit=window.__resourceAudit={mainGzipFetches:[],mainDecoderConstructions:0,webglContexts:0,workerConstructors:[]},nativeFetch=globalThis.fetch.bind(globalThis),NativeWorker=Worker,nativeContext=HTMLCanvasElement.prototype.getContext;
    globalThis.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);if(url.pathname.endsWith('.gz')){audit.mainGzipFetches.push(url.pathname);return Promise.reject(Error('Unexpected main-thread gzip fetch'));}return nativeFetch(input,options);};
    globalThis.DecompressionStream=class{constructor(){audit.mainDecoderConstructions++;throw Error('Unexpected main-thread gzip decoding');}};
    globalThis.Worker=class extends NativeWorker{constructor(url,options){super(url,options);audit.workerConstructors.push({url:String(url),options});}};
    HTMLCanvasElement.prototype.getContext=function(kind,...args){if(/webgl/i.test(String(kind))){audit.webglContexts++;throw Error('WebGL is outside this resource-only test');}return nativeContext.call(this,kind,...args);};
  });
  const testURL=new URL('/__tests/cs2-resource-loader',base.origin).href;
  await context.route(testURL,route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>CS2 resource worker integration</title><p>Resource-only worker verification</p>'}));
  await page.goto(testURL);
  const cdp=await browser.newBrowserCDPSession();try{report.browser=await cdp.send('Browser.getVersion');}finally{await cdp.detach();}
  report.result=await page.evaluate(async()=>{
    const {createCS2ResourceLoader}=await import('/cs2-resource-loader.js'),{validateResourceRequest}=await import('/cs2-resource-format.js');
    const fetchJSON=async url=>{const response=await fetch(url);if(!response.ok)throw Error('Missing original metadata '+url);return response.json();};
    const [map,textures]=await Promise.all([fetchJSON('/assets/cs2-optimized/map.json'),fetchJSON('/assets/cs2-optimized/textures.json')]);
    const canonical=file=>new URL('/assets/cs2-optimized/'+file,location.origin).pathname,entries=[];
    for(const [name,tiers]of Object.entries(textures.textures))for(const tier of ['preview','full'])entries.push({name,tier,...tiers[tier],url:canonical(tiers[tier].file)});
    const registry=new Map();for(const spec of [map.geometry,map.visibility,...entries]){
      const url=spec.url||canonical(spec.file);validateResourceRequest(url,spec.bytes);
      if(!/^[a-f0-9]{64}$/.test(spec.sha256))throw Error('Missing manifest digest for '+url);
      const prior=registry.get(url);if(prior&&(prior.bytes!==spec.bytes||prior.sha256!==spec.sha256))throw Error('Conflicting original resource declarations');registry.set(url,{bytes:spec.bytes,sha256:spec.sha256});
    }
    const preview=entries.filter(e=>e.tier==='preview'&&e.url.startsWith('/assets/cs2-optimized/')).sort((a,b)=>a.bytes-b.bytes)[0];
    const fullCandidates=entries.filter(e=>e.tier==='full'&&e.file!==textures.textures[e.name].preview.file).sort((a,b)=>a.bytes-b.bytes);
    const full=fullCandidates.find(e=>e.bytes>=512*1024)||fullCandidates.at(-1),shared=entries.filter(e=>e.name.includes('/lightmaps/')&&e.url.startsWith('/assets/cs2-textured/textures/')).sort((a,b)=>a.bytes-b.bytes)[0];
    if(!preview||!full||!shared)throw Error('Original preview/full/shared fixtures are required');
    const chosen=[{label:'geometry',...map.geometry,url:canonical(map.geometry.file)},{label:'visibility',...map.visibility,url:canonical(map.visibility.file)},{label:'small-preview',...preview},{label:'full-texture',...full},{label:'shared-lightmap',...shared}];
    const loader=createCS2ResourceLoader({timeoutMs:120000}),started=performance.now();let disposed;
    try{
      const results=await Promise.all(chosen.map(async spec=>{const at=performance.now(),bytes=await loader.load(spec.url,spec.bytes);if(!(bytes instanceof ArrayBuffer)||bytes.byteLength!==spec.bytes)throw Error('Transferred output length mismatch');const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(digest!==spec.sha256)throw Error('Original manifest SHA256 mismatch: '+spec.label);return{label:spec.label,url:spec.url,bytes:bytes.byteLength,downloadBytes:spec.downloadBytes,sha256:digest,wallMs:performance.now()-at};}));
      const diagnostics=loader.diagnostics();if(diagnostics.mainThreadInflateJobs!==0||diagnostics.mode!=='worker-only'||diagnostics.completed!==chosen.length||diagnostics.active!==0||diagnostics.queued!==0)throw Error('Worker lane completion gate failed');
      return{results,elapsedWallMs:performance.now()-started,diagnostics,manifestPathsValidated:2+entries.length,uniqueManifestPaths:registry.size,sharedManifestPaths:[...registry.keys()].filter(p=>p.startsWith('/assets/cs2-textured/textures/')).length,geometryAbove256MiB:map.geometry.bytes>256*1024*1024,audit:window.__resourceAudit};
    }finally{loader.dispose();disposed=loader.diagnostics();window.__resourceAudit.disposed=disposed.disposed;}
  });
  report.audit=await page.evaluate(()=>window.__resourceAudit);report.moduleResponses=await Promise.all(moduleResponses);
  assert.equal(report.result.results.length,5);assert.equal(report.result.geometryAbove256MiB,true);assert.equal(report.result.diagnostics.transferredBytes,report.result.results.reduce((sum,r)=>sum+r.bytes,0));
  assert.equal(report.audit.mainGzipFetches.length,0);assert.equal(report.audit.mainDecoderConstructions,0);assert.equal(report.audit.webglContexts,0);assert.equal(report.audit.workerConstructors.length,1);assert.equal(report.audit.workerConstructors[0].options.name,'cs2-map-resources');assert.equal(report.audit.disposed,true);
  assert.equal(report.workers.length,1);assert.equal(report.webSockets.length,0);assert.deepEqual(report.errors,[]);
  for(const name of modulePaths){const observed=report.moduleResponses.filter(r=>r.path===name);assert(observed.length,'Actual module response missing: '+name);assert(observed.every(r=>r.status===200&&r.sha256===beforeHashes[name]),'Actual module source mismatch: '+name);}
  assert.deepEqual(await localHashes(),beforeHashes);report.status='completed';
}catch(error){report.status='failed';report.failure=error.stack||String(error);process.exitCode=1;try{report.audit=await page?.evaluate(()=>window.__resourceAudit);}catch{}}
finally{await context?.close().catch(error=>report.errors.push(String(error)));await browser?.close().catch(error=>report.errors.push(String(error)));report.closed=true;report.finishedUTC=new Date().toISOString();report.sourceHashesAfter=await localHashes();await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,output,closed:report.closed,failure:report.failure,resources:report.result?.results.map(r=>({label:r.label,bytes:r.bytes,sha256:r.sha256})),scope:report.scope}));}
