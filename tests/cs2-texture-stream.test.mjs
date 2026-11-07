import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';

// Use the actual Three texture classes; only the browser's vendor import is
// redirected. The renderer below observes submissions without a GL context.
const source=(await readFile(new URL('../public/cs2-texture-stream.js',import.meta.url),'utf8')).replace("'/vendor/three.module.js'",JSON.stringify(import.meta.resolve('three')));
const {createTextureStream}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const materials=(...names)=>names.map(name=>({TextureParams:{g_tColor:name}}));
function tier(name,full,faces=1){const mips=full?[{width:8,height:8,offset:0,bytes:32*faces},{width:4,height:4,offset:32*faces,bytes:8*faces}]:[{width:4,height:4,offset:0,bytes:8*faces}],bytes=mips.reduce((sum,m)=>sum+m.bytes,0);return{file:name+(full?'-full':'-preview'),sha256:name+(full?'-full':'-preview'),format:1,faces,mips,bytes,downloadBytes:bytes};}
async function fixture({names=['a'],faces=1,maxHighBytes=160*1048576,inflate:customInflate,initTexture}={}){
 let time=0;const calls=[],downloads=[],index={textures:{}},specs=new Map();
 for(const name of names){const full=tier(name,true,faces),preview=tier(name,false,faces);index.textures[name]={full,preview};specs.set(full.file,full);specs.set(preview.file,preview);}
 const renderer={capabilities:{getMaxAnisotropy:()=>4},initTexture(t){calls.push({texture:t,width:t.isCompressedCubeTexture?t.image[0].width:t.image.width});initTexture?.(t);}};
 const stream=await createTextureStream({renderer,index,base:'',progress:()=>{},maxHighBytes,now:()=>time,inflate:async file=>{downloads.push(file);const spec=specs.get(file);return customInflate?customInflate(spec):new Uint8Array(spec.bytes).fill(file.endsWith('-full')?44:11).buffer;}});
 return{stream,calls,downloads,index,renderer,setTime:n=>{time=n;}};
}
async function drain(stream,ready,{loading=false,start=0}={}){let done=false,failure;void ready.then(()=>{done=true;},error=>{done=true;failure=error;});for(let i=0;i<100&&!done;i++){await turn();stream.pump(loading?undefined:start+i);}assert.equal(done,true,'all variants must eventually settle');if(failure)throw failure;await ready;}

test('two updates with one RAF timestamp share one submission across entries and variants',async()=>{
 const {stream,calls}=await fixture({names:['a','b']});const a=stream.texture('a'),color=stream.texture('a',{color:true}),b=stream.texture('b');const ready=stream.wanted(materials('a','b'));let done=false;void ready.then(()=>{done=true;});await turn();
 assert.equal(stream.pump(100),true);assert.equal(stream.pump(100),false);assert.equal(calls.length,1);assert.equal(done,false);
 assert.equal(stream.pump(113.333),true);assert.equal(stream.pump(113.333),false);assert.equal(calls.length,2);assert.equal(done,false);
 assert.equal(stream.pump(126.666),true);await ready;assert.deepEqual(calls.map(c=>c.texture),[a,color,b]);assert.equal(stream.info().remaining,0);assert.equal(stream.info().uploadedHigh,2);assert.equal(stream.info().uploadBudget.frameSubmissions,1);
 assert.equal(stream.info().submittedTextureBytes,120);assert.equal(stream.info().estimatedTextureGPUBytes,120);stream.dispose();
});
test('loading pumps can drain every first-view variant without a measured frame token',async()=>{
 const {stream,calls}=await fixture();for(const options of [{},{color:true},{clamp:true},{channel:1}])stream.texture('a',options);const ready=stream.wanted(materials('a'));await turn();
 for(let i=0;i<4;i++)assert.equal(stream.pump(),true);await ready;assert.equal(calls.length,4);assert.equal(stream.info().remaining,0);assert.equal(stream.info().uploadBudget.frameTimeMs,null);stream.dispose();
});
test('a late variant queues its full tier and preserves authored texture identity and settings',async()=>{
 const {stream,calls,downloads}=await fixture();const a=stream.texture('a');await drain(stream,stream.wanted(materials('a')));const before=downloads.length;
 const t=stream.texture('a',{color:true,clamp:true,channel:1});assert.equal(t.image.width,4);assert.equal(stream.texture('a',{color:true,clamp:true,channel:1}),t);await drain(stream,stream.wanted(materials('a')),{start:100});
 assert.equal(t.image.width,8);assert.equal(a.image.width,8);assert.equal(calls.length,2);assert.equal(downloads.length,before);assert.equal(t.colorSpace,THREE.SRGBColorSpace);assert.equal(t.wrapS,THREE.ClampToEdgeWrapping);assert.equal(t.channel,1);assert.equal(t.format,THREE.RGBA_S3TC_DXT1_Format);assert.deepEqual(t.mipmaps.map(m=>[m.width,m.height,m.data.byteLength]),[[8,8,32],[4,4,8]]);stream.dispose();
});
test('a variant created synchronously after the last upload starts a fresh request before promise callbacks',async()=>{
 const {stream,calls}=await fixture();stream.texture('a');const first=stream.wanted(materials('a'));await turn();assert.equal(stream.pump(0),true);
 // Deliberately do not await first: its resolve reaction has not run yet.
 const late=stream.texture('a',{color:true}),ready=stream.wanted(materials('a'));assert.equal(late.image.width,4);assert.equal(stream.pump(0),false);await drain(stream,ready,{start:1});await first;assert.equal(late.image.width,8);assert.equal(calls.length,2);assert.equal(stream.info().remaining,0);stream.dispose();
});
test('a variant added reentrantly during submission is included before its shared request settles',async()=>{
 let active,late;const {stream,calls}=await fixture({initTexture:()=>{if(!late)late=active.texture('a',{color:true});}});active=stream;stream.texture('a');const ready=stream.wanted(materials('a'));let done=false;void ready.then(()=>{done=true;});await turn();stream.pump(0);await turn();assert.equal(done,false);assert.equal(late.image.width,4);assert.equal(stream.pump(0),false);stream.pump(1);await ready;assert.equal(late.image.width,8);assert.equal(calls.length,2);assert.equal(stream.info().remaining,0);stream.dispose();
});
test('preview demotions share the frame budget and full tier can be requested again',async()=>{
 const {stream,calls,setTime,downloads}=await fixture({maxHighBytes:1});const a=stream.texture('a'),color=stream.texture('a',{color:true});await drain(stream,stream.wanted(materials('a')));await stream.wanted([]);setTime(10001);const before=calls.length;
 stream.trim();assert.equal(calls.length,before,'trim only queues work');assert.equal(stream.pump(100),true);assert.equal(stream.pump(100),false);assert.equal(stream.info().evictions,0);assert.equal(stream.info().estimatedTextureGPUBytes,48);assert.equal(stream.pump(101),true);assert.equal(stream.info().evictions,1);assert.equal(stream.info().remaining,0);assert.equal(stream.info().estimatedTextureGPUBytes,16);assert.equal(a.image.width,4);assert.equal(color.image.width,4);
 await drain(stream,stream.wanted(materials('a')),{start:200});assert.equal(a.image.width,8);assert.equal(color.image.width,8);assert.equal(downloads.filter(f=>f==='a-full').length,2);stream.dispose();
});
test('a newly visible material cancels a partial demotion and restores only changed variants',async()=>{
 const {stream,calls,setTime,downloads}=await fixture({maxHighBytes:1});const a=stream.texture('a'),color=stream.texture('a',{color:true});await drain(stream,stream.wanted(materials('a')));await stream.wanted([]);setTime(10001);stream.trim();stream.pump(100);assert.equal(a.image.width,4);assert.equal(color.image.width,8);const before=calls.length;
 await drain(stream,stream.wanted(materials('a')),{start:200});assert.equal(calls.length,before+1);assert.equal(a.image.width,8);assert.equal(color.image.width,8);assert.equal(stream.info().evictions,0);assert.equal(downloads.filter(f=>f==='a-full').length,1);assert.equal(stream.info().remaining,0);stream.dispose();
});
test('a demotion canceled reentrantly during initTexture retains its high buffer for restoration',async()=>{
 let active,restore,demoting=false;const {stream,calls,setTime,downloads}=await fixture({maxHighBytes:1,initTexture:()=>{if(demoting){demoting=false;restore=active.wanted(materials('a'));}}});active=stream;const t=stream.texture('a');await drain(stream,stream.wanted(materials('a')));await stream.wanted([]);setTime(10001);stream.trim();demoting=true;stream.pump(100);assert.equal(t.image.width,4);await drain(stream,restore,{start:101});assert.equal(t.image.width,8);assert.equal(stream.info().evictions,0);assert.equal(stream.info().remaining,0);assert.equal(calls.length,3);assert.equal(downloads.filter(f=>f==='a-full').length,1);stream.dispose();
});
test('a dispose listener requesting a demoting texture waits for its high tier to be restored',async()=>{
 const {stream,calls,setTime,downloads}=await fixture({maxHighBytes:1});const t=stream.texture('a');await drain(stream,stream.wanted(materials('a')));await stream.wanted([]);setTime(10001);stream.trim();let ready,settled=false;
 const onDispose=()=>{t.removeEventListener('dispose',onDispose);ready=stream.wanted(materials('a'));void ready.then(()=>{settled=true;});};t.addEventListener('dispose',onDispose);stream.pump(100);await turn();assert.equal(settled,false,'preview allocation does not fulfill a request for full mips');assert.equal(t.image.width,4);await drain(stream,ready,{start:101});assert.equal(t.image.width,8);assert.equal(stream.info().evictions,0);assert.equal(stream.info().remaining,0);assert.equal(calls.length,3);assert.equal(downloads.filter(f=>f==='a-full').length,1);stream.dispose();
});
test('closing the stream from a texture dispose listener prevents the following initTexture call',async()=>{
 const {stream,calls,setTime}=await fixture({maxHighBytes:1});const t=stream.texture('a');await drain(stream,stream.wanted(materials('a')));await stream.wanted([]);setTime(10001);stream.trim();const before=calls.length;const close=()=>{t.removeEventListener('dispose',close);stream.dispose();};t.addEventListener('dispose',close);assert.equal(stream.pump(100),false);assert.equal(calls.length,before);assert.equal(stream.info().remaining,0);stream.dispose();
});
test('creating a variant during demotion cancels the low job without dropping its high buffer',async()=>{
 const {stream,setTime}=await fixture({maxHighBytes:1});stream.texture('a');await drain(stream,stream.wanted(materials('a')));await stream.wanted([]);setTime(10001);stream.trim();const t=stream.texture('a',{clamp:true});await drain(stream,stream.wanted(materials('a')),{start:100});assert.equal(t.image.width,8);assert.equal(stream.info().evictions,0);assert.equal(stream.info().remaining,0);stream.dispose();
});
test('visible, recently seen and still-promoting materials are not evicted',async()=>{
 const {stream,setTime}=await fixture({maxHighBytes:1});stream.texture('a');stream.texture('a',{color:true});const ready=stream.wanted(materials('a'));await turn();stream.pump(0);await stream.wanted([]);setTime(11000);stream.trim();assert.equal(stream.info().remaining,1,'no demotion queued over a pending promotion');await drain(stream,ready,{start:10});await stream.wanted(materials('a'));stream.trim();assert.equal(stream.info().remaining,0);await stream.wanted([]);setTime(21000);stream.trim();assert.equal(stream.info().remaining,0,'ten seconds alone is not strictly beyond the grace period');setTime(21001);stream.trim();assert.equal(stream.info().remaining,1);stream.dispose();
});
test('cube variant budget counts initTexture submissions and keeps all authored faces and mips',async()=>{
 const {stream,calls}=await fixture({faces:6});const t=stream.texture('a'),color=stream.texture('a',{color:true});const ready=stream.wanted(materials('a'));await turn();stream.pump(0);stream.pump(0);assert.equal(calls.length,1);assert.equal(t.image.length,6);for(const face of t.image)assert.deepEqual(face.mipmaps.map(m=>m.data.byteLength),[32,8]);assert.equal(color.image[0].width,4);stream.pump(1);await ready;assert.equal(stream.info().submittedTextureBytes,480);stream.dispose();
});
test('a full tier identical to preview needs no queued upload',async()=>{
 const renderer={capabilities:{getMaxAnisotropy:()=>1},initTexture:()=>assert.fail('unexpected full upload')},spec=tier('same',false),stream=await createTextureStream({renderer,index:{textures:{same:{full:spec,preview:spec}}},base:'',progress:()=>{},inflate:async()=>new ArrayBuffer(spec.bytes)});stream.texture('same');await stream.wanted(materials('same'));assert.equal(stream.pump(0),false);assert.equal(stream.info().remaining,0);stream.dispose();
});
test('requested entries without a material variant settle without consuming a frame submission',async()=>{
 const {stream,calls}=await fixture({names:['a','b']});stream.texture('b');const ready=stream.wanted(materials('a','b'));await turn();assert.equal(stream.pump(0),true);await ready;assert.equal(calls.length,1);assert.equal(calls[0].texture.name,'b');assert.equal(stream.info().remaining,0);assert.equal(stream.info().uploadBudget.frameSubmissions,1);stream.dispose();
});
test('failed downloads reject their request without blocking other materials or future retry',async()=>{
 let fail=true;const {stream,calls}=await fixture({names:['a','b'],inflate:spec=>{if(spec.file==='a-full'&&fail){fail=false;throw Error('download failed');}return new ArrayBuffer(spec.bytes);}});stream.texture('a');stream.texture('b');const ready=stream.wanted(materials('a','b'));const rejected=assert.rejects(ready,/download failed/);await turn();stream.pump(0);await rejected;assert.equal(calls.length,1);await drain(stream,stream.wanted(materials('a','b')),{start:10});assert.equal(stream.info().remaining,0);assert.equal(stream.info().uploadedHigh,2);stream.dispose();
});
test('an initTexture failure rejects the affected job and leaves subsequent jobs drainable',async()=>{
 let fail=true;const {stream,calls}=await fixture({names:['a','b'],initTexture:()=>{if(fail){fail=false;throw Error('submission failed');}}});stream.texture('a');stream.texture('b');const ready=stream.wanted(materials('a','b')),rejected=assert.rejects(ready,/submission failed/);await turn();assert.equal(stream.pump(0),false);assert.equal(stream.pump(0),false);stream.pump(1);await rejected;await drain(stream,stream.wanted(materials('a','b')),{start:10});assert.equal(stream.info().remaining,0);assert.equal(calls.length,3);stream.dispose();
});
test('a synchronous retry after a failed submission cannot reuse its rejected pending promise',async()=>{
 let fail=true;const {stream,calls}=await fixture({initTexture:()=>{if(fail){fail=false;throw Error('submission failed');}}});const firstTexture=stream.texture('a'),first=stream.wanted(materials('a')),rejected=assert.rejects(first,/submission failed/);await turn();assert.equal(stream.pump(0),false);
 const late=stream.texture('a',{color:true}),retry=stream.wanted(materials('a'));await drain(stream,retry,{start:1});await rejected;assert.equal(firstTexture.image.width,8);assert.equal(late.image.width,8);assert.equal(calls.length,3);assert.equal(stream.info().remaining,0);stream.dispose();
});
test('dispose settles queued and in-flight requests before either network promise settles',async()=>{
 const waiting=[];const {stream,calls,downloads}=await fixture({names:['a','b','c'],inflate:spec=>spec.file.endsWith('-full')?new Promise((resolve,reject)=>waiting.push({spec,resolve,reject})):new ArrayBuffer(spec.bytes)});for(const name of ['a','b','c'])stream.texture(name);let settled=false;const ready=stream.wanted(materials('a','b','c'));void ready.then(()=>{settled=true;});await turn();assert.equal(waiting.length,2);const downloadCount=downloads.length;
 stream.dispose();stream.dispose();await turn();assert.equal(settled,true,'dispose must not wait for fetch/inflate');await ready;assert.equal(stream.info().remaining,0);assert.equal(stream.info().textureBufferBytes,0);
 // Late success and rejection both remain handled without adding GPU work or
 // reviving the third request after the stream has been closed.
 waiting[0].resolve(new ArrayBuffer(waiting[0].spec.bytes));waiting[1].reject(Error('late network error'));await turn();assert.equal(stream.pump(1),false);await stream.wanted(materials('a'));stream.trim();assert.equal(calls.length,0);assert.equal(downloads.length,downloadCount);assert.equal(stream.info().remaining,0);assert.equal(stream.info().residentHigh,0);assert.equal(stream.info().textureBufferBytes,0);assert.deepEqual(stream.info().errors,[]);assert.throws(()=>stream.texture('a'),/disposed/);
});
test('runtime passes its RAF timestamp while loading retains independent pumping',async()=>{
 const renderer=await readFile(new URL('../public/cs2-optimized-renderer.js',import.meta.url),'utf8');assert.match(renderer,/update\(now\)\{[^\n]*stream\.pump\(now\)/);assert.match(renderer,/pumpBoot[^\n]*stream\.pump\(\)/);
});

test('loading pump rechecks boot, disposal and abort after its pending RAF resumes',async()=>{
 const renderer=await readFile(new URL('../public/cs2-optimized-renderer.js',import.meta.url),'utf8'),match=renderer.match(/const pumpBoot=(async\(\)=>\{[^\n]+\});void pumpBoot\(\);/);assert.ok(match,'extract the actual loading pump');
 for(const reason of ['boot','disposed','aborted']){
  let resume,calls=0;const gate=new Promise(resolve=>{resume=resolve;}),signal={aborted:false};const control=new Function('tick','stream','signal',`let boot=true,disposed=false;const pumpBoot=${match[1]};return{run:pumpBoot,stop(reason){if(reason==='boot')boot=false;else if(reason==='disposed')disposed=true;else signal.aborted=true;}};`)(()=>gate,{pump(){calls++;return true;}},signal);
  const run=control.run();control.stop(reason);resume();await run;assert.equal(calls,0,reason+' must block unmetered uploads after await');
 }
});
