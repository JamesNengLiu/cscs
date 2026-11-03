import {GUNS} from './arsenal.js';
import {ownedWeapons,GRENADE_IDS} from './shop.js';
import {allowsPlayerActions} from './round-state.js';
import {validInputSequence} from './input-protocol.js';
import {WEAPON_ACTION_LIMIT} from './weapon-action-order.js';
export const WEAPON_SWITCH_VIEW_PROTOCOL=1;
const visualWeapon=id=>id==='knife'||Object.hasOwn(GUNS,id||'');
export function resolveViewWeapon(p,key,bomb,fallback){
 if(!p)return null;const owned=ownedWeapons(p,bomb);
 if(key==='last')key=owned.includes(p.previousWeapon)&&p.previousWeapon!==p.weapon?p.previousWeapon:fallback;
 if(typeof key==='number'||/^[1-5]$/.test(String(key))){const gs=GRENADE_IDS.filter(g=>p.grenades?.[g]>0);key=({1:p.primary||(p.shield?p.pistol:null),2:p.pistol,3:'knife',4:gs[(gs.indexOf(p.weapon)+1)%gs.length],5:owned.includes('c4')?'c4':null})[key];}
 return typeof key==='string'&&owned.includes(key)&&key!==p.weapon?key:null;
}
// Local model selection only. No authoritative inventory, aiming or movement writes.
export function createWeaponSwitchView({now=()=>performance.now(),maxAgeMs=1500}={}){
 let round=-1,sequence=0,confirmed=0,pending=[],anchor=null,stateTime=-Infinity,supported=false,serial=0,deployAt=0;
 const counters={predicted:0,confirmed:0,rejected:0,expired:0};
 function cancel(){confirmed=sequence;pending=[];anchor=null;}
 function reset(){round=-1;sequence=confirmed=0;pending=[];anchor=null;stateTime=-Infinity;supported=false;serial++;}
 function expire(){if(pending.some(a=>now()-a.at>maxAgeMs)||anchor&&now()-anchor.at>maxAgeMs){cancel();serial++;counters.expired++;}}
 function selection(p,bomb){let result=anchor?{...p,weapon:anchor.weapon,previousWeapon:anchor.previousWeapon}:p;for(const a of pending){const key=resolveViewWeapon(result,a.weapon,bomb,a.fallbackWeapon);if(key)result={...result,previousWeapon:result.weapon,weapon:key};}return result;}
 return {
  reset,cancel,
  observe(p,{round:nextRound,time,protocol,phase}={}){
   if(!Number.isFinite(time)||nextRound<round)return;
   if(nextRound!==round){reset();round=nextRound;}
   supported=protocol===WEAPON_SWITCH_VIEW_PROTOCOL;
   if(time<stateTime)return;stateTime=time;
   if(!supported||!p?.alive||!allowsPlayerActions(phase)){cancel();return;}
   const watermark=p.weaponSwitchAckRound===round&&validInputSequence(p.weaponSwitchAckSeq)&&p.weaponSwitchAckSeq<=sequence?p.weaponSwitchAckSeq:0;
   confirmed=Math.max(confirmed,watermark);pending=pending.filter(a=>a.seq>confirmed);
   if(anchor&&time>=anchor.time)anchor=null;expire();
  },
  intent(message,p,{round:currentRound,phase,bomb,canQueue=true}={}){
   expire();if(message.type!=='equip'||!supported||currentRound!==round||!p?.alive||!allowsPlayerActions(phase)||!canQueue||pending.length>=WEAPON_ACTION_LIMIT||sequence>=2147483647)return message;
   const from=selection(p,bomb),key=resolveViewWeapon(from,message.weapon,bomb,message.fallbackWeapon);
   // Utilities retain their existing pin/release prediction and input rules.
   if(!visualWeapon(from?.weapon)||!visualWeapon(key)){if(key)cancel();return message;}
   const seq=++sequence;pending.push({seq,weapon:message.weapon,fallbackWeapon:message.fallbackWeapon,fence:null,at:now()});serial++;deployAt=now()/1000;counters.predicted++;
   return {...message,switchSeq:seq,round};
  },
  sent(message){const a=pending.find(a=>a.seq===message.switchSeq);if(a&&Number.isInteger(message.afterInputSeq)&&message.afterInputSeq>=0)a.fence=message.afterInputSeq;},
  confirm(ack){
   if(ack?.type!=='scopeAck'||ack.weaponSwitchViewProtocol!==WEAPON_SWITCH_VIEW_PROTOCOL||ack.switchRound!==round||!validInputSequence(ack.switchSeq)||ack.switchSeq<=confirmed||!Number.isFinite(ack.time)||!pending.some(a=>a.seq===ack.switchSeq))return false;
   confirmed=ack.switchSeq;pending=pending.filter(a=>a.seq>confirmed);
   if(ack.time>=stateTime)anchor={weapon:ack.weapon,previousWeapon:ack.previousWeapon,time:ack.time,ok:!!ack.ok,zoom:ack.zoom||90,at:now()};
   counters[ack.ok?'confirmed':'rejected']++;return true;
  },
  blocksShot(seq){expire();return Boolean(anchor||pending.some(a=>a.fence!==null&&seq>a.fence));},
  view(p,{bomb}={}){
   expire();if(!p?.alive||!pending.length&&!anchor)return p;
   const selected=selection(p,bomb),id=selected?.weapon;if(!visualWeapon(id))return p;
   const entry=p.inventory?.[id];return {...p,weapon:id,previousWeapon:selected.previousWeapon,zoom:!pending.length&&anchor?.ok===false?anchor.zoom:90,shieldRaised:false,reloadAt:0,reloading:false,grenadePhase:'',action:'',
    ammo:id===p.weapon?p.ammo:entry?.ammo||0,silenced:id===p.weapon?p.silenced:!!entry?.silenced,burstMode:id===p.weapon?p.burstMode:!!entry?.burstMode,
    lastShot:-100,weaponShotAt:-100,weaponShotToken:`switch:${round}:${serial}`,weaponDeployToken:`switch:${round}:${serial}`,weaponDeployAt:deployAt,weaponLocalClock:true,weaponSwitchPredicted:true};
  },
  diagnostics:()=>({supported,round,pending:pending.length,awaitingSnapshot:!!anchor,sequence,confirmedSeq:confirmed,...counters})
 };
}
