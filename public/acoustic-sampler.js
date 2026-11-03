// Best-effort, bounded acoustic approximation; never an enemy visibility gate.
export function createAcousticSampler(trace,{now=()=>performance.now(),budget=8,windowMs=100,capacity=128}={}){
 const cache=new Map();let windowAt=-Infinity,used=0,traces=0,hits=0,skipped=0,roomAt=-Infinity,room=0;
 const finite=p=>p&&[p.x,p.y,p.z].every(Number.isFinite);
 function cast(a,b){const t=now();if(t-windowAt>=windowMs){windowAt=t;used=0;}if(used>=budget){skipped++;return null;}used++;traces++;return trace(a,b);}
 return {
  sample(source,listener){if(!finite(source)||!finite(listener))return null;const t=now(),key=[source.x,source.y,source.z,listener.x,listener.y,listener.z].map(v=>Math.floor(v*2)).join(':');const old=cache.get(key);if(old&&t-old.at<150){hits++;return old.value;}
   const hit=cast({x:source.x,y:source.y+.05,z:source.z},{x:listener.x,y:listener.y+.02,z:listener.z});if(!hit)return null;
   const blocked=!hit.startSolid&&hit.fraction<.995,value={gain:blocked?.62:1,cutoff:blocked?1800:22000,blocked};cache.set(key,{at:t,value});if(cache.size>capacity)cache.delete(cache.keys().next().value);return value;
  },
  room(listener){if(!finite(listener))return 0;const t=now();if(t-roomAt<1000)return room;let near=0,complete=true;for(const [x,y,z]of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]]){const hit=cast(listener,{x:listener.x+x*4,y:listener.y+y*4,z:listener.z+z*4});if(!hit){complete=false;break;}if(!hit.startSolid&&hit.fraction<1)near++;}if(complete){roomAt=t;room=near>=4?.09:near>=3?.04:0;}return room;
  },
  diagnostics:()=>({traces,cacheHits:hits,skipped,entries:cache.size,capacity,traceBudget:budget,roomWet:room,scope:'Mild cached line/room approximation, not GoldSrc DSP or physical acoustic parity'}),clear(){cache.clear();roomAt=-Infinity;room=0;}
 };
}
