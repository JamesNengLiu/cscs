// Local presentation/input preference only; never changes authoritative rules.
export const MOUSE_SENSITIVITY=Object.freeze({min:.1,max:5,step:.05,default:1,radiansPerPixel:.002,storageKey:'lan-strike-mouse-sensitivity'});
export function normalizeSensitivity(value,fallback=MOUSE_SENSITIVITY.default){
  const number=typeof value==='number'?value:typeof value==='string'&&value.trim()!==''?Number(value):NaN;
  if(!Number.isFinite(number))return fallback;
  const {min,max,step}=MOUSE_SENSITIVITY;
  return Number((Math.round(Math.max(min,Math.min(max,number))/step)*step).toFixed(2));
}
export function createMouseSettings(storage){
  let value=MOUSE_SENSITIVITY.default,saved=Boolean(storage);
  try{const stored=storage?.getItem(MOUSE_SENSITIVITY.storageKey);if(stored!=null)value=normalizeSensitivity(stored);}catch{saved=false;}
  return {
    get value(){return value;},get saved(){return saved;},
    get radiansPerPixel(){return value*MOUSE_SENSITIVITY.radiansPerPixel;},
    set(next){value=normalizeSensitivity(next,value);try{if(!storage)throw Error('Storage unavailable');storage.setItem(MOUSE_SENSITIVITY.storageKey,String(value));saved=true;}catch{saved=false;}return value;},
    reset(){return this.set(MOUSE_SENSITIVITY.default);},
  };
}
export function bindMouseSettings(root,settings){
  const range=root.getElementById('mouseSensitivity'),number=root.getElementById('mouseSensitivityNumber'),value=root.getElementById('mouseSensitivityValue'),status=root.getElementById('mouseSettingsStatus');
  for(const control of [range,number]){control.min=MOUSE_SENSITIVITY.min;control.max=MOUSE_SENSITIVITY.max;control.step=MOUSE_SENSITIVITY.step;}
  function render(updateNumber=true){
    range.value=String(settings.value);if(updateNumber)number.value=settings.value.toFixed(2);
    value.textContent=settings.value.toFixed(2)+'×';range.setAttribute('aria-valuetext',settings.value.toFixed(2)+' 倍');
    status.textContent=settings.saved?'即时生效 · 自动保存在当前浏览器和地址':'即时生效 · 浏览器存储不可用，刷新后会恢复默认';
    if(updateNumber)number.removeAttribute('aria-invalid');
  }
  range.addEventListener('input',()=>{settings.set(range.value);render();});
  number.addEventListener('input',()=>{
    const n=number.valueAsNumber,valid=Number.isFinite(n)&&n>=MOUSE_SENSITIVITY.min&&n<=MOUSE_SENSITIVITY.max;
    number.setAttribute('aria-invalid',String(!valid));
    if(valid){settings.set(n);render(false);}
  });
  const commit=()=>{settings.set(normalizeSensitivity(number.value,settings.value));render();};
  number.addEventListener('change',commit);number.addEventListener('blur',commit);
  root.getElementById('resetMouseSettings').addEventListener('click',()=>{settings.reset();render();});
  render();
}
