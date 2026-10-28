// Pin preparation follows the reference delay; flight fuse starts only on release.
export const GRENADE_TIMING=Object.freeze({pinSeconds:.5,recoverSeconds:.5});
// Shortened project tuning, retaining a facing/distance-dependent hold then fade.
export const FLASH_TIMING=Object.freeze({frontHold:1,frontFade:3,backHold:.15,backFade:1.35});
export function resetGrenadeThrow(p){
  p.grenadePhase='';p.grenadeStartedAt=0;p.grenadeReleased=false;p.grenadeThrownAt=0;
}
