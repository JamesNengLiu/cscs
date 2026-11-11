// Presentation only: weapon prediction, shot ordering and ray punch keep their
// original clocks. This clock only samples the camera's copied punch state.
import {sampleReferencePunch,rebaseReferencePunch} from './cs2-recoil-state.js';

const STEP=1/60,EPS=1e-8;
const FIELDS=['recoilPitch','recoilYaw','cs2RecoilPitchVelocity','cs2RecoilYawVelocity','cs2PunchVersion','cs2PunchTime','cs2PunchBaseAt','cs2PunchBasePitch','cs2PunchBaseYaw','cs2PunchBasePitchVelocity','cs2PunchBaseYawVelocity','cs2PunchEvaluatedPitch','cs2PunchEvaluatedYaw'];
const finite=Number.isFinite;
const energy=p=>Math.hypot(p?.recoilPitch||0,p?.recoilYaw||0,p?.cs2RecoilPitchVelocity||0,p?.cs2RecoilYawVelocity||0);
function referenceCopy(p){
  if(p?.cs2PunchVersion!==2||!['recoilPitch','recoilYaw','cs2RecoilPitchVelocity','cs2RecoilYawVelocity','cs2PunchTime'].every(k=>finite(p[k])))return null;
  const copy=Object.fromEntries(FIELDS.filter(k=>p[k]!==undefined).map(k=>[k,p[k]]));
  const complete=['cs2PunchBaseAt','cs2PunchBasePitch','cs2PunchBaseYaw','cs2PunchBasePitchVelocity','cs2PunchBaseYawVelocity'].every(k=>finite(copy[k]));
  if(!complete||copy.recoilPitch!==copy.cs2PunchEvaluatedPitch||copy.recoilYaw!==copy.cs2PunchEvaluatedYaw)rebaseReferencePunch(copy,copy.cs2PunchTime);
  return copy;
}
const atTime=(base,time)=>sampleReferencePunch({...base,cs2PunchTime:time},0);
const authorityCopy=p=>({ack:p?.ackInputSeq,ordinal:p?.shotsFired,hp:p?.hp,flinch:p?.flinchAt});
function impulseCopy(p){
  const fields=['at','deltaPitch','deltaYaw','deltaPitchVelocity','deltaYawVelocity'];
  return p&&fields.every(k=>finite(p[k]))?Object.fromEntries(fields.map(k=>[k,p[k]])):null;
}

export function createRecoilPresentationClock({sampleRecoil,maxFrameGapMs=50,maxPhaseMs=250}={}){
  if(typeof sampleRecoil!=='function')throw new TypeError('A pure recoil sampler is required');
  let pending=[],last=null,epoch=null,currentRound=null,lastAuthority=null,highestOrdinal=0,overflow=false;
  const seen=new Set(),unconfirmed=new Map();
  const counts={samples:0,presentedShots:0,corrections:0,impulses:0,duplicates:0,reanchors:0,rejected:0,unknown:0,resets:0};
  let status={mode:'inactive',reason:'initial'};
  function clear(reason){pending=[];last=epoch=null;currentRound=null;lastAuthority=null;highestOrdinal=0;unconfirmed.clear();overflow=false;counts.resets++;status={mode:'inactive',reason};}
  function remember(markers,authority){
    for(const marker of markers){
      if(Number.isSafeInteger(marker.ordinal))highestOrdinal=Math.max(highestOrdinal,marker.ordinal);
      if(Number.isSafeInteger(marker.seq)&&marker.seq>0&&Number.isSafeInteger(marker.ordinal))unconfirmed.set(marker.token,marker);
    }
    if(Number.isSafeInteger(authority?.shotsFired))highestOrdinal=Math.max(highestOrdinal,authority.shotsFired);
    for(const [key,marker]of unconfirmed)if((authority?.ackInputSeq||0)>=marker.seq&&(authority?.shotsFired||0)>=marker.ordinal)unconfirmed.delete(key);
    while(unconfirmed.size>256)unconfirmed.delete(unconfirmed.keys().next().value);
  }
  function adopt(source,raw,{round,nowMs,authority},markers,reason='normal'){
    epoch=null;currentRound=round;lastAuthority=authorityCopy(authority);remember(markers,authority);
    if(Number.isSafeInteger(source?.shotsFired))highestOrdinal=Math.max(highestOrdinal,source.shotsFired);
    last={nowMs,rawAt:raw.cs2PunchTime,renderAt:raw.cs2PunchTime,source:referenceCopy(source),result:{...raw}};
    status={mode:'source',reason,rawAt:raw.cs2PunchTime,renderAt:raw.cs2PunchTime,phaseMs:0,extraStepMs:0};
    return raw;
  }
  return {
    reset(reason='reset'){clear(reason);},
    noteShot(marker){
      if(!marker?.token)return false;
      const key=String(marker.round)+':'+marker.token;
      if(seen.has(key)){counts.duplicates++;return false;}
      seen.add(key);while(seen.size>256)seen.delete(seen.values().next().value);
      counts.presentedShots++;
      pending.push({token:marker.token,round:marker.round,weapon:marker.weapon,seq:marker.seq,ordinal:marker.ordinal,impulse:impulseCopy(marker.impulse)});
      if(pending.length>32){pending.shift();overflow=true;}
      return true;
    },
    sample(source,{round,nowMs,fractionSeconds=0,active=true,authority=source}={}){
      source=source||{};const raw=sampleRecoil(source,fractionSeconds),basis=referenceCopy(source);
      const markers=pending.filter(marker=>marker.round===round);pending=[];counts.samples++;
      if(!active||!finite(nowMs)||!basis||!finite(raw.cs2PunchTime)){
        if(last||epoch||markers.length||unconfirmed.size)clear(!active?'inactive':'unsupported-source');
        return raw;
      }
      const context={round,nowMs,authority};
      if(!last||currentRound!==round){clear('round-or-initial');return adopt(source,raw,context,markers,'initial');}
      const elapsedMs=nowMs-last.nowMs;
      const sameAuthority=Object.entries(authorityCopy(authority)).every(([key,value])=>value===lastAuthority?.[key]);
      if(elapsedMs===0&&!markers.length&&raw.cs2PunchTime===last.rawAt&&sameAuthority)return {...last.result};
      if(!(elapsedMs>0)||elapsedMs>=maxFrameGapMs){clear('frame-gap');return adopt(source,raw,context,markers,'frame-gap');}
      const rejected=[...unconfirmed.values()].some(marker=>(authority?.ackInputSeq||0)>=marker.seq&&(authority?.shotsFired||0)<marker.ordinal);
      const hit=(finite(lastAuthority?.hp)&&finite(authority?.hp)&&authority.hp<lastAuthority.hp)||(finite(lastAuthority?.flinch)&&finite(authority?.flinchAt)&&authority.flinchAt!==lastAuthority.flinch);
      const incomingOrdinal=Math.max(highestOrdinal,...markers.map(marker=>Number.isSafeInteger(marker.ordinal)?marker.ordinal:0));
      const unknownAuthority=Number.isSafeInteger(authority?.shotsFired)&&authority.shotsFired>Math.max(incomingOrdinal,lastAuthority?.ordinal||0);
      const unknownSource=Number.isSafeInteger(source.shotsFired)&&source.shotsFired>incomingOrdinal;
      const unknownMarker=markers.some(marker=>!marker.impulse);
      if(rejected||hit||unknownAuthority||unknownSource||unknownMarker||overflow){
        const reason=rejected?'prediction-rejected':hit?'external-hit':overflow?'marker-overflow':'untracked-shot';
        if(rejected)counts.rejected++;if(unknownAuthority||unknownSource||unknownMarker)counts.unknown++;counts.reanchors++;
        clear(reason);return adopt(source,raw,context,markers,reason);
      }
      remember(markers,authority);lastAuthority=authorityCopy(authority);
      const elapsed=elapsedMs/1000,extra=raw.cs2PunchTime-last.rawAt-elapsed;
      if(!epoch&&(extra>STEP*.5||raw.cs2PunchTime<last.rawAt-EPS)&&(energy(last.result)>EPS||energy(raw)>EPS)){
        epoch={base:last.source,at:last.renderAt,wallMs:last.nowMs};counts.corrections++;
      }
      if(!epoch)return adopt(source,raw,context,[], 'normal');
      const renderAt=epoch.at+(nowMs-epoch.wallMs)/1000,phaseMs=(raw.cs2PunchTime-renderAt)*1000;
      if(!epoch.base||Math.abs(phaseMs)>maxPhaseMs){counts.reanchors++;clear('phase-limit');return adopt(source,raw,context,markers,'phase-limit');}
      const ordered=markers.map((marker,index)=>({...marker,index})).sort((a,b)=>a.impulse.at-b.impulse.at||a.index-b.index);
      for(const marker of ordered){
        // Preserve the shot's original within-frame fraction. A new impulse
        // changes velocity (or the legacy angle), never the elapsed old punch.
        const shotAt=marker.impulse.at-phaseMs/1000;
        if(shotAt<last.renderAt-EPS||shotAt<epoch.base.cs2PunchBaseAt-EPS||shotAt>renderAt+EPS){
          counts.reanchors++;clear('late-impulse');return adopt(source,raw,context,markers,'late-impulse');
        }
        const value=atTime(epoch.base,Math.min(renderAt,shotAt)),next={...value,cs2PunchVersion:2};
        next.recoilPitch+=marker.impulse.deltaPitch;next.recoilYaw+=marker.impulse.deltaYaw;
        next.cs2RecoilPitchVelocity+=marker.impulse.deltaPitchVelocity;next.cs2RecoilYawVelocity+=marker.impulse.deltaYawVelocity;
        rebaseReferencePunch(next,Math.min(renderAt,shotAt));epoch.base=next;counts.impulses++;
      }
      if(renderAt<epoch.base.cs2PunchBaseAt-EPS){counts.reanchors++;clear('base-ahead');return adopt(source,raw,context,markers,'base-ahead');}
      const value=atTime(epoch.base,renderAt);
      if(energy(value)<EPS&&energy(raw)<EPS){counts.reanchors++;return adopt(source,raw,context,[],'settled');}
      last={nowMs,rawAt:raw.cs2PunchTime,renderAt,source:basis,result:{...value}};
      status={mode:'wall-clock',reason:'continuous-punch',rawAt:raw.cs2PunchTime,renderAt,phaseMs,extraStepMs:extra*1000};
      return value;
    },
    diagnostics:()=>({version:1,...counts,...status,pendingMarkers:pending.length,unconfirmedMarkers:unconfirmed.size}),
  };
}
