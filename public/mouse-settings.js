// Local presentation/input preference only; never changes authoritative rules.
import {GUNS} from './arsenal.js';
export const MOUSE_SENSITIVITY=Object.freeze({min:.1,max:5,step:.05,default:1,radiansPerPixel:.001,storageKey:'lan-strike-mouse-sensitivity'});
export const SCOPED_SENSITIVITY=Object.freeze({...MOUSE_SENSITIVITY,storageKey:'lan-strike-scoped-sensitivity'});
export function normalizeSensitivity(value,fallback=MOUSE_SENSITIVITY.default){
  const number=typeof value==='number'?value:typeof value==='string'&&value.trim()!==''?Number(value):NaN;
  if(!Number.isFinite(number))return fallback;
  const {min,max,step}=MOUSE_SENSITIVITY;
  return Number((Math.round(Math.max(min,Math.min(max,number))/step)*step).toFixed(2));
}
export function createMouseSettings(storage,definition=MOUSE_SENSITIVITY){
  let value=definition.default,saved=Boolean(storage);
  try{const stored=storage?.getItem(definition.storageKey);if(stored!=null)value=normalizeSensitivity(stored);}catch{saved=false;}
  return {
    get value(){return value;},get saved(){return saved;},
    get radiansPerPixel(){return value*definition.radiansPerPixel;},
    set(next){value=normalizeSensitivity(next,value);try{if(!storage)throw Error('Storage unavailable');storage.setItem(definition.storageKey,String(value));saved=true;}catch{saved=false;}return value;},
    reset(){return this.set(definition.default);},
  };
}
export function mouseTurnFactor(settings,scopedSettings,player){
  const scoped=player?.alive&&GUNS[player.weapon]?.zoom?.includes(player.zoom);
  return settings.radiansPerPixel*(scoped?scopedSettings.value*player.zoom/90:1);
}
export function bindMouseSettings(root,settings,scopedSettings){
  const status=root.getElementById('mouseSettingsStatus'),renders=[];
  function renderStatus(){status.textContent=settings.saved&&scopedSettings.saved?'即时生效 · 自动保存在当前浏览器和地址':'即时生效 · 浏览器存储不可用，刷新后会恢复默认';}
  for(const [prefix,preference] of [['mouseSensitivity',settings],['scopedSensitivity',scopedSettings]]){
    const range=root.getElementById(prefix),number=root.getElementById(prefix+'Number'),value=root.getElementById(prefix+'Value');
    for(const control of [range,number]){control.min=MOUSE_SENSITIVITY.min;control.max=MOUSE_SENSITIVITY.max;control.step=MOUSE_SENSITIVITY.step;}
    function render(updateNumber=true){
      range.value=String(preference.value);if(updateNumber)number.value=preference.value.toFixed(2);
      value.textContent=preference.value.toFixed(2)+'×';range.setAttribute('aria-valuetext',preference.value.toFixed(2)+' 倍');
      if(updateNumber)number.removeAttribute('aria-invalid');renderStatus();
    }
    range.addEventListener('input',()=>{preference.set(range.value);render();});
    number.addEventListener('input',()=>{
      const n=number.valueAsNumber,valid=Number.isFinite(n)&&n>=MOUSE_SENSITIVITY.min&&n<=MOUSE_SENSITIVITY.max;
      number.setAttribute('aria-invalid',String(!valid));
      if(valid){preference.set(n);render(false);}
    });
    const commit=()=>{preference.set(normalizeSensitivity(number.value,preference.value));render();};
    number.addEventListener('change',commit);number.addEventListener('blur',commit);
    renders.push(render);render();
  }
  root.getElementById('resetMouseSettings').addEventListener('click',()=>{settings.reset();scopedSettings.reset();for(const render of renders)render();});
}
