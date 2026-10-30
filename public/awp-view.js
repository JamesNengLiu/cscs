// Cosmetic AWP zoom prediction only. Never edits ammunition, aim, movement or gun state.
import {allowsPlayerActions} from './round-state.js';
export const SCOPE_VIEW_PROTOCOL='awp-view-v1';
export const validScopeSequence=n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647;
const zoomOf=p=>[40,10].includes(p?.zoom)?p.zoom:90;
export function createAwpView(){
 let round=-1,weapon=null,supported=false,sequence=0,confirmed=0,stateTime=-Infinity,ackTime=-Infinity;
 let base={zoom:90,nextSecondaryAt:0,resumeZoomAt:0,resumeZoom:90},pending=[],shot=null;
 const counters={predicted:0,confirmed:0,rejected:0,shotExits:0,shotRollbacks:0,expired:0};
 function reset(){round=-1;weapon=null;supported=false;sequence=confirmed=0;stateTime=ackTime=-Infinity;base={zoom:90,nextSecondaryAt:0,resumeZoomAt:0,resumeZoom:90};pending=[];shot=null;}
 function expire(now){const n=pending.length;pending=pending.filter(a=>now-a.at<=5000);counters.expired+=n-pending.length;if(shot&&now-shot.at>5000){shot=null;counters.expired++;}}
 function display(time,now){expire(now);if(shot)return 90;let result=base.zoom;if(base.resumeZoomAt>0&&time>=base.resumeZoomAt)result=base.resumeZoom;for(const a of pending)if(a.zoom!==null)result=a.zoom;return [40,10].includes(result)?result:90;}
 return {
  reset,
  observe(player,{round:nextRound,stateTime:time,protocol,nowMs=performance.now()}={}){
   if(!Number.isFinite(time)||nextRound<round)return;
   if(nextRound!==round){reset();round=nextRound;}
   supported=protocol===SCOPE_VIEW_PROTOCOL;
   if(time<stateTime||time<=ackTime)return;stateTime=time;
   if(weapon!==player?.weapon||!player?.alive){pending=[];shot=null;weapon=player?.weapon;}
   if(!supported||weapon!=='awp'||!player?.alive){pending=[];shot=null;}
   base={zoom:zoomOf(player),nextSecondaryAt:player?.nextSecondaryAt||0,resumeZoomAt:player?.resumeZoomAt||0,resumeZoom:player?.resumeZoom||90};
   if(shot&&(player.ackInputSeq||0)>=shot.seq){
    if((player.shotsFired||0)<shot.ordinal)counters.shotRollbacks++;
    confirmed=Math.max(confirmed,shot.cutoff);pending=pending.filter(a=>a.seq>shot.cutoff);shot=null;
   }
   pending=pending.filter(a=>a.seq>confirmed);expire(nowMs);
  },
  intent(message,player,{round:currentRound,stateTime:time,phase,nowMs=performance.now(),canSwitch=false}={}){
   if(!supported||currentRound!==round||player?.weapon!=='awp'||!player.alive||!['secondary','equip','reload','drop'].includes(message.type)||!allowsPlayerActions(phase))return message;
   expire(nowMs);if(pending.length>=16||sequence>=2147483647)return message;
   const seq=++sequence,current=display(time,nowMs),nextReady=Math.max(base.nextSecondaryAt,shot?.nextReady||0,...pending.map(a=>a.nextReady||0));let zoom=null,nextAt=nextReady;
   if(message.type==='secondary'&&!player.reloadAt&&!player.shieldRaised&&time+1e-8>=nextReady){zoom=current===90?40:current===40?10:90;nextAt=time+.3;}
   if((message.type==='equip'&&canSwitch)||(message.type==='drop')||(message.type==='reload'&&!player.reloadAt&&player.ammo<10&&player.reserve>0)){zoom=90;shot=null;base.resumeZoomAt=0;}
   pending.push({seq,kind:message.type,zoom,nextReady:nextAt,at:nowMs});if(zoom!==null)counters.predicted++;
   return {...message,scopeSeq:seq,round};
  },
  shot(event,{stateTime:time,nowMs=performance.now()}={}){
   if(!supported||weapon!=='awp'||event?.weapon!=='awp'||!validScopeSequence(event.seq)||!validScopeSequence(event.ordinal)||display(time,nowMs)===90)return;
   shot={seq:event.seq,ordinal:event.ordinal,cutoff:sequence,at:nowMs,nextReady:time+1.45};base.nextSecondaryAt=Math.max(base.nextSecondaryAt,time+1.45);counters.shotExits++;
  },
  confirm(ack){
   if(ack?.type!=='scopeAck'||ack.protocol!==SCOPE_VIEW_PROTOCOL||ack.round!==round||!validScopeSequence(ack.scopeSeq)||ack.scopeSeq<=confirmed||!Number.isFinite(ack.time))return false;
   const known=pending.some(a=>a.seq===ack.scopeSeq);if(!known)return false;
   confirmed=ack.scopeSeq;pending=pending.filter(a=>a.seq>confirmed);
   // A delayed reliable ACK still retires the local intent, but cannot replace
   // a newer authoritative snapshot (e.g. a death or completed reload).
   if(ack.time>=stateTime){ackTime=Math.max(ackTime,ack.time);base={zoom:ack.weapon==='awp'?zoomOf(ack):90,nextSecondaryAt:ack.nextSecondaryAt||0,resumeZoomAt:ack.resumeZoomAt||0,resumeZoom:ack.resumeZoom||90};
   if(ack.weapon!=='awp')shot=null;}
   if(ack.ok)counters.confirmed++;else counters.rejected++;return true;
  },
  zoom(player,{stateTime:time=stateTime,nowMs=performance.now()}={}){return supported&&player?.alive&&player.weapon==='awp'?display(time,nowMs):Math.max(10,Math.min(90,Number(player?.zoom)||90));},
  diagnostics:()=>({supported,round,pending:pending.length,shotPending:!!shot,confirmedSeq:confirmed,...counters}),
 };
}
