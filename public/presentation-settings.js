const KEY='lan-strike.presentation.v1';
export const PRESENTATION_DEFAULTS=Object.freeze({landing:true,landingStrength:.25,bob:'current',bobStrength:.35,shells:true,gunSmoke:true,muzzleLight:false,rawMouse:false,dpi:0});
const bools=['landing','shells','gunSmoke','muzzleLight','rawMouse'];
export function normalizePresentation(value={}){
 const out={...PRESENTATION_DEFAULTS};if(!value||typeof value!=='object')return out;
 for(const k of bools)if(typeof value[k]==='boolean')out[k]=value[k];
 for(const k of ['landingStrength','bobStrength'])if(Number.isFinite(value[k]))out[k]=Math.max(0,Math.min(1,value[k]));
 if(['current','classic','off'].includes(value.bob))out.bob=value.bob;
 if(Number.isFinite(value.dpi))out.dpi=Math.max(0,Math.min(64000,Math.round(value.dpi)));
 return out;
}
export function createPresentationSettings(storage){
 let values=normalizePresentation();try{values=normalizePresentation(JSON.parse(storage?.getItem(KEY)||'null'));}catch{}
 return {get values(){return {...values};},set(patch){values=normalizePresentation({...values,...patch});try{storage?.setItem(KEY,JSON.stringify(values));}catch{}return {...values};},reset(){return this.set(PRESENTATION_DEFAULTS);}};
}
export function bindPresentationSettings(root,settings,onChange=()=>{}){
 const nodes=[...root.querySelectorAll('[data-presentation]')];
 const render=()=>{for(const node of nodes){const value=settings.values[node.dataset.presentation];if(node.type==='checkbox')node.checked=value;else node.value=String(value);}};
 for(const node of nodes)node.addEventListener('change',()=>{const key=node.dataset.presentation,value=node.type==='checkbox'?node.checked:['landingStrength','bobStrength','dpi'].includes(key)?Number(node.value):node.value;settings.set({[key]:value});render();onChange(settings.values);});
 root.getElementById('resetPresentation')?.addEventListener('click',()=>{settings.reset();render();onChange(settings.values);});render();return {render};
}
