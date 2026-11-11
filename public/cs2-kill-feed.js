import {killWeaponInfo,createKillIcon,createHeadshotIcon} from './cs2-kill-icons.js';

const playerName=(value,fallback)=>typeof value==='string'?Array.from(value.replace(/[\u0000-\u001f\u007f]/g,'')).slice(0,64).join('').trim()||fallback:fallback;
const playerId=value=>typeof value==='string'&&value?value:null;
const team=value=>value==='T'||value==='CT'?value:'';

// The fatal event is the source of truth. A later snapshot may already show a
// different gun, a disconnected attacker, or two players with the same name.
export function killNotice(event,myId=null){
 const weapon=killWeaponInfo(event.weapon),attackerId=playerId(event.attackerId),victimId=playerId(event.victimId);
 const suicide=event.suicide===true||attackerId!==null&&attackerId===victimId;
 const environment=event.environment===true||!attackerId&&(!event.attacker||event.attacker==='环境')&&weapon.kind!=='gun';
 const headshot=event.headshot===true&&weapon.kind==='gun'&&!environment&&!suicide;
 const attacker=playerName(event.attacker,'环境'),victim=playerName(event.victim,'玩家');
 const localDeath=!!myId&&victimId===myId,localKill=!!myId&&attackerId===myId&&!suicide&&!environment;
 const reason=suicide?'自杀':environment?'环境死亡':'击杀';
 const description=suicide||environment?`${victim} · ${reason} · ${weapon.label}`:`${attacker} 使用 ${weapon.label}${headshot?' 爆头':''}击杀 ${victim}`;
 return {weapon,attacker,victim,attackerTeam:team(event.attackerTeam??event.team),victimTeam:team(event.victimTeam),suicide,environment,headshot,localDeath,localKill,description};
}

export function createKillFeed(element,{maxEntries=6,durationMs=6000,signal,schedule=globalThis.setTimeout.bind(globalThis),cancel=globalThis.clearTimeout.bind(globalThis)}={}){
 if(!element?.ownerDocument||!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>8||!Number.isFinite(durationMs)||durationMs<=0)throw new TypeError('Invalid kill feed');
 const document=element.ownerDocument,entries=new Map();let disposed=false;
 element.setAttribute('role','log');element.setAttribute('aria-label','击杀信息');element.setAttribute('aria-live','polite');element.setAttribute('aria-relevant','additions');
 function remove(row){if(!entries.has(row))return;cancel(entries.get(row));entries.delete(row);row.remove();}
 function clear(){for(const row of entries.keys())remove(row);}
 function dispose(){if(disposed)return;disposed=true;clear();signal?.removeEventListener('abort',dispose);}
 signal?.addEventListener('abort',dispose,{once:true});if(signal?.aborted)dispose();
 const name=(value,side,whichTeam)=>{const node=document.createElement('bdi');node.className=`kill-feed-name kill-feed-${side}`;node.dataset.team=whichTeam;node.dir='auto';node.textContent=value;return node;};
 return {
  add(event,{myId=null}={}){
   if(disposed||event?.type!=='kill')return null;
   const notice=killNotice(event,myId),row=document.createElement('div');row.className='kill-feed-entry';
   row.classList.toggle('is-local-kill',notice.localKill);row.classList.toggle('is-local-death',notice.localDeath);
   row.dataset.weapon=notice.weapon.id;row.dataset.headshot=String(notice.headshot);row.dataset.cause=notice.suicide?'suicide':notice.environment?'environment':'kill';
   row.setAttribute('role','group');row.setAttribute('aria-label',notice.description);row.title=notice.description;
   if(!notice.suicide&&!notice.environment)row.append(name(notice.attacker,'attacker',notice.attackerTeam));
   const weapon=document.createElement('span');weapon.className='kill-feed-weapon';weapon.append(createKillIcon(document,notice.weapon.id));
   const label=document.createElement('span');label.className='kill-feed-weapon-label';label.textContent=notice.weapon.label;weapon.append(label);row.append(weapon);
   if(notice.headshot){const head=document.createElement('span');head.className='kill-feed-headshot';head.title='爆头击杀';head.append(createHeadshotIcon(document));row.append(head);}
   row.append(name(notice.victim,'victim',notice.victimTeam));
   while(entries.size>=maxEntries)remove(entries.keys().next().value);
   // Older notices stay above newer ones, without reordering the whole HUD.
   element.append(row);entries.set(row,schedule(()=>remove(row),durationMs));return row;
  },
  clear,dispose,
 };
}
