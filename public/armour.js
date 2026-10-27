// Independent implementation of the numeric rules in player.cpp::TakeDamage and
// IsArmored at the pinned commit. Source links and edge cases: docs/cs16-sources.md.

function nonnegative(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function covered(hitgroup, helmet) {
  // Support source hitgroup numbers and descriptive browser names without lookups
  // into Object.prototype. Unknown groups deliberately receive no armour benefit.
  const group = typeof hitgroup === 'string'
    ? hitgroup.toLowerCase().replace(/[-_ ]/g, '') : hitgroup;
  switch (group) {
    case 1: case 'head': return helmet === true;
    case 0: case 2: case 3: case 4: case 5:
    case 'generic': case 'chest': case 'stomach': case 'torso':
    case 'arm': case 'arms': case 'leftarm': case 'rightarm': return true;
    default: return false;
  }
}

/**
 * damage is ALREADY multiplied for hitgroup (head 4, stomach 1.25, legs 0.75).
 * weaponRatio is GUNS[id].armorRatio, multiplying the 0.5 base health fraction.
 * blast=true models the early HE/C4 explosion branch: generic hitgroup, ratio
 * 0.5 independent of weapon, and its distinct low-armour depletion rule.
 * Returns fractional damage and ACTUAL armour spent, not rounded HUD/log values.
 * Does not model VIP, shield, friendly-fire scaling, fall/drowning or blast radius.
 */
export function armourDamage(damage, armour, helmet, hitgroup = 'chest', weaponRatio = 1, blast = false) {
  const incoming = nonnegative(damage);
  const available = nonnegative(armour);
  const explosion = blast === true;
  let spent = 0;
  let healthDamage = incoming;

  if (available > 0 && (explosion || covered(hitgroup, helmet))) {
    const multiplier = Number.isFinite(weaponRatio) ? Math.min(2, Math.max(0, weaponRatio)) : 1;
    const healthFraction = explosion ? 0.5 : multiplier * 0.5;
    const prevented = incoming * (1 - healthFraction);
    const needed = prevented * 0.5;
    spent = Math.min(available, needed);
    // In the source explosion branch, depleted armour prevents only its own
    // remaining value. Bullets instead prevent twice the remaining armour.
    healthDamage = needed > available
      ? incoming - available * (explosion ? 1 : 2)
      : incoming * healthFraction;
  }

  return Object.freeze({ healthDamage, armourDamage: spent, armour: available - spent });
}
