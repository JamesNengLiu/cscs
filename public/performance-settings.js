import {FRAME_TARGETS} from './render-budget.js';
const KEY='lan-strike-frame-target';
export function createFrameTargetSettings(storage,query=null){
  let target='auto';try{const saved=storage?.getItem(KEY);if(FRAME_TARGETS.includes(saved))target=saved;}catch{}
  const override=query?.get('frameTarget');if(FRAME_TARGETS.includes(override))target=override;
  return {get target(){return target;},set(value){value=String(value);if(!FRAME_TARGETS.includes(value))return false;target=value;try{storage?.setItem(KEY,value);}catch{}return true;}};
}
export function bindFrameTargets(root,settings,onChange){
  const controls=[...root.querySelectorAll('[data-frame-target]')];
  for(const control of controls){control.value=settings.target;control.addEventListener('change',()=>{if(!settings.set(control.value))return;for(const other of controls)other.value=settings.target;onChange(settings.target);});}
}
