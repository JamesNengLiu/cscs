// A single snapshot of render delay smooths 30 Hz flight positions without inventing velocity.
export function createProjectileBuffer(){
  let previous=new Map(),current=[],previousTime=null,time=null,round=null;
  return {
    clear(){previous.clear();current=[];previousTime=time=round=null;},
    remove(id){previous.delete(id);current=current.filter(p=>p.id!==id);},
    push(projectiles,at,currentRound){
      if(currentRound!==round||!Number.isFinite(at)||time!==null&&(at<time||at-time>.2)){previous.clear();previousTime=null;time=null;}
      round=currentRound;
      if(Number.isFinite(at)&&time!==null&&at>time){previous=new Map(current.map(p=>[p.id,p]));previousTime=time;}
      if(Number.isFinite(at))time=at;current=projectiles.map(p=>({...p}));
    },
    sample(now){
      if(previousTime===null||time===null||time<=previousTime)return current;
      const delay=Math.min(.1,time-previousTime),alpha=Math.max(0,Math.min(1,(now-delay-previousTime)/(time-previousTime)));
      return current.map(p=>{const old=previous.get(p.id);if(!old||p.resting||old.kind!==p.kind||Math.hypot(p.x-old.x,p.y-old.y,p.z-old.z)>3)return p;
        return {...p,x:old.x+(p.x-old.x)*alpha,y:old.y+(p.y-old.y)*alpha,z:old.z+(p.z-old.z)*alpha};});
    },
  };
}
