// Actual installed Chrome + real Web Audio PCM. No service or physical listening claim.
// The mono impulse WAV exists ONLY in this DSP test fixture, never in game code/assets.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true,
  executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const errors=[],externalRequests=[];
try{
  const page=await browser.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!=='https://audio-mixer.test'){externalRequests.push(url.href);return route.abort();}
    if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Offline audio DSP test fixture</title>'});
    if(url.pathname==='/fixture-step.wav')return route.fulfill({contentType:'audio/wav',body:await readFile(new URL('../public/assets/sounds/player/pl_step1.wav',import.meta.url))});
    if(!['/game-audio.js','/audio-settings.js','/sound-catalog.js','/weapon-audio.js'].includes(url.pathname))return route.fulfill({status:404,body:'Not a fixture route'});
    await route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../public'+url.pathname,import.meta.url))});
  });
  await page.goto('https://audio-mixer.test/');
  const evidence=await page.evaluate(async()=>{
    const {createGameAudio}=await import('/game-audio.js');
    const sampleRate=48000,frames=16384,results={};
    // Deterministic mono impulse at 2048 frames; ample silence for the HRTF filter tail.
    const wav=new ArrayBuffer(44+frames*2),view=new DataView(wav);
    const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
    text(0,'RIFF');view.setUint32(4,wav.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);
    view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
    view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,frames*2,true);view.setInt16(44+2048*2,16384,true);
    async function render({mode='hrtf',position={x:4,y:0,z:-4},forward={x:0,y:0,z:-1},category='effects',settings={},attenuation=.8,wavBuffer=wav}={}){
      const offline=new OfflineAudioContext(2,frames,sampleRate);
      // Only lifecycle is adapted: every source, decoder, gain, listener and panner is native.
      // OfflineAudioContext starts suspended; its resume() has different semantics from real-time.
      class OfflineAdapter{
        constructor(){this.destination=offline.destination;this.listener=offline.listener;}
        get state(){return 'running';}get currentTime(){return offline.currentTime;}
        createGain(){return offline.createGain();}createBufferSource(){return offline.createBufferSource();}
        createPanner(){return offline.createPanner();}decodeAudioData(data){return offline.decodeAudioData(data);}
        async resume(){}async close(){}
      }
      const mixer=createGameAudio({Context:OfflineAdapter,now:()=>0,settings:{master:1,effects:1,voice:1,spatialMode:mode,...settings},
        fetcher:async()=>new Response(wavBuffer.slice(0),{headers:{'content-type':'audio/wav'}})});
      await mixer.resume();mixer.listen({x:0,y:0,z:0},{x:0,y:0,z:-1});
      const admitted=await mixer.play('weapons/awp1.wav',{position,volume:1,category,attenuation});
      if(!admitted)throw Error('Native DSP fixture not admitted');
      // Rotate the listener after the source graph exists; never rewrite the event location.
      mixer.listen({x:0,y:0,z:0},forward);
      const rendered=await offline.startRendering();
      const left=Array.from(rendered.getChannelData(0)),right=Array.from(rendered.getChannelData(1));
      const energy=samples=>samples.reduce((sum,v)=>sum+v*v,0);
      const stats={left:energy(left),right:energy(right),peak:Math.max(...left.map(Math.abs),...right.map(Math.abs))};
      stats.total=stats.left+stats.right;mixer.dispose();return {stats,left,right};
    }
    const difference=(a,b)=>{
      let delta=0,reference=0;for(const key of ['left','right'])for(let i=0;i<a[key].length;i++){
        delta+=(a[key][i]-b[key][i])**2;reference+=a[key][i]**2;
      }return delta/Math.max(reference,1e-30);
    };
    for(const mode of ['hrtf','equalpower']){
      const facing=await render({mode}),rotated=await render({mode,forward:{x:0,y:0,z:1}});
      const near=await render({mode,position:{x:0,y:0,z:-2}}),far=await render({mode,position:{x:0,y:0,z:-20}});
      const front=await render({mode,position:{x:0,y:0,z:-4}}),back=await render({mode,position:{x:0,y:0,z:4}});
      results[mode]={facing:facing.stats,rotated:rotated.stats,near:near.stats,far:far.stats,
        farNearEnergyRatio:far.stats.total/near.stats.total,front:front.stats,back:back.stats,frontBackNormalizedSquaredDifference:difference(front,back)};
    }
    const local=await render({position:null}),rotatedLocal=await render({position:null,forward:{x:1,y:0,z:0}});
    const halfMaster=await render({position:null,settings:{master:.5}});
    const mutedEffects=await render({position:null,settings:{effects:0}});
    const audibleVoice=await render({position:null,category:'voice',settings:{effects:0,voice:.5}});
    results.headlocked={baseline:local.stats,rotationDifference:difference(local,rotatedLocal),
      halfMasterEnergyRatio:halfMaster.stats.total/local.stats.total,mutedEffects:mutedEffects.stats,
      voiceEnergyRatio:audibleVoice.stats.total/local.stats.total};
    const original=await (await fetch('/fixture-step.wav')).arrayBuffer();
    const originalRight=await render({wavBuffer:original}),originalRotated=await render({wavBuffer:original,forward:{x:0,y:0,z:1}});
    const originalFront=await render({wavBuffer:original,position:{x:0,y:0,z:-4}}),originalBack=await render({wavBuffer:original,position:{x:0,y:0,z:4}});
    results.originalFootstep={file:'player/pl_step1.wav',encodedBytes:original.byteLength,right:originalRight.stats,rotated:originalRotated.stats,
      frontBackNormalizedSquaredDifference:difference(originalFront,originalBack)};
    return {secureContext:isSecureContext,userAgent:navigator.userAgent,sampleRate,frames,fixture:'test-only mono PCM16 impulse, amplitude 0.5 at frame 2048',
      nativePath:'createGameAudio -> native decodeAudioData -> BufferSource -> Gain -> Panner (world only) -> category Gain -> master Gain -> OfflineAudioContext stereo PCM',results};
  });
  assert.equal(evidence.secureContext,true);
  for(const mode of ['hrtf','equalpower']){
    const r=evidence.results[mode];assert.ok(r.facing.right>r.facing.left*1.2,mode+' facing: right energy must dominate');
    assert.ok(r.rotated.left>r.rotated.right*1.2,mode+' rotated: left energy must dominate');
    assert.ok(r.near.total>0&&r.far.total>0&&r.farNearEnergyRatio<.5,mode+' distance attenuation');
    for(const trial of [r.facing,r.rotated,r.near,r.far,r.front,r.back])assert.ok(Number.isFinite(trial.total)&&trial.peak<=1);
  }
  assert.ok(evidence.results.hrtf.frontBackNormalizedSquaredDifference>1e-4,'HRTF front/back impulse responses must differ');
  assert.ok(evidence.results.equalpower.frontBackNormalizedSquaredDifference<1e-10,'equalpower control has no front/back filter');
  const local=evidence.results.headlocked;assert.equal(local.rotationDifference,0);
  assert.equal(local.baseline.left,local.baseline.right);assert.equal(local.mutedEffects.total,0);
  assert.ok(Math.abs(local.halfMasterEnergyRatio-.25)<1e-5);assert.ok(Math.abs(local.voiceEnergyRatio-.25)<1e-5);
  const step=evidence.results.originalFootstep;assert.ok(step.right.right>step.right.left*1.2);assert.ok(step.rotated.left>step.rotated.right*1.2);
  assert.ok(step.frontBackNormalizedSquaredDifference>1e-4,'actual prepared footstep must have distinct HRTF front/back PCM');
  assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);
  console.log(JSON.stringify({status:'passed',chromeVersion:browser.version(),errors,externalRequests,...evidence},null,2));
}finally{await browser.close();}
