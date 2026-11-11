import {createPresentationClock} from './cs2-presentation-clock.js';
import {createTerrainCameraResponse,CS2_TERRAIN_CAMERA} from './cs2-terrain-camera.js';
// CS2 adapter: retains the v1.0 stair/stance handling and responsive mode, with
// bounded position-presentation timing for the baseline camera.
import {RULES} from './cs2-client-world.js';
import {eyeHeight,movePlayer,maxMoveSpeed} from './cs2-client-world.js';
import {trace} from './cs2-client-world.js';

const STEP=1/RULES.tick,MAX_OFFSET=RULES.stepHeight+.04,STANCE_RANGE=RULES.eye-(RULES.crouchEye??.75);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const pose=p=>({x:p.x,y:p.y,z:p.z,eye:eyeHeight(p),grounded:Boolean(p.grounded)});
const eye=p=>({x:p.x,y:p.y+p.eye,z:p.z,feetY:p.y,grounded:p.grounded,stanceEye:p.eye});
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
export function createPlayerCamera({mode='baseline',stablePresentation=false,terrainSmoothing=false}={}){
  if(!validMode(mode))throw new RangeError('Unknown camera mode');
  let physical=null,older=null,previous=null,current=null,stepOffset=0,lastInput=null,nearby=[],responsive=null,forecast=null,stepCount=0;
  const presentationClock=createPresentationClock();let presentationClockEnabled=Boolean(stablePresentation);
  const terrainResponse=terrainSmoothing?createTerrainCameraResponse():null;
  const terrainGuardSteps=terrainResponse?CS2_TERRAIN_CAMERA.landingGuardSteps:0;
  let terrainGroundSteps=0;
  let previews=0,limitedFrames=0,pointClamps=0,previewPeakMs=0;
  const position={x:0,y:0,z:0};
  function reset(player=null){
    physical=player?pose(player):null;
    older=previous=current=physical?eye(physical):null;stepCount=0;presentationClock.reset();
    stepOffset=0;lastInput=null;nearby=[];
    responsive=current?{...current}:null;forecast=null;
    terrainResponse?.reset(current?.feetY);terrainGroundSteps=physical?.grounded?terrainGuardSteps:0;
  }
  return {
    reset,
    setMode(value){
      if(!validMode(value))return false;
      mode=value;responsive=current?{...current}:null;forecast=null;presentationClock.reset();terrainResponse?.reset(current?.feetY);terrainGroundSteps=0;return true;
    },
    push(player,input=null,players=[]){
      const after=pose(player);
      if(!physical){reset(player);lastInput=input?{...input}:null;nearby=players;return;}
      stepOffset=nextOffset(physical,after,stepOffset,STEP);
      terrainGroundSteps=after.grounded&&physical.grounded&&after.eye===physical.eye?Math.min(100,terrainGroundSteps+1):0;
      older=previous;previous=current;current={x:after.x,y:after.y+after.eye+stepOffset,z:after.z,feetY:after.y,grounded:after.grounded,stanceEye:after.eye};stepCount++;
      physical=after;lastInput=input?{...input}:null;nearby=players;forecast=null;
    },
    rebase(before,after,{maxDistance=.5}={}){
      const delta={x:after.x-before.x,y:after.y-before.y,z:after.z-before.z};
      const limit=Number.isFinite(maxDistance)&&maxDistance>=0?Math.min(8,maxDistance):.5;
      if(!physical||Math.hypot(delta.x,delta.y,delta.z)>limit){reset(after);return;}
      for(const sample of new Set([older,previous,current])){for(const k of ['x','y','z'])sample[k]+=delta[k];sample.feetY+=delta.y;}
      if(responsive)for(const k of ['x','y','z'])responsive[k]+=delta[k];
      const afterPose=pose(after);
      if(physical.grounded!==afterPose.grounded||physical.eye!==afterPose.eye){terrainResponse?.reset(after.y);terrainGroundSteps=0;}
      else terrainResponse?.rebase(delta.y);
      physical=afterPose;forecast=null;
    },
    update(player,{fractionSeconds=0,dt=STEP,enabled=true,frameTimeMs,players=nearby,correction={x:0,y:0,z:0},correctionY=correction.y||0}={}){
      if(!physical)reset(player);
      const alpha=clamp((Number(fractionSeconds)||0)/STEP,0,1);
      let terrainSampleTime=(stepCount-1)*STEP+alpha*STEP,terrainFeetY=physical.y,terrainEligible=false;
      if(mode==='baseline'){
        let first=previous,second=current,blend=alpha;
        if(presentationClockEnabled&&enabled&&Number.isFinite(frameTimeMs)){
          const time=presentationClock.sample(stepCount*STEP+alpha*STEP,{frameTimeMs})-STEP,previousTime=(stepCount-1)*STEP;
          terrainSampleTime=time;
          if(time<previousTime){first=older;second=previous;blend=clamp((time-(previousTime-STEP))/STEP,0,1);}
          else blend=clamp((time-previousTime)/STEP,0,1);
        }else if(presentationClockEnabled)presentationClock.reset();
        for(const k of ['x','y','z'])position[k]=first[k]+(second[k]-first[k])*blend+(k==='y'?correctionY:correction[k]||0);
        terrainFeetY=first.feetY+(second.feetY-first.feetY)*blend;
        terrainEligible=first.grounded&&second.grounded&&first.stanceEye===second.stanceEye;
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
      if(terrainResponse){
        // Keep air, the landing tail, stance/stair easing, responsive preview
        // and recovery clocks unchanged. Filter baseline feet only: its delta
        // is added after the original eye/step/correction arithmetic.
        const safeY=position.y;
        const eligible=terrainEligible&&physical.grounded&&player.grounded&&terrainGroundSteps>=terrainGuardSteps&&Math.abs(stepOffset)<.0005&&!hit.startSolid&&hit.fraction===1;
        const filtered=terrainResponse.sample(terrainFeetY,{dt,sampleTime:terrainSampleTime,eligible,enabled});
        const candidateY=safeY+(filtered-terrainFeetY);
        if(Math.abs(candidateY-safeY)>1e-9){
          const candidate={x:position.x,y:candidateY,z:position.z};
          const vertical=trace(position,candidate),direct=trace(origin,candidate);
          if(!vertical.startSolid&&vertical.fraction===1&&!direct.startSolid&&direct.fraction===1)position.y=candidateY;
          else terrainResponse.reject(terrainFeetY);
        }
      }
      return position.y;
    },
    setPresentationClockEnabled(value){presentationClockEnabled=Boolean(value);presentationClock.reset();terrainResponse?.reset();return presentationClockEnabled;},
    get position(){return position;},
    get mode(){return mode;},
    diagnostics:()=>({mode,previews,limitedFrames,pointClamps,previewPeakMs,terrainPresentation:terrainResponse?.diagnostics()??{enabled:false},presentationClock:{enabled:presentationClockEnabled,...presentationClock.diagnostics()}})
  };
}
