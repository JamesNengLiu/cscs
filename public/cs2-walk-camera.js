// Baseline camera interpolation from v1.0, injected with the experimental CPU
// world and movement adapter. No prediction, input consumption, or old BSP.
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export function createWalkCamera({world,movement}={}){
 if(!world||typeof world.trace!=='function'||!movement||typeof movement.eyeHeight!=='function'||!Number.isFinite(movement.fixedDt))throw new TypeError('Walk camera requires world and movement');
 const STEP=movement.fixedDt,MAX_OFFSET=movement.rules.stepHeight+.04;
 const STANCE_RANGE=movement.eyeHeight({crouch:false})-movement.eyeHeight({crouch:true});
 const pose=player=>({x:player.x,y:player.y,z:player.z,eye:movement.eyeHeight(player),grounded:Boolean(player.grounded)});
 const eye=p=>({x:p.x,y:p.y+p.eye,z:p.z});
 const position={x:0,y:0,z:0};
 let physical=null,previous=null,current=null,stepOffset=0,pointClamps=0;

 function nextOffset(before,after,offset,dt){
  let change=clamp(offset*(Math.exp(-12*dt)-1),-2.5*dt,2.5*dt);
  const eyeDelta=after.y+after.eye-before.y-before.eye;
  if(!after.grounded||!before.grounded){
   if(eyeDelta>0)change=Math.max(change,-eyeDelta);
   if(eyeDelta<0)change=Math.min(change,-eyeDelta);
  }
  offset+=change;
  const dy=after.y-before.y,travel=Math.hypot(after.x-before.x,after.z-before.z);
  if(after.grounded&&before.grounded){
   const step=Math.abs(dy)>.04&&Math.abs(dy)>travel*1.021+.005?dy:0;
   const standRise=Math.max(0,after.eye-before.eye);
   if(step||standRise)offset=clamp(offset-step-standRise,-MAX_OFFSET-STANCE_RANGE,MAX_OFFSET);
  }
  return offset;
 }

 function reset(player=null){
  physical=player?pose(player):null;previous=current=physical?eye(physical):null;stepOffset=0;
  if(current)Object.assign(position,current);
 }
 function push(player){
  const after=pose(player);
  if(!physical){reset(player);return;}
  stepOffset=nextOffset(physical,after,stepOffset,STEP);
  previous=current;current={x:after.x,y:after.y+after.eye+stepOffset,z:after.z};physical=after;
 }
 function update(player,{fractionSeconds=0}={}){
  if(!physical)reset(player);
  const alpha=clamp((Number(fractionSeconds)||0)/STEP,0,1);
  for(const key of ['x','y','z'])position[key]=previous[key]+(current[key]-previous[key])*alpha;
  const origin={x:player.x,y:player.y+movement.eyeHeight(player),z:player.z};
  const hit=world.trace(origin,position,0,{radius:0,channel:'player'});
  if(!hit.startSolid&&hit.fraction<1){Object.assign(position,hit.end);pointClamps++;}
  return position.y;
 }
 return Object.freeze({reset,push,update,get position(){return position;},get mode(){return 'baseline';},diagnostics:()=>({mode:'baseline',stepOffset,pointClamps,scope:'One fixed-step interpolation; no movement prediction or gameplay actions'})});
}
