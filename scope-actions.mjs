import {SCOPE_VIEW_PROTOCOL,validScopeSequence} from './public/awp-view.js';
// Original authoritative operations, with an optional cosmetic acknowledgement.
export function applyScopeAwareAction(game,id,message){
 const p=game.players.get(id),tracked=message.scopeSeq!==undefined;
 if(tracked&&(!validScopeSequence(message.scopeSeq)||message.round!==game.round))throw Error('Invalid scoped action');
 let ok=false;
 if(message.type==='secondary')ok=game.secondary(id);
 else if(message.type==='equip')ok=game.equip(id,message.weapon);
 else if(message.type==='drop')ok=game.drop(id);
 else if(message.type==='reload'){const before=p?.reloadAt||0;game.reload(id);ok=(p?.reloadAt||0)>before;}
 else throw Error('Unknown weapon action');
 return tracked?{type:'scopeAck',protocol:SCOPE_VIEW_PROTOCOL,scopeSeq:message.scopeSeq,kind:message.type,round:game.round,time:game.time,ok:!!ok,weapon:p?.weapon,zoom:p?.zoom||90,nextSecondaryAt:p?.nextSecondaryAt||0,resumeZoomAt:p?.resumeZoomAt||0,resumeZoom:p?.resumeZoom||90}:null;
}
