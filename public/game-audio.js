import {SHOT_SOUNDS,ACTION_SOUNDS,safeSound,gunSound} from './sound-catalog.js';
export function createGameAudio({Context=globalThis.AudioContext||globalThis.webkitAudioContext,fetcher=globalThis.fetch}={}){
  let context=null,master=null,listener={x:0,y:0,z:0},missing=0,played=0,impactPlayed=0;
  const cache=new Map(),voices=new Set(),events=new Set();
  async function load(name){
    if(!safeSound(name)||!context)return null;if(cache.has(name))return cache.get(name);
    if(cache.size>=128)cache.delete(cache.keys().next().value);
    const result=(async()=>{try{const r=await fetcher('/assets/sounds/'+name);if(!r.ok)throw Error('Missing sound');const b=await r.arrayBuffer();if(b.byteLength>2*1024*1024)throw Error('Oversized sound');return await context.decodeAudioData(b);}catch{missing++;return null;}})();
    cache.set(name,result);return result;
  }
  async function play(name,{position=null,volume=.7}={}){
    if(!context||context.state!=='running'||!safeSound(name))return false;
    const started=context.currentTime,buffer=await load(name);if(!buffer||context.currentTime-started>.25)return false;
    while(voices.size>=48){const oldest=voices.values().next().value;oldest.stop();voices.delete(oldest);}
    const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;gain.gain.value=Math.max(0,Math.min(1,volume));source.connect(gain);
    let panner=null;
    if(position&&[position.x,position.y,position.z].every(Number.isFinite)){
      if(Math.hypot(position.x-listener.x,position.y-listener.y,position.z-listener.z)>90)return false;
      panner=context.createPanner();panner.panningModel='HRTF';panner.distanceModel='inverse';panner.refDistance=3;panner.maxDistance=90;panner.rolloffFactor=1;
      panner.positionX.value=position.x;panner.positionY.value=position.y;panner.positionZ.value=position.z;gain.connect(panner);panner.connect(master);
    }else gain.connect(master);
    voices.add(source);source.onended=()=>{voices.delete(source);source.disconnect();gain.disconnect();panner?.disconnect();};source.start();played++;if(/^player\/(bhit_|headshot)/.test(name))impactPlayed++;return true;
  }
  return {
    async resume(){if(!context&&Context){context=new Context();master=context.createGain();master.gain.value=.28;master.connect(context.destination);}if(!context)return;await context.resume();await Promise.all([...new Set([...Object.values(SHOT_SOUNDS),...ACTION_SOUNDS])].map(load));},
    play,preload:names=>Promise.all(names.filter(safeSound).map(load)),
    shot(event,position=null){const key=event.shotId;if(key&&events.has(key))return;if(key){events.add(key);if(events.size>256)events.delete(events.values().next().value);}return play(gunSound(event.weapon,event.silenced),{position,volume:event.silenced?.55:.85});},
    listen(position,forward){listener={...position};if(!context)return;const l=context.listener;l.positionX.value=position.x;l.positionY.value=position.y;l.positionZ.value=position.z;l.forwardX.value=forward.x;l.forwardY.value=forward.y;l.forwardZ.value=forward.z;l.upX.value=0;l.upY.value=1;l.upZ.value=0;},
    diagnostics:()=>({source:'local-wav',cached:cache.size,voices:voices.size,played,impactPlayed,missing,ready:context?.state==='running'}),
    dispose(){for(const v of voices)v.stop();voices.clear();cache.clear();events.clear();context?.close();context=null;},
  };
}
