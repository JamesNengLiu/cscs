import {RULES} from './config.js';
import {eyeHeight,movePlayer,maxMoveSpeed} from './movement.js';
import {trace} from './map.js';

const STEP=1/RULES.tick,MAX_OFFSET=RULES.stepHeight+.04,STANCE_RANGE=RULES.eye-.75;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const pose=p=>({x:p.x,y:p.y,z:p.z,eye:eyeHeight(p),grounded:Boolean(p.grounded)});
const eye=p=>({x:p.x,y:p.y+p.eye,z:p.z});
const validMode=value=>['baseline','responsive'].includes(value);

// Shared original stair/stance smoothing; A's arithmetic and order are retained.
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

// A interpolates the completed step. B previews one held-input step on a copy,
// then limits display transitions. Neither mode commits a move or action.
export function createPlayerCamera({mode='baseline'}={}){
  if(!validMode(mode))throw new RangeError('Unknown camera mode');
  let physical=null,previous=null,current=null,stepOffset=0,lastInput=null,nearby=[],responsive=null,forecast=null;
  let previews=0,limitedFrames=0,pointClamps=0,previewPeakMs=0;
  const position={x:0,y:0,z:0};
  function reset(player=null){
    physical=player?pose(player):null;
    previous=current=physical?eye(physical):null;
    stepOffset=0;lastInput=null;nearby=[];
    responsive=current?{...current}:null;forecast=null;
  }
  return {
    reset,
    setMode(value){
      if(!validMode(value))return false;
      mode=value;responsive=current?{...current}:null;forecast=null;return true;
    },
    push(player,input=null,players=[]){
      const after=pose(player);
      if(!physical){reset(player);lastInput=input?{...input}:null;nearby=players;return;}
      stepOffset=nextOffset(physical,after,stepOffset,STEP);
      previous=current;current={x:after.x,y:after.y+after.eye+stepOffset,z:after.z};
      physical=after;lastInput=input?{...input}:null;nearby=players;forecast=null;
    },
    rebase(before,after,{maxDistance=.5}={}){
      const delta={x:after.x-before.x,y:after.y-before.y,z:after.z-before.z};
      if(!physical||Math.hypot(delta.x,delta.y,delta.z)>(mode==='responsive'?maxDistance:.5)){reset(after);return;}
      for(const sample of new Set([previous,current]))for(const k of ['x','y','z'])sample[k]+=delta[k];
      if(responsive)for(const k of ['x','y','z'])responsive[k]+=delta[k];
      physical=pose(after);forecast=null;
    },
    update(player,{fractionSeconds=0,dt=STEP,enabled=true,players=nearby,correction={x:0,y:0,z:0},correctionY=correction.y||0}={}){
      if(!physical)reset(player);
      const alpha=clamp((Number(fractionSeconds)||0)/STEP,0,1);
      if(mode==='baseline'){
        for(const k of ['x','y','z'])position[k]=previous[k]+(current[k]-previous[k])*alpha+(k==='y'?correctionY:correction[k]||0);
      }else{
        const target={...current},duration=alpha*STEP;
        let future=player;
        // Reuse one collision-aware forecast until the next physical step/rebase.
        // Only already-consumed movement/stance is eligible: no fresh jump edge,
        // crouch transition, weapon action, input sampling, or sound is generated.
        if(enabled&&lastInput&&duration>1e-8&&player.alive!==false){
          if(!forecast){
            const start=performance.now(),copy={...player};
            const previewInput={...lastInput,jump:Boolean(player.jumpHeld),crouch:Boolean(player.crouch||player.ducking),fire:false,use:false};
            movePlayer(copy,previewInput,STEP,players);
            const after=pose(copy),offset=nextOffset(physical,after,stepOffset,STEP);
            forecast={player:copy,dx:copy.x-player.x,dz:copy.z-player.z,dy:copy.y+after.eye-player.y-eyeHeight(player)+offset-stepOffset};
            previews++;previewPeakMs=Math.max(previewPeakMs,performance.now()-start);
          }
          future=forecast.player;target.x+=forecast.dx*alpha;target.z+=forecast.dz*alpha;target.y+=forecast.dy*alpha;
        }
        responsive??={...current};
        const elapsed=clamp(Number(dt)||0,0,.05),dx=target.x-responsive.x,dz=target.z-responsive.z,distance=Math.hypot(dx,dz);
        const horizontal=Math.max(maxMoveSpeed(player),Math.hypot(player.vx||0,player.vz||0),Math.hypot(future.vx||0,future.vz||0),Math.hypot(current.x-previous.x,current.z-previous.z)/STEP)*1.05+.05;
        const scale=distance?Math.min(1,horizontal*elapsed/distance):1;
        responsive.x+=dx*scale;responsive.z+=dz*scale;
        // A direct forecast doubled the first rising-frame speed at high Hz.
        // Bound it instead, retaining the established <10 world units/s limit.
        const chord=(current.y-previous.y)/STEP;
        const up=Math.min(9.8,Math.max(2.5,player.vy||0,future.vy||0,chord)+.8);
        const down=Math.max(2.5,-(player.vy||0),-(future.vy||0),-chord)+.8;
        const dy=target.y-responsive.y,change=clamp(dy,-down*elapsed,up*elapsed);
        responsive.y+=change;if(scale<1||change!==dy)limitedFrames++;
        // Network recovery owns its correction rate; do not damp it twice.
        for(const k of ['x','y','z'])position[k]=responsive[k]+(k==='y'?correctionY:correction[k]||0);
      }
      const origin={x:player.x,y:player.y+eyeHeight(player),z:player.z},hit=trace(origin,position);
      if(!hit.startSolid&&hit.fraction<1){
        Object.assign(position,hit.end);pointClamps++;
        if(mode==='responsive')for(const k of ['x','y','z'])responsive[k]=position[k]-(k==='y'?correctionY:correction[k]||0);
      }
      return position.y;
    },
    get position(){return position;},
    get mode(){return mode;},
    diagnostics:()=>({mode,previews,limitedFrames,pointClamps,previewPeakMs})
  };
}
