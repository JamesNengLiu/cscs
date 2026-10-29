import {GUNS} from './arsenal.js';
import {shotProfile,updateWeapon} from './weapons.js';
import {shotInterval,nextShotDeadline} from './weapon-feel.js';
// Presentation prediction only. Never emits hit markers, damage, authoritative ammo or world rays.
export function createShotFeedback({maxAgeMs=1200}={}){
  let pending=[],weapon=null,round=null,held=false,nextAt=0,serial=0,burstLeft=0,burstAt=0,confirmed=new Set(),predicted=0,suppressed=0,view=null;
  const prune=now=>{pending=pending.filter(p=>now-p.at<=maxAgeMs);};
  return {
    reset(){pending=[];weapon=null;round=null;held=false;nextAt=0;burstLeft=0;confirmed.clear();view=null;},
    sample({player,input,seq,round:currentRound,time,stateTime=time,nowMs,allowed}){
      prune(nowMs);const w=GUNS[player?.weapon];if(weapon!==player?.weapon||round!==currentRound){pending=[];weapon=player?.weapon;round=currentRound;held=false;nextAt=0;burstLeft=0;confirmed.clear();}
      const down=!!input.fire,edge=down&&!held;held=down;
      if(!allowed||!player?.alive||!w||player.shieldRaised){burstLeft=0;view=null;return null;}
      pending=pending.filter(p=>p.seq>(player?.ackInputSeq||0));
      const copy={...player,input:{fire:down}};let cursor=Math.min(time,stateTime);
      for(const entry of pending){updateWeapon(copy,Math.max(0,entry.time-cursor),entry.time);shotProfile(copy,()=>.5,entry.time,entry.follow);copy.lastShot=entry.time;cursor=entry.time;}
      updateWeapon(copy,Math.max(0,time-cursor),time);view={recoilYaw:copy.recoilYaw||0,recoilPitch:copy.recoilPitch||0};
      const available=(player.ammo||0)-pending.filter(p=>p.seq>(player.ackInputSeq||0)).length;
      if(available<=0||(player.reloadAt&&w.reloadStyle!=='per-shell')||time<(player.nextAttackAt||0))return null;
      const burst=player.burstMode&&['glock18','famas'].includes(weapon),follow=burstLeft>0&&time>=burstAt;
      if(!follow&&(!down||(!w.automatic&&!burst&&!edge)||time+1e-6<Math.max(nextAt,player.nextShotAt||0)))return null;
      const interval=shotInterval(player);
      if(follow){burstLeft--;burstAt=time+.1;}else{nextAt=nextShotDeadline(nextAt,time,interval,w.automatic&&!burst&&!edge);if(burst){burstLeft=Math.min(2,available-1);burstAt=time+(weapon==='glock18'?.1:.05);}}
      const profile=shotProfile(copy,()=>.5,time,follow),entry={serial:++serial,seq,weapon,round,at:nowMs,time,follow};pending.push(entry);if(pending.length>32)pending.shift();predicted++;
      view={recoilYaw:profile.recoilYaw||0,recoilPitch:profile.recoilPitch||0};
      return {...entry,recoilYaw:profile.recoilYaw,recoilPitch:profile.recoilPitch};
    },
    confirm(event,nowMs){prune(nowMs);const key=event.shotId||`${event.round}:${event.inputSeq}:${event.weapon}`;if(confirmed.has(key))return false;confirmed.add(key);if(confirmed.size>256)confirmed.delete(confirmed.values().next().value);
      const index=pending.findIndex(p=>!p.confirmed&&p.weapon===event.weapon&&p.round===event.round&&p.seq<=event.inputSeq);if(index<0)return true;pending[index].confirmed=true;suppressed++;return false;
    },
    authoritative(){view=null;},
    view(){return view;},
    diagnostics(){return {pending:pending.filter(p=>!p.confirmed).length,predicted,suppressed};},
  };
}
