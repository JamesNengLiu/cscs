import test from 'node:test';
import assert from 'node:assert/strict';
import { GUNS, EQUIPMENT, KNIFE, ARSENAL_SOURCE } from '../public/arsenal.js';
import { ECONOMY, clampMoney, lossReward } from '../public/economy.js';
import { armourDamage } from '../public/armour.js';

// Independent expected facts from the pinned reference, not generated from GUNS.
// id: price, allowed purchasing teams, clip, damage, armour multiplier, interval, reload, speed
const expected = {
  glock18: [400, 'T,CT', 20, 25, 1.05, .15, 2.2, 250],
  usp: [500, 'T,CT', 12, 34, 1, .15, 2.7, 250],
  p228: [600, 'T,CT', 13, 32, 1.25, .15, 2.7, 250],
  deagle: [650, 'T,CT', 7, 54, 1.5, .225, 2.2, 250],
  elite: [800, 'T', 30, 36, 1.05, .075, 4.5, 250],
  fiveseven: [750, 'CT', 20, 20, 1.5, .15, 2.7, 250],
  m3: [1700, 'T,CT', 8, 20, 1, .875, .45, 230],
  xm1014: [3000, 'T,CT', 7, 20, 1, .25, .3, 240],
  mac10: [1400, 'T', 30, 29, .95, .07, 3.15, 250],
  tmp: [1250, 'CT', 30, 20, 1, .07, 2.12, 250],
  mp5navy: [1500, 'T,CT', 30, 26, 1, .075, 2.63, 250],
  ump45: [1700, 'T,CT', 25, 30, 1, .1, 3.5, 250],
  p90: [2350, 'T,CT', 50, 21, 1.5, .066, 3.4, 245],
  galil: [2000, 'T', 35, 30, 1.55, .0875, 2.45, 240],
  famas: [2250, 'CT', 25, 30, 1.4, .0825, 3.3, 240],
  ak47: [2500, 'T', 30, 36, 1.55, .0955, 2.45, 221],
  m4a1: [3100, 'CT', 30, 32, 1.4, .0875, 3.05, 230],
  aug: [3500, 'CT', 30, 32, 1.4, .0825, 3.3, 240],
  sg552: [3500, 'T', 30, 33, 1.4, .0825, 3, 235],
  scout: [2750, 'T,CT', 10, 75, 1.7, 1.25, 2, 260],
  awp: [4750, 'T,CT', 10, 115, 1.95, 1.45, 2.5, 210],
  g3sg1: [5000, 'T', 20, 80, 1.65, .25, 3.5, 210],
  sg550: [4200, 'CT', 30, 70, 1.45, .25, 3.35, 210],
  m249: [5750, 'T,CT', 100, 32, 1.5, .1, 4.7, 220],
};

test('catalogue has exactly the 24 canonical guns and all reference prices/team flags', () => {
  assert.equal(Object.keys(GUNS).length, 24);
  assert.deepEqual(Object.keys(GUNS).sort(), Object.keys(expected).sort());
  for (const [id, row] of Object.entries(expected)) {
    const g = GUNS[id];
    assert.equal(g.id, id);
    assert.deepEqual([g.price, g.teams.join(','), g.clip, g.damage, g.armorRatio,
      g.interval, g.reload, g.maxSpeed], row, id);
  }
  assert.equal(GUNS.knife, undefined);
  assert.equal(GUNS.hegrenade, undefined);
});

test('every gun has the numeric API and the six pistols use slot 2', () => {
  const pistols = new Set(['glock18', 'usp', 'p228', 'deagle', 'elite', 'fiveseven']);
  for (const g of Object.values(GUNS)) {
    for (const field of ['price', 'clip', 'reserve', 'ammoCost', 'ammoPack', 'damage',
      'head', 'rangeModifier', 'armorRatio', 'interval', 'reload', 'pellets', 'maxSpeed',
      'spread', 'moveSpread', 'airSpread', 'heatSpread', 'recovery']) {
      assert.ok(Number.isFinite(g[field]) && g[field] > 0, `${g.id}.${field}`);
    }
    assert.equal(g.slot, pistols.has(g.id) ? 2 : 1, g.id);
    assert.equal(g.head, 4);
    assert.equal(g.automatic, !pistols.has(g.id), `${g.id} normal-mode held fire`);
    assert.ok(g.name.length > 0 && g.category.length > 0);
    assert.equal(g.pellets, g.id === 'm3' ? 9 : g.id === 'xm1014' ? 6 : 1);
  }
});

test('ammunition pools, carry limits, pack prices and pack sizes match the reference', () => {
  const pools = [
    ['9mm', 120, 20, 30, ['glock18', 'elite', 'tmp', 'mp5navy']],
    ['45acp', 100, 25, 12, ['usp', 'mac10', 'ump45']],
    ['357SIG', 52, 50, 13, ['p228']],
    ['50AE', 35, 40, 7, ['deagle']],
    ['57mm', 100, 50, 50, ['fiveseven', 'p90']],
    ['buckshot', 32, 65, 8, ['m3', 'xm1014']],
    ['556Nato', 90, 60, 30, ['galil', 'famas', 'm4a1', 'aug', 'sg552', 'sg550']],
    ['762Nato', 90, 80, 30, ['ak47', 'scout', 'g3sg1']],
    ['338Magnum', 30, 125, 10, ['awp']],
    ['556NatoBox', 200, 60, 30, ['m249']],
  ];
  let count = 0;
  for (const [type, reserve, cost, pack, ids] of pools) {
    for (const id of ids) {
      const g = GUNS[id];
      assert.deepEqual([g.ammoType, g.reserve, g.ammoCost, g.ammoPack],
        [type, reserve, cost, pack], id);
      count++;
    }
  }
  assert.equal(count, 24);
});

test('range modifiers, scopes, modes and shotgun adapters are explicit', () => {
  const ranges = [.75, .79, .8, .81, .75, .885, 1, 1, .82, .85, .84, .82,
    .885, .98, .96, .98, .97, .96, .955, .98, .99, .98, .98, .97];
  Object.keys(expected).forEach((id, i) => assert.equal(GUNS[id].rangeModifier, ranges[i], id));
  for (const [id, fov] of Object.entries({ aug: [55], sg552: [55], scout: [40, 15],
    awp: [40, 10], g3sg1: [40, 15], sg550: [40, 15] })) {
    assert.deepEqual(GUNS[id].zoom, fov, id);
  }
  assert.deepEqual(GUNS.glock18.modes, ['semi', 'burst']);
  assert.deepEqual(GUNS.famas.modes, ['auto', 'burst']);
  for (const id of ['usp', 'm4a1']) assert.deepEqual(GUNS[id].modes, ['unsilenced', 'silenced']);
  for (const id of ['m3', 'xm1014']) {
    assert.equal(GUNS[id].reloadStyle, 'per-shell');
    assert.equal(GUNS[id].reloadStart, .55);
    assert.equal(GUNS[id].rangeModel, 'linear');
  }
  assert.equal(GUNS.m3.range, 3000);
  assert.equal(GUNS.xm1014.range, 3048);
});

test('all eight equipment prices, teams and carrying limits are correct', () => {
  const rows = {
    kevlar: [650, 'T,CT', 1], assaultsuit: [1000, 'T,CT', 1],
    defusekit: [200, 'CT', 1], nightvision: [1250, 'T,CT', 1],
    shield: [2200, 'CT', 1], hegrenade: [300, 'T,CT', 1],
    flashbang: [200, 'T,CT', 2], smokegrenade: [300, 'T,CT', 1],
  };
  assert.deepEqual(Object.keys(EQUIPMENT).sort(), Object.keys(rows).sort());
  for (const [id, expectedRow] of Object.entries(rows)) {
    const item = EQUIPMENT[id];
    assert.equal(item.id, id);
    assert.deepEqual([item.price, item.teams.join(','), item.limit], expectedRow, id);
  }
  assert.equal(KNIFE.price, 0);
  assert.equal(KNIFE.purchasable, false);
  assert.equal(KNIFE.slot, 3);
  assert.equal(KNIFE.armorRatio, 1.7);
  assert.equal(EQUIPMENT.knife, undefined);
});

function checkImmutable(value) {
  if (value === null || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  if (!Array.isArray(value)) assert.equal(Object.getPrototypeOf(value), null);
  for (const child of Object.values(value)) checkImmutable(child);
}

test('exports are deeply frozen and hostile purchase ids cannot resolve inherited properties', () => {
  for (const value of [GUNS, EQUIPMENT, KNIFE, ARSENAL_SOURCE, ECONOMY]) checkImmutable(value);
  for (const id of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty']) {
    assert.equal(GUNS[id], undefined);
    assert.equal(EQUIPMENT[id], undefined);
  }
  assert.throws(() => { GUNS.ak47.price = 1; }, TypeError);
  assert.throws(() => { GUNS.ak47.teams.push('CT'); }, TypeError);
  assert.throws(() => { GUNS.awp.zoom[0] = 90; }, TypeError);
  assert.throws(() => { EQUIPMENT.__proto__ = { free: true }; }, TypeError);
});

test('provenance pins the commit and unverified tuning remains machine-readable', () => {
  assert.equal(ARSENAL_SOURCE.commit, '4a50c42e85fd3778c2b7d24731c7d30c83bbab01');
  const fields = ['spread', 'moveSpread', 'airSpread', 'heatSpread', 'recovery'];
  assert.deepEqual(ARSENAL_SOURCE.approximateFields, fields);
  for (const g of Object.values(GUNS)) {
    for (const field of fields) assert.ok(g.unverifiedFields.includes(field), `${g.id}.${field}`);
  }
  assert.ok(GUNS.m3.unverifiedFields.includes('rangeModifier'));
  assert.ok(GUNS.xm1014.unverifiedFields.includes('rangeModifier'));
  assert.ok(ARSENAL_SOURCE.exceptions.eliteInterval.includes('0.122'));
});

test('economy uses source bomb-map rewards and cvar defaults except the requested starting balance and round duration', () => {
  const facts = { startMoney: 10000, maxMoney: 16000, killReward: 300, teamKillPenalty: -3300,
    winElimination: 3250, winBomb: 3500, winDefuse: 3250, plantReward: 0, defuseReward: 0,
    plantedLossBonus: 800, lossBase: 1400, lossIncrement: 500, lossMax: 3400,
    lossReset: 1500, lossThreshold: 3000, buySeconds: 90, freezeSeconds: 6,
    roundSeconds: 150, bombSeconds: 45, defuseSeconds: 10, defuseKitSeconds: 5,
    winEliminationOtherMaps: 3000, winTimeout: 3250 };
  for (const [key, value] of Object.entries(facts)) assert.equal(ECONOMY[key], value, key);
});

test('money clamps integer additions and penalties without string concatenation or coercion', () => {
  assert.equal(clampMoney(15900, 300), 16000);
  assert.equal(clampMoney(16000, -3300), 12700);
  assert.equal(clampMoney(100, -3300), 0);
  assert.equal(clampMoney(10.9, 2.8), 12);
  assert.equal(clampMoney(10.9, -2.8), 8);
  assert.equal(clampMoney('1000', 300), 300);
  assert.equal(clampMoney(1000, '300'), 1000);
  assert.equal(clampMoney(20000, -500), 15500);
  assert.equal(clampMoney(-10, 300), 300);
  assert.equal(clampMoney(100, Number.MAX_VALUE), 16000);
  assert.equal(clampMoney(100, -Number.MAX_VALUE), 0);
});

test('lossReward covers only the initial uninterrupted streak and safely caps large counts', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 1000].map(lossReward),
    [0, 1400, 1900, 2400, 2900, 3400, 3400, 3400]);
  assert.equal(lossReward(2.8), 1900);
  assert.equal(lossReward(Number.MAX_VALUE), 3400);
  for (const bad of [-1, NaN, Infinity, -Infinity, '2', null, undefined, {}, 2n, Symbol('x')]) {
    assert.equal(lossReward(bad), 0);
  }
});

const close = (actual, expectedValue) => assert.ok(Math.abs(actual - expectedValue) < 1e-9,
  `${actual} != ${expectedValue}`);

test('armour uses the 0.5 base times the weapon ratio, with damage already hitgroup-scaled', () => {
  assert.deepEqual(armourDamage(100, 100, false), { healthDamage: 50, armourDamage: 25, armour: 75 });
  const head = armourDamage(36 * 4, 100, true, 'head', GUNS.ak47.armorRatio);
  close(head.healthDamage, 111.6);
  close(head.armourDamage, 16.2);
  close(head.armour, 83.8);
  const awp = armourDamage(115, 100, false, 'chest', GUNS.awp.armorRatio);
  close(awp.healthDamage, 112.125);
  assert.ok(Object.isFrozen(head));
});

test('head requires a helmet, torso and arms are covered, legs and unknown groups are not', () => {
  for (const group of ['head', 1]) {
    assert.equal(armourDamage(100, 100, false, group).healthDamage, 100);
    assert.equal(armourDamage(100, 100, true, group).healthDamage, 50);
  }
  for (const group of ['chest', 'stomach', 'torso', 'arms', 'leftArm', 'right_arm', 'generic', 0, 2, 3, 4, 5]) {
    assert.equal(armourDamage(100, 100, false, group).healthDamage, 50, String(group));
  }
  for (const group of ['legs', 'leftleg', 'rightLeg', 'shield', 6, 7, 8, 'unknown', '__proto__', 'constructor', null, {}]) {
    assert.deepEqual(armourDamage(100, 100, true, group),
      { healthDamage: 100, armourDamage: 0, armour: 100 });
  }
});

test('bullet depletion spends the available armour and prevents twice that amount', () => {
  assert.deepEqual(armourDamage(100, 10, true), { healthDamage: 80, armourDamage: 10, armour: 0 });
  assert.deepEqual(armourDamage(100, 25, false), { healthDamage: 50, armourDamage: 25, armour: 0 });
  assert.deepEqual(armourDamage(100, 0, true), { healthDamage: 100, armourDamage: 0, armour: 0 });
  assert.deepEqual(armourDamage(1, .1, true), { healthDamage: .8, armourDamage: .1, armour: 0 });
});

test('explosions ignore weapon/head/leg ratios and preserve the distinct depletion boundary', () => {
  assert.deepEqual(armourDamage(100, 100, false, 'head', 1.95, true),
    { healthDamage: 50, armourDamage: 25, armour: 75 });
  assert.deepEqual(armourDamage(100, 10, false, 'leftleg', 0, true),
    { healthDamage: 90, armourDamage: 10, armour: 0 });
  assert.equal(armourDamage(100, 25, false, 'chest', 1, true).healthDamage, 50);
  close(armourDamage(100, 24.9, false, 'chest', 1, true).healthDamage, 75.1);
});

test('pure helpers reject malformed numeric inputs without invoking user conversion methods', () => {
  const hostile = { valueOf() { throw Error('coercion'); }, toString() { throw Error('coercion'); } };
  for (const bad of [NaN, Infinity, -Infinity, '100', null, undefined, hostile, Symbol('x'), 100n]) {
    assert.equal(clampMoney(100, bad), 100);
    assert.equal(clampMoney(bad, 300), 300);
    assert.equal(armourDamage(bad, 100, true).healthDamage, 0);
    assert.equal(armourDamage(100, bad, true).armour, 0);
  }
  assert.equal(armourDamage(100, 100, true, 'chest', hostile).healthDamage, 50);
  assert.equal(armourDamage(100, 100, true, hostile).healthDamage, 100);
  assert.equal(armourDamage(100, 100, true, 'chest', 999).healthDamage, 100);
  assert.equal(armourDamage(100, 100, true, 'chest', -5).healthDamage, 0);
  assert.deepEqual(armourDamage(-100, -10, true), { healthDamage: 0, armourDamage: 0, armour: 0 });
});
