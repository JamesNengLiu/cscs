/**
 * Timestamped REMOTE render-state buffer. No dependencies or simulation writes.
 *
 * Integration:
 *   const remotes = createSnapshotBuffer();
 *   // Once per complete authoritative game.snapshot(), NOT once per player:
 *   remotes.push({ time: game.time, round: game.round, players: game.players });
 *   // Use one performance.now() value for all actors in a render frame:
 *   const pose = remotes.sample(playerId, frameNowMs); // player-shaped copy | null
 *   // On disconnect / new server session (including a round counter restart):
 *   remotes.reset();
 *
 * time is server game.time in SECONDS; arrival/sample times are local monotonic
 * MILLISECONDS from the same clock (performance.now by default). round is a
 * nonnegative safe integer. players is the COMPLETE roster, including dead
 * players, each with a unique string/finite-number id and finite x/y/z. Optional
 * yaw/pitch are radians. State must be structured-cloneable. push returns true
 * only for an accepted snapshot; invalid, duplicate and out-of-order snapshots
 * are rejected atomically. Higher rounds start a fresh timeline, even if server
 * time restarts; lower rounds cannot resurrect old actors. Same-round time must
 * strictly increase. receivedAtMs must not decrease within a round.
 *
 * Clock: bounded lower-envelope window of (arrival - server time), slewed at
 * clockSlewMsPerSecond. This estimates a clock offset PLUS minimum observed
 * transit, NOT synchronized wall time or one-way latency. Arrival/server delta
 * deviation feeds a time-weighted jitter EWMA. Delay targets 2 nominal snapshot
 * intervals + jitterMultiplier*jitter, bounded by min/maxDelayMs, with time-based
 * rise/fall limits. Playback is monotonic within a round, including if delay
 * increases, nowMs regresses, or the offset estimate changes. Once sampling
 * starts, push also advances the cursor up to the arrival under the OLD clock
 * and delay before adjusting them. This captures the pre-adjustment time floor
 * independently of how many render frames happened between packets. No
 * frame-count stepping and no exponential chase of the latest position.
 *
 * Membership is authoritative IMMEDIATELY at push: missing ids are deleted;
 * new/reappearing ids hold their first pose until playback catches up. Death /
 * alive changes, spawnId/spawnSeq/lifeId changes, teleportId/teleportSeq changes,
 * teleport:true, team changes, distance > teleportDistance, and gaps greater
 * than maxInterpolationGapMs clear that actor's history immediately. These are
 * deliberate hard discontinuities, never blends across lives/teleports. Send a
 * spawn/teleport token for same-position or small-distance discontinuities;
 * unmarked teleports below the distance threshold cannot be inferred reliably.
 * Only x/y/z, yaw (shortest arc), pitch, vx/vy/vz are blended. All other fields
 * use the earlier timestamp's state until the later timestamp is reached.
 * Outputs and inputs are isolated copies, including nested metadata.
 *
 * Default underflow behavior is HOLD (safe without map/collision access).
 * Optional extrapolation:'velocity' needs finite vx/vy/vz, a live actor, speed
 * <= maxExtrapolationSpeed, AND canExtrapolate(from, proposed, context) === true.
 * That callback must check the ENTIRE swept segment against authoritative
 * collision geometry; endpoint-only checks are insufficient. It receives copies,
 * may not replace coordinates, and exceptions/rejection fall back to hold. No
 * callback means no extrapolation. Horizon is hard-capped at 80ms, then freezes
 * at the collision-approved endpoint. Corrections after optional extrapolation
 * may change position; only playback TIME is guaranteed never to rewind.
 * Interpolation stays within its two endpoints; it does not alter geometry or
 * independently prove the segment collision-free around a corner.
 *
 * Options (all optional; invalid options throw RangeError/TypeError):
 * snapshotHz:30, minDelayMs:50, maxDelayMs:160,
 * initialDelayMs:clamp(2000/snapshotHz, minDelayMs, maxDelayMs),
 * jitterMultiplier:2, delayRiseMsPerSecond:200, delayFallMsPerSecond:10,
 * clockSlewMsPerSecond:5, clockWindowMs:5000, clockWindowSamples:128,
 * maxSnapshots:64 (per actor), maxHistoryMs:1000, maxEntities:128,
 * teleportDistance:8 (world units), maxInterpolationGapMs:250,
 * extrapolation:'hold', maxExtrapolationMs:80 (clamped to 80),
 * maxExtrapolationSpeed:20 (world units/sec), canExtrapolate:undefined.
 * Setting minDelayMs === maxDelayMs gives a fixed delay (useful for tests).
 *
 * Memory: <= maxEntities*maxSnapshots player records, <= clockWindowSamples
 * offset observations, no tombstones/unbounded packet or diagnostic logs. A
 * roster above maxEntities is rejected rather than partially applied. Payload
 * byte/depth limits belong to the transport decoder, not this render module.
 * diagnostics() returns a detached scalar summary: effective/target delay,
 * jitter/clock/playback times, current occupancy and cumulative counters.
 * Sample counters (including underflows) count actor sample calls, NOT packets
 * or outage episodes; they naturally depend on render rate. reset() clears all
 * state AND counters; automatic round reset keeps cumulative counters.
 */
export function createSnapshotBuffer(options = {}) {
  const finite = (name, fallback, min = 0, integer = false) => {
    const value = options[name] ?? fallback;
    if (!Number.isFinite(value) || value < min || (integer && !Number.isSafeInteger(value))) {
      throw new RangeError(`Invalid ${name}`);
    }
    return value;
  };
  const snapshotHz = finite('snapshotHz', 30, Number.MIN_VALUE);
  const minDelayMs = finite('minDelayMs', 50);
  const maxDelayMs = finite('maxDelayMs', 160, minDelayMs);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const baseDelayMs = clamp(2000 / snapshotHz, minDelayMs, maxDelayMs);
  const initialDelayMs = clamp(finite('initialDelayMs', baseDelayMs), minDelayMs, maxDelayMs);
  const jitterMultiplier = finite('jitterMultiplier', 2);
  const delayRise = finite('delayRiseMsPerSecond', 200);
  const delayFall = finite('delayFallMsPerSecond', 10);
  const clockSlew = finite('clockSlewMsPerSecond', 5);
  const clockWindowMs = finite('clockWindowMs', 5000, Number.MIN_VALUE);
  const clockWindowSamples = finite('clockWindowSamples', 128, 1, true);
  const maxSnapshots = finite('maxSnapshots', 64, 2, true);
  const maxHistoryMs = finite('maxHistoryMs', 1000, Number.MIN_VALUE);
  const maxEntities = finite('maxEntities', 128, 1, true);
  const teleportDistance = finite('teleportDistance', 8, Number.MIN_VALUE);
  const maxInterpolationGapMs = finite('maxInterpolationGapMs', 250, Number.MIN_VALUE);
  const maxExtrapolationMs = Math.min(80, finite('maxExtrapolationMs', 80));
  const maxExtrapolationSpeed = finite('maxExtrapolationSpeed', 20);
  const extrapolation = options.extrapolation ?? 'hold';
  const canExtrapolate = options.canExtrapolate;
  if (!['hold', 'velocity'].includes(extrapolation)) throw new TypeError('Invalid extrapolation');
  if (canExtrapolate !== undefined && typeof canExtrapolate !== 'function') {
    throw new TypeError('canExtrapolate must be a function');
  }
  const extrapolationHorizonMs = extrapolation === 'velocity' && canExtrapolate
    ? maxExtrapolationMs : 0;

  const actors = new Map();
  let round, latestTimeMs, lastArrivalMs, clockOffsetMs, playbackTimeMs, lastNowMs;
  let clockObservations, jitterMs, delayMs, targetDelayMs, stats;
  const clone = value => structuredClone(value);
  const moveToward = (value, target, step) => target > value
    ? Math.min(target, value + step) : Math.max(target, value - step);
  const spawnKey = p => p.spawnId ?? p.spawnSeq ?? p.lifeId;
  const teleportKey = p => p.teleportId ?? p.teleportSeq;

  function clearTimeline() {
    actors.clear();
    latestTimeMs = lastArrivalMs = clockOffsetMs = playbackTimeMs = lastNowMs = undefined;
    clockObservations = [];
    jitterMs = 0;
    delayMs = initialDelayMs;
    targetDelayMs = baseDelayMs;
  }

  function reset() {
    round = undefined;
    clearTimeline();
    stats = {
      pushes: 0, accepted: 0, rejectedInvalid: 0, rejectedDuplicate: 0,
      rejectedStale: 0, rejectedOldRound: 0, roundResets: 0,
      entityAdds: 0, entityRemovals: 0, discontinuities: 0,
      spawnResets: 0, teleportResets: 0, gapResets: 0,
      samples: 0, misses: 0, interpolations: 0, holds: 0,
      startupHolds: 0, underflows: 0, extrapolations: 0,
      extrapolationClamps: 0, collisionBlocks: 0,
    };
  }
  reset();

  function push(snapshot, receivedAtMs = performance.now()) {
    stats.pushes++;
    // Validate/copy before any membership, clock or round mutation.
    const timeMs = typeof snapshot?.time === 'number' ? snapshot.time * 1000 : NaN;
    if (!snapshot || !Number.isFinite(snapshot.time) || !Number.isFinite(timeMs) ||
        snapshot.time < 0 || !Number.isSafeInteger(snapshot.round) || snapshot.round < 0 ||
        !Number.isFinite(receivedAtMs) || !Number.isFinite(receivedAtMs - timeMs) ||
        !Array.isArray(snapshot.players) ||
        snapshot.players.length > maxEntities) {
      stats.rejectedInvalid++;
      return false;
    }
    if (round !== undefined && snapshot.round < round) {
      stats.rejectedOldRound++;
      return false;
    }
    if (snapshot.round === round && timeMs <= latestTimeMs) {
      if (timeMs === latestTimeMs) stats.rejectedDuplicate++;
      else stats.rejectedStale++;
      return false;
    }
    if (snapshot.round === round && (receivedAtMs < lastArrivalMs ||
        !Number.isFinite(receivedAtMs - lastArrivalMs))) {
      stats.rejectedInvalid++;
      return false;
    }
    const ids = new Set();
    for (const p of snapshot.players) {
      if (!p || !((typeof p.id === 'string' && p.id.length > 0) ||
          (typeof p.id === 'number' && Number.isFinite(p.id))) || ids.has(p.id) ||
          !['x', 'y', 'z'].every(k => Number.isFinite(p[k])) ||
          !['yaw', 'pitch'].every(k => p[k] === undefined || Number.isFinite(p[k]))) {
        stats.rejectedInvalid++;
        return false;
      }
      ids.add(p.id);
    }
    let players;
    try { players = clone(snapshot.players); }
    catch { stats.rejectedInvalid++; return false; }

    if (snapshot.round === round && playbackTimeMs !== undefined) {
      // Capture the maximum before a discrete estimator update. Otherwise a
      // high-Hz renderer might see a pre-update peak that a low-Hz one misses,
      // making the monotonic freeze after a delay increase frame-rate dependent.
      const beforeUpdate = receivedAtMs - clockOffsetMs - delayMs;
      playbackTimeMs = Math.max(playbackTimeMs,
        Math.min(beforeUpdate, latestTimeMs + extrapolationHorizonMs));
    }
    if (round !== undefined && snapshot.round > round) {
      stats.roundResets++;
      stats.entityRemovals += actors.size;
      clearTimeline();
    }
    round = snapshot.round;
    const observation = receivedAtMs - timeMs;
    clockObservations.push({ arrival: receivedAtMs, offset: observation });
    while (clockObservations.length > clockWindowSamples ||
        (clockObservations.length > 1 && clockObservations[0].arrival < receivedAtMs - clockWindowMs)) {
      clockObservations.shift();
    }
    if (clockOffsetMs === undefined) {
      clockOffsetMs = observation;
    } else {
      const elapsedMs = receivedAtMs - lastArrivalMs;
      const serverDeltaMs = timeMs - latestTimeMs;
      // Time-weighted EWMA: comparable adaptation at different snapshot rates.
      const weight = -Math.expm1(-elapsedMs / 500);
      jitterMs += (Math.abs(elapsedMs - serverDeltaMs) - jitterMs) * weight;
      let offsetTarget = observation;
      for (const sample of clockObservations) offsetTarget = Math.min(offsetTarget, sample.offset);
      clockOffsetMs = moveToward(clockOffsetMs, offsetTarget, clockSlew * (elapsedMs / 1000));
      targetDelayMs = clamp(baseDelayMs + jitterMultiplier * jitterMs, minDelayMs, maxDelayMs);
      const rate = targetDelayMs > delayMs ? delayRise : delayFall;
      delayMs = moveToward(delayMs, targetDelayMs, rate * (elapsedMs / 1000));
    }
    latestTimeMs = timeMs;
    lastArrivalMs = receivedAtMs;

    for (const id of actors.keys()) {
      if (!ids.has(id)) { actors.delete(id); stats.entityRemovals++; }
    }
    for (const player of players) {
      let history = actors.get(player.id);
      if (!history) {
        history = [];
        actors.set(player.id, history);
        stats.entityAdds++;
      } else {
        const previous = history[history.length - 1];
        const p = previous.player;
        const spawn = p.alive !== player.alive || p.team !== player.team ||
          spawnKey(p) !== spawnKey(player);
        const teleport = player.teleport === true || teleportKey(p) !== teleportKey(player) ||
          Math.hypot(player.x - p.x, player.y - p.y, player.z - p.z) > teleportDistance;
        const gap = timeMs - previous.timeMs > maxInterpolationGapMs;
        if (spawn || teleport || gap) {
          history.length = 0;
          stats.discontinuities++;
          if (spawn) stats.spawnResets++;
          if (teleport) stats.teleportResets++;
          if (gap) stats.gapResets++;
        }
      }
      history.push({ timeMs, player });
      while (history.length > maxSnapshots ||
          (history.length > 2 && history[1].timeMs < timeMs - maxHistoryMs)) {
        history.shift();
      }
    }
    stats.accepted++;
    return true;
  }

  function sample(playerId, nowMs = performance.now()) {
    stats.samples++;
    if (!Number.isFinite(nowMs) || latestTimeMs === undefined ||
        !Number.isFinite(nowMs - clockOffsetMs)) {
      stats.misses++;
      return null;
    }
    // One shared monotonic timeline, not a per-actor frame-count accumulator.
    lastNowMs = lastNowMs === undefined ? nowMs : Math.max(lastNowMs, nowMs);
    const desired = lastNowMs - clockOffsetMs - delayMs;
    const capped = Math.min(desired, latestTimeMs + extrapolationHorizonMs);
    playbackTimeMs = playbackTimeMs === undefined ? capped : Math.max(playbackTimeMs, capped);
    const history = actors.get(playerId);
    if (!history) { stats.misses++; return null; }
    const first = history[0];
    const newest = history[history.length - 1];
    if (playbackTimeMs < first.timeMs) {
      stats.holds++;
      stats.startupHolds++;
      return clone(first.player);
    }
    if (playbackTimeMs >= newest.timeMs) {
      const beyondMs = Math.max(0, playbackTimeMs - newest.timeMs);
      // desired detects continuing outage even when the playback cursor is capped.
      if (desired > newest.timeMs || beyondMs > 0) stats.underflows++;
      const p = newest.player;
      if (beyondMs > 0 && extrapolation === 'velocity' && canExtrapolate &&
          p.alive !== false && ['vx', 'vy', 'vz'].every(k => Number.isFinite(p[k])) &&
          Math.hypot(p.vx, p.vy, p.vz) <= maxExtrapolationSpeed) {
        const dtMs = Math.min(beyondMs, maxExtrapolationMs);
        const proposed = clone(p);
        proposed.x += p.vx * dtMs / 1000;
        proposed.y += p.vy * dtMs / 1000;
        proposed.z += p.vz * dtMs / 1000;
        let safe = false;
        try {
          safe = canExtrapolate(clone(p), clone(proposed), {
            playerId, round, fromTime: newest.timeMs / 1000,
            toTime: (newest.timeMs + dtMs) / 1000, dtSeconds: dtMs / 1000,
          }) === true;
        } catch { /* Collision failures must fail closed. */ }
        if (safe) {
          stats.extrapolations++;
          if (desired - newest.timeMs > maxExtrapolationMs) stats.extrapolationClamps++;
          return proposed;
        }
        stats.collisionBlocks++;
      }
      stats.holds++;
      return clone(p);
    }
    for (let i = 1; i < history.length; i++) {
      const b = history[i];
      if (playbackTimeMs >= b.timeMs) continue;
      const a = history[i - 1];
      const alpha = clamp((playbackTimeMs - a.timeMs) / (b.timeMs - a.timeMs), 0, 1);
      const result = clone(a.player);
      for (const k of ['x', 'y', 'z', 'pitch', 'vx', 'vy', 'vz']) {
        if (Number.isFinite(a.player[k]) && Number.isFinite(b.player[k])) {
          // Convex combination avoids both overshoot and b-a overflow.
          result[k] = a.player[k] * (1 - alpha) + b.player[k] * alpha;
        }
      }
      if (Number.isFinite(a.player.yaw) && Number.isFinite(b.player.yaw)) {
        const yawA = Math.atan2(Math.sin(a.player.yaw), Math.cos(a.player.yaw));
        const yawB = Math.atan2(Math.sin(b.player.yaw), Math.cos(b.player.yaw));
        const delta = yawB - yawA;
        result.yaw = yawA + Math.atan2(Math.sin(delta), Math.cos(delta)) * alpha;
      }
      if(a.player.playerSequence===b.player.playerSequence&&Number.isFinite(a.player.playerFrame)&&Number.isFinite(b.player.playerFrame)&&b.player.playerFrame>=a.player.playerFrame){result.playerFrame=a.player.playerFrame*(1-alpha)+b.player.playerFrame*alpha;}
      stats.interpolations++;
      return result;
    }
    // All finite, strictly increasing timestamps are handled above.
    stats.holds++;
    return clone(newest.player);
  }

  function diagnostics() {
    let bufferedSnapshots = 0, largestEntityBuffer = 0;
    for (const history of actors.values()) {
      bufferedSnapshots += history.length;
      largestEntityBuffer = Math.max(largestEntityBuffer, history.length);
    }
    return {
      ...stats, round: round ?? null, delayMs, targetDelayMs, jitterMs,
      clockOffsetMs: clockOffsetMs ?? null,
      estimatedServerTimeMs: lastNowMs === undefined ? null : lastNowMs - clockOffsetMs,
      playbackTimeMs: playbackTimeMs ?? null, latestServerTimeMs: latestTimeMs ?? null,
      latestArrivalMs: lastArrivalMs ?? null, activeEntities: actors.size,
      bufferedSnapshots, largestEntityBuffer, clockSamples: clockObservations.length,
      maxSnapshots, maxEntities, maxHistoryMs,
    };
  }

  return { push, sample, reset, diagnostics };
}
