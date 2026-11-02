// Local A/B preference; does not change simulation or aim angles.
export const CAMERA_SETTINGS=Object.freeze({default:'baseline',storageKey:'lan-strike-camera-mode',modes:Object.freeze(['baseline','responsive'])});
export function createCameraSettings(storage,query=null){
 let mode=CAMERA_SETTINGS.default,saved=Boolean(storage),source='default';
 try{const value=storage?.getItem(CAMERA_SETTINGS.storageKey);if(CAMERA_SETTINGS.modes.includes(value)){mode=value;source='storage';}}catch{saved=false;}
 const override=query?.get?.('camera');if(CAMERA_SETTINGS.modes.includes(override)){mode=override;source='query';}
 return {get mode(){return mode;},get saved(){return saved;},get source(){return source;},setMode(value){if(!CAMERA_SETTINGS.modes.includes(value))return false;mode=value;source='selection';try{if(!storage)throw Error('Storage unavailable');storage.setItem(CAMERA_SETTINGS.storageKey,mode);saved=true;}catch{saved=false;}return true;}};
}
export function bindCameraSettings(root,settings,onChange=()=>{}){
 const select=root.getElementById('cameraMode'),status=root.getElementById('cameraModeStatus');
 const render=()=>{select.value=settings.mode;status.textContent=settings.mode==='responsive'?'B 实验方案 · 可随时切回 A': 'A 现有方案 · 默认保持稳定插值';};
 select.addEventListener('change',()=>{if(settings.setMode(select.value))onChange(settings.mode);render();});render();
 return {render};
}
