export const WEAPON_HAND=Object.freeze({default:'right',storageKey:'lan-strike-weapon-hand'});
export function createViewmodelSettings(storage){
  let hand=WEAPON_HAND.default,saved=Boolean(storage);
  try{const value=storage?.getItem(WEAPON_HAND.storageKey);if(value==='left'||value==='right')hand=value;}catch{saved=false;}
  return {get hand(){return hand;},get saved(){return saved;},
    setHand(value){if(value!=='left'&&value!=='right')return false;hand=value;try{if(!storage)throw Error('Storage unavailable');storage.setItem(WEAPON_HAND.storageKey,hand);saved=true;}catch{saved=false;}return true;},
  };
}
export function bindViewmodelSettings(root,settings,onChange=()=>{}){
  const select=root.getElementById('weaponHand'),status=root.getElementById('weaponHandStatus');
  const render=()=>{select.value=settings.hand;status.textContent=settings.saved?'即时生效 · 自动保存在当前浏览器和地址':'即时生效 · 刷新后会恢复右手持枪';};
  select.addEventListener('change',()=>{settings.setHand(select.value);render();onChange();});render();
}
export function applyWeaponHand(group,hand,bob=0){
  const side=hand==='left'?-1:1;
  // The imported model cancels the legacy .25 origin internally. Mirror that origin too.
  group.scale.x=side;group.position.x=side*(.25+bob);
}
