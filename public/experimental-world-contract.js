// Experimental map boundary only. Legacy modules and their default world stay
// unchanged. Geometry uses Source 2 metres; movement initially keeps the tested
// legacy-metre tuning and does not claim original CS2 movement values.
export const EXPERIMENTAL_WORLD_PROTOCOL = 'lan-strike-experimental-world-v1';
export const SOURCE_UNIT_METRES = .0254;
export const WORLD_COORDINATE_BASIS = 'source-YZX-metres';
export const LEGACY_METER_RULES_VERSION = 'legacy-meter-movement-v1';
export const DEFAULT_CS2_MAP_ID = 'de_dust2-cs2-experimental';

function vector(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new TypeError(`${label} must be a finite three-component vector`);
  }
  return value;
}

export function sourcePointToMeters(value) {
  const [x, y, z] = vector(value, 'Source point');
  return {x: y * SOURCE_UNIT_METRES, y: z * SOURCE_UNIT_METRES, z: x * SOURCE_UNIT_METRES};
}

export function metersPointToSource(value) {
  if (!value || !['x', 'y', 'z'].every(key => Number.isFinite(value[key]))) {
    throw new TypeError('World point must have finite x, y and z');
  }
  return [value.z / SOURCE_UNIT_METRES, value.x / SOURCE_UNIT_METRES, value.y / SOURCE_UNIT_METRES];
}

export function sourceAnglesToView(value) {
  const [pitch, yaw] = vector(value, 'Source angles');
  const radians = yaw * Math.PI / 180 + Math.PI;
  return {yaw: Math.atan2(Math.sin(radians), Math.cos(radians)), pitch: -pitch * Math.PI / 180};
}

const FIELDS = Object.freeze([
  'protocol', 'mapId', 'sourceSHA1', 'collisionSHA256', 'collisionVersion',
  'rulesVersion', 'coordinateBasis', 'metresPerSourceUnit'
]);

export function createWorldContract({
  mapId = DEFAULT_CS2_MAP_ID, sourceSHA1, collisionSHA256,
  collisionVersion = 1, rulesVersion = LEGACY_METER_RULES_VERSION
} = {}) {
  if (typeof mapId !== 'string' || !/^[a-z0-9_-]{1,80}$/.test(mapId)) throw new TypeError('Invalid experimental map ID');
  if (typeof sourceSHA1 !== 'string' || !/^[a-f0-9]{40}$/.test(sourceSHA1)) throw new TypeError('Invalid source SHA-1');
  if (typeof collisionSHA256 !== 'string' || !/^[a-f0-9]{64}$/.test(collisionSHA256)) throw new TypeError('Invalid collision SHA-256');
  if (!Number.isSafeInteger(collisionVersion) || collisionVersion < 1) throw new TypeError('Invalid collision version');
  if (typeof rulesVersion !== 'string' || !/^[a-z0-9_-]{1,80}$/.test(rulesVersion)) throw new TypeError('Invalid rules version');
  return Object.freeze({
    protocol: EXPERIMENTAL_WORLD_PROTOCOL, mapId, sourceSHA1, collisionSHA256,
    collisionVersion, rulesVersion, coordinateBasis: WORLD_COORDINATE_BASIS,
    metresPerSourceUnit: SOURCE_UNIT_METRES
  });
}

export function assertWorldCompatible(expected, received) {
  if (!expected || !received || typeof received !== 'object' || Array.isArray(received)) {
    throw new Error('Experimental world mismatch: missing contract');
  }
  for (const contract of [expected, received]) {
    for (const key of FIELDS) if (!Object.hasOwn(contract, key)) throw new Error(`Experimental world mismatch: missing ${key}`);
    let canonical;
    try { canonical = createWorldContract(contract); }
    catch { throw new Error('Experimental world mismatch: malformed contract'); }
    for (const key of FIELDS) if (contract[key] !== canonical[key]) throw new Error(`Experimental world mismatch: ${key}`);
  }
  // An old map/version or a differently baked collision package cannot enter
  // this experiment by falling back to the legacy game silently.
  for (const key of FIELDS) {
    if (expected[key] !== received[key]) throw new Error(`Experimental world mismatch: ${key}`);
  }
  return true;
}
