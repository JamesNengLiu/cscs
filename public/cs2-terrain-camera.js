// Bounded CS2 display-height response. No simulation, input or angle state.
export const CS2_TERRAIN_CAMERA=Object.freeze({tauSeconds:.015,maxOffsetMetres:.015,settleEpsilonMetres:.000001,landingGuardSteps:8});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function createTerrainCameraResponse(){
  let shown=null,lastTime=null,offset=0,peakOffset=0,filteredFrames=0,rejectedFrames=0;
  function reset(target=null){shown=Number.isFinite(target)?target:null;lastTime=null;offset=0;}
  return {
    reset,
    rebase(deltaY){if(!Number.isFinite(deltaY))throw new TypeError('Finite display rebase required');if(shown!==null)shown+=deltaY;},
    sample(target,{dt=0,sampleTime,eligible=false,enabled=true}={}){
      if(!Number.isFinite(target))throw new TypeError('Finite display height required');
      const timed=Number.isFinite(sampleTime),elapsed=timed&&lastTime!==null?sampleTime-lastTime:dt;
      const discontinuity=!Number.isFinite(dt)||dt<0||dt>=.05||!Number.isFinite(elapsed)||elapsed<0||elapsed>=.05;
      lastTime=timed?sampleTime:null;
      if(!enabled||!eligible||shown===null||discontinuity){shown=target;offset=0;return target;}
      if(elapsed>0){
        const weight=-Math.expm1(-elapsed/CS2_TERRAIN_CAMERA.tauSeconds);
        shown+=(target-shown)*weight;
      }
      shown=clamp(shown,target-CS2_TERRAIN_CAMERA.maxOffsetMetres,target+CS2_TERRAIN_CAMERA.maxOffsetMetres);
      if(Math.abs(shown-target)<=CS2_TERRAIN_CAMERA.settleEpsilonMetres)shown=target;
      offset=shown-target;peakOffset=Math.max(peakOffset,Math.abs(offset));if(offset!==0)filteredFrames++;
      return shown;
    },
    reject(target){shown=target;offset=0;rejectedFrames++;},
    diagnostics:()=>({enabled:true,policy:'cs2-ground-height-v1',offsetMetres:offset,peakOffsetMetres:peakOffset,filteredFrames,rejectedFrames,tauSeconds:CS2_TERRAIN_CAMERA.tauSeconds,maxOffsetMetres:CS2_TERRAIN_CAMERA.maxOffsetMetres}),
  };
}
