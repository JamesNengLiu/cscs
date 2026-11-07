// Material and penetration adapter for the independent CPU world. The legacy
// BSP renderer/material tables are never imported by the CS2 authority path.
const MATERIAL=Object.freeze({metal:[.15,.2],concrete:[.25,.5],grate:[.5,.4],vent:[.5,.45],tile:[.65,.3],computer:[.4,.45],wood:[1,.6],glass:[1,.5]});
const AMMO={'9mm':[21,800],'45acp':[15,500],'50AE':[30,1000],'762Nato':[39,5000],'556Nato':[35,4000],'556NatoBox':[35,4000],'338Magnum':[45,8000],'57mm':[30,2000],'357SIG':[25,800]};
// These are explicit physics surface names, not filename heuristics. Preserve
// unknown source names/hashes in the returned descriptor for later calibration.
export function surfaceClass(name){
 if(typeof name!=='string')return 'concrete';
 const key=name.toLowerCase();if(Object.hasOwn(MATERIAL,key))return key;
 if(['rock','stone','brick','plaster','cement','default'].includes(key))return 'concrete';
 if(['dirt','sand','gravel','grass','carpet','plastic'].includes(key))return key;
 return 'concrete';
}
export function createBallistics(world,{metresPerUnit=1/40}={}){
 if(!world?.collision?.trace)throw Error('A CPU experimental world is required');
 const trace=(a,b)=>world.collision.trace(a,b,0,{radius:0,channel:'bullet'});
 function at(position,normal){
  const a={x:position.x+normal[0]*.012,y:position.y+normal[1]*.012,z:position.z+normal[2]*.012},b={x:position.x-normal[0]*.03,y:position.y-normal[1]*.03,z:position.z-normal[2]*.03};
  return trace(a,b);
 }
 const descriptor=hit=>({texture:'',material:surfaceClass(hit.material),sourceSurface:hit.material??null,materialHash:hit.materialHash??null,known:typeof hit.material==='string'});
 const soundMaterialAt=(position,normal)=>descriptor(at(position,normal));
 const materialAt=(position,normal)=>surfaceClass(at(position,normal).material);
 function groundSoundSurface(player){const hit=world.collision.trace({x:player.x,y:player.y+.08,z:player.z},{x:player.x,y:player.y-.4,z:player.z},0,{radius:0,channel:'audio'});return descriptor(hit);}
 function bulletProperties(w){const pair=AMMO[w.ammoType];return{power:pair?.[0]||0,distance:(pair?.[1]||0)*metresPerUnit,hits:w.category==='sniper'?3:['rifle','machinegun'].includes(w.category)||w.id==='deagle'?2:1};}
 function penetrationExit(point,d,power,material='concrete'){
  const maximum=power*(MATERIAL[material]?.[0]??.25)*metresPerUnit;if(!Number.isFinite(maximum)||maximum<=0)return null;
  if(typeof world.collision.rayIntervals!=='function')return null;
  // Trace leaves a 0.5mm contact skin. Include that entry, then require a real
  // convex-hull exit in the same bounded segment. Triangle surfaces never
  // certify a volume and cannot be paired into a fictitious thick wall.
  const back=.003,start={x:point.x-d.x*back,y:point.y-d.y*back,z:point.z-d.z*back},end={x:point.x+d.x*(maximum+.003),y:point.y+d.y*(maximum+.003),z:point.z+d.z*(maximum+.003)};
  const result=world.collision.rayIntervals(start,end,{channel:'bullet',maxHits:256});if(result.truncated)return null;
  const intervals=result.intervals.filter(hit=>hit.kind==='solid-hull'&&hit.exitCertified&&hit.enterFraction*(maximum+.006)<=back+.003).sort((a,b)=>a.enterFraction-b.enterFraction);
  if(!intervals.length)return null;
  let exit=intervals[0].exitFraction;
  // Overlapping hulls form one solid interval. Never exit a near hull directly
  // inside an overlapping neighbour, or skip a disconnected subsequent wall.
  for(const hit of result.intervals){if(hit.enterFraction>exit+1e-7)break;if(hit.exitCertified&&hit.kind==='solid-hull')exit=Math.max(exit,hit.exitFraction);}
  const distance=exit*(maximum+.006)-back;if(distance>maximum+1e-6)return null;
  // A mesh surface before this exit is an uncertified blocker, even where a
  // neighbouring convex volume would otherwise permit penetration.
  if(result.surfaces.some(hit=>hit.fraction<=exit&&hit.fraction*(maximum+.006)>=back-.001))return null;
  const candidate={x:point.x+d.x*(distance+.002),y:point.y+d.y*(distance+.002),z:point.z+d.z*(distance+.002)};
  return trace(candidate,candidate).startSolid?null:candidate;
 }
 return{trace,materialAt,soundMaterialAt,impactSurface:descriptor,groundSoundSurface,bulletProperties,penetrationExit,materialDamage:material=>MATERIAL[material]?.[1]??.5};
}
