import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotBuffer } from '../public/snapshot-buffer.js';

const close = (actual, expected, epsilon = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected} (±${epsilon})`);
const player = (x = 0, extra = {}) => ({
  id: 'remote', x, y: 0, z: 0, yaw: 0, pitch: 0,
  vx: 5, vy: 0, vz: 0, alive: true, team: 'CT', ...extra,
});
const snapshot = (time, players = [player(time * 5)], round = 1) => ({ time, round, players });
const fixed = (delay = 100, extra = {}) => createSnapshotBuffer({
  minDelayMs: delay, maxDelayMs: delay, clockSlewMsPerSecond: 0, ...extra,
});

// These tests use simulated monotonic arrival times, not wall-clock sleeps.
test('empty/default API, detached diagnostics and reset', () => {
  const b = createSnapshotBuffer();
  assert.equal(b.sample('missing', 0), null);
  assert.equal(b.diagnostics().activeEntities, 0);
  assert.equal(b.diagnostics().playbackTimeMs, null);
  assert.equal(b.push(snapshot(0)), true); // Exercise default performance.now().
  assert.ok(b.sample('remote'));
  const d = b.diagnostics();
  d.accepted = -50;
  assert.equal(b.diagnostics().accepted, 1);
  b.reset();
  const after = b.diagnostics();
  assert.equal(after.round, null);
  assert.equal(after.activeEntities, 0);
  assert.equal(after.clockSamples, 0);
  assert.equal(after.accepted, 0);
  assert.equal(after.samples, 0);
  assert.equal(after.clockOffsetMs, null);
  assert.equal(after.estimatedServerTimeMs, null);
  assert.equal(b.push(snapshot(0, [player(9)], 0), 10), true);
  assert.equal(b.sample('remote', 10).x, 9);
});

test('uses actual timestamp brackets rather than latest-target chasing', () => {
  const b = fixed(100);
  b.push(snapshot(0, [player(0)]), 1000);
  b.push(snapshot(0.04, [player(4)]), 1040);
  b.push(snapshot(0.2, [player(8)]), 1200);
  // Playback = 100ms, inside [40,200], NOT inside an assumed 30Hz interval.
  const p = b.sample('remote', 1200);
  close(p.x, 5.5);
  close(b.diagnostics().playbackTimeMs, 100);
  assert.equal(b.diagnostics().interpolations, 1);
  assert.equal(b.sample('remote', 1200).x, p.x); // No repeated-call chase.
  close(b.sample('remote', 1250).x, 6.75);
});

test('lerps all position components/pitch/velocity without overshoot', () => {
  const b = fixed(0, { teleportDistance: 20 });
  b.push(snapshot(0, [player(2, { y: -4, z: 6, pitch: -1, vx: 0, vy: -3, vz: 2 })]), 1000);
  b.push(snapshot(0.1, [player(-2, { y: 4, z: 0, pitch: 1, vx: 4, vy: 3, vz: -2 })]), 1100);
  const a = b.sample('remote', 1025);
  close(a.x, 1); close(a.y, -2); close(a.z, 4.5); close(a.pitch, -0.5);
  close(a.vx, 1); close(a.vy, -1.5); close(a.vz, 1);
  for (let t = 1025; t <= 1200; t++) {
    const p = b.sample('remote', t);
    assert.ok(p.x >= -2 && p.x <= 2);
    assert.ok(p.y >= -4 && p.y <= 4);
    assert.ok(p.z >= 0 && p.z <= 6);
  }
});

test('yaw takes shortest arc across ±pi', () => {
  for (const sign of [-1, 1]) {
    const b = fixed(0);
    b.push(snapshot(0, [player(0, { yaw: sign * 179 * Math.PI / 180 })]), 1000);
    b.push(snapshot(0.1, [player(0, { yaw: -sign * 179 * Math.PI / 180 })]), 1100);
    close(Math.abs(b.sample('remote', 1050).yaw), Math.PI);
    const p = b.sample('remote', 1075);
    close(Math.abs(Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw))), 179.5 * Math.PI / 180);
  }
});

test('large finite yaw angles do not overflow the shortest-arc calculation', () => {
  const b = fixed(0);
  b.push(snapshot(0, [player(0, { yaw: 1e308 })]), 1000);
  b.push(snapshot(0.1, [player(0, { yaw: -1e308 })]), 1100);
  assert.ok(Number.isFinite(b.sample('remote', 1050).yaw));
});

test('same-arrival packet bursts are valid and do not divide by zero', () => {
  const b = createSnapshotBuffer();
  for (let i = 0; i < 8; i++) assert.equal(b.push(snapshot(i / 30), 1000), true);
  const p = b.sample('remote', 1200);
  assert.ok(Number.isFinite(p.x));
  assert.equal(b.diagnostics().jitterMs, 0);
  assert.equal(b.diagnostics().accepted, 8);
});

test('discrete player fields change at timestamp, not early', () => {
  const b = fixed(0);
  b.push(snapshot(0, [player(0, { hp: 100, weapon: 'knife', crouch: false })]), 1000);
  b.push(snapshot(0.1, [player(0.5, { hp: 20, weapon: 'rifle', crouch: true })]), 1100);
  const between = b.sample('remote', 1050);
  assert.equal(between.hp, 100);
  assert.equal(between.weapon, 'knife');
  assert.equal(between.crouch, false);
  const exact = b.sample('remote', 1100);
  assert.equal(exact.hp, 20);
  assert.equal(exact.weapon, 'rifle');
  assert.equal(exact.crouch, true);
});

test('input and output mutations cannot modify retained snapshots', () => {
  const b = fixed(0);
  const a = snapshot(0, [player(0, { inventory: { slots: ['knife'] } })]);
  b.push(a, 1000);
  a.players[0].x = 999;
  a.players[0].inventory.slots.push('mutated-input');
  const output = b.sample('remote', 1000);
  assert.deepEqual(output.inventory, { slots: ['knife'] });
  output.x = -999;
  output.inventory.slots.push('mutated-output');
  const next = b.sample('remote', 1000);
  assert.equal(next.x, 0);
  assert.deepEqual(next.inventory, { slots: ['knife'] });
});

test('out-of-order, duplicates and old rounds cannot mutate roster or clock', () => {
  const b = fixed(50);
  b.push(snapshot(1), 2000);
  b.push(snapshot(1.1), 2100);
  const before = b.diagnostics();
  assert.equal(b.push(snapshot(1.1, []), 2200), false);
  assert.equal(b.push(snapshot(1.05, []), 2300), false);
  assert.equal(b.push(snapshot(99, [], 0), 2400), false);
  const after = b.diagnostics();
  assert.equal(after.activeEntities, 1);
  assert.equal(after.clockOffsetMs, before.clockOffsetMs);
  assert.equal(after.latestArrivalMs, before.latestArrivalMs);
  assert.equal(after.latestServerTimeMs, 1100);
  assert.equal(after.rejectedDuplicate, 1);
  assert.equal(after.rejectedStale, 1);
  assert.equal(after.rejectedOldRound, 1);
});

test('invalid snapshots are rejected atomically, including a malformed new round', () => {
  const b = fixed(50, { maxEntities: 2 });
  b.push(snapshot(0), 1000);
  const invalid = [
    null, {}, { ...snapshot(0.1), time: NaN }, { ...snapshot(0.1), time: '0.1' },
    { ...snapshot(0.1), time: Symbol('invalid') }, { ...snapshot(0.1), time: 1n },
    snapshot(-1), snapshot(Infinity), snapshot(0.1, [], -1), snapshot(0.1, [], 1.5),
    snapshot(0.1, [player(NaN)], 2), snapshot(0.1, [player(Infinity)]),
    snapshot(0.1, [player(0, { yaw: NaN })]),
    snapshot(0.1, [player(0, { pitch: Infinity })]),
    snapshot(0.1, [player(0, { id: '' })]), snapshot(0.1, [player(0, { id: NaN })]),
    snapshot(0.1, [player(), player()]),
    snapshot(0.1, [player(), player(0, { id: 'b' }), player(0, { id: 'c' })]),
    snapshot(0.1, [player(0, { uncloneable: () => 1 })]),
    { ...snapshot(0.1), players: {} },
  ];
  for (const s of invalid) assert.equal(b.push(s, 1100), false);
  assert.equal(b.push(snapshot(0.1), NaN), false);
  assert.equal(b.push(snapshot(0.1), 999), false);
  assert.equal(b.diagnostics().round, 1);
  assert.equal(b.diagnostics().activeEntities, 1);
  assert.equal(b.diagnostics().roundResets, 0);
  assert.equal(b.diagnostics().accepted, 1);
  assert.equal(b.diagnostics().rejectedInvalid, invalid.length + 2);
  assert.equal(b.sample('remote', NaN), null);
  assert.equal(b.diagnostics().playbackTimeMs, null);
  assert.equal(b.push(snapshot(0.1), 1100), true);
});

test('full-roster push removes absent ids immediately and id reuse has no old life', () => {
  const b = fixed(100);
  b.push(snapshot(0, [player(0), player(2, { id: 'other' })]), 1000);
  b.sample('remote', 1050);
  b.push(snapshot(0.1, [player(2.5, { id: 'other' })]), 1100);
  assert.equal(b.sample('remote', 1100), null);
  assert.equal(b.sample('other', 1100).id, 'other');
  b.push(snapshot(0.2, [player(6), player(3, { id: 'other' })]), 1200);
  assert.equal(b.sample('remote', 1200).x, 6); // NOT a blend from old x=0.
  assert.equal(b.diagnostics().entityAdds, 3);
  assert.equal(b.diagnostics().entityRemovals, 1);
  b.push(snapshot(0.3, []), 1300);
  assert.equal(b.diagnostics().activeEntities, 0);
  assert.equal(b.diagnostics().bufferedSnapshots, 0);
  assert.equal(b.sample('other', 1300), null);
});

test('number ids and special string ids remain distinct, with no object prototype keys', () => {
  const b = fixed(0);
  const ids = [1, '1', '__proto__', 'constructor'];
  b.push(snapshot(0, ids.map((id, i) => player(i, { id }))), 1000);
  for (let i = 0; i < ids.length; i++) assert.equal(b.sample(ids[i], 1000).x, i);
  assert.equal(b.sample('absent', 1000), null);
});

for (const [label, oldExtra, newExtra, counter] of [
  ['alive transition / respawn', { alive: false }, { alive: true }, 'spawnResets'],
  ['death', { alive: true }, { alive: false }, 'spawnResets'],
  ['spawnId', { spawnId: 'a' }, { spawnId: 'b' }, 'spawnResets'],
  ['spawnSeq', { spawnSeq: 1 }, { spawnSeq: 2 }, 'spawnResets'],
  ['lifeId', { lifeId: 1 }, { lifeId: 2 }, 'spawnResets'],
  ['team switch', { team: 'CT' }, { team: 'T' }, 'spawnResets'],
  ['teleport marker', {}, { teleport: true }, 'teleportResets'],
  ['teleportId', { teleportId: 1 }, { teleportId: 2 }, 'teleportResets'],
  ['teleportSeq', { teleportSeq: 1 }, { teleportSeq: 2 }, 'teleportResets'],
]) {
  test(`${label} hard-resets actor history even with a small position delta`, () => {
    const b = fixed(100);
    b.push(snapshot(0, [player(0, oldExtra)]), 1000);
    b.push(snapshot(0.1, [player(0.5, newExtra)]), 1100);
    assert.equal(b.sample('remote', 1100).x, 0.5);
    assert.equal(b.diagnostics().bufferedSnapshots, 1);
    assert.equal(b.diagnostics()[counter], 1);
  });
}

test('large teleport snaps immediately without interpolating through intervening geometry', () => {
  const b = fixed(100, { teleportDistance: 3 });
  b.push(snapshot(0, [player(0)]), 1000);
  b.push(snapshot(0.1, [player(10)]), 1100);
  assert.equal(b.sample('remote', 1100).x, 10);
  assert.equal(b.diagnostics().teleportResets, 1);
});

test('long server snapshot gap resets history instead of blending across an outage', () => {
  const b = fixed(100);
  b.push(snapshot(0, [player(0)]), 1000);
  b.push(snapshot(0.5, [player(1)]), 1500);
  assert.equal(b.sample('remote', 1500).x, 1);
  assert.equal(b.diagnostics().gapResets, 1);
  assert.equal(b.diagnostics().bufferedSnapshots, 1);
});

test('higher rounds reset clock/playback, accept server time restart and reject old rounds', () => {
  const b = fixed(50);
  b.push(snapshot(20, [player(1)], 4), 50000);
  b.sample('remote', 50100);
  b.push(snapshot(0, [player(7)], 5), 50110);
  let d = b.diagnostics();
  assert.equal(d.round, 5);
  assert.equal(d.clockOffsetMs, 50110);
  assert.equal(d.playbackTimeMs, null);
  assert.equal(d.roundResets, 1);
  assert.equal(d.bufferedSnapshots, 1);
  assert.equal(b.sample('remote', 50110).x, 7);
  assert.equal(b.push(snapshot(100, [], 4), 50120), false);
  assert.equal(b.sample('remote', 50120).x, 7);
  b.push(snapshot(0.1, [player(7.5)], 5), 50210);
  close(b.sample('remote', 50210).x, 7.25);
  d = b.diagnostics();
  assert.equal(d.accepted, 3);
  assert.equal(d.rejectedOldRound, 1);
});

test('default outage hold is bounded indefinitely and resumes timestamp playback', () => {
  const b = fixed(100);
  b.push(snapshot(0), 1000);
  b.push(snapshot(0.1), 1100);
  b.push(snapshot(0.2), 1200);
  close(b.sample('remote', 1250).x, 0.75);
  for (const t of [1400, 2000, 10000, 1e9]) {
    assert.equal(b.sample('remote', t).x, 1);
    assert.equal(b.diagnostics().playbackTimeMs, 200);
  }
  assert.equal(b.diagnostics().extrapolations, 0);
  assert.equal(b.diagnostics().underflows, 4);
  // Separate normal outage recovery without intentionally sending regressed now.
  const c = fixed(100);
  c.push(snapshot(0), 1000);
  c.push(snapshot(0.1), 1100);
  c.sample('remote', 3000);
  c.push(snapshot(2), 3000);
  assert.equal(c.sample('remote', 3000).x, 10);
  c.push(snapshot(2.1), 3100);
  c.push(snapshot(2.2), 3200);
  close(c.sample('remote', 3200).x, 10.5);
  close(c.sample('remote', 3250).x, 10.75);
  assert.ok(c.diagnostics().interpolations >= 1);
});

test('velocity mode without collision callback still holds (cannot tunnel through walls)', () => {
  const b = fixed(0, { extrapolation: 'velocity' });
  b.push(snapshot(0), 1000);
  assert.equal(b.sample('remote', 1050).x, 0);
  assert.equal(b.sample('remote', 100000).x, 0);
  assert.equal(b.diagnostics().extrapolations, 0);
  assert.equal(b.diagnostics().playbackTimeMs, 0);
});

test('safe velocity extrapolation hard-caps at 80ms, then holds endpoint', () => {
  const contexts = [];
  const b = fixed(0, {
    extrapolation: 'velocity', maxExtrapolationMs: 500,
    canExtrapolate: (from, to, context) => {
      contexts.push(context);
      from.x = 999; to.x = 999; // Callback cannot rewrite output/history.
      return true;
    },
  });
  b.push(snapshot(0), 1000);
  close(b.sample('remote', 1050).x, 0.25);
  close(b.sample('remote', 1100).x, 0.4);
  close(b.sample('remote', 100000).x, 0.4);
  assert.ok(contexts.every(c => c.dtSeconds <= 0.08 && c.fromTime === 0));
  assert.equal(b.diagnostics().extrapolations, 3);
  assert.equal(b.diagnostics().extrapolationClamps, 2);
  assert.equal(b.diagnostics().playbackTimeMs, 80);
});

test('recovery after optional extrapolation never rewinds playback time', () => {
  const b = fixed(0, { extrapolation: 'velocity', canExtrapolate: () => true });
  b.push(snapshot(0), 1000);
  close(b.sample('remote', 1080).x, 0.4);
  const previous = b.diagnostics().playbackTimeMs;
  b.push(snapshot(0.05), 1080);
  close(b.sample('remote', 1080).x, 0.4);
  assert.ok(b.diagnostics().playbackTimeMs >= previous);
  b.push(snapshot(0.1), 1100);
  close(b.sample('remote', 1100).x, 0.5);
  assert.ok(b.diagnostics().playbackTimeMs >= previous);
});

test('collision callback checks swept segment and fails closed on block/throw/non-true', () => {
  const swept = fixed(0, {
    extrapolation: 'velocity',
    canExtrapolate: (from, to) => !(from.x < 0.2 && to.x >= 0.2),
  });
  swept.push(snapshot(0), 1000);
  close(swept.sample('remote', 1020).x, 0.1);
  assert.equal(swept.sample('remote', 1050).x, 0);
  assert.equal(swept.diagnostics().collisionBlocks, 1);
  for (const callback of [() => false, () => undefined, () => ({}), () => { throw Error('collision offline'); }]) {
    const b = fixed(0, { extrapolation: 'velocity', canExtrapolate: callback });
    b.push(snapshot(0), 1000);
    assert.equal(b.sample('remote', 1050).x, 0);
    assert.equal(b.diagnostics().collisionBlocks, 1);
  }
});

test('dead, missing, invalid or implausibly fast velocities never extrapolate', () => {
  for (const extra of [{ alive: false }, { vx: undefined }, { vy: NaN }, { vz: Infinity }, { vx: 100 }]) {
    const b = fixed(0, { extrapolation: 'velocity', canExtrapolate: () => true });
    b.push(snapshot(0, [player(0, extra)]), 1000);
    assert.equal(b.sample('remote', 1050).x, 0);
    assert.equal(b.diagnostics().extrapolations, 0);
  }
});

test('smaller configured extrapolation horizon is respected', () => {
  const b = fixed(0, {
    extrapolation: 'velocity', maxExtrapolationMs: 25, canExtrapolate: () => true,
  });
  b.push(snapshot(0), 1000);
  close(b.sample('remote', 1200).x, 0.125);
  close(b.diagnostics().playbackTimeMs, 25);
});

test('clock lower envelope adapts slowly, does not jump to jittery arrival offsets', () => {
  const b = createSnapshotBuffer({ minDelayMs: 50, maxDelayMs: 50, clockSlewMsPerSecond: 5 });
  b.push(snapshot(0), 1100); // Initial packet is delayed an extra 100ms.
  b.push(snapshot(0.1), 1120); // Observed offset 1020ms, only 20ms elapsed locally.
  close(b.diagnostics().clockOffsetMs, 1099.9);
  let previousOffset = b.diagnostics().clockOffsetMs;
  let previousArrival = 1120;
  for (let i = 2; i <= 700; i++) {
    const time = i / 30;
    const arrival = 1000 + time * 1000 + (i % 3 === 0 ? 10 : 0);
    if (arrival < previousArrival) continue;
    b.push(snapshot(time), arrival);
    const d = b.diagnostics();
    assert.ok(Math.abs(d.clockOffsetMs - previousOffset) <= 5 * (arrival - previousArrival) / 1000 + 1e-8);
    b.sample('remote', arrival);
    previousOffset = d.clockOffsetMs;
    previousArrival = arrival;
  }
  close(b.diagnostics().clockOffsetMs, 1000, 1e-7);
  assert.ok(Number.isFinite(b.diagnostics().estimatedServerTimeMs));
});

test('offset observation window ages out and follows a sustained baseline shift slowly', () => {
  const b = createSnapshotBuffer({ clockWindowMs: 150, clockWindowSamples: 4, clockSlewMsPerSecond: 10 });
  b.push(snapshot(0), 1000);
  b.push(snapshot(0.1), 1100);
  const before = b.diagnostics().clockOffsetMs;
  for (let i = 2; i < 20; i++) b.push(snapshot(i / 10), 1000 + i * 100 + 40);
  const after = b.diagnostics();
  assert.ok(after.clockOffsetMs > before);
  assert.ok(after.clockOffsetMs < 1040);
  assert.ok(after.clockSamples <= 4);
});

test('adaptive delay rises under receive jitter, stays bounded, then relaxes', () => {
  const b = createSnapshotBuffer();
  b.push(snapshot(0), 1000);
  const initial = b.diagnostics().delayMs;
  let lastArrival = 1000;
  for (let i = 1; i <= 180; i++) {
    const arrival = 1000 + i * 100 / 3 + (i % 2 ? 27 : 0);
    assert.ok(arrival >= lastArrival);
    b.push(snapshot(i / 30), arrival);
    lastArrival = arrival;
    const d = b.diagnostics();
    assert.ok(d.delayMs >= 50 && d.delayMs <= 160);
    assert.ok(d.targetDelayMs >= 50 && d.targetDelayMs <= 160);
  }
  const jittered = b.diagnostics();
  assert.ok(jittered.delayMs > initial + 20);
  assert.ok(jittered.jitterMs > 15);
  for (let i = 181; i <= 900; i++) b.push(snapshot(i / 30), 1000 + i * 100 / 3);
  const stable = b.diagnostics();
  assert.ok(stable.delayMs < jittered.delayMs);
  close(stable.delayMs, 2000 / 30, 1e-4);
  assert.ok(stable.jitterMs < 0.001);
});

test('playback never reverses under aggressive delay changes, clock adaptation or regressed now', () => {
  const b = createSnapshotBuffer({ delayRiseMsPerSecond: 5000, clockSlewMsPerSecond: 20 });
  let previousPlayback = -Infinity;
  let previousX = -Infinity;
  for (let i = 0; i < 300; i++) {
    const time = i / 30;
    const arrival = 1000 + time * 1000 + (i % 2 ? 30 : 0);
    b.push(snapshot(time), arrival);
    for (const now of [arrival, arrival - 15, arrival + 1]) {
      const p = b.sample('remote', now);
      const d = b.diagnostics();
      assert.ok(d.playbackTimeMs >= previousPlayback);
      assert.ok(p.x >= previousX - 1e-8);
      previousPlayback = d.playbackTimeMs;
      previousX = p.x;
    }
  }
});

function arrivalTrace() {
  const events = [];
  const jitter = [0, 14, -5, 31, 8, 2, 40, -8];
  for (let i = 0; i <= 120; i++) {
    const time = i / 30;
    // Include a short loss burst and intentionally late / duplicate datagrams.
    if (i >= 45 && i <= 47) continue;
    const arrival = 1000 + time * 1000 + jitter[i % jitter.length];
    events.push({ arrival, data: snapshot(time) });
    if (i % 17 === 0) events.push({ arrival: arrival + 95, data: snapshot(time) });
    if (i % 23 === 0) events.push({ arrival: arrival + 1, data: snapshot(time) });
  }
  return events.sort((a, b) => a.arrival - b.arrival);
}

function runTrace(fps, checkpoints = [2000, 3000, 4000, 5000], options = {}) {
  const b = createSnapshotBuffer(options);
  const events = arrivalTrace();
  const times = new Set(checkpoints);
  for (let frame = 0; frame <= fps * 4; frame++) times.add(1000 + frame * 1000 / fps);
  const points = [];
  let eventIndex = 0, previousPlayback = -Infinity;
  for (const now of [...times].sort((a, b) => a - b)) {
    while (eventIndex < events.length && events[eventIndex].arrival <= now) {
      const event = events[eventIndex++];
      b.push(event.data, event.arrival);
    }
    const p = b.sample('remote', now);
    if (!p) continue;
    const d = b.diagnostics();
    assert.ok(d.playbackTimeMs >= previousPlayback);
    previousPlayback = d.playbackTimeMs;
    assert.ok(p.x >= 0 && p.x <= d.latestServerTimeMs * 5 / 1000 + 1e-8);
    assert.ok(Number.isFinite(p.yaw));
    if (d.playbackTimeMs >= 0 && d.playbackTimeMs <= d.latestServerTimeMs) {
      close(p.x, d.playbackTimeMs * 5 / 1000, 1e-7);
    }
    if (checkpoints.includes(now)) points.push({ now, x: p.x, playback: d.playbackTimeMs });
  }
  return { points, diagnostics: b.diagnostics() };
}

test('variable arrival/reorder/duplicates render consistently at 30/60/120/144Hz', () => {
  const baseline = runTrace(30);
  assert.equal(baseline.points.length, 4);
  assert.ok(baseline.diagnostics.rejectedStale > 0);
  assert.ok(baseline.diagnostics.rejectedDuplicate > 0);
  for (const fps of [60, 120, 144]) {
    const result = runTrace(fps);
    assert.equal(result.points.length, baseline.points.length);
    for (let i = 0; i < result.points.length; i++) {
      close(result.points[i].x, baseline.points[i].x, 1e-7);
      close(result.points[i].playback, baseline.points[i].playback, 1e-7);
    }
    // Network estimator is driven by arrivals, never render frame count.
    close(result.diagnostics.delayMs, baseline.diagnostics.delayMs);
    close(result.diagnostics.clockOffsetMs, baseline.diagnostics.clockOffsetMs);
  }
});

test('frame-rate independence also holds immediately after adaptive-delay jumps', () => {
  const checkpoints = [...new Set(arrivalTrace()
    .filter(e => e.arrival > 1100 && e.arrival < 4900)
    .map(e => e.arrival + 0.001))].sort((a, b) => a - b);
  const options = { delayRiseMsPerSecond: 5000 };
  const baseline = runTrace(30, checkpoints, options);
  for (const fps of [60, 120, 144]) {
    const result = runTrace(fps, checkpoints, options);
    assert.equal(result.points.length, checkpoints.length);
    for (let i = 0; i < checkpoints.length; i++) {
      close(result.points[i].playback, baseline.points[i].playback, 1e-7);
      close(result.points[i].x, baseline.points[i].x, 1e-7);
    }
  }
});

test('10,000 pushes bound history/clock memory and do not retain disappeared ids', () => {
  const b = createSnapshotBuffer({
    maxSnapshots: 8, maxHistoryMs: 150, maxEntities: 3, clockWindowSamples: 7,
  });
  for (let i = 0; i < 10000; i++) {
    const time = i / 30;
    const players = [player(time / 10), player(0, { id: 'stable' }), player(0, { id: `transient-${i}` })];
    assert.equal(b.push(snapshot(time, players), 1000 + time * 1000), true);
    if (i % 101 === 0) {
      const d = b.diagnostics();
      assert.equal(d.activeEntities, 3);
      assert.ok(d.bufferedSnapshots <= 3 * 8);
      assert.ok(d.largestEntityBuffer <= 8);
      assert.ok(d.clockSamples <= 7);
    }
  }
  const d = b.diagnostics();
  assert.equal(d.accepted, 10000);
  assert.equal(d.entityRemovals, 9999);
  assert.equal(d.entityAdds, 10002);
  assert.equal(b.sample('transient-0', 400000), null);
  b.push(snapshot(10000 / 30, []), 1000 + 10000 / 30 * 1000);
  assert.equal(b.diagnostics().bufferedSnapshots, 0);
  assert.equal(b.diagnostics().activeEntities, 0);
});

test('maxHistoryMs keeps a bounded predecessor while hard maxSnapshots wins', () => {
  const byAge = fixed(0, { maxSnapshots: 100, maxHistoryMs: 100 });
  const byCount = fixed(0, { maxSnapshots: 3, maxHistoryMs: 10000 });
  for (let i = 0; i <= 100; i++) {
    for (const b of [byAge, byCount]) b.push(snapshot(i / 100), 1000 + i * 10);
  }
  assert.ok(byAge.diagnostics().largestEntityBuffer <= 12);
  assert.equal(byCount.diagnostics().largestEntityBuffer, 3);
  assert.equal(byAge.sample('remote', 1000).x, 4.45); // Oldest retained predecessor at .89s.
});

test('invalid options fail loudly instead of producing NaN/unbounded buffers', () => {
  for (const options of [
    { snapshotHz: 0 }, { snapshotHz: NaN }, { minDelayMs: -1 },
    { minDelayMs: 100, maxDelayMs: 50 }, { maxDelayMs: Infinity },
    { maxSnapshots: 1 }, { maxSnapshots: 2.5 }, { maxEntities: 0 },
    { clockWindowSamples: Infinity }, { clockWindowMs: 0 },
    { maxHistoryMs: 0 }, { teleportDistance: 0 }, { maxInterpolationGapMs: -1 },
    { extrapolation: 'unsafe' }, { canExtrapolate: true },
    { jitterMultiplier: NaN }, { clockSlewMsPerSecond: -1 },
  ]) assert.throws(() => createSnapshotBuffer(options));
});
