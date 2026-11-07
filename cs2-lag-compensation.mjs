import {interpolateLocomotion,copyLocomotion} from './public/player-locomotion.js';
import {validInputSequence,MAX_INPUT_BATCH,INPUT_DT} from './public/cs2-input-protocol.js';
// Independent experiment history also retains the render/hitbox rig identity.
// Bounded, server-validated hitscan rewind. Never rewinds the live world or trusts client positions.
export function createLagCompensation({maxRewindSeconds=.2,maxFrames=32}={}){
  const frames=[],clients=new Map();let lookups=0,rewinds=0,rejectedTimes=0,activeRound=null,roundResets=0,ignoredCommands=0;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const client=id=>{if(!clients.has(id))clients.set(id,{rttMs:0,views:new Map(),latestSeq:0});return clients.get(id);};
  function enterRound(round){if(!Number.isSafeInteger(round)||round<0||activeRound!==null&&round<activeRound)return false;
    if(round!==activeRound){if(activeRound!==null)roundResets++;activeRound=round;frames.length=0;for(const c of clients.values()){c.views.clear();c.latestSeq=0;}}return true;}
  return {
    record({time,round,players}){if(!Number.isFinite(time)||!enterRound(round))return;if(frames.at(-1)?.time>=time)return;frames.push({time,round,players:new Map(players.map(p=>[p.id,{id:p.id,team:p.team,character:p.character,diedAt:p.diedAt,x:p.x,y:p.y,z:p.z,yaw:p.yaw,gaitYaw:p.gaitYaw,pitch:p.pitch,weapon:p.weapon,vx:p.vx,vz:p.vz,grounded:p.grounded,walk:p.walk,gaitDistance:p.gaitDistance,nativeGaitPhase:p.nativeGaitPhase,playerLocomotion:copyLocomotion(p.playerLocomotion),airTime:p.airTime,flinchAt:p.flinchAt,flinchHead:p.flinchHead,poseFromSequence:p.poseFromSequence,poseFromFrame:p.poseFromFrame,poseFromTime:p.poseFromTime,poseChangedAt:p.poseChangedAt,lastShot:p.lastShot,reloadAt:p.reloadAt,reloadStartedAt:p.reloadStartedAt,crouch:p.crouch,alive:p.alive,shield:p.shield,shieldRaised:p.shieldRaised,playedRound:p.playedRound}]))});while(frames.length>maxFrames||time-frames[0].time>maxRewindSeconds+.1)frames.shift();},
    timing(id,rttMs){if(Number.isFinite(rttMs))client(id).rttMs=clamp(rttMs,0,1000);},
    view(id,commands,{viewTime,interpDelayMs,viewAgeMs,now,round}){
      if(!Number.isFinite(now)||!Array.isArray(commands)||!enterRound(round))return;const c=client(id);let rejected=false;
      const batch=commands.slice(0,MAX_INPUT_BATCH);
      for(const command of batch)if((command?.round??command?.input?.round??round)===round&&validInputSequence(command?.seq))c.latestSeq=Math.max(c.latestSeq,command.seq);
      for(const command of batch){
        const commandRound=command?.round??command?.input?.round??round;
        if(commandRound!==round||!validInputSequence(command?.seq)){ignoredCommands++;continue;}if(c.views.has(command.seq))continue;
        const stamp=Number.isFinite(command.viewTime)?command.viewTime:viewTime,rawDelay=Number.isFinite(command.interpDelayMs)?command.interpDelayMs:interpDelayMs;
        const rawAge=Number.isFinite(command.viewAgeMs)?command.viewAgeMs:viewAgeMs,renderAge=clamp(Number.isFinite(rawAge)?rawAge:0,0,maxRewindSeconds*1000)/1000;
        const delay=clamp(Number.isFinite(rawDelay)?rawDelay:67,50,160)/1000,expected=now-c.rttMs/2000-delay-renderAge;
        // Retransmitted older fixed commands legitimately describe older views.
        // Sequence age grants only bounded past slack, never future time or a
        // larger rewind window. The wire caller supplies accepted commands only.
        const age=Math.min(maxRewindSeconds,Math.max(0,c.latestSeq-command.seq)*INPUT_DT);
        // Snapshot clock estimation can include the measured downlink age.
        // Admit that bounded past uncertainty while retaining the same future
        // tolerance and absolute max rewind; no client clock sets simulation time.
        const earliest=expected-c.rttMs/2000-age-.06;
        const valid=Number.isFinite(stamp)&&stamp<=now+1e-9&&stamp>=now-maxRewindSeconds-1e-9&&stamp>=earliest-1e-9&&stamp<=expected+.06+1e-9;
        if(!valid)rejected=true;const time=clamp(valid?stamp:expected,now-maxRewindSeconds,now);c.views.set(command.seq,{time,round,at:now});
      }
      if(rejected)rejectedTimes++;
      while(c.views.size>128)c.views.delete(c.views.keys().next().value);
    },
    targetTime(id,seq,now,round){const c=clients.get(id),v=c?.views.get(seq);if(!v||v.round!==round||now-v.at>.5)return null;return clamp(v.time,now-maxRewindSeconds,now);},
    pose(id,time,round){lookups++;if(!Number.isFinite(time)||!frames.length)return null;
      const eligible=frames.filter(f=>f.round===round);if(!eligible.length||time<eligible[0].time)return null;
      let a=eligible[0],b=a;for(const f of eligible){if(f.time<=time)a=f;if(f.time>=time){b=f;break;}b=f;}
      const p=a.players.get(id),q=b.players.get(id);if(!p?.alive||!q?.alive||p.playedRound!==q.playedRound)return null;
      if(Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z)>3)return null;
      const t=a.time===b.time?0:clamp((time-a.time)/(b.time-a.time),0,1),pose={...p};for(const k of ['x','y','z','pitch','gaitDistance','airTime','nativeGaitPhase'])if(Number.isFinite(p[k])&&Number.isFinite(q[k])&&(k!=='airTime'||p.grounded===q.grounded))pose[k]=p[k]+(q[k]-p[k])*t;
      pose.playerLocomotion=interpolateLocomotion(p.playerLocomotion,q.playerLocomotion,t);
      pose.yaw=p.yaw+Math.atan2(Math.sin(q.yaw-p.yaw),Math.cos(q.yaw-p.yaw))*t;if(Number.isFinite(p.gaitYaw)&&Number.isFinite(q.gaitYaw))pose.gaitYaw=p.gaitYaw+Math.atan2(Math.sin(q.gaitYaw-p.gaitYaw),Math.cos(q.gaitYaw-p.gaitYaw))*t;rewinds++;return pose;
    },
    remove(id){clients.delete(id);},diagnostics(){return {maxRewindMs:maxRewindSeconds*1000,frames:frames.length,clients:clients.size,lookups,rewinds,rejectedTimes,roundResets,ignoredCommands};},
  };
}
