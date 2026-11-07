// CS2 presentation experiment only. The baseline delegates unchanged to the
// shared controller; the headroom profile limits render pixels, never clocks,
// input counts, world geometry, camera FOV, or simulation.
import {createResolutionController} from './render-budget.js';

export const CS2_RENDER_PROFILES=Object.freeze(['baseline','headroom']);
export const CS2_HEADROOM_PIXEL_RATIO=.75;
export function cs2RenderProfileFromSearch(search){
  return new URLSearchParams(search).get('present')==='headroom'?'headroom':'baseline';
}

export function createCS2ResolutionController(maxRatio=1.25,{profile='baseline'}={}){
  if(!Number.isFinite(maxRatio)||maxRatio<=0)throw new RangeError('Invalid render pixel ratio');
  let selected=CS2_RENDER_PROFILES.includes(profile)?profile:'baseline';
  const create=()=>createResolutionController(selected==='headroom'?Math.min(maxRatio,CS2_HEADROOM_PIXEL_RATIO):maxRatio);
  let controller=create();
  const controllers=new Map([[selected,controller]]);
  return {
    get profile(){return selected;},
    get quality(){return controller.quality;},
    get ratio(){return controller.ratio;},
    get target(){return controller.target;},
    get targetHz(){return controller.targetHz;},
    setProfile(value){
      if(!CS2_RENDER_PROFILES.includes(value)||value===selected)return false;
      const {quality,target}=controller;
      selected=value;controller=controllers.get(value)||create();controllers.set(value,controller);
      // reset clears the measurement window but retains the cadence learned on
      // this profile. Returning to A must not silently turn auto75 into auto60.
      controller.reset();
      if(controller.quality!==quality)controller.setQuality(quality);
      if(controller.target!==target)controller.setTarget(target);
      return true;
    },
    setQuality(value){return controller.setQuality(value);},
    setTarget(value){return controller.setTarget(value);},
    reset(){controller.reset();},
    sample(ms,now,gpuMs,metadata){return controller.sample(ms,now,gpuMs,metadata);},
    diagnostics(){return {...controller.diagnostics(),presentationAB:{profile:selected,headroomPixelRatioLimit:CS2_HEADROOM_PIXEL_RATIO,scope:'Render-resolution experiment; no input, simulation or physical latency guarantee'}};},
  };
}
