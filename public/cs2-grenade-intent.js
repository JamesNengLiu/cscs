// Experimental adapter: same protocol/order, without indirect legacy BSP imports.
import {validInputSequence} from './cs2-input-protocol.js';
import {grenadeActionPhase} from './grenade-state.js';
import {CS2_GRENADE_CONTROLS,grenadeEventTime,validThrowButtons,createThrowControl,changeThrowButtons,throwStrength,throwMode} from './cs2-grenade-controls.js';
import {CS2_GRENADE_PROFILE} from './cs2-grenade-profile.js';
import {allowsPlayerActions} from './round-state.js';

export const GRENADE_PROTOCOL='grenade-intent-v2';
export const GRENADE_KINDS=Object.freeze(['hegrenade','flashbang','smokegrenade']);
export function normalizeGrenadeIntent(raw,round){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.round!==round||!validInputSequence(raw.seq))return null;
  if(!['press','buttons','release','cancel'].includes(raw.kind))return null;
  const elapsed=raw.elapsed;
  if(elapsed!==undefined&&(!Number.isFinite(elapsed)||elapsed<0||elapsed>CS2_GRENADE_CONTROLS.maxActionSeconds||raw.kind==='press'&&elapsed!==0))return null;
  if(raw.kind==='cancel')return raw.actionId===0||validInputSequence(raw.actionId)?{round,seq:raw.seq,kind:'cancel',actionId:raw.actionId}:null;
  if(!validInputSequence(raw.actionId)||!GRENADE_KINDS.includes(raw.weapon))return null;
  if(raw.kind==='press'&&raw.actionId!==raw.seq)return null;
  const buttons=raw.buttons===undefined?(raw.kind==='press'?1:raw.kind==='release'?0:null):raw.buttons;
  if(raw.kind==='release'?buttons!==0:!validThrowButtons(buttons))return null;
  if(raw.kind==='release'&&(!Number.isFinite(raw.yaw)||!Number.isFinite(raw.pitch)))return null;
  if(raw.kind==='release'&&raw.afterInputSeq!==undefined&&raw.afterInputSeq!==0&&!validInputSequence(raw.afterInputSeq))return null;
  return {round,seq:raw.seq,kind:raw.kind,actionId:raw.actionId,weapon:raw.weapon,buttons,elapsed,
    ...(raw.kind==='release'&&raw.afterInputSeq!==undefined?{afterInputSeq:raw.afterInputSeq}:{}),
    yaw:Number.isFinite(raw.yaw)?Math.atan2(Math.sin(raw.yaw),Math.cos(raw.yaw)):0,
    pitch:Math.max(-Math.PI/2,Math.min(Math.PI/2,Number.isFinite(raw.pitch)?raw.pitch:0))};
}

// Cosmetic local prediction only. No inventory, position, trajectory or damage authority.
// Animation timestamps live on a monotonic local clock, never the snapshot clock.
export function createGrenadePrediction({send=()=>{},now=()=>performance.now()/1000}={}){
  let round=-1,sequence=0,current=null,supported=false,confirmedSeq=0,profileId=null;
  const counters={predicted:0,confirmed:0,rejected:0,cancelled:0};
  function reset(nextRound=round){round=nextRound;sequence=0;current=null;confirmedSeq=0;supported=false;profileId=null;}
  function launchDelay(){return profileId===CS2_GRENADE_PROFILE.id&&CS2_GRENADE_PROFILE.trajectoryVersion===1?CS2_GRENADE_PROFILE.releaseDelaySeconds:0;}
  function phase(at=now()){
    if(!current||current.cancelled)return '';
    return grenadeActionPhase(current.startedAt,at,current.released,current.thrownAt);
  }
  function cancelVisual(rejected=false){if(current&&!current.cancelled){current.cancelled=true;counters[rejected?'rejected':'cancelled']++;}}
  // Relative edge time preserves button-release windows if reliable delivery or
  // a weapon input fence batches several edges into one authority tick. It is
  // cosmetic/control timing only, never an authority launch or physics clock.
  function edgeElapsed(at){
    current.elapsed=Math.min(CS2_GRENADE_CONTROLS.maxActionSeconds,Math.max(current.elapsed,Number.isFinite(at)?at-current.pressedAt:0,0));
    return current.elapsed;
  }
  function confirm(ack){
    if(!ack||ack.round!==round||!Number.isSafeInteger(ack.seq)||ack.seq<=confirmedSeq||ack.seq>sequence)return;
    confirmedSeq=ack.seq;
    if(current&&ack.actionId===current.id){
      if(['rejected','cancelled'].includes(ack.status))cancelVisual(ack.status==='rejected');
      else if(!current.confirmed){current.confirmed=true;counters.confirmed++;}
    }
  }
  function observe(p,{round:nextRound,stateTime,phase:gamePhase,grenadeProfileId}={}){
    if(nextRound!==round)reset(nextRound);
    if(typeof grenadeProfileId==='string')profileId=grenadeProfileId;
    supported=p?.grenadeProtocol===GRENADE_PROTOCOL;
    if(!supported||!p?.alive||!allowsPlayerActions(gamePhase)){cancelVisual();return;}
    if(current&&p.weapon!==current.weapon){cancelVisual();current=null;}
    if(current&&p.grenadeRejectedActionId===current.id)cancelVisual(true);
    if(current&&p.grenadeActionId===current.id&&p.grenadeAckSeq>=current.id){
      if(p.grenadeIntentStatus==='cancelled')cancelVisual();
      else if(!current.confirmed){current.confirmed=true;counters.confirmed++;}
      if(p.grenadeLaunchDeferred&&!current.launchDeferred){current.launchDeferred=true;current.spawnAt+=launchDelay();}
    }
    // Delayed confirmations never rewrite a predicted animation's start or release.
    void stateTime;
  }
  function press(p,{round:nextRound,stateTime,phase:gamePhase,yaw=0,pitch=0,buttons=1,eventTimeStamp,grenadeProfileId}={}){
    if(nextRound!==round)reset(nextRound);
    if(typeof grenadeProfileId==='string')profileId=grenadeProfileId;
    supported=p?.grenadeProtocol===GRENADE_PROTOCOL;
    if(!supported||!p?.alive||!allowsPlayerActions(gamePhase)||!GRENADE_KINDS.includes(p.weapon)||!(p.grenades?.[p.weapon]>0)||p.shieldRaised||!validThrowButtons(buttons))return false;
    if(current&&!current.cancelled&&!current.released)return false;
    const at=now(),pressedAt=grenadeEventTime(eventTimeStamp,at),previous=current;
    const ready=Math.max(at,at+Math.max(0,(p.nextAttackAt||0)-(Number.isFinite(stateTime)?stateTime:0)),
      previous&&!previous.cancelled&&previous.released?previous.spawnAt+CS2_GRENADE_CONTROLS.recoverSeconds:at);
    const id=++sequence;
    current={id,weapon:p.weapon,pressedAt,elapsed:0,startedAt:ready,released:false,thrownAt:0,spawnAt:0,launchDeferred:false,cancelled:false,confirmed:false,control:createThrowControl(buttons,pressedAt)};counters.predicted++;
    send({type:'grenadeIntent',round,seq:id,actionId:id,kind:'press',weapon:p.weapon,buttons,elapsed:0,yaw,pitch});return true;
  }
  function buttons(p,mask,context={}){
    if(!validThrowButtons(mask,{released:true}))return false;
    if(context.round!==undefined&&context.round!==round)reset(context.round);
    if(current&&!current.cancelled&&!current.released&&(!p?.alive||p.weapon!==current.weapon||!allowsPlayerActions(context.phase))){cancel();return false;}
    if(!mask)return release(context);
    if(!current||current.cancelled||current.released)return press(p,{...context,buttons:mask});
    if(!supported||p?.weapon!==current.weapon||!p.alive||!allowsPlayerActions(context.phase)){cancel();return false;}
    if(current.control.buttons===mask)return false;
    const elapsed=edgeElapsed(grenadeEventTime(context.eventTimeStamp,now()));current.control=changeThrowButtons(current.control,mask,current.pressedAt+elapsed);
    send({type:'grenadeIntent',round,seq:++sequence,actionId:current.id,kind:'buttons',weapon:current.weapon,buttons:mask,elapsed});return true;
  }
  function release({yaw=0,pitch=0,eventTimeStamp,afterInputSeq}={}){
    if(!supported||!current||current.cancelled||current.released)return false;
    const at=now(),elapsed=edgeElapsed(grenadeEventTime(eventTimeStamp,at));current.control=changeThrowButtons(current.control,0,current.pressedAt+elapsed);current.released=true;current.thrownAt=Math.max(at,current.startedAt+CS2_GRENADE_CONTROLS.pinSeconds);
    current.spawnAt=current.thrownAt+launchDelay();
    if(at+1e-8<current.startedAt)cancelVisual();
    send({type:'grenadeIntent',round,seq:++sequence,actionId:current.id,kind:'release',weapon:current.weapon,buttons:0,elapsed,yaw,pitch,...(afterInputSeq===0||validInputSequence(afterInputSeq)?{afterInputSeq}:{})});return true;
  }
  function cancel({preserveReleased=false}={}){
    if(!supported||!current||current.cancelled)return;
    const detached=preserveReleased&&launchDelay()>0&&current.released&&phase()==='throw';
    cancelVisual();if(detached)return;send({type:'grenadeIntent',round,seq:++sequence,actionId:current.id,kind:'cancel'});
  }
  function view(p,at=now()){
    if(!supported||!current||p?.weapon!==current.weapon)return p;
    const localPhase=phase(at),strength=throwStrength(current.control,at);
    return {...p,grenadePhase:localPhase,grenadeStartedAt:current.startedAt,grenadeThrownAt:current.thrownAt,
      grenadeReleased:current.released,grenadeStrength:strength,grenadeMode:throwMode(strength),grenadeButtons:current.control.buttons,grenadeAnimationToken:`${round}:${current.id}`,grenadePredictedSpawnAt:current.spawnAt,grenadePredicted:true};
  }
  return {press,buttons,release,cancel,observe,confirm,reset,view,
    diagnostics:()=>({protocol:supported?GRENADE_PROTOCOL:null,round,sequence,confirmedSeq,actionId:current?.id||0,
      phase:phase(),buttons:current?.control.buttons||0,strength:throwStrength(current?.control,now()),mode:throwMode(throwStrength(current?.control,now())),startedAt:current?.startedAt||0,thrownAt:current?.thrownAt||0,predictedSpawnAt:current?.spawnAt||0,launchDeferred:!!current?.launchDeferred,cancelled:!!current?.cancelled,...counters})};
}
