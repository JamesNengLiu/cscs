import {GUNS} from './arsenal.js';
import {shotProfile} from './weapons.js';
// Presentation prediction only. Never emits hit markers, damage, authoritative ammo or world rays.
export function createShotFeedback({maxAgeMs=1200}={}){
  let pending=[],weapon=null,round=null,held=false,nextAt=0,serial=0,burstLeft=0,burstAt=0,confirmed=new Set(),predicted=0,suppressed=0;
  const prune=now=>{pending=pending.filter(p=>now-p.at<=maxAgeMs);};
  return {
    reset(){pending=[];weapon=null;round=null;held=false;nextAt=0;burstLeft=0;confirmed.clear();},
    sample({player,input,seq,round:currentRound,time,nowMs,allowed}){
      prune(nowMs);const w=GUNS[player?.weapon];if(weapon!==player?.weapon||round!==currentRound){pending=[];weapon=player?.weapon;round=currentRound;held=false;nextAt=0;burstLeft=0;confirmed.clear();}
      const down=!!input.fire,edge=down&&!held;held=down;
      if(!allowed||!player?.alive||!w||player.shieldRaised){burstLeft=0;return null;}
      const available=(player.ammo||0)-pending.filter(p=>p.seq>(player.ackInputSeq||0)).length;
      if(available<=0||(player.reloadAt&&w.reloadStyle!=='per-shell')||time<(player.nextAttackAt||0))return null;
      const burst=player.burstMode&&['glock18','famas'].includes(weapon),follow=burstLeft>0&&time>=burstAt;
      if(!follow&&(!down||(!w.automatic&&!edge)||time+1e-6<nextAt))return null;
      const interval=burst?(weapon==='glock18'?.5:.55):w.interval;
      if(follow){burstLeft--;burstAt=time+(weapon==='glock18'?.1:.05);}else{nextAt=time+interval;if(burst){burstLeft=Math.min(2,available-1);burstAt=time+(weapon==='glock18'?.1:.05);}}
      const copy={...player};const profile=shotProfile(copy,()=>.5),entry={serial:++serial,seq,weapon,round,at:nowMs};pending.push(entry);if(pending.length>32)pending.shift();predicted++;
      return {...entry,recoilYaw:profile.recoilYaw,recoilPitch:profile.recoilPitch};
    },
    confirm(event,nowMs){prune(nowMs);const key=event.shotId||`${event.round}:${event.inputSeq}:${event.weapon}`;if(confirmed.has(key))return false;confirmed.add(key);if(confirmed.size>256)confirmed.delete(confirmed.values().next().value);
      const index=pending.findIndex(p=>p.weapon===event.weapon&&p.round===event.round&&p.seq<=event.inputSeq);if(index<0)return true;pending.splice(index,1);suppressed++;return false;
    },
    diagnostics(){return {pending:pending.length,predicted,suppressed};},
  };
}
