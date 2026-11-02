// Room-wide recovery experiment. Only the recovery clock changes; the existing
// velocity multiplier, damage impulse and movement order remain in movement.js.
export const HIT_RECOVERY_PROFILES=Object.freeze({
  baseline:Object.freeze({name:'baseline',version:0,perSecond:.6,referenceHz:60}),
  reference100:Object.freeze({name:'reference100',version:1,perSecond:1,referenceHz:100})
});
export function hitRecoveryProfile(name='baseline'){
  if(!Object.hasOwn(HIT_RECOVERY_PROFILES,name))throw new RangeError('HIT_RECOVERY_PROFILE must be baseline or reference100');
  return HIT_RECOVERY_PROFILES[name];
}
export function recoveryRate(player){return player.hitRecoveryVersion===1?1:.6;}
