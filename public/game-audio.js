import {SHOT_SOUNDS,ACTION_SOUNDS,safeSound,gunSound} from './sound-catalog.js';
import * as catalog from './sound-catalog.js';
import {normalizeAudioSettings} from './audio-settings.js';
import {gunAudioProfile} from './weapon-audio.js';

// World positions are already metres. Only the nominal range is converted.
// 1000 units is an ENGINEERING parameter, not verified retail CS1.6 parity.
export const AUDIO_SPATIAL=Object.freeze({sourceUnitsPerMetre:40,nominalClipSourceUnits:1000});
export const AUDIO_LIMITS=Object.freeze({voices:48,cacheEntries:512,cacheBytes:64*1024*1024,
  encodedBytes:2*1024*1024,decodedBytes:16*1024*1024,loads:4,queuedLoads:28,
  pendingPlays:96,events:512,eventAgeMs:10000,staleMs:250,loadTimeoutMs:8000,preloadNames:512});
const xyz=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<=1e7);
const copy=p=>({x:p.x,y:p.y,z:p.z});
const clamp=(v,min,max,fallback)=>Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;
const identifier=v=>(typeof v==='string'&&v.length>0&&v.length<=128)||Number.isSafeInteger(v);
const channelKey=(entity,channel)=>identifier(entity)&&identifier(channel)&&channel!=='auto'&&channel!==0?
  JSON.stringify([entity,channel]):null;
const param=(node,key,value)=>{if(node[key])node[key].value=value;};

export function createGameAudio({Context=globalThis.AudioContext||globalThis.webkitAudioContext,
  fetcher=globalThis.fetch,settings:initialSettings={},now=()=>globalThis.performance?.now()??Date.now()}={}){
  let context=null,master=null,buses=null,disposed=false,resuming=null,warmed=false,epoch=0,cacheBytes=0;
  let settings=normalizeAudioSettings(initialSettings),listener={x:0,y:0,z:0},forward={x:0,y:0,z:-1};
  let missing=0,played=0,impactPlayed=0,activeLoads=0,dropped=0,stale=0,deduplicated=0;
  const cache=new Map(),loads=new Map(),queue=[],voices=new Set(),pending=new Set(),channels=new Map(),events=new Map();
  let announcerAt=0,announcerLoad=Promise.resolve();
  function applySettings(){
    if(!master)return;
    master.gain.value=settings.enabled?settings.master:0;
    buses.effects.gain.value=settings.effects;buses.voice.gain.value=settings.voice;
    for(const v of voices)if(v.panner)v.panner.panningModel=settings.spatialMode==='hrtf'?'HRTF':'equalpower';
  }
  function applyListener(){
    if(!context)return;
    const l=context.listener;
    if(l.positionX){for(const k of ['x','y','z'])param(l,'position'+k.toUpperCase(),listener[k]);}
    else l.setPosition?.(listener.x,listener.y,listener.z);
    if(l.forwardX){
      for(const k of ['x','y','z'])param(l,'forward'+k.toUpperCase(),forward[k]);
      param(l,'upX',0);param(l,'upY',1);param(l,'upZ',0);
    }else l.setOrientation?.(forward.x,forward.y,forward.z,0,1,0);
  }
  function removeCache(name){const old=cache.get(name);if(old){cacheBytes-=old.bytes;cache.delete(name);}}
  function remember(name,buffer){
    const bytes=buffer.length*buffer.numberOfChannels*4;
    if(!Number.isFinite(bytes)||bytes<=0||bytes>AUDIO_LIMITS.decodedBytes)throw Error('Oversized decoded sound');
    while(cache.size>=AUDIO_LIMITS.cacheEntries||cacheBytes+bytes>AUDIO_LIMITS.cacheBytes)removeCache(cache.keys().next().value);
    cache.set(name,{buffer,bytes});cacheBytes+=bytes;
  }
  async function runLoad(job){
    const ctx=context;activeLoads++;
    const controller=new AbortController();job.controller=controller;
    let buffer=null;
    try{
      const r=await fetcher('/assets/sounds/'+job.name,{signal:controller.signal});
      if(!r.ok||job.expired||disposed)throw Error('Unavailable sound');
      const declared=Number(r.headers?.get?.('content-length'));
      if(declared>AUDIO_LIMITS.encodedBytes)throw Error('Oversized sound');
      // Bound the response body when streaming is available, including absent/false Content-Length.
      let data;
      if(r.body?.getReader){
        const reader=r.body.getReader(),chunks=[];let size=0;
        try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
          if(size>AUDIO_LIMITS.encodedBytes||job.expired||disposed)throw Error('Sound body rejected');chunks.push(value);}}
        catch(error){await reader.cancel().catch(()=>{});throw error;}
        finally{reader.releaseLock();}
        data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
        data=data.buffer;
      }else data=await r.arrayBuffer();
      if(data.byteLength>AUDIO_LIMITS.encodedBytes||job.expired||disposed)throw Error('Sound body rejected');
      buffer=await ctx.decodeAudioData(data);
      if(disposed||job.expired||context!==ctx)buffer=null;
      else remember(job.name,buffer);
    }catch{if(!disposed)missing++;buffer=null;}
    finally{
      clearTimeout(job.timer);activeLoads--;loads.delete(job.name);job.resolve(buffer);pump();
    }
  }
  function pump(){while(!disposed&&context&&activeLoads<AUDIO_LIMITS.loads&&queue.length)void runLoad(queue.shift());}
  function load(name){
    if(disposed||!context||!safeSound(name))return Promise.resolve(null);
    if(cache.has(name)){const hit=cache.get(name);cache.delete(name);cache.set(name,hit);return Promise.resolve(hit.buffer);}
    if(loads.has(name))return loads.get(name).promise;
    // All native decoders/fetchers hung after their deadlines: fail fast, not an endless preload queue.
    if(activeLoads>=AUDIO_LIMITS.loads&&[...loads.values()].filter(j=>j.controller).every(j=>j.expired))return Promise.resolve(null);
    if(loads.size>=AUDIO_LIMITS.loads+AUDIO_LIMITS.queuedLoads){dropped++;return Promise.resolve(null);}
    let resolve;const promise=new Promise(r=>{resolve=r;}),job={name,promise,resolve};
    job.timer=setTimeout(()=>{
      job.expired=true;job.controller?.abort();job.resolve(null);
      if(!job.controller){const i=queue.indexOf(job);if(i>=0)queue.splice(i,1);loads.delete(name);}
    },AUDIO_LIMITS.loadTimeoutMs);
    loads.set(name,job);queue.push(job);pump();return promise;
  }
  async function preload(names=[]){
    if(!context||disposed||!Array.isArray(names))return [];
    const selected=new Set();
    for(const name of names){if(safeSound(name))selected.add(name);if(selected.size>=AUDIO_LIMITS.preloadNames)break;}
    const unique=[...selected],results=new Array(unique.length);let cursor=0;
    await Promise.all(Array.from({length:Math.min(AUDIO_LIMITS.loads,unique.length)},async()=>{
      while(cursor<unique.length&&!disposed){const i=cursor++;results[i]=await load(unique[i]);}
    }));return results;
  }
  function release(v){
    if(v.released)return;v.released=true;voices.delete(v);
    if(v.key&&channels.get(v.key)===v)channels.delete(v.key);
    for(const node of [v.source,v.gain,v.panner])try{node?.disconnect();}catch{}
  }
  function stop(v){
    v.cancelled=true;
    if(v.source){v.source.onended=null;try{v.source.stop();}catch{}release(v);}
    else if(v.key&&channels.get(v.key)===v)channels.delete(v.key);
  }
  function stopChannel(entityId,channel){
    const key=channelKey(entityId,channel),v=key&&channels.get(key);if(!v)return false;stop(v);return true;
  }
  function stopAll(){epoch++;announcerAt=0;announcerLoad=Promise.resolve();for(const p of pending)stop(p);for(const v of [...voices])stop(v);channels.clear();}
  function acceptEvent(eventId){
    if(eventId===undefined||eventId===null)return true;
    if(!identifier(eventId))return false;
    const time=now();for(const [key,at] of events){if(time-at<AUDIO_LIMITS.eventAgeMs)break;events.delete(key);}
    if(events.has(eventId)){deduplicated++;return false;}
    while(events.size>=AUDIO_LIMITS.events)events.delete(events.keys().next().value);
    events.set(eventId,time);return true;
  }
  async function play(name,{position=null,volume=.7,category='effects',attenuation=.8,entityId,
    channel='auto',eventId,loop=false,priority=0,pitch=100,queue:playQueue=null}={}){
    if(disposed||!context||context.state!=='running'||!settings.enabled||!safeSound(name))return false;
    if(position!==null&&!xyz(position))return false;
    // Reject non-finite values rather than passing NaN/Infinity to native AudioParams.
    if(!Number.isFinite(volume)||!Number.isFinite(attenuation)||!Number.isFinite(priority)||!Number.isFinite(pitch))return false;
    volume=clamp(volume,0,1,.7);attenuation=clamp(attenuation,0,4,.8);priority=clamp(priority,-100,100,0);
    if(volume===0||pending.size>=AUDIO_LIMITS.pendingPlays){dropped++;return false;}
    position=position&&copy(position);
    const range=AUDIO_SPATIAL.nominalClipSourceUnits/AUDIO_SPATIAL.sourceUnitsPerMetre/(attenuation||1);
    if(position&&attenuation>0&&Math.hypot(position.x-listener.x,position.y-listener.y,position.z-listener.z)>=range)return false;
    if(!acceptEvent(eventId))return false;
    const queued=playQueue==='announcer'&&category==='voice'&&!position;
    const key=queued?null:channelKey(entityId,channel),old=key&&channels.get(key);if(old)stop(old);
    const ctx=context,ticket={key,cancelled:false,epoch,priority},time=now(),audioTime=ctx.currentTime;
    const predecessor=queued?announcerLoad:null;let unlock;
    if(queued)announcerLoad=new Promise(resolve=>{unlock=resolve;});
    pending.add(ticket);if(key)channels.set(key,ticket);
    try{
      const buffer=await load(name);
      if(predecessor)await predecessor;
      if(!buffer||ticket.cancelled||disposed||epoch!==ticket.epoch||context!==ctx||ctx.state!=='running'||!settings.enabled)return false;
      if(now()-time>AUDIO_LIMITS.staleMs||(ctx.currentTime-audioTime)*1000>AUDIO_LIMITS.staleMs){stale++;return false;}
      if(voices.size>=AUDIO_LIMITS.voices){
        let victim=null;for(const v of voices)if(!victim||v.priority<victim.priority)victim=v;
        if(victim.priority>priority){dropped++;return false;}stop(victim);
      }
      ticket.source=ctx.createBufferSource();ticket.gain=ctx.createGain();
      const rate=clamp(pitch,25,255,100)/100;
      ticket.source.buffer=buffer;ticket.source.loop=loop===true&&!queued;ticket.gain.gain.value=volume;
      if(ticket.source.playbackRate)ticket.source.playbackRate.value=rate;
      ticket.source.connect(ticket.gain);
      if(position){
        const p=ticket.panner=ctx.createPanner();p.panningModel=settings.spatialMode==='hrtf'?'HRTF':'equalpower';
        p.distanceModel='linear';p.refDistance=0;p.maxDistance=range;p.rolloffFactor=attenuation===0?0:1;
        p.coneInnerAngle=360;p.coneOuterAngle=360;p.coneOuterGain=1;
        if(p.positionX)for(const k of ['x','y','z'])param(p,'position'+k.toUpperCase(),position[k]);
        else p.setPosition(position.x,position.y,position.z);
        ticket.gain.connect(p);p.connect(buses[category==='voice'?'voice':'effects']);
      }else ticket.gain.connect(buses[category==='voice'?'voice':'effects']);
      const when=queued?Math.max(ctx.currentTime,announcerAt):ctx.currentTime;
      if(queued&&when-ctx.currentTime>5){stop(ticket);dropped++;return false;}
      if(queued)announcerAt=when+(Number.isFinite(buffer.duration)?buffer.duration:buffer.length/(ctx.sampleRate||48000))/rate;
      ticket.source.onended=()=>release(ticket);voices.add(ticket);ticket.source.start(when);played++;
      if(/^player\/(bhit_|headshot)/.test(name))impactPlayed++;
      return true;
    }catch{stop(ticket);return false;}
    finally{unlock?.();pending.delete(ticket);if(!voices.has(ticket)&&key&&channels.get(key)===ticket)channels.delete(key);}
  }
  return {
    async resume(){
      if(disposed)return false;if(resuming)return resuming;
      resuming=(async()=>{
        try{
          if(!context&&Context){context=new Context();master=context.createGain();buses={effects:context.createGain(),voice:context.createGain()};
            buses.effects.connect(master);buses.voice.connect(master);master.connect(context.destination);applySettings();applyListener();}
          if(!context)return false;await context.resume();if(disposed)return false;
          if(!warmed){
            warmed=true;
            const all=Array.isArray(catalog.ALL_SOUNDS)?catalog.ALL_SOUNDS:[...Object.values(SHOT_SOUNDS),...ACTION_SOUNDS];
            const shots=new Set([...Object.values(SHOT_SOUNDS),gunSound('m4a1',true),gunSound('usp',true)]);
            // Warm once, guns last: large optional catalogs must not evict every common gun,
            // nor refetch the entire catalog on every menu/user-gesture resume.
            await preload([...all.filter(name=>!shots.has(name)),...shots]);
          }
          return !disposed&&context?.state==='running';
        }catch{return false;}
      })();try{return await resuming;}finally{resuming=null;}
    },
    play,preload,
    shot(event,position=null){const p=gunAudioProfile(event);if(!p)return Promise.resolve(false);return play(p.name,{
      position,volume:p.volume,attenuation:p.attenuation,pitch:p.pitch,priority:10,eventId:event.shotId??event.eventId,entityId:event.entityId??event.id,channel:'auto'});},
    listen(position,direction){
      if(!xyz(position)||!xyz(direction))return false;
      const length=Math.hypot(direction.x,direction.y,direction.z);if(length<1e-6)return false;
      // Avoid a forward vector parallel to fixed world-up (undefined listener basis).
      const horizontal=Math.hypot(direction.x,direction.z);if(horizontal<1e-6)return false;
      listener=copy(position);forward={x:direction.x/length,y:direction.y/length,z:direction.z/length};applyListener();return true;
    },
    setSettings(value){settings=normalizeAudioSettings(value,settings);applySettings();if(!settings.enabled)stopAll();return {...settings};},
    getSettings:()=>({...settings}),stopChannel,stopAll,
    diagnostics:()=>({source:'local-wav',cached:cache.size,cacheBytes,voices:voices.size,played,impactPlayed,missing,
      ready:!disposed&&context?.state==='running',pendingPlays:pending.size,activeLoads,queuedLoads:queue.length,
      channels:channels.size,events:events.size,dropped,stale,deduplicated,settings:{...settings},disposed}),
    dispose(){
      if(disposed)return;disposed=true;stopAll();cache.clear();cacheBytes=0;events.clear();
      for(const job of loads.values()){clearTimeout(job.timer);job.expired=true;job.controller?.abort();job.resolve(null);}queue.length=0;
      // Keep active slots occupied until actual fetch/decode settles; never spawn unbounded zombie decoders.
      for(const [name,job] of loads)if(!job.controller)loads.delete(name);
      for(const node of [buses?.effects,buses?.voice,master])try{node?.disconnect();}catch{}
      const ctx=context;context=null;master=null;buses=null;
      try{const closed=ctx?.close();closed?.catch?.(()=>{});}catch{}
    },
  };
}
