// CS2-only presentation. Physics runs independently of the 60 Hz player clock;
// each authoritative point carries its own sampling time. No render-time traces
// or forward simulation are performed here.
export const CS2_PROJECTILE_BUFFER_LIMIT=32;
const finitePoint=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k]));
function pointTime(p,stateTime){
 return Number.isFinite(p.simulatedAt)&&p.simulatedAt<=stateTime+1e-8&&p.simulatedAt>=stateTime-.25?p.simulatedAt:stateTime;
}
export function createProjectileBuffer(){
 let previous=new Map(),current=[],previousTime=null,time=null,round=null;
 return {
  clear(){previous.clear();current=[];previousTime=time=round=null;},
  remove(id){previous.delete(id);current=current.filter(p=>p.id!==id);},
  push(projectiles,at,currentRound){
   if(!Number.isFinite(at))return;
   if(currentRound!==round||time!==null&&(at<time||at-time>.2)){previous.clear();previousTime=null;time=null;}
   round=currentRound;
   if(time!==null&&at>time){previous=new Map(current.map(p=>[p.id,p]));previousTime=time;}
   time=at;current=(Array.isArray(projectiles)?projectiles:[]).slice(0,CS2_PROJECTILE_BUFFER_LIMIT).filter(finitePoint).map(p=>({...p}));
  },
  sample(now){
   if(!Number.isFinite(now)||previousTime===null||time===null||time<=previousTime)return current;
   const target=now-Math.min(.1,time-previousTime);
   return current.map(p=>{
    const old=previous.get(p.id);if(!old||old.kind!==p.kind)return p;
    // Settle once, then reuse the stable sample. Crowded resting grenades do
    // not need fresh interpolation objects or time/length math every frame.
    if(p.resting&&old.resting&&p.x===old.x&&p.y===old.y&&p.z===old.z)return p;
    if(Math.hypot(p.x-old.x,p.y-old.y,p.z-old.z)>3)return p;
    const start=pointTime(old,previousTime),end=pointTime(p,time);
    if(end<=start)return p;
    const alpha=Math.max(0,Math.min(1,(target-start)/(end-start)));
    return {...p,x:old.x+(p.x-old.x)*alpha,y:old.y+(p.y-old.y)*alpha,z:old.z+(p.z-old.z)*alpha};
   });
  }
 };
}
