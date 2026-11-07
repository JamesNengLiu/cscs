// Experimental adapter: same protocol/order, without indirect legacy BSP imports.
import {buildInputBatch} from './cs2-input-protocol.js';
export const WEAPON_ACTION_PROTOCOL=1,WEAPON_ACTION_LIMIT=16;
export const isWeaponAction=type=>['equip','drop','reload','secondary'].includes(type);
// Keep a click that has not reached its fixed sample ahead of a weapon action.
// This never creates an extra simulation command or waits for a server round trip.
export function createWeaponActionOrder(){
 let pending=[];
 function barrier(message,c){return {...message,round:c.round,afterInputSeq:c.seq,commands:buildInputBatch(c.commands,c.round,c.ack).commands,viewTime:c.viewTime,interpDelayMs:c.interpDelayMs};}
 return {
  get pending(){return pending.length;},cancel(){pending=[];},
  prepare(message,c){if(!c.supported||!isWeaponAction(message.type))return message;
   if(c.firePending||pending.length){if(pending.length<WEAPON_ACTION_LIMIT)pending.push({message:{...message},round:c.round});return null;}
   return barrier(message,c);
  },
  flush(c){if(!c.supported||!c.active){pending=[];return [];}if(c.firePending)return [];
   const ready=pending;pending=[];return ready.filter(a=>a.round===c.round).map(a=>barrier(a.message,c));
  },
  diagnostics:()=>({pending:pending.length,limit:WEAPON_ACTION_LIMIT})
 };
}
