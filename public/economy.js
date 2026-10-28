import {EQUIPMENT} from './arsenal.js';
// Source-linked reward branches, defaults and integration rules: docs/cs16-sources.md.
// Amounts are dollars; durations are seconds. These are bomb-map defaults.
export const ECONOMY = Object.freeze(Object.assign(Object.create(null), {
  startMoney: 10000, // Explicit project override; original mp_startmoney is 800.
  maxMoney: 16000,
  killReward: 300,
  teamKillPenalty: -3300, // Signed delta, ready for clampMoney.
  winElimination: 3250, // Either team on a bomb map; other map types use 3000.
  winBomb: 3500,
  winDefuse: 3250,
  lossBase: 1400,
  lossIncrement: 500,
  lossMax: 3400, // Largest reachable initial-streak payout, not the source threshold.
  plantReward: 0, // No individual cash in CC4::PrimaryAttack.
  defuseReward: 0, // Defuser gets score points, not a separate cash payment.
  plantedLossBonus: 800, // T team account when the bomb is defused.
  buySeconds: 90,
  freezeSeconds: 6,
  roundSeconds: 150, // Explicit project override: 2.5 minutes; reference mp_roundtime is 5.
  bombSeconds: 45, // mp_c4timer = 45 in the reference, not 35.
  defuseSeconds: 10,
  defuseKitSeconds: 5,
  // Needed by a faithful stateful round controller; a streak count alone is insufficient.
  lossReset: 1500,
  lossThreshold: 3000, // Add 500 only while the shared bonus is below this value.
  winEliminationOtherMaps: 3000,
  winTimeout: 3250,
}));

// No coercion: strings, objects, infinities and NaN are invalid, and become zero.
// Sanitize current first; dollars are whole integers, truncated toward zero.
export function clampMoney(current, delta = 0) {
  const balance = Number.isFinite(current)
    ? Math.max(0, Math.min(ECONOMY.maxMoney, Math.trunc(current))) : 0;
  const change = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  return Math.max(0, Math.min(ECONOMY.maxMoney, balance + change));
}

/**
 * Initial uninterrupted losing streak, counted INCLUDING the current loss:
 * 1..5+ => 1400, 1900, 2400, 2900, 3400. Zero/invalid => no loss reward.
 * Not a complete round-economy state machine: the original shared bonus resets
 * to 1500 after a team breaks >1 losses. See lossReset/lossThreshold and docs.
 * The caller must separately enforce alive-T timeout denial and objective money.
 */
export function lossReward(lossStreak) {
  if (!Number.isFinite(lossStreak) || lossStreak < 1) return 0;
  const increments = Math.min(4, Math.floor(lossStreak) - 1);
  return Math.min(ECONOMY.lossMax, ECONOMY.lossBase + increments * ECONOMY.lossIncrement);
}

// Quote only: the server must separately enforce eligibility and ownership.
export function equipmentPrice(id,player){
  if(!Object.hasOwn(EQUIPMENT,id))return undefined;
  if(id==='assaultsuit'){
    if((player?.armour||0)>=100&&!player?.helmet)return EQUIPMENT.assaultsuit.price-EQUIPMENT.kevlar.price;
    if(player?.helmet&&(player?.armour||0)<100)return EQUIPMENT.kevlar.price;
  }
  return EQUIPMENT[id].price;
}
