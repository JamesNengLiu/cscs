import {validInputSequence} from './input-protocol.js';
import {GRENADE_TIMING,grenadeActionPhase} from './grenade-state.js';
import {allowsPlayerActions} from './round-state.js';

export const GRENADE_PROTOCOL='grenade-intent-v1';
export const GRENADE_KINDS=Object.freeze(['hegrenade','flashbang','smokegrenade']);
export function normalizeGrenadeIntent(raw,round){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.round!==round||!validInputSequence(raw.seq))return null;
  if(!['press','release','cancel'].includes(raw.kind))return null;
  if(raw.kind==='cancel')return raw.actionId===0||validInputSequence(raw.actionId)?{round,seq:raw.seq,kind:'cancel',actionId:raw.actionId}:null;
  if(!validInputSequence(raw.actionId)||!GRENADE_KINDS.includes(raw.weapon))return null;
  if(raw.kind==='press'&&raw.actionId!==raw.seq)return null;
  if(raw.kind==='release'&&(!Number.isFinite(raw.yaw)||!Number.isFinite(raw.pitch)))return null;
  return {round,seq:raw.seq,kind:raw.kind,actionId:raw.actionId,weapon:raw.weapon,
    yaw:Number.isFinite(raw.yaw)?Math.atan2(Math.sin(raw.yaw),Math.cos(raw.yaw)):0,
    pitch:Math.max(-Math.PI/2,Math.min(Math.PI/2,Number.isFinite(raw.pitch)?raw.pitch:0))};
}

// Cosmetic local prediction only. No inventory, position, trajectory or damage authority.
// Animation timestamps live on a monotonic local clock, never the snapshot clock.
export function createGrenadePrediction({send=()=>{},now=()=>performance.now()/1000}={}){
  let round=-1,sequence=0,current=null,supported=false,confirmedSeq=0;
  const counters={predicted:0,confirmed:0,rejected:0,cancelled:0};
  function reset(nextRound=round){round=nextRound;sequence=0;current=null;confirmedSeq=0;supported=false;}
  function phase(at=now()){
    if(!current||current.cancelled)return '';
    return grenadeActionPhase(current.startedAt,at,current.released,current.thrownAt);
  }
  function cancelVisual(rejected=false){if(current&&!current.cancelled){current.cancelled=true;counters[rejected?'rejected':'cancelled']++;}}
  function confirm(ack){
    if(!ack||ack.round!==round||!Number.isSafeInteger(ack.seq)||ack.seq<=confirmedSeq||ack.seq>sequence)return;
    confirmedSeq=ack.seq;
    if(current&&ack.actionId===current.id){
      if(['rejected','cancelled'].includes(ack.status))cancelVisual(ack.status==='rejected');
      else if(!current.confirmed){current.confirmed=true;counters.confirmed++;}
    }
  }
  function observe(p,{round:nextRound,stateTime,phase:gamePhase}={}){
    if(nextRound!==round)reset(nextRound);
    supported=p?.grenadeProtocol===GRENADE_PROTOCOL;
    if(!supported||!p?.alive||!allowsPlayerActions(gamePhase)){cancelVisual();return;}
    if(current&&p.weapon!==current.weapon){cancelVisual();current=null;}
    if(current&&p.grenadeRejectedActionId===current.id)cancelVisual(true);
    if(current&&p.grenadeActionId===current.id&&p.grenadeAckSeq>=current.id){
      if(p.grenadeIntentStatus==='cancelled')cancelVisual();
      else if(!current.confirmed){current.confirmed=true;counters.confirmed++;}
    }
    // Delayed confirmations never rewrite a predicted animation's start or release.
    void stateTime;
  }
  function press(p,{round:nextRound,stateTime,phase:gamePhase,yaw=0,pitch=0}={}){
    if(nextRound!==round)reset(nextRound);
    supported=p?.grenadeProtocol===GRENADE_PROTOCOL;
    if(!supported||!p?.alive||!allowsPlayerActions(gamePhase)||!GRENADE_KINDS.includes(p.weapon)||!(p.grenades?.[p.weapon]>0)||p.shieldRaised)return false;
    if(current&&!current.cancelled&&!current.released)return false;
    const at=now(),previous=current;
    const ready=Math.max(at,at+Math.max(0,(p.nextAttackAt||0)-stateTime),
      previous&&!previous.cancelled&&previous.released?previous.thrownAt+GRENADE_TIMING.recoverSeconds:at);
    const id=++sequence;
    current={id,weapon:p.weapon,startedAt:ready,released:false,thrownAt:0,cancelled:false,confirmed:false};counters.predicted++;
    send({type:'grenadeIntent',round,seq:id,actionId:id,kind:'press',weapon:p.weapon,yaw,pitch});return true;
  }
  function release({yaw=0,pitch=0}={}){
    if(!supported||!current||current.cancelled||current.released)return false;
    const at=now();current.released=true;current.thrownAt=Math.max(at,current.startedAt+GRENADE_TIMING.pinSeconds);
    if(at+1e-8<current.startedAt)cancelVisual();
    send({type:'grenadeIntent',round,seq:++sequence,actionId:current.id,kind:'release',weapon:current.weapon,yaw,pitch});return true;
  }
  function cancel(){
    if(!supported||!current||current.cancelled)return;
    cancelVisual();send({type:'grenadeIntent',round,seq:++sequence,actionId:current.id,kind:'cancel'});
  }
  function view(p,at=now()){
    if(!supported||!current||p?.weapon!==current.weapon)return p;
    const localPhase=phase(at);
    return {...p,grenadePhase:localPhase,grenadeStartedAt:current.startedAt,grenadeThrownAt:current.thrownAt,
      grenadeReleased:current.released,grenadeAnimationToken:`${round}:${current.id}`,grenadePredicted:true};
  }
  return {press,release,cancel,observe,confirm,reset,view,
    diagnostics:()=>({protocol:supported?GRENADE_PROTOCOL:null,round,sequence,confirmedSeq,actionId:current?.id||0,
      phase:phase(),startedAt:current?.startedAt||0,thrownAt:current?.thrownAt||0,cancelled:!!current?.cancelled,...counters})};
}
