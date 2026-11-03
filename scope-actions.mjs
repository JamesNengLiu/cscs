import {SCOPE_VIEW_PROTOCOL,validScopeSequence} from './public/awp-view.js';
import {isWeaponAction} from './public/weapon-action-order.js';
import {MAX_INPUT_BATCH,MAX_INPUT_QUEUE,normalizeInputCommand,validInputSequence} from './public/input-protocol.js';
// Original authoritative operations, with an optional cosmetic acknowledgement.
export function applyScopeAwareAction(game,id,message,{onAck=()=>{},onError=()=>{}}={}){
 const p=game.players.get(id),tracked=message.scopeSeq!==undefined;
 if(tracked&&(!validScopeSequence(message.scopeSeq)||message.round!==game.round))throw Error('Invalid scoped action');
 if(!isWeaponAction(message.type))throw Error('Unknown weapon action');
 const reply=ok=>tracked?{type:'scopeAck',protocol:SCOPE_VIEW_PROTOCOL,scopeSeq:message.scopeSeq,kind:message.type,round:game.round,time:game.time,ok:!!ok,weapon:p?.weapon,zoom:p?.zoom||90,nextSecondaryAt:p?.nextSecondaryAt||0,resumeZoomAt:p?.resumeZoomAt||0,resumeZoom:p?.resumeZoom||90}:null;
 if(message.afterInputSeq!==undefined){
  const seq=message.afterInputSeq;
  if(!p||message.round!==game.round||(seq!==0&&!validInputSequence(seq))||seq>p.ackInputSeq+MAX_INPUT_QUEUE||!Array.isArray(message.commands)||message.commands.length>MAX_INPUT_BATCH)throw Error('Invalid weapon input barrier');
  if(message.commands.some(raw=>{const c=normalizeInputCommand(raw,game.round);return !c||c.seq>seq;}))throw Error('Invalid weapon input commands');
  const accepted=[];game.inputBatch(id,message.commands,accepted);game.lagComp?.view(id,accepted,{viewTime:message.viewTime,interpDelayMs:message.interpDelayMs,viewAgeMs:message.viewAgeMs,now:game.time,round:game.round});
  const action={type:message.type,weapon:message.weapon,round:message.round,...(tracked?{scopeSeq:message.scopeSeq}:{})};
  game.queueInputAction(id,{seq,round:message.round},allowed=>{try{const ack=allowed?applyScopeAwareAction(game,id,action):reply(false);if(ack)onAck(ack);}catch(error){onError(error);}});return null;
 }
 let ok=false;
 if(message.type==='secondary')ok=game.secondary(id);
 else if(message.type==='equip')ok=game.equip(id,message.weapon);
 else if(message.type==='drop')ok=game.drop(id);
 else if(message.type==='reload'){const before=p?.reloadAt||0;game.reload(id);ok=(p?.reloadAt||0)>before;}
 else throw Error('Unknown weapon action');
 return reply(ok);
}
