// Pin preparation follows the reference delay; flight fuse starts only on release.
export const GRENADE_TIMING=Object.freeze({pinSeconds:.5,recoverSeconds:.5,retireWithAmmoSeconds:.75});
// Shared client/server transition rules; each side supplies its own simulation clock.
export function grenadeActionPhase(startedAt,now,released,releaseAt=startedAt){
  if(now+1e-8<startedAt)return '';
  if(now+1e-8<startedAt+GRENADE_TIMING.pinSeconds)return 'pin';
  return released&&now+1e-8>=Math.max(releaseAt,startedAt+GRENADE_TIMING.pinSeconds)?'throw':'hold';
}
// Shortened project tuning, retaining a facing/distance-dependent hold then fade.
export const FLASH_TIMING=Object.freeze({frontHold:1,frontFade:3,backHold:.15,backFade:1.35});
export function resetGrenadeThrow(p){
  p.grenadePhase='';p.grenadeStartedAt=0;p.grenadeReleased=false;p.grenadeThrownAt=0;
}
