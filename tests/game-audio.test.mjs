// Mock graph/lifecycle tests. Real PCM rendering is tests/spatial-audio-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameAudio,AUDIO_LIMITS,AUDIO_SPATIAL} from '../public/game-audio.js';
import {gunSound,safeSound} from '../public/sound-catalog.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(options={}){
  const requests=[],contexts=[];let clock=0,fetchHook=null,decodeHook=null;
  class Node{
    constructor(kind){this.kind=kind;this.connections=[];this.stops=0;this.disconnected=false;}
    connect(n){this.connections.push(n);}disconnect(){this.disconnected=true;}
    stop(){this.stops++;this.onended?.();}start(when){this.started=true;this.startAt=when;}
  }
  class Context{
    constructor(){this.state='running';this.currentTime=0;this.destination={};this.panners=[];this.sources=[];this.gains=[];
      this.listener=Object.fromEntries(['positionX','positionY','positionZ','forwardX','forwardY','forwardZ','upX','upY','upZ'].map(k=>[k,{value:0}]));contexts.push(this);}
    createGain(){const n=Object.assign(new Node('gain'),{gain:{value:0}});this.gains.push(n);return n;}
    createBufferSource(){const n=new Node('source');n.playbackRate={value:1};this.sources.push(n);return n;}
    createPanner(){const n=Object.assign(new Node('panner'),{positionX:{value:0},positionY:{value:0},positionZ:{value:0}});this.panners.push(n);return n;}
    async decodeAudioData(b){return decodeHook?decodeHook(b):{length:1024,numberOfChannels:1};}
    async resume(){this.state='running';}close(){this.state='closed';return Promise.resolve();}
  }
  const audio=createGameAudio({Context,now:()=>clock,fetcher:async (url,init)=>{requests.push(url);return fetchHook?fetchHook(url,init):{ok:true,arrayBuffer:async()=>new ArrayBuffer(44)};},...options});
  return {audio,requests,contexts,setClock:v=>{clock=v;},setFetch:f=>{fetchHook=f;},setDecode:f=>{decodeHook=f;}};
}

test('original WAV selection, suppressor variants, and traversal rejection',()=>{
  assert.notEqual(gunSound('ak47'),gunSound('m4a1'));assert.notEqual(gunSound('awp'),gunSound('scout'));
  assert.notEqual(gunSound('m4a1'),gunSound('m4a1',true));assert.notEqual(gunSound('usp'),gunSound('usp',true));
  for(const n of ['../secret.wav','https://evil.test/x.wav','weapons/../../x.wav','/weapons/x.wav'])assert.equal(safeSound(n),false);
});
test('gesture gate, cached buffers and bounded event dedup with TTL and shot compatibility',async()=>{
  const f=fixture(),{audio}=f;assert.equal(await audio.play('weapons/awp1.wav'),false);assert.equal(f.requests.length,0);
  assert.equal(await audio.resume(),true);await audio.preload(['weapons/awp1.wav']);const before=f.requests.length;
  assert.equal(await audio.shot({weapon:'awp',shotId:'one'}),true);
  assert.equal(await audio.shot({weapon:'awp',shotId:'one'}),false);assert.equal(f.requests.length,before);
  await audio.resume();assert.equal(f.requests.length,before,'resuming must not thrash a catalog larger than the LRU');
  for(let i=0;i<600;i++)await audio.play('weapons/awp1.wav',{eventId:'event-'+i});
  assert.equal(audio.diagnostics().events,AUDIO_LIMITS.events);
  f.setClock(AUDIO_LIMITS.eventAgeMs+1);assert.equal(await audio.play('weapons/awp1.wav',{eventId:'event-599'}),true);
  assert.equal(audio.diagnostics().events,1);audio.dispose();
});
test('world metres, nominal engineering clip, listener rotation; local audio bypasses panners',async()=>{
  const {audio,contexts}=fixture();audio.listen({x:1,y:2,z:3},{x:2,y:0,z:0});await audio.resume();
  assert.equal(contexts[0].listener.forwardX.value,1);assert.equal(contexts[0].listener.positionX.value,1);
  await audio.shot({weapon:'ak47'},{x:5,y:2,z:3});const p=contexts[0].panners[0];
  assert.equal(p.panningModel,'HRTF');assert.equal(p.positionX.value,5);assert.equal(p.distanceModel,'linear');
  assert.equal(p.refDistance,0);assert.equal(p.maxDistance,1000/40/.8);assert.equal(AUDIO_SPATIAL.sourceUnitsPerMetre,40);
  assert.equal(await audio.play('weapons/awp1.wav',{position:{x:100,y:2,z:3}}),false);
  assert.equal(await audio.play('weapons/awp1.wav',{position:{x:100,y:2,z:3},attenuation:0}),true);
  assert.equal(contexts[0].panners[1].rolloffFactor,0);
  const n=contexts[0].panners.length;await audio.shot({weapon:'ak47'});assert.equal(contexts[0].panners.length,n);
  for(const args of [{position:{x:NaN,y:0,z:0}},{position:{x:Infinity,y:0,z:0}},{volume:NaN},{attenuation:Infinity},{priority:NaN}])
    assert.equal(await audio.play('weapons/awp1.wav',args),false);
  assert.equal(audio.listen({x:0,y:NaN,z:0},{x:0,y:0,z:-1}),false);
  assert.equal(audio.listen({x:0,y:0,z:0},{x:0,y:1,z:0}),false);audio.dispose();
});
test('live settings route independent category gains and switch existing world panners',async()=>{
  const {audio,contexts}=fixture();await audio.resume();await audio.play('weapons/awp1.wav',{position:{x:1,y:0,z:-1},category:'voice'});
  const ctx=contexts[0];assert.equal(ctx.panners[0].connections[0],ctx.gains[2]);
  await audio.play('weapons/awp1.wav');assert.equal(ctx.sources[1].connections[0].connections[0],ctx.gains[1]);
  const value=audio.setSettings({master:.6,effects:.2,voice:.9,spatialMode:'equalpower'});
  assert.equal(ctx.gains[0].gain.value,.6);assert.equal(ctx.gains[1].gain.value,.2);assert.equal(ctx.gains[2].gain.value,.9);
  assert.equal(ctx.panners[0].panningModel,'equalpower');value.master=0;assert.equal(audio.getSettings().master,.6);
  audio.setSettings({enabled:false});assert.equal(ctx.gains[0].gain.value,0);assert.equal(audio.diagnostics().voices,0);
  assert.equal(await audio.play('weapons/awp1.wav'),false);audio.setSettings({enabled:true});assert.equal(ctx.gains[0].gain.value,.6);audio.dispose();
});
test('entity/channel replacement, auto overlap, loops, natural ends and explicit stops',async()=>{
  const {audio,contexts}=fixture();await audio.resume();
  const options={entityId:'p1',channel:'weapon',loop:true};await audio.play('weapons/awp1.wav',options);
  const first=contexts[0].sources[0];assert.equal(first.loop,true);
  await audio.play('weapons/awp1.wav',options);assert.equal(first.stops,1);assert.equal(first.disconnected,true);
  assert.equal(audio.diagnostics().voices,1);await audio.play('weapons/awp1.wav',{...options,entityId:'p2'});
  await audio.play('weapons/awp1.wav',{entityId:'p1'});await audio.play('weapons/awp1.wav',{entityId:'p1'});
  assert.equal(audio.diagnostics().voices,4);assert.equal(audio.stopChannel('p1','weapon'),true);assert.equal(audio.stopChannel('p1','weapon'),false);
  contexts[0].sources[2].onended();assert.equal(audio.diagnostics().channels,0);assert.equal(audio.diagnostics().voices,2);
  audio.stopAll();assert.equal(audio.diagnostics().voices,0);assert.equal(audio.diagnostics().channels,0);audio.dispose();
});
test('priority-aware bounded voices clean every graph; dispose is terminal and idempotent',async()=>{
  const {audio,contexts}=fixture();await audio.resume();
  for(let i=0;i<100;i++)assert.equal(await audio.play('weapons/awp1.wav',{priority:10}),true);
  assert.equal(audio.diagnostics().voices,48);assert.equal(contexts[0].sources[0].disconnected,true);
  assert.equal(await audio.play('weapons/awp1.wav',{priority:0}),false);
  audio.dispose();audio.dispose();assert.equal(audio.diagnostics().voices,0);assert.equal(audio.diagnostics().cached,0);
  assert.equal(await audio.resume(),false);assert.equal(await audio.play('weapons/awp1.wav'),false);
  assert.ok(contexts[0].sources.every(s=>s.disconnected));
});
test('stale wall clock and audio clock both gate decode completion',async()=>{
  for(const which of ['wall','audio']){
    const f=fixture();await f.audio.resume();const d=deferred();f.setDecode(()=>d.promise);
    const result=f.audio.play('weapons/test_stale.wav');await tick();
    if(which==='wall')f.setClock(251);else f.contexts[0].currentTime=.251;
    d.resolve({length:1024,numberOfChannels:1});assert.equal(await result,false);assert.equal(f.audio.diagnostics().stale,1);f.audio.dispose();
  }
});
test('pending decode cannot resurrect stopped/replaced/disposed or disabled channels',async()=>{
  for(const operation of ['channel','all','dispose','disable','replace']){
    const f=fixture();await f.audio.resume();const d=deferred();f.setDecode(()=>d.promise);
    const result=f.audio.play('weapons/test_delayed.wav',{entityId:'e',channel:1});await tick();
    let replacement;
    if(operation==='channel')f.audio.stopChannel('e',1);
    if(operation==='all')f.audio.stopAll();
    if(operation==='dispose')f.audio.dispose();
    if(operation==='disable'){f.audio.setSettings({enabled:false});f.audio.setSettings({enabled:true});}
    if(operation==='replace')replacement=f.audio.play('weapons/awp1.wav',{entityId:'e',channel:1});
    d.resolve({length:1024,numberOfChannels:1});assert.equal(await result,false);
    if(replacement)assert.equal(await replacement,true);
    assert.equal(f.audio.diagnostics().voices,replacement?1:0);f.audio.dispose();
  }
});
test('bounded async load queue and pending plays; disposal resolves even noncooperative fetches',async()=>{
  const f=fixture();await f.audio.resume();const d=deferred();let active=0,peak=0;
  f.setFetch(async()=>{active++;peak=Math.max(peak,active);await d.promise;active--;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(44)};});
  const results=Array.from({length:200},(_,i)=>f.audio.play('weapons/test_'+i+'.wav'));
  await tick();const diag=f.audio.diagnostics();assert.equal(peak,4);assert.equal(diag.activeLoads,4);
  assert.ok(diag.queuedLoads<=28);assert.ok(diag.pendingPlays<=96);assert.ok(diag.dropped>0);
  f.audio.dispose();assert.ok((await Promise.all(results)).every(v=>v===false));
  d.resolve();await tick();assert.equal(f.audio.diagnostics().activeLoads,0);assert.equal(f.audio.diagnostics().cached,0);
});
test('single flight loads, decoded LRU bounds, byte bounds, missing and oversized failures',async()=>{
  const f=fixture();await f.audio.resume();const before=f.requests.length;
  await Promise.all(Array.from({length:12},()=>f.audio.play('weapons/test_shared.wav')));assert.equal(f.requests.length,before+1);
  for(let i=0;i<AUDIO_LIMITS.cacheEntries+22;i++)await f.audio.play('weapons/test_cache_'+i+'.wav');
  assert.equal(f.audio.diagnostics().cached,AUDIO_LIMITS.cacheEntries);assert.ok(f.audio.diagnostics().cacheBytes<=AUDIO_LIMITS.cacheBytes);
  f.setDecode(()=>({length:1024*1024,numberOfChannels:2}));
  const slots=Math.floor(AUDIO_LIMITS.cacheBytes/(1024*1024*2*4));
  await f.audio.preload(Array.from({length:slots+2},(_,i)=>'weapons/test_large_'+i+'.wav'));
  assert.equal(f.audio.diagnostics().cached,slots);assert.ok(f.audio.diagnostics().cacheBytes<=AUDIO_LIMITS.cacheBytes);
  f.setDecode(()=>({length:AUDIO_LIMITS.decodedBytes,numberOfChannels:2}));
  assert.equal(await f.audio.play('weapons/test_decode_oversize.wav'),false);
  f.setFetch(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(AUDIO_LIMITS.encodedBytes+1)}));
  assert.equal(await f.audio.play('weapons/test_encode_oversize.wav'),false);
  f.setFetch(async()=>({ok:false}));assert.equal(await f.audio.play('weapons/test_missing.wav'),false);
  assert.ok(f.audio.diagnostics().missing>=3);f.audio.dispose();
});
test('streamed bodies have a hard byte limit and are cancelled on excess',async()=>{
  const f=fixture();await f.audio.resume();let cancelled=false,released=false;
  f.setFetch(async()=>({ok:true,body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(AUDIO_LIMITS.encodedBytes+1)}),
    cancel:async()=>{cancelled=true;},releaseLock(){released=true;}})}}));
  assert.equal(await f.audio.play('weapons/test_stream.wav'),false);assert.equal(cancelled,true);assert.equal(released,true);f.audio.dispose();
});
test('queued and active load deadlines settle callers without spawning zombie decoders',async()=>{
  const f=fixture();await f.audio.resume();const d=deferred();f.setDecode(()=>d.promise);
  const results=Array.from({length:40},(_,i)=>f.audio.play('weapons/test_timeout_'+i+'.wav'));
  assert.ok((await Promise.all(results)).every(v=>v===false));
  assert.equal(f.audio.diagnostics().activeLoads,4);assert.equal(f.audio.diagnostics().queuedLoads,0);
  assert.equal(f.audio.diagnostics().pendingPlays,0);
  const requests=f.requests.length;
  assert.equal(await f.audio.play('weapons/test_after_timeout.wav'),false);
  assert.equal(f.requests.length,requests);
  d.resolve({length:1024,numberOfChannels:1});await tick();
  assert.equal(f.audio.diagnostics().activeLoads,0);assert.equal(f.audio.diagnostics().voices,0);
  // Expired decodes must not be inserted into the cache.
  const before=f.requests.length;await f.audio.play('weapons/test_timeout_0.wav');assert.equal(f.requests.length,before+1);f.audio.dispose();
});
test('unavailable contexts, rejected resume, and graph creation errors fail safely',async()=>{
  const unavailable=createGameAudio({Context:null});assert.equal(await unavailable.resume(),false);unavailable.dispose();
  class Denied{constructor(){this.listener={};this.destination={};}async resume(){throw Error('autoplay blocked');}createGain(){return {gain:{value:0},connect(){},disconnect(){}};}}
  const denied=createGameAudio({Context:Denied});assert.equal(await denied.resume(),false);denied.dispose();
  const f=fixture();await f.audio.resume();f.contexts[0].createPanner=()=>{throw Error('node failed');};
  assert.equal(await f.audio.play('weapons/awp1.wav',{position:{x:1,y:0,z:0},entityId:'e',channel:1}),false);
  assert.equal(f.audio.diagnostics().voices,0);assert.equal(f.audio.diagnostics().channels,0);
  assert.ok(f.contexts[0].sources[0].disconnected);f.audio.dispose();
});

test('announcer queue preserves intent order despite out-of-order loads, then stopAll clears scheduled voices',async()=>{
  const f=fixture();await f.audio.resume();const gate=deferred();
  f.setFetch(()=>gate.promise);f.setDecode(()=>({length:48000,numberOfChannels:1,duration:1}));
  const options={category:'voice',queue:'announcer',entityId:'world',channel:'announcer'};
  const first=f.audio.play('radio/test_queue_first.wav',options),second=f.audio.play('radio/ctwin.wav',options);
  await tick();assert.equal(f.contexts[0].sources.length,0,'cached second cue must not jump an unfinished first decode');
  gate.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(44)});assert.deepEqual(await Promise.all([first,second]),[true,true]);
  const [a,b]=f.contexts[0].sources;assert.equal(a.startAt,0);assert.equal(b.startAt,1);
  f.audio.stopAll();assert.equal(a.stops,1);assert.equal(b.stops,1);assert.equal(f.audio.diagnostics().voices,0);
  await f.audio.play('radio/ctwin.wav',options);assert.equal(f.contexts[0].sources[2].startAt,0);f.audio.dispose();
});
test('mode-specific gun volume, attenuation and source pitch reach actual graph parameters',async()=>{
  const f=fixture();await f.audio.resume();await f.audio.shot({weapon:'m4a1',silenced:true,soundPitch:96});
  assert.equal(f.contexts[0].sources[0].playbackRate.value,.96);assert.equal(f.contexts[0].sources[0].connections[0].gain.value,1);
  await f.audio.shot({weapon:'tmp',soundPitch:109},{x:1,y:0,z:0});assert.equal(f.contexts[0].sources[1].playbackRate.value,1.09);
  assert.equal(f.contexts[0].panners[0].maxDistance,1000/40/.8);assert.equal(f.contexts[0].sources[1].connections[0].gain.value,1);f.audio.dispose();
});
