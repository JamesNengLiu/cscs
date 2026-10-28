import {GUNS} from './public/arsenal.js';
import {resetWeapon} from './public/weapons.js';
import {resetGrenadeThrow} from './public/grenade-state.js';
export const GRENADE_IDS=['hegrenade','flashbang','smokegrenade'];
export function freshLoadout(p){
  const pistol=p.team==='T'?'glock18':'usp',w=GUNS[pistol];
  p.inventory={knife:{ammo:0},[pistol]:{ammo:w.clip,silenced:false,burstMode:false}};
  p.primary=null;p.pistol=pistol;p.ammoPool={[w.ammoType]:w.reserve};p.grenades={hegrenade:0,flashbang:0,smokegrenade:0};
  p.armour=0;p.helmet=false;p.defuseKit=false;p.nightvision=false;p.nightvisionOn=false;p.shield=false;p.shieldRaised=false;p.weapon=pistol;
  p.ammo=w.clip;p.reserve=w.reserve;p.zoom=90;p.silenced=false;p.burstMode=false;
}
export function saveActive(p){const w=GUNS[p.weapon];if(w&&p.inventory?.[p.weapon]){
  p.inventory[p.weapon].ammo=Math.max(0,Math.trunc(p.ammo||0));p.inventory[p.weapon].silenced=!!p.silenced;p.inventory[p.weapon].burstMode=!!p.burstMode;
  p.ammoPool[w.ammoType]=Math.max(0,Math.trunc(p.reserve||0));
}}
// Save the active gun before filling shared pools so switching cannot overwrite a refill.
export function refillAmmo(p,keys=Object.keys(p.inventory)){
  saveActive(p);
  for(const key of keys){const w=GUNS[key],entry=p.inventory[key];if(!w||!entry)continue;
    entry.ammo=w.clip;p.ammoPool[w.ammoType]=w.reserve;
  }
  const active=GUNS[p.weapon];if(active&&p.inventory[p.weapon]){
    p.ammo=p.inventory[p.weapon].ammo;p.reserve=p.ammoPool[active.ammoType]||0;
  }
}
export function ownedWeapons(p,hasBomb=false){return [p.primary,p.pistol,'knife',...GRENADE_IDS.filter(k=>p.grenades[k]>0),hasBomb?'c4':null].filter(Boolean);}
export function activate(p,key,now=0){
  saveActive(p);p.previousWeapon=p.weapon;p.weapon=key;p.reloadAt=0;p.burstRemaining=0;p.fireHeld=false;p.zoom=90;p.shieldRaised=false;
  // Switching weapons cancels the previous sniper shot's pending scope recovery.
  p.resumeZoom=0;p.resumeZoomAt=0;
  resetGrenadeThrow(p);
  const w=GUNS[key],entry=p.inventory[key];p.ammo=w?(entry?.ammo||0):0;p.reserve=w?(p.ammoPool[w.ammoType]||0):0;
  p.silenced=!!entry?.silenced;p.burstMode=!!entry?.burstMode;p.lastShot=-100;p.nextAttackAt=now+.5;resetWeapon(p);
}
