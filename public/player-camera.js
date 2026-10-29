import {RULES} from './config.js';
import {eyeHeight} from './movement.js';
import {trace} from './map.js';
const STEP=1/RULES.tick,MAX_OFFSET=RULES.stepHeight+.04,STANCE_RANGE=RULES.eye-.75;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const pose=p=>({x:p.x,y:p.y,z:p.z,eye:eyeHeight(p),grounded:Boolean(p.grounded)});
const eye=p=>({x:p.x,y:p.y+p.eye,z:p.z});

// All axes display the same completed simulation interval. A new jump impulse
// must not be extrapolated into the previous interval's remainder.
export function createPlayerCamera(){
  let physical=null,previous=null,current=null,stepOffset=0;
  const position={x:0,y:0,z:0};
  function reset(player=null){
    physical=player?pose(player):null;previous=current=physical?eye(physical):null;stepOffset=0;
  }
  return {
    reset,
    push(player){
      const after=pose(player);if(!physical){reset(player);return;}
      let change=clamp(stepOffset*(Math.exp(-12*STEP)-1),-2.5*STEP,2.5*STEP);
      const eyeDelta=after.y+after.eye-physical.y-physical.eye;
      if(!after.grounded||!physical.grounded){
        if(eyeDelta>0)change=Math.max(change,-eyeDelta);
        if(eyeDelta<0)change=Math.min(change,-eyeDelta);
      }
      stepOffset+=change;
      const dy=after.y-physical.y,travel=Math.hypot(after.x-physical.x,after.z-physical.z);
      // Ramps are continuous motion. Only discrete ground steps need an offset;
      // retain that offset through takeoff instead of suddenly clearing it.
      if(after.grounded&&physical.grounded){
        const step=Math.abs(dy)>.04&&Math.abs(dy)>travel*1.021+.005?dy:0;
        const standRise=Math.max(0,after.eye-physical.eye);
        if(step||standRise)stepOffset=clamp(stepOffset-step-standRise,-MAX_OFFSET-STANCE_RANGE,MAX_OFFSET);
      }
      previous=current;current={x:after.x,y:after.y+after.eye+stepOffset,z:after.z};physical=after;
    },
    rebase(before,after){
      const delta={x:after.x-before.x,y:after.y-before.y,z:after.z-before.z};
      if(!physical||Math.hypot(delta.x,delta.y,delta.z)>.5){reset(after);return;}
      // Replay shifts both samples. The client's visual correction cancels this
      // shift initially, then decays independently.
      for(const sample of new Set([previous,current]))for(const k of ['x','y','z'])sample[k]+=delta[k];
      physical=pose(after);
    },
    update(player,{fractionSeconds=0,correction={x:0,y:0,z:0},correctionY=correction.y||0}={}){
      if(!physical)reset(player);
      const alpha=clamp((Number(fractionSeconds)||0)/STEP,0,1);
      for(const k of ['x','y','z'])position[k]=previous[k]+(current[k]-previous[k])*alpha+(k==='y'?correctionY:correction[k]||0);
      const origin={x:player.x,y:player.y+eyeHeight(player),z:player.z};
      const hit=trace(origin,position);
      if(!hit.startSolid&&hit.fraction<1)Object.assign(position,hit.end);
      return position.y;
    },
    get position(){return position;},
  };
}
