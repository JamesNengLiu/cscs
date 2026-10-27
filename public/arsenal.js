// Independently authored factual catalogue; provenance and limits: docs/cs16-sources.md.
// This is not a Valve-certified or engine-identical implementation.

// Null-prototype records make untrusted id lookups (including __proto__) harmless.
// Every exported record and nested array is immutable; no caller data is merged.
function immutable(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutable));
  if (value !== null && typeof value === 'object') {
    const record = Object.create(null);
    for (const [key, item] of Object.entries(value)) record[key] = immutable(item);
    return Object.freeze(record);
  }
  return value;
}

const BOTH = ['T', 'CT'];
const APPROXIMATE = ['spread', 'moveSpread', 'airSpread', 'heatSpread', 'recovery'];
const ROOT = 'https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/';

export const ARSENAL_SOURCE = immutable({
  project: 'ReGameDLL_CS',
  commit: '4a50c42e85fd3778c2b7d24731c7d30c83bbab01',
  checkedOn: '2026-10-27',
  reference: ROOT,
  documentation: 'docs/cs16-sources.md',
  scope: 'Default non-VIP bomb-map buying; original branches where FIXES changes a value.',
  verifiedFields: ['price', 'teams', 'slot', 'clip', 'reserve', 'ammoType', 'ammoCost',
    'ammoPack', 'damage', 'head', 'armorRatio', 'interval', 'reload', 'pellets',
    'maxSpeed', 'zoom', 'modes', 'automatic'],
  approximateFields: APPROXIMATE,
  unverified: ['GoldSrc spread/recoil equivalence', 'browser timing and prediction equivalence',
    'knife fast-swing timing equivalence'],
  exceptions: {
    shotgunRangeModifier: '1 is an adapter placeholder, not an original exponential falloff; use rangeModel and range.',
    shotgunReload: 'reload is the per-shell delay, with a separate reloadStart; not a whole-magazine duration.',
    eliteInterval: '0.075 is the non-REGAMEDLL_FIXES branch; FIXES uses 0.122.',
    automatic: 'Normal-mode held-trigger repeat: true for all primaries, including M3/Scout/AWP; false for pistols. Glock burst needs a mode override.',
    modes: 'Names describe available actions; primary scalars describe normal, unsilenced, unzoomed fire.',
  },
  sources: {
    pricesAmmo: ROOT + 'weapontype.h#L86-L319',
    teamRestrictions: ROOT + 'weapontype.cpp#L596-L725',
    weaponConstants: ROOT + 'weapons.h#L512-L2091',
    weaponBehavior: ROOT.replace('/blob/', '/tree/') + 'wpn_shared',
    armour: ROOT + 'player.cpp#L905-L1290',
    money: ROOT + 'multiplay_gamerules.cpp#L1903-L2024',
    defaults: ROOT + 'game.cpp#L28-L47',
  },
});

// ammoType preserves the source pool names. Reserve excludes ammunition in clips.
const AMMO = immutable({
  '9mm': { reserve: 120, ammoCost: 20, ammoPack: 30 },
  '45acp': { reserve: 100, ammoCost: 25, ammoPack: 12 },
  '357SIG': { reserve: 52, ammoCost: 50, ammoPack: 13 },
  '50AE': { reserve: 35, ammoCost: 40, ammoPack: 7 },
  '57mm': { reserve: 100, ammoCost: 50, ammoPack: 50 },
  buckshot: { reserve: 32, ammoCost: 65, ammoPack: 8 },
  '556Nato': { reserve: 90, ammoCost: 60, ammoPack: 30 },
  '762Nato': { reserve: 90, ammoCost: 80, ammoPack: 30 },
  '338Magnum': { reserve: 30, ammoCost: 125, ammoPack: 10 },
  '556NatoBox': { reserve: 200, ammoCost: 60, ammoPack: 30 },
});

// UNVERIFIED browser tuning, not extracted CS accuracy/recoil formulae.
// Spread fields are angular half-widths in radians; recovery is heat units/second.
const TUNING = immutable({
  pistol: { spread: 0.008, moveSpread: 0.020, airSpread: 0.100, heatSpread: 0.008, recovery: 4 },
  shotgun: { spread: 0.045, moveSpread: 0.015, airSpread: 0.060, heatSpread: 0.005, recovery: 3 },
  smg: { spread: 0.012, moveSpread: 0.018, airSpread: 0.090, heatSpread: 0.004, recovery: 5 },
  rifle: { spread: 0.004, moveSpread: 0.045, airSpread: 0.180, heatSpread: 0.006, recovery: 4 },
  sniper: { spread: 0.001, moveSpread: 0.080, airSpread: 0.250, heatSpread: 0.010, recovery: 3 },
  machinegun: { spread: 0.009, moveSpread: 0.055, airSpread: 0.220, heatSpread: 0.007, recovery: 3 },
});

function gun(id, name, category, teams, price, clip, ammoType, damage, rangeModifier,
  armorRatio, interval, reload, maxSpeed, extra = {}) {
  return {
    id, name, category, slot: category === 'pistol' ? 2 : 1, teams, price, clip,
    ammoType, ...AMMO[ammoType], damage, head: 4, rangeModifier, armorRatio,
    interval, reload, automatic: category !== 'pistol', pellets: 1, maxSpeed,
    rangeModel: 'exponential', reloadStyle: 'magazine',
    ...TUNING[category], unverifiedFields: APPROXIMATE, ...extra,
  };
}

export const GUNS = immutable(Object.fromEntries([
  gun('glock18', 'Glock 18', 'pistol', BOTH, 400, 20, '9mm', 25, 0.75, 1.05, 0.15, 2.2, 250,
    { modes: ['semi', 'burst'] }),
  gun('usp', 'USP', 'pistol', BOTH, 500, 12, '45acp', 34, 0.79, 1, 0.15, 2.7, 250,
    { modes: ['unsilenced', 'silenced'] }),
  gun('p228', 'P228', 'pistol', BOTH, 600, 13, '357SIG', 32, 0.8, 1.25, 0.15, 2.7, 250),
  gun('deagle', 'Desert Eagle', 'pistol', BOTH, 650, 7, '50AE', 54, 0.81, 1.5, 0.225, 2.2, 250),
  gun('elite', 'Dual Elites', 'pistol', ['T'], 800, 30, '9mm', 36, 0.75, 1.05, 0.075, 4.5, 250),
  gun('fiveseven', 'Five-SeveN', 'pistol', ['CT'], 750, 20, '57mm', 20, 0.885, 1.5, 0.15, 2.7, 250),
  gun('m3', 'M3', 'shotgun', BOTH, 1700, 8, 'buckshot', 20, 1, 1, 0.875, 0.45, 230,
    { pellets: 9, rangeModel: 'linear', range: 3000,
      reloadStyle: 'per-shell', reloadStart: 0.55, unverifiedFields: [...APPROXIMATE, 'rangeModifier'] }),
  gun('xm1014', 'XM1014', 'shotgun', BOTH, 3000, 7, 'buckshot', 20, 1, 1, 0.25, 0.3, 240,
    { pellets: 6, rangeModel: 'linear', range: 3048,
      reloadStyle: 'per-shell', reloadStart: 0.55, unverifiedFields: [...APPROXIMATE, 'rangeModifier'] }),
  gun('mac10', 'MAC-10', 'smg', ['T'], 1400, 30, '45acp', 29, 0.82, 0.95, 0.07, 3.15, 250),
  gun('tmp', 'TMP', 'smg', ['CT'], 1250, 30, '9mm', 20, 0.85, 1, 0.07, 2.12, 250),
  gun('mp5navy', 'MP5 Navy', 'smg', BOTH, 1500, 30, '9mm', 26, 0.84, 1, 0.075, 2.63, 250),
  gun('ump45', 'UMP45', 'smg', BOTH, 1700, 25, '45acp', 30, 0.82, 1, 0.1, 3.5, 250),
  gun('p90', 'P90', 'smg', BOTH, 2350, 50, '57mm', 21, 0.885, 1.5, 0.066, 3.4, 245),
  gun('galil', 'Galil', 'rifle', ['T'], 2000, 35, '556Nato', 30, 0.98, 1.55, 0.0875, 2.45, 240),
  gun('famas', 'FAMAS', 'rifle', ['CT'], 2250, 25, '556Nato', 30, 0.96, 1.4, 0.0825, 3.3, 240,
    { modes: ['auto', 'burst'] }),
  gun('ak47', 'AK-47', 'rifle', ['T'], 2500, 30, '762Nato', 36, 0.98, 1.55, 0.0955, 2.45, 221),
  gun('m4a1', 'M4A1', 'rifle', ['CT'], 3100, 30, '556Nato', 32, 0.97, 1.4, 0.0875, 3.05, 230,
    { modes: ['unsilenced', 'silenced'] }),
  gun('aug', 'AUG', 'rifle', ['CT'], 3500, 30, '556Nato', 32, 0.96, 1.4, 0.0825, 3.3, 240,
    { zoom: [55] }),
  gun('sg552', 'SG552', 'rifle', ['T'], 3500, 30, '556Nato', 33, 0.955, 1.4, 0.0825, 3, 235,
    { zoom: [55] }),
  gun('scout', 'Scout', 'sniper', BOTH, 2750, 10, '762Nato', 75, 0.98, 1.7, 1.25, 2, 260,
    { zoom: [40, 15] }),
  gun('awp', 'AWP', 'sniper', BOTH, 4750, 10, '338Magnum', 115, 0.99, 1.95, 1.45, 2.5, 210,
    { zoom: [40, 10] }),
  gun('g3sg1', 'G3SG1', 'sniper', ['T'], 5000, 20, '762Nato', 80, 0.98, 1.65, 0.25, 3.5, 210,
    { zoom: [40, 15] }),
  gun('sg550', 'SG550', 'sniper', ['CT'], 4200, 30, '556Nato', 70, 0.98, 1.45, 0.25, 3.35, 210,
    { zoom: [40, 15] }),
  gun('m249', 'M249', 'machinegun', BOTH, 5750, 100, '556NatoBox', 32, 0.97, 1.5, 0.1, 4.7, 220),
].map(record => [record.id, record])));

export const EQUIPMENT = immutable(Object.fromEntries([
  ['kevlar', 'Kevlar', 650, BOTH, 1],
  ['assaultsuit', 'Kevlar + Helmet', 1000, BOTH, 1],
  ['defusekit', 'Defuse Kit', 200, ['CT'], 1],
  ['nightvision', 'Night Vision', 1250, BOTH, 1],
  ['shield', 'Tactical Shield', 2200, ['CT'], 1],
  ['hegrenade', 'HE Grenade', 300, BOTH, 1],
  ['flashbang', 'Flashbang', 200, BOTH, 2],
  ['smokegrenade', 'Smoke Grenade', 300, BOTH, 1],
].map(([id, name, price, teams, limit]) => [id, { id, name, price, teams, limit }])));

// Issued for free, deliberately outside both purchase dictionaries.
export const KNIFE = immutable({
  id: 'knife', name: 'Knife', category: 'melee', slot: 3, price: 0,
  purchasable: false, teams: BOTH, maxSpeed: 250, head: 4, armorRatio: 1.7,
  damage: 15, fastSwingDamage: 20, stabDamage: 65, backstabMultiplier: 3,
  swingDistance: 48, stabDistance: 32,
  unverifiedFields: ['fastSwingTiming'],
});
