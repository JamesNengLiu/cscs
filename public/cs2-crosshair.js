// CS2-style static/dynamic geometry. Changes presentation only; aim, recoil and
// authoritative spread never read these local preferences.
export const CS2_CROSSHAIR_DEFAULTS=Object.freeze({mode:'static',size:6,gap:4,thickness:2,color:'#62ff8b',dot:false});
export function createCS2Crosshair({storage=null}={}){
 let values={...CS2_CROSSHAIR_DEFAULTS};try{const s=JSON.parse(storage?.getItem('lan-strike-cs2-crosshair')||'null');if(s)for(const [k,v]of Object.entries(s))set(k,v,false);}catch{}
 function set(key,value,persist=true){if(!Object.hasOwn(values,key))return false;if(key==='mode'&&!['static','dynamic'].includes(value)||key==='color'&&!/^#[0-9a-f]{6}$/i.test(value)||key==='dot'&&typeof value!=='boolean')return false;if(['size','gap','thickness'].includes(key)){value=Number(value);if(!Number.isFinite(value))return false;value=Math.max(key==='thickness'?1:0,Math.min(key==='thickness'?5:20,value));}values={...values,[key]:value};if(persist)try{storage?.setItem('lan-strike-cs2-crosshair',JSON.stringify(values));}catch{}return true;}
 return{get values(){return{...values};},set,reset(){values={...CS2_CROSSHAIR_DEFAULTS};},shot(){},update(p,dt,width){if(values.mode==='static')return values.gap;const spread=Math.max(0,Math.min(.3,Number(p?.spread)||0));return Math.max(values.gap,Math.min(60,Math.tan(spread)*width*.45));}};
}
export function bindCS2Crosshair(root,settings,node){
 const render=()=>{const v=settings.values;node.style.setProperty('--cs2-color',v.color);node.style.setProperty('--cs2-size',v.size+'px');node.style.setProperty('--cs2-thickness',v.thickness+'px');node.classList.toggle('cs2-dot',v.dot);for(const input of root.querySelectorAll('[data-cs2-crosshair]')){const value=v[input.dataset.cs2Crosshair];if(input.type==='checkbox')input.checked=value;else input.value=String(value);}};
 for(const input of root.querySelectorAll('[data-cs2-crosshair]'))input.addEventListener('input',()=>{settings.set(input.dataset.cs2Crosshair,input.type==='checkbox'?input.checked:input.value);render();});render();
}
