// Source CNmSoundEvent start values are normalized clip time. This clock never
// mutates gameplay/ammo, and canceling an action retires all pending cues.
export function createAnimationEventClock(emit,{staleSeconds=.18,maxEvents=64}={}){
 let events=[],duration=0,last=-1,token=0,played=0,stale=0;
 return{start(metadata,seconds,{from=0,to=Infinity}={}){token++;duration=seconds;last=from-1e-7;events=(metadata?.events||[]).filter(e=>e._class==='CNmSoundEvent'&&typeof e.m_name==='string'&&Number.isFinite(e.m_flStartTime?.m_flValue)).slice(0,maxEvents).map((e,i)=>({name:e.m_name,at:Math.max(0,Math.min(1,e.m_flStartTime.m_flValue))*seconds,index:i})).filter(e=>e.at+1e-7>=from&&e.at<=to+1e-7).sort((a,b)=>a.at-b.at);},
  sample(time,{silent=false}={}){if(!Number.isFinite(time)||time<last)return;for(const e of events)if(e.at>last&&e.at<=time+1e-7){if(!silent&&time-e.at<=staleSeconds){emit({nativeEvent:e.name,token:token+':'+e.index,clipTime:e.at});played++;}else stale++;}last=time;},
  flush(time,predicate){if(!Number.isFinite(time))return;for(const e of events)if(e.at>last&&e.at<=time+1e-7&&predicate(e.name)){emit({nativeEvent:e.name,token:token+':'+e.index,clipTime:e.at});played++;}last=Math.max(last,time);},
  cancel(){events=[];last=-1;token++;},diagnostics:()=>({pending:events.filter(e=>e.at>last).length,played,stale,token,duration})};
}
