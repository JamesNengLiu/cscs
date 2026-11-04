import {SPAWN_POINTS,MAP_BOUNDS,trace,collides,supportHeight,eyeHeight,isGrounded,direction} from '../../public/shared.js';
// Original BSP only: find stable standing positions whose central ray reaches
// a vertical wall at the requested distance. No replacement map geometry.
export function akWallCases(distances=[10,20,30]){
 const found=new Map(),seeds=[{x:-18.4,z:22,y:3.3},...Object.values(SPAWN_POINTS).flat()];
 function search(point){
  const y=supportHeight(point.x,point.z,(point.y??3.3)+2),origin={x:point.x,y:y+eyeHeight({}),z:point.z};if(collides(point.x,point.z,.4,y+.01))return;
  for(let i=0;i<64;i++){
   const yaw=i*Math.PI/32,d=direction(yaw,0),hit=trace(origin,{x:origin.x+d.x*45,y:origin.y,z:origin.z+d.z*45});
   if(hit.startSolid||hit.fraction===1||Math.abs(hit.normal[1])>.1)continue;
   for(const distance of distances){if(found.has(distance))continue;
    const x=hit.end.x-d.x*distance,z=hit.end.z-d.z*distance,feet=supportHeight(x,z,y+2),p={x,y:feet,z,grounded:true,vx:0,vy:0,vz:0,crouch:false};
    const floor=trace({x,y:feet+.1,z},{x,y:feet-.1,z});
    if(collides(x,z,.4,feet+.01)||!isGrounded(p)||floor.startSolid||floor.normal[1]<.999)continue;
    const o={x,y:feet+eyeHeight(p),z},check=trace(o,{x:x+d.x*(distance+1),y:o.y,z:z+d.z*(distance+1)}),actual=check.fraction*(distance+1);
    if(check.startSolid||check.fraction===1||Math.abs(check.normal[1])>.1||Math.abs(actual-distance)>=.02)continue;
    let clear=true;
    for(const side of [-.13,0,.13])for(const pitch of [-.01,0,.1,.21]){
     const ray=direction(yaw+side,pitch),test=trace(o,{x:x+ray.x*distance*1.6,y:o.y+ray.y*distance*1.6,z:z+ray.z*distance*1.6});
     if(test.startSolid||test.fraction*distance*1.6<distance*.7)clear=false;
    }
    if(clear)found.set(distance,{distance,actual,position:{x,y:feet,z},yaw,wall:{...check.end}});
   }
   if(found.size===distances.length)return;
  }
 }
 for(const p of seeds){search(p);if(found.size===distances.length)break;}
 if(found.size<distances.length){const [lo,hi]=MAP_BOUNDS;for(let x=lo[0]+2;x<hi[0]&&found.size<distances.length;x+=4)for(let z=lo[2]+2;z<hi[2]&&found.size<distances.length;z+=4)search({x,z,y:5});}
 if(found.size!==distances.length)throw Error('Cannot find original BSP wall distances: '+distances.filter(d=>!found.has(d)).join(','));
 return distances.map(d=>found.get(d));
}
