// Experimental adapter: same protocol/order, without indirect legacy BSP imports.
import {SCOPE_VIEW_PROTOCOL,validScopeSequence} from './public/awp-view.js';
import {isWeaponAction} from './public/cs2-weapon-action-order.js';
import {MAX_INPUT_BATCH,MAX_INPUT_QUEUE,normalizeInputCommand,validInputSequence} from './public/cs2-input-protocol.js';
import {WEAPON_SWITCH_VIEW_PROTOCOL} from './public/cs2-weapon-switch-view.js';
// Original authoritative operations, with an optional cosmetic acknowledgement.
export function applyScopeAwareAction(game,id,message,{onAck=()=>{},onError=()=>{}}={}){
 const p=game.players.get(id),tracked=message.scopeSeq!==undefined,switchTracked=message.switchSeq!==undefined;
 if(tracked&&(!validScopeSequence(message.scopeSeq)||message.round!==game.round))throw Error('Invalid scoped action');
 if(switchTracked&&(message.type!=='equip'||!validInputSequence(message.switchSeq)||message.round!==game.round))throw Error('Invalid switch view action');
 if(!isWeaponAction(message.type))throw Error('Unknown weapon action');
 const reply=ok=>{
  if(switchTracked&&p&&message.round===game.round){if(p.weaponSwitchAckRound!==game.round)p.weaponSwitchAckSeq=0;p.weaponSwitchAckRound=game.round;p.weaponSwitchAckSeq=Math.max(p.weaponSwitchAckSeq||0,message.switchSeq);}
  return tracked||switchTracked?{type:'scopeAck',protocol:SCOPE_VIEW_PROTOCOL,...(tracked?{scopeSeq:message.scopeSeq}:{}),...(switchTracked?{weaponSwitchViewProtocol:WEAPON_SWITCH_VIEW_PROTOCOL,switchSeq:message.switchSeq,switchRound:message.round,previousWeapon:p?.previousWeapon}:{}),kind:message.type,round:game.round,time:game.time,ok:!!ok,weapon:p?.weapon,zoom:p?.zoom||90,nextSecondaryAt:p?.nextSecondaryAt||0,resumeZoomAt:p?.resumeZoomAt||0,resumeZoom:p?.resumeZoom||90}:null;
 };
 if(message.afterInputSeq!==undefined){
  const seq=message.afterInputSeq;
  if(!p||message.round!==game.round||(seq!==0&&!validInputSequence(seq))||seq>p.ackInputSeq+MAX_INPUT_QUEUE||!Array.isArray(message.commands)||message.commands.length>MAX_INPUT_BATCH)throw Error('Invalid weapon input barrier');
  if(message.commands.some(raw=>{const c=normalizeInputCommand(raw,game.round);return !c||c.seq>seq;}))throw Error('Invalid weapon input commands');
  const accepted=[];game.inputBatch(id,message.commands,accepted);game.lagComp?.view(id,accepted,{viewTime:message.viewTime,interpDelayMs:message.interpDelayMs,viewAgeMs:message.viewAgeMs,now:game.time,round:game.round});
  const action={type:message.type,weapon:message.weapon,fallbackWeapon:message.fallbackWeapon,round:message.round,...(switchTracked?{switchSeq:message.switchSeq}:{}),...(tracked?{scopeSeq:message.scopeSeq}:{})};
  game.queueInputAction(id,{seq,round:message.round},allowed=>{try{const ack=allowed?applyScopeAwareAction(game,id,action):reply(false);if(ack)onAck(ack);}catch(error){onError(error);}});return null;
 }
 let ok=false;
 if(message.type==='secondary')ok=game.secondary(id);
 else if(message.type==='equip'){
  ok=game.equip(id,message.weapon);
  // A thrown grenade or dropped gun may no longer be owned. Preserve the
  // client's last valid fallback, but only after resolving the ordered Q.
  if(!ok&&message.weapon==='last'&&typeof message.fallbackWeapon==='string')ok=game.equip(id,message.fallbackWeapon);
 }
 else if(message.type==='drop')ok=game.drop(id);
 else if(message.type==='reload'){const before=p?.reloadAt||0;game.reload(id);ok=(p?.reloadAt||0)>before;}
 else throw Error('Unknown weapon action');
 return reply(ok);
}
