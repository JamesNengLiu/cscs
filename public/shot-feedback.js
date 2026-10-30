import {GUNS} from './arsenal.js';
import {updateWeapon} from './weapons.js';
import {consumeGunShot} from './gun-state.js';
import {INPUT_DT,MAX_INPUT_QUEUE} from './input-protocol.js';
const POSE=['x','y','z','yaw','pitch','vx','vy','vz','grounded','groundPlayer','crouch','duckAmount','walk'];
const poseCopy=p=>Object.fromEntries(POSE.filter(k=>p?.[k]!==undefined).map(k=>[k,p[k]]));
// Predict only a copied weapon state and presentation. No traces, health,
// inventory, authoritative ammunition or world hit effects are produced here.
export function createShotFeedback({maxAgeMs=1200}={}){
  let history=[],pending=[],weapon=null,round=null,serial=0,view=null,lastVisual=null,lastAuth=0;
  let known=new Map(),confirmed=new Set(),canceled=[],predicted=0,suppressed=0;
  const key=(w,n)=>`${round}:${w}:${n}`;
  function reset(){history=[];pending=[];known.clear();confirmed.clear();canceled=[];weapon=round=null;view=lastVisual=null;lastAuth=0;}
  function identity(player,currentRound){
    if(round!==currentRound){reset();round=currentRound;}
    if(weapon!==player?.weapon){history=[];pending=[];view=lastVisual=null;weapon=player?.weapon;}
  }
  function prune(now){
    history=history.filter(c=>now-c.at<=maxAgeMs);
    for(const [k,s]of known)if(now-s.at>maxAgeMs)known.delete(k);
    pending=pending.filter(s=>now-s.at<=maxAgeMs);
    canceled=canceled.filter(s=>now-s.at<=maxAgeMs);
  }
  function present(s,at){
    if(s.played)return null;s.played=true;s.at=at;s.token=`shot:${round}:${++serial}`;
    if(s.weapon===weapon)lastVisual=s;
    return {...s};
  }
  function remember(copy,command,follow,profile){
    const k=key(copy.weapon,copy.shotsFired);let s=known.get(k);
    if(!s){s={seq:command.seq,round,weapon:copy.weapon,ordinal:copy.shotsFired,at:command.at,follow,played:false,auth:false,silenced:!!copy.silenced};known.set(k,s);}
    s.recoilYaw=profile.recoilYaw||0;s.recoilPitch=profile.recoilPitch||0;s.ammo=copy.ammo;
    if(known.size>256)known.delete(known.keys().next().value);return s;
  }
  function rebuild(player,stateTime){
    const copy={...player,input:{...player.input}},shots=[];let cursor=stateTime;
    history=history.filter(c=>c.seq>(player.ackInputSeq||0)).slice(-MAX_INPUT_QUEUE);
    for(let i=0;i<history.length;i++){
      const c=history[i],at=c.fixed?stateTime+(i+1)*INPUT_DT:Math.max(cursor,c.time);
      Object.assign(copy,c.pose);copy.input=c.input;
      // Decay uses bounded simulation-sized steps even in legacy sparse callers.
      let elapsed=Math.max(0,at-cursor);while(elapsed>1e-8){const dt=Math.min(INPUT_DT,elapsed);updateWeapon(copy,dt,at-elapsed+dt);elapsed-=dt;}
      cursor=at;const w=GUNS[copy.weapon];
      if(copy.resumeZoomAt&&at>=copy.resumeZoomAt){copy.zoom=copy.resumeZoom||90;copy.resumeZoomAt=0;}
      if(copy.reloadAt&&at+1e-8>=copy.reloadAt&&w){const n=Math.min(w.clip-copy.ammo,copy.reserve,w.reloadStyle==='per-shell'?1:Infinity);copy.ammo+=n;copy.reserve-=n;copy.reloadAt=w.reloadStyle==='per-shell'&&copy.ammo<w.clip&&copy.reserve>0?copy.reloadAt+w.reload:0;}
      if(copy.alive&&!copy.shieldRaised){
        if(copy.burstRemaining>0&&at+1e-8>=copy.nextBurstAt){const p=consumeGunShot(copy,at,true,()=>.5);if(p){copy.burstRemaining--;shots.push(remember(copy,c,true,p));}else copy.burstRemaining=0;copy.nextBurstAt=at+.1;}
        if(c.input.fire&&!copy.action&&(w?.automatic||copy.burstMode||!copy.fireHeld)){const p=consumeGunShot(copy,at,false,()=>.5);if(p)shots.push(remember(copy,c,false,p));}
      }
      copy.fireHeld=Boolean(c.input.fire);
    }
    pending=shots;view=copy;return shots;
  }
  return {
    reset,
    cancel(){
      for(const [k,s]of known)if(!s.auth){canceled.push(s);known.delete(k);}
      canceled=canceled.slice(-256);history=[];pending=[];view=lastVisual=null;
    },
    observe(player,{round:currentRound,stateTime=0,nowMs=performance.now()}={}){
      const initial=round!==currentRound;identity(player,currentRound);prune(nowMs);
      for(const [k,s]of known)if(!s.auth&&s.seq<=(player.ackInputSeq||0)&&s.ordinal>(player.shotsFired||0))known.delete(k);
      const ordinal=player.shotsFired||0;let result=null;
      if(ordinal>lastAuth&&GUNS[player.weapon]){
        const k=key(player.weapon,ordinal);let s=known.get(k);
        if(!s){s={seq:player.ackInputSeq||0,round,weapon:player.weapon,ordinal,at:nowMs,silenced:!!player.silenced,recoilYaw:player.recoilYaw||0,recoilPitch:player.recoilPitch||0};known.set(k,s);}
        s.auth=true;s.serverTime=player.lastShot;
        if(initial)s.played=true;else result=present(s,nowMs);
      }
      lastAuth=Math.max(lastAuth,ordinal);rebuild(player,stateTime);return result;
    },
    sample({player,pose,input,seq,round:currentRound,time,stateTime=time,fixedStep=false,nowMs,allowed}){
      identity(player,currentRound);prune(nowMs);
      if(!allowed||!player?.alive||!GUNS[player.weapon]||player.shieldRaised){view=null;return null;}
      if(!Number.isSafeInteger(seq)||seq<=0||!Number.isFinite(stateTime)||(!fixedStep&&!Number.isFinite(time))||history.some(c=>c.seq===seq))return null;
      history.push({seq,round:currentRound,input:{...input},pose:poseCopy(pose||player),time,at:nowMs,fixed:fixedStep});
      const shots=rebuild(player,stateTime),fresh=shots.find(s=>s.seq===seq&&!s.played);
      if(!fresh)return null;const result=present(fresh,nowMs);if(result)predicted++;return result;
    },
    confirm(event,nowMs){
      if(round!==null&&event.round!==undefined&&event.round!==round)return false;
      prune(nowMs);const id=event.shotId||`${event.round}:${event.inputSeq}:${event.weapon}`;
      if(confirmed.has(id))return false;confirmed.add(id);if(confirmed.size>256)confirmed.delete(confirmed.values().next().value);
      const ordinal=event.shotOrdinal;
      const matches=p=>p.weapon===event.weapon&&p.round===event.round&&p.seq<=event.inputSeq&&(!Number.isSafeInteger(ordinal)||p.ordinal===ordinal);
      // A canceled prediction may still be confirmed in flight. It must not
      // consume the presentation of a newer shot reusing the rejected ordinal.
      let s=canceled.find(matches);
      s||=Number.isSafeInteger(ordinal)?known.get(key(event.weapon,ordinal)):null;
      if(s&&Number.isFinite(event.inputSeq)&&s.seq>event.inputSeq)s=null;
      s||=[...known.values()].find(p=>p.auth&&p.weapon===event.weapon&&Number.isFinite(event.time)&&Math.abs(p.serverTime-event.time)<1e-8);
      s||=pending.find(p=>!p.auth&&p.weapon===event.weapon&&p.round===event.round&&p.seq<=event.inputSeq);
      if(s){s.auth=true;if(s.played){suppressed++;return false;}present(s,nowMs);return true;}
      s={seq:event.inputSeq,round:event.round,weapon:event.weapon,ordinal,at:nowMs,auth:true,silenced:!!event.silenced,recoilYaw:event.recoilYaw||0,recoilPitch:event.recoilPitch||0};
      if(Number.isSafeInteger(ordinal))known.set(key(event.weapon,ordinal),s);present(s,nowMs);return true;
    },
    presentation(player){
      if(!GUNS[player?.weapon])return player;
      const shot=lastVisual?.weapon===player.weapon?lastVisual:null;
      return {...player,ammo:view?.weapon===player.weapon?view.ammo:player.ammo,weaponLocalClock:true,weaponShotToken:shot?.token||`base:${round}:${player.weapon}`,weaponShotAt:shot?shot.at/1000:-100};
    },
    authoritative(){view=null;},
    view:()=>view,
    diagnostics:()=>({pending:pending.filter(p=>!p.auth).length,predicted,suppressed,history:history.length}),
  };
}
