import {safeSound,SOUND_GROUPS} from './sound-catalog.js';
const choose=(list,random)=>list[Math.min(list.length-1,Math.max(0,Math.floor(random()*list.length)))];
const MATERIAL_HITS=Object.freeze({
  concrete:[.9,['player/pl_step1.wav','player/pl_step2.wav']],metal:[.9,['player/pl_metal1.wav','player/pl_metal2.wav']],
  dirt:[.9,['player/pl_dirt1.wav','player/pl_dirt2.wav','player/pl_dirt3.wav']],vent:[.5,['player/pl_duct1.wav']],
  grate:[.9,['player/pl_grate1.wav','player/pl_grate4.wav']],tile:[.8,['player/pl_tile1.wav','player/pl_tile3.wav','player/pl_tile2.wav','player/pl_tile4.wav']],
  slosh:[.9,['player/pl_slosh1.wav','player/pl_slosh3.wav','player/pl_slosh2.wav','player/pl_slosh4.wav']],
  snow:[.7,['player/pl_snow1.wav','player/pl_snow2.wav','player/pl_snow3.wav','player/pl_snow4.wav','player/pl_snow5.wav','player/pl_snow6.wav']],
  wood:[.9,['debris/wood1.wav','debris/wood2.wav','debris/wood3.wav']],glass:[.8,['debris/glass1.wav','debris/glass2.wav','debris/glass3.wav']],
  computer:[.8,['debris/glass1.wav','debris/glass2.wav','debris/glass3.wav']],
});
/** Only consume emitted events: visibility/FOV and enemy state never gate audibility. */
export function createWorldAudio(getAudio,{random=Math.random}={}){
  let seen=new Set(),shots=new Map(),received=0,routed=0,duplicates=0,localSteps=0,remoteSteps=0;
  function reset(){seen.clear();shots.clear();}
  function play(name,options){if(!safeSound(name))return;routed++;void getAudio()?.play(name,options);}
  function handle(e,{myId=null,team=null,round=null,predictOwnMovement=true}={}){
    if(!e||typeof e!=='object'||(round!==null&&e.round!==undefined&&e.round!==round))return;
    received++;
    if(e.eventId!==undefined){
      const key=String(e.eventId);if(seen.has(key)){duplicates++;return;}seen.add(key);if(seen.size>512)seen.delete(seen.values().next().value);
    }
    const identity=e.eventId===undefined?undefined:`world:${e.eventId}`;
    const base={entityId:e.id,position:e.id===myId?null:e.from,eventId:identity};
    if(e.type==='soundStop'){
      getAudio()?.stopChannel(e.id,e.channel);
    }else if(e.type==='sound'){
      if(e.private&&e.id!==myId||e.exceptId===myId||e.team&&e.team!==team)return;
      play(e.name,{...base,position:e.global||e.private?null:base.position,volume:e.volume??1,attenuation:e.attenuation??.8,
        channel:e.channel||'auto',category:e.category||'effects',priority:e.priority||0,queue:e.global&&e.category==='voice'?'announcer':null});
    }else if(['footstep','jump','landing'].includes(e.type)){
      if(e.id===myId&&predictOwnMovement)return;
      if(!safeSound(e.sound))return;remoteSteps++;
      play(e.sound,{...base,volume:e.volume??.5,attenuation:.8,channel:'body',priority:15});
    }else if(e.type==='bounce'){
      play(choose(SOUND_GROUPS[e.kind==='hegrenade'?'grenade.bounce.he':'grenade.bounce.other'],random),{...base,volume:.25,channel:'voice',priority:5});
    }else if(e.type==='melee'){
      const group=e.blocked?'ricochet.metal':e.hit?(e.secondary?'knife.stab':'knife.body'):e.wall?'knife.wall':'knife.swing';
      play(choose(SOUND_GROUPS[group],random),{...base,volume:1,channel:'weapon',priority:10});
    }else if(e.type==='explosion'){
      if(!['hegrenade','flashbang','smokegrenade'].includes(e.kind))return;
      const group=e.kind==='hegrenade'?'grenade.he':e.kind==='flashbang'?'grenade.flash':'grenade.smoke';
      play(choose(SOUND_GROUPS[group],random),{...base,position:e,volume:e.kind==='flashbang'?.55:1,channel:'weapon',priority:25});
      if(e.kind==='hegrenade')play(choose(SOUND_GROUPS['grenade.aftermath'],random),{...base,eventId:identity&&identity+':debris',position:e,volume:.55,channel:'voice',priority:5});
    }else if(e.type==='shot'){
      const shot=e.shotId||identity;let hitKeys=shots.get(shot);
      if(!hitKeys){hitKeys=new Set();shots.set(shot,hitKeys);if(shots.size>256)shots.delete(shots.keys().next().value);}
      const hit=e.hitImpact,impact=e.impact,p=hit?.position||impact?.position;
      if(!p||!['x','y','z'].every(k=>Number.isFinite(p[k])))return;
      const key=hit?'player:'+hit.targetId:`wall:${p.x.toFixed(2)}:${p.y.toFixed(2)}:${p.z.toFixed(2)}`;
      if(hitKeys.has(key)||hitKeys.size>=8)return;hitKeys.add(key);
      const opt={position:p,entityId:'impact:'+e.id,channel:'auto',priority:2,eventId:identity&&identity+':impact'};
      if(hit){
        play(choose(hit.effect==='shield'?SOUND_GROUPS['ricochet.metal']:['weapons/bullet_hit1.wav','weapons/bullet_hit2.wav'],random),{...opt,volume:1,attenuation:hit.effect==='shield'?.8:1});
      }else{
        if(impact.soundSurface?.texture?.toLowerCase()==='sky')return;
        const material=impact.soundSurface?.material||impact.material||'concrete',entry=MATERIAL_HITS[material]||MATERIAL_HITS.concrete;
        play(choose(entry[1],random),{...opt,volume:entry[0],pitch:96+Math.min(15,Math.floor(random()*16))});
        if(random()<.5){
          const sounds=['metal','vent'].includes(material)?SOUND_GROUPS['ricochet.metal']:[...SOUND_GROUPS['ricochet.generic'],'weapons/ric_conc-1.wav'];
          play(choose(sounds,random),{...opt,eventId:identity&&identity+':ricochet',volume:1});
        }
      }
    }
  }
  function localMovement(events){for(const e of events){localSteps++;play(e.sound,{volume:e.volume,entityId:'local-movement',channel:'body',priority:15});}}
  return {handle,localMovement,reset,diagnostics:()=>({received,routed,duplicates,localSteps,remoteSteps,rememberedEvents:seen.size,rememberedShots:shots.size})};
}
