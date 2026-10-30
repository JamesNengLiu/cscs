// Bounded, server-validated hitscan rewind. Never rewinds the live world or trusts client positions.
export function createLagCompensation({maxRewindSeconds=.2,maxFrames=32}={}){
  const frames=[],clients=new Map();let lookups=0,rewinds=0,rejectedTimes=0;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const client=id=>{if(!clients.has(id))clients.set(id,{rttMs:0,views:new Map()});return clients.get(id);};
  return {
    record({time,round,players}){if(!Number.isFinite(time))return;if(frames.at(-1)?.round!==round)frames.length=0;if(frames.at(-1)?.time>=time)return;frames.push({time,round,players:new Map(players.map(p=>[p.id,{id:p.id,x:p.x,y:p.y,z:p.z,yaw:p.yaw,gaitYaw:p.gaitYaw,pitch:p.pitch,weapon:p.weapon,vx:p.vx,vz:p.vz,grounded:p.grounded,walk:p.walk,gaitDistance:p.gaitDistance,airTime:p.airTime,flinchAt:p.flinchAt,flinchHead:p.flinchHead,poseFromSequence:p.poseFromSequence,poseFromFrame:p.poseFromFrame,poseChangedAt:p.poseChangedAt,lastShot:p.lastShot,reloadAt:p.reloadAt,reloadStartedAt:p.reloadStartedAt,crouch:p.crouch,alive:p.alive,shield:p.shield,shieldRaised:p.shieldRaised,playedRound:p.playedRound}]))});while(frames.length>maxFrames||time-frames[0].time>maxRewindSeconds+.1)frames.shift();},
    timing(id,rttMs){if(Number.isFinite(rttMs))client(id).rttMs=clamp(rttMs,0,1000);},
    view(id,commands,{viewTime,interpDelayMs,now,round}){
      const c=client(id),delay=clamp(Number.isFinite(interpDelayMs)?interpDelayMs:67,50,160)/1000,expected=now-c.rttMs/2000-delay;
      const valid=Number.isFinite(viewTime)&&viewTime<=now&&viewTime>=now-maxRewindSeconds&&Math.abs(viewTime-expected)<=.06;
      if(!valid)rejectedTimes++;
      const time=clamp(valid?viewTime:expected,now-maxRewindSeconds,now);
      for(const command of commands)if(Number.isSafeInteger(command.seq)&&command.seq>0&&!c.views.has(command.seq))c.views.set(command.seq,{time,round,at:now});
      while(c.views.size>128)c.views.delete(c.views.keys().next().value);
    },
    targetTime(id,seq,now,round){const c=clients.get(id),v=c?.views.get(seq);if(!v||v.round!==round||now-v.at>.5)return null;return clamp(v.time,now-maxRewindSeconds,now);},
    pose(id,time,round){lookups++;if(!Number.isFinite(time)||!frames.length)return null;
      const eligible=frames.filter(f=>f.round===round);if(!eligible.length||time<eligible[0].time)return null;
      let a=eligible[0],b=a;for(const f of eligible){if(f.time<=time)a=f;if(f.time>=time){b=f;break;}b=f;}
      const p=a.players.get(id),q=b.players.get(id);if(!p?.alive||!q?.alive||p.playedRound!==q.playedRound)return null;
      if(Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z)>3)return null;
      const t=a.time===b.time?0:clamp((time-a.time)/(b.time-a.time),0,1),pose={...p};for(const k of ['x','y','z','pitch','gaitDistance','airTime'])if(Number.isFinite(p[k])&&Number.isFinite(q[k])&&(k!=='airTime'||p.grounded===q.grounded))pose[k]=p[k]+(q[k]-p[k])*t;
      pose.yaw=p.yaw+Math.atan2(Math.sin(q.yaw-p.yaw),Math.cos(q.yaw-p.yaw))*t;if(Number.isFinite(p.gaitYaw)&&Number.isFinite(q.gaitYaw))pose.gaitYaw=p.gaitYaw+Math.atan2(Math.sin(q.gaitYaw-p.gaitYaw),Math.cos(q.gaitYaw-p.gaitYaw))*t;rewinds++;return pose;
    },
    remove(id){clients.delete(id);},diagnostics(){return {maxRewindMs:maxRewindSeconds*1000,frames:frames.length,clients:clients.size,lookups,rewinds,rejectedTimes};},
  };
}
