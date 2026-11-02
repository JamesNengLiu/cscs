// Shared geometry only; input, weapon and movement tuning stay in movement/config.
export const COLLISION_PROFILE=Object.freeze({
 bumps:4,planes:5,stop:.1/40,edgeAhead:16/40,edgeDrop:34/40,edgeFriction:2
});
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export function clipVelocity(velocity,normal){
 const into=dot(velocity,normal);
 return velocity.map((v,i)=>{const value=v-normal[i]*into;return Math.abs(value)<COLLISION_PROFILE.stop?0:value;});
}
export function slideMove(start,velocity,dt,trace,{airborne=false}={}){
 let pos={x:start.x,y:start.y,z:start.z},v=[...velocity],original=[...velocity],remaining=dt,planes=[],travelled=0;
 const primal=[...velocity],hits=[];
 for(let bump=0;bump<COLLISION_PROFILE.bumps&&remaining>1e-8&&v.some(value=>value!==0);bump++){
  const hit=trace(pos,{x:pos.x+v[0]*remaining,y:pos.y+v[1]*remaining,z:pos.z+v[2]*remaining});
  if(hit.startSolid)return {pos,velocity:[0,0,0],blocked:true,hits};
  travelled+=hit.fraction;
  if(hit.fraction>0){pos={...hit.end};original=[...v];planes=[];}
  if(hit.fraction===1)break;
  hits.push({normal:[...hit.normal],velocity:[...v],position:{...pos},player:hit.player??null});
  remaining*=1-hit.fraction;
  if(planes.length>=COLLISION_PROFILE.planes){v=[0,0,0];break;}
  planes.push([...hit.normal]);
  if(airborne&&planes.length===1){v=clipVelocity(original,planes[0]);original=[...v];continue;}
  let candidate=null;
  for(let i=0;i<planes.length;i++){
   const clipped=clipVelocity(original,planes[i]);
   if(planes.every((n,j)=>j===i||dot(clipped,n)>=-1e-9)){candidate=clipped;break;}
  }
  if(candidate)v=candidate;
  else if(planes.length===2){
   // The base PM_FlyMove rule uses the unnormalised cross product; normalising
   // it would select a different movement variant at non-orthogonal seams.
   const [a,b]=planes,crease=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],along=dot(crease,v);
   v=crease.map(n=>n*along);
  }else v=[0,0,0];
  if(dot(v,primal)<=0){v=[0,0,0];break;}
 }
 if(travelled===0&&dt>0)v=[0,0,0];
 return {pos,velocity:v,blocked:hits.length>0,hits};
}
export function edgeFrictionMultiplier(player,height,trace){
 const speed=Math.hypot(player.vx,player.vz);
 if(speed<COLLISION_PROFILE.stop)return 1;
 // PM_Friction traces the current BODY hull from a centre at foot height.
 // Our sweep API takes feet coordinates, hence subtract half the hull height.
 // A point ray 16 units ahead would start braking too early and on low steps.
 const from={x:player.x+player.vx/speed*COLLISION_PROFILE.edgeAhead,y:player.y-height/2,z:player.z+player.vz/speed*COLLISION_PROFILE.edgeAhead};
 const to={...from,y:from.y-COLLISION_PROFILE.edgeDrop};
 return trace(from,to).fraction===1?COLLISION_PROFILE.edgeFriction:1;
}
