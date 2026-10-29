import {createBonePose} from './bone-pose.js';
// GoldSrc player rendering. Assets are supplied separately; no retail mesh data here.
import {createRigidSkinning} from './rigid-skinning.js';
export const ORIGINAL_PLAYER_IDS = Object.freeze('terror leet arctic guerilla urban gsg9 sas gign'.split(' '));
export const PLAYER_MODEL_IDS = Object.freeze([...ORIGINAL_PLAYER_IDS, ...ORIGINAL_PLAYER_IDS.slice(0, 4).map(id => `${id}_trump`)]);
const BASE = '/assets/players/';
const LIMIT = {json: 64 * 1024 * 1024, manifest: 1024 * 1024, vertices: 500000, samples: 24000000};
const SHA = /^[a-f0-9]{64}$/;
const check = (yes, message) => { if (!yes) throw new Error(message); };
const index = (n, size) => Number.isInteger(n) && n >= 0 && n < size;
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const caches = new WeakMap();
function cacheFor(THREE) {
  if (!caches.has(THREE)) caches.set(THREE, {manifest: null, models: new Map(), textures: new Map()});
  return caches.get(THREE);
}
function array(value, max, label, min = 0) {
  check(Array.isArray(value) && value.length >= min && value.length <= max, `Invalid ${label} array`);
  return value;
}
function pathFor(file) {
  check(typeof file === 'string' && file.length <= 240 && /^[a-zA-Z0-9_./-]+\.json$/.test(file)
    && !file.startsWith('/') && !file.split('/').some(p => p === '..' || p === '.' || !p), 'Unsafe model path');
  return BASE + file;
}
async function fetchJSON(url, max, expectedHash) {
  if (expectedHash != null) check(SHA.test(expectedHash), 'Invalid converted SHA256');
  const response = await fetch(url, {signal: AbortSignal.timeout(20000)});
  check(response.ok, `${url}: HTTP ${response.status}`);
  check(Number(response.headers?.get('content-length') || 0) <= max, 'JSON exceeds byte limit');
  let bytes;
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = [];
    let count = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        count += value.byteLength;
        check(count <= max, 'JSON exceeds byte limit');
        chunks.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
    check(bytes.byteLength <= max, 'JSON exceeds byte limit');
  }
  let verified = false;
  if (expectedHash && globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const actual = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    check(actual === expectedHash, 'Converted model SHA256 mismatch');
    verified = true;
  }
  return {data: JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)), verified};
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    if (Array.isArray(value)) { for (const child of value) if (typeof child === 'object') freeze(child); }
    else for (const key of Object.keys(value)) if (typeof value[key] === 'object') freeze(value[key]);
  }
  return value;
}
function manifestFor(cache) {
  if (!cache.manifest) cache.manifest = fetchJSON(BASE + 'manifest.json', LIMIT.manifest).then(({data}) => {
    check(data.schema === 'goldsrc-players-v1' && data.models && typeof data.models === 'object'
      && !Array.isArray(data.models) && Object.keys(data.models).length <= 64, 'Invalid player manifest');
    if (data.weapons) check(typeof data.weapons === 'object' && !Array.isArray(data.weapons)
      && Object.keys(data.weapons).length <= 64, 'Invalid third-person weapon manifest');
    return freeze(data);
  }).catch(error => { cache.manifest = null; throw error; });
  return cache.manifest;
}
function validate(data, id, entry, weapon) {
  const schemas = weapon ? ['goldsrc-player-weapon-v1', 'goldsrc-worldmodel-v1', 'goldsrc-player-v1'] : ['goldsrc-player-v1'];
  check(schemas.includes(data?.schema) && data.metadata?.id === id, 'Wrong player model schema/id');
  const source = weapon || ORIGINAL_PLAYER_IDS.includes(id) ? 'original-mdl' : 'custom-trump-face';
  check(entry.source === source && data.metadata.source === source, 'Inconsistent source provenance');
  if (source === 'original-mdl') check(SHA.test(entry.sourceSHA256) && data.metadata.sourceSHA256 === entry.sourceSHA256, 'Invalid original MDL SHA256 provenance');
  else {
    check(SHA.test(entry.baseSourceSHA256) && data.metadata.baseSourceSHA256 === entry.baseSourceSHA256, 'Invalid custom baseSourceSHA256 provenance');
    if (entry.sourceSHA256) check(SHA.test(entry.sourceSHA256) && data.metadata.sourceSHA256 === entry.sourceSHA256, 'Inconsistent custom sourceSHA256');
  }
  array(data.bones, 128, 'bones', 1);
  array(data.controllers || [], 64, 'controllers');
  for (const c of data.controllers || []) check(index(c.bone, data.bones.length) && [c.type, c.start, c.end, c.rest].every(Number.isFinite), 'Invalid bone controller');
  for (let i = 0; i < data.bones.length; i++) {
    const b = data.bones[i];
    check(typeof b.name === 'string' && b.name.length <= 128 && Number.isInteger(b.parent) && b.parent >= -1 && b.parent < i, 'Invalid bone hierarchy');
    for (const key of ['value', 'scale']) check(array(b[key], 6, `bone ${key}`, 6).every(Number.isFinite), 'Invalid bone transform');
    check(array(b.controllers || [-1, -1, -1, -1, -1, -1], 6, 'bone controllers', 6).every(c => c === -1 || index(c, (data.controllers || []).length)), 'Invalid bone controller index');
  }
  array(data.textures, 128, 'textures', 1);
  let pixels = 0;
  for (const t of data.textures) {
    check(/^texture-\d+\.png$/.test(t.file) && Number.isInteger(t.width) && Number.isInteger(t.height)
      && t.width > 0 && t.height > 0 && t.width <= 4096 && t.height <= 4096 && Number.isInteger(t.flags), 'Invalid texture');
    pixels += t.width * t.height;
  }
  check(pixels <= 16777216, 'Texture pixel budget exceeded');
  array(data.skins, 256, 'skins', 1);
  const skinSize = array(data.skins[0], 256, 'skin references', 1).length;
  for (const skin of data.skins) check(array(skin, skinSize, 'skin', skinSize).every(t => index(t, data.textures.length)), 'Invalid skin texture');
  array(data.bodyparts, 64, 'bodyparts', 1);
  for (const b of data.bodyparts) {
    array(b.models, 64, 'bodypart models', 1);
    check(Number.isInteger(b.base) && b.base > 0, 'Invalid bodypart base');
  }
  array(data.meshes, 1024, 'meshes', 1);
  let vertices = 0, indices = 0;
  for (const m of data.meshes) {
    const n = array(m.vertexBones, LIMIT.vertices, 'vertex bones', 1).length;
    vertices += n;
    check(vertices <= LIMIT.vertices, 'Vertex budget exceeded');
    for (const [key, stride] of [['positions', 3], ['normals', 3], ['uvPixels', 2]]) check(array(m[key], n * stride, key, n * stride).every(Number.isFinite), 'Invalid geometry samples');
    check(array(m.normalBones, n, 'normal bones', n).every(b => index(b, data.bones.length))
      && m.vertexBones.every(b => index(b, data.bones.length)), 'Invalid vertex bone');
    indices += array(m.indices, 3000000, 'indices', 3).length;
    check(indices <= 3000000 && m.indices.length % 3 === 0 && m.indices.every(v => index(v, n)), 'Invalid triangle index');
    check(index(m.bodypart, data.bodyparts.length) && index(m.model, data.bodyparts[m.bodypart].models.length)
      && index(m.skinref, skinSize), 'Invalid mesh body/skin reference');
  }
  for (const a of array(data.attachments || [], 64, 'attachments')) check(index(a.bone, data.bones.length)
    && array(a.origin, 3, 'attachment origin', 3).every(Number.isFinite), 'Invalid attachment');
  array(data.sequences, 1024, 'sequences');
  let samples = 0;
  for (const s of data.sequences) {
    check(typeof s.name === 'string' && s.name.length <= 128 && Number.isInteger(s.frames) && s.frames > 0 && s.frames <= 10000
      && Number.isFinite(s.fps) && s.fps > 0 && s.fps <= 1000 && Number.isInteger(s.blendCount) && s.blendCount > 0 && s.blendCount <= 16, 'Invalid sequence');
    if (s.motionBone != null) check(index(s.motionBone, data.bones.length), 'Invalid motion bone');
    for (const key of ['blendStart', 'blendEnd', 'blendType']) if (s[key]) check(array(s[key], 2, key, 2).every(Number.isFinite), 'Invalid blend range');
    const validateTracks = tracks => {
      array(tracks, data.bones.length, 'animation bones', data.bones.length);
      for (const channels of tracks) for (const c of array(channels, 6, 'animation channels', 6)) {
        if (c == null) continue;
        samples += array(c.values, s.frames, 'animation samples', s.frames).length;
        check(samples <= LIMIT.samples, 'Animation sample budget exceeded');
        check(c.values.every(v => Number.isInteger(v) && v >= -32768 && v <= 32767), 'Invalid animation sample');
        if (c.positionHold) check(array(c.positionHold, s.frames, 'positionHold').every(v => index(v, s.frames)), 'Invalid positionHold');
      }
    };
    if (s.tracks) validateTracks(s.tracks);
    if (s.blendTracks) {
      array(s.blendTracks, s.blendCount, 'blend tracks', s.blendCount);
      for (const tracks of s.blendTracks) validateTracks(tracks);
    }
  }
}
async function modelFor(cache, id, entry, weapon = false) {
  check(entry?.file, weapon ? 'Third-person weapon asset missing' : 'Player asset not imported');
  const url = pathFor(entry.file), key = `${url}:${entry.convertedSHA256 || ''}`;
  if (!cache.models.has(key)) {
    if (cache.models.size >= 16) cache.models.delete(cache.models.keys().next().value);
    const promise = fetchJSON(url, LIMIT.json, entry.convertedSHA256).then(result => {
      validate(result.data, id, entry, weapon);
      return {...result, data: freeze(result.data), url, key, entry: freeze({...entry})};
    }).catch(error => { cache.models.delete(key); throw error; });
    cache.models.set(key, promise);
  }
  const asset = await cache.models.get(key);
  // A changed manifest entry cannot inherit a previous identity from the cache.
  validateProvenance(asset, id, entry);
  return asset;
}
function validateProvenance(asset, id, entry) {
  check(asset.data.metadata.id === id && asset.data.metadata.source === entry.source
    && (entry.sourceSHA256 == null || asset.data.metadata.sourceSHA256 === entry.sourceSHA256)
    && asset.data.metadata.baseSourceSHA256 === entry.baseSourceSHA256, 'Cached asset provenance mismatch');
}
async function texturesFor(THREE, cache, asset) {
  let shared = cache.textures.get(asset.key);
  if (!shared) {
    shared = {refs: 0, promise: null};
    shared.promise = (async () => {
      const loader = new THREE.TextureLoader(), directory = asset.url.slice(0, asset.url.lastIndexOf('/') + 1);
      const loaded = await Promise.allSettled(asset.data.textures.map(t => loader.loadAsync(directory + t.file)));
      try {
        check(loaded.every(r => r.status === 'fulfilled'), 'Player texture load failed');
        return loaded.map((r, i) => {
          const texture = r.value, spec = asset.data.textures[i];
          check(texture.image?.width === spec.width && texture.image?.height === spec.height, 'Texture dimensions mismatch');
          texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.magFilter = THREE.LinearFilter;
          texture.minFilter = spec.flags & 8 ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
          texture.generateMipmaps = !(spec.flags & 8); texture.needsUpdate = true;
          return texture;
        });
      } catch (error) {
        for (const r of loaded) if (r.status === 'fulfilled') r.value.dispose();
        throw error;
      }
    })();
    cache.textures.set(asset.key, shared);
  }
  shared.refs++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (--shared.refs === 0) {
      if (cache.textures.get(asset.key) === shared) cache.textures.delete(asset.key);
      shared.promise.then(textures => textures.forEach(t => t.dispose()), () => {});
    }
  };
  try { return {textures: await shared.promise, release}; }
  catch (error) { release(); throw error; }
}
function world(object) {
  object.layers.set(0);
  object.renderOrder = 0;
  if (object.isMesh) { object.frustumCulled = false; object.material.depthTest = object.material.depthWrite = true; }
}
function placeholder(THREE, id) {
  const root = new THREE.Group(); root.name = `missing-player:${id}`;
  const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.38), new THREE.MeshBasicMaterial({color: 0xff00ff, wireframe: true}));
  mesh.position.y = 0.9; root.add(mesh); root.traverse(world);
  return {root, dispose() { mesh.geometry.dispose(); mesh.material.dispose(); }};
}
function buildPose(THREE, asset, shared, skinningMode) {
  const data = asset.data, root = new THREE.Group();
  const matrices = data.bones.map(() => new THREE.Matrix4());
  const skinning = createRigidSkinning(THREE, matrices, skinningMode);
  root.name = `${data.metadata.source}:${data.metadata.id}`;
  root.matrixAutoUpdate = false;
  // Determinant +1 before uniform scale: source +X forward maps to world -Z.
  root.matrix.set(0, -1 / 40, 0, 0, 0, 0, 1 / 40, 0.9, -1 / 40, 0, 0, 0, 0, 0, 0, 1);
  const materials = shared.textures.map((map, i) => new THREE.MeshBasicMaterial({map,
    alphaTest: data.textures[i].flags & 64 ? 0.5 : 0,
    transparent: !!(data.textures[i].flags & 32),
    blending: data.textures[i].flags & 32 ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthTest: true, depthWrite: true, toneMapped: false, fog: true}));
  materials.forEach(m => skinning.material(m));
  const meshes = data.meshes.map(spec => {
    const geometry = new THREE.BufferGeometry();
    skinning.geometry(geometry, spec);
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(spec.uvPixels.length), 2));
    geometry.setIndex(spec.indices);
    const mesh = new THREE.Mesh(geometry, materials[0]); root.add(mesh); return mesh;
  });
  root.traverse(world);
  const bonePose=createBonePose(THREE,data,matrices);
  let currentSkin = -1, currentBody = -1;
  function pose(sequence, frame, p, merged = null, mapping = null) {
    const skin = index(p.skin, data.skins.length) ? p.skin : 0, body = Math.max(0, Math.floor(finite(p.body)));
    root.matrix.elements[13] = p.crouch ? 0.45 : 0.9;
    root.matrixWorldNeedsUpdate = true;
    if (skin !== currentSkin || body !== currentBody) {
      for (let i = 0; i < meshes.length; i++) {
        const spec = data.meshes[i], part = data.bodyparts[spec.bodypart], ti = data.skins[skin][spec.skinref];
        meshes[i].visible = Math.floor(body / part.base) % part.models.length === spec.model;
        meshes[i].material = materials[ti];
        const uv = meshes[i].geometry.attributes.uv, texture = data.textures[ti];
        for (let j = 0; j < uv.count; j++) uv.setXY(j, spec.uvPixels[j * 2] / texture.width, spec.uvPixels[j * 2 + 1] / texture.height);
        uv.needsUpdate = true;
      }
      currentSkin = skin; currentBody = body;
    }
    bonePose.pose(sequence,frame,p,merged,mapping);
    skinning.update(meshes);
  }
  return {root, data, asset, matrices, pose, blendInfo: bonePose.blendInfo,
    dispose() { skinning.dispose(); for (const mesh of meshes) mesh.geometry.dispose(); for (const m of materials) m.dispose(); shared.release(); }};
}
const weaponSuffix = id => ({glock18: 'onehanded', usp: 'onehanded', p228: 'onehanded', deagle: 'onehanded', fiveseven: 'onehanded',
  elite: 'dualpistols', m4a1: 'carbine', galil: 'carbine', famas: 'carbine', aug: 'rifle', sg552: 'rifle', scout: 'rifle', awp: 'rifle',
  g3sg1: 'rifle', sg550: 'rifle', mp5navy: 'mp5', mac10: 'mp5', tmp: 'mp5', ump45: 'mp5', p90: 'mp5',
  m3: 'shotgun', xm1014: 'shotgun', hegrenade: 'grenade', flashbang: 'grenade', smokegrenade: 'grenade'}[id] || String(id || 'ak47'));
function selector(data) {
  const sequences = data.sequences.filter(s => s.tracks || s.blendTracks), memo = new Map();
  return (action, crouch, weapon) => {
    const key = `${action}:${!!crouch}:${weapon}`;
    if (memo.has(key)) return memo.get(key);
    const suffix = weaponSuffix(weapon).toLowerCase(), prefix = crouch ? 'crouch' : 'ref';
    const names = action === 'idle' || action === 'aim' ? [`${prefix}_aim_${suffix}`, `aim_${suffix}`, crouch ? 'crouch_idle' : 'idle', 'idle1']
      : action === 'shoot' || action === 'reload' ? [`${prefix}_${action}_${suffix}`, `${action}_${suffix}`, `${prefix}_${action}`, action]
      : action === 'walk' || action === 'run' ? [crouch ? 'crouch_walk' : action, crouch ? 'crouchrun' : `${action}1`, crouch ? 'crouch' : action]
      : action === 'crouch' ? ['crouch_idle', `crouch_aim_${suffix}`, 'crouch']
      : action === 'jump' ? ['jump', 'hop', 'leap'] : action === 'death' ? [crouch ? 'crouch_die' : 'death1', 'death1', 'death', 'die', 'head'] : [action];
    let found = null;
    for (const name of names) { found = sequences.find(s => s.name.toLowerCase() === name); if (found) break; }
    if (!found && action === 'death') found = sequences.find(s => /death|die|dead/i.test(s.name));
    if (!found && ['aim', 'idle', 'crouch'].includes(action)) found = sequences.find(s => new RegExp(crouch ? 'crouch.*(idle|aim)' : '^(idle|ref_aim|aim)').test(s.name.toLowerCase()));
    memo.set(key, found); return found;
  };
}

/** Synchronous world actor. p.x/y/z are feet, radians yaw=0 faces -Z.
 * Call setCharacter(id), attach group to scene, then update(dt, state) in seconds.
 * See docs/player-renderer.md for explicit animation controls and provenance.
 */
export function createPlayerActor(THREE, {onChange = () => {}, skinning = 'gpu'} = {}) {
  const group = new THREE.Group(); group.name = 'goldsrc-player'; group.layers.set(0);
  const cache = cacheFor(THREE);
  let id = null, active = null, missing = null, manifest = null, generation = 0, pending = null, disposed = false, error = null;
  let choose = null, sequence = null, elapsed = 0, frame = 0, action = 'idle', animationWarning = null, explicitKey = null;
  let shotSeen, ammoSeen, animationTokenSeen, reloadSeen = false, actionRemaining = 0;
  let weapon = null, weaponId = null, weaponGeneration = 0, weaponStatus = 'No third-person weapon requested', weaponMapping = null;
  const state = {};
  function notify() { try { onChange(info()); } catch (cause) { console.error('Player onChange callback failed', cause); } }
  function clearWeapon() { weaponGeneration++; if (weapon) { group.remove(weapon.root); weapon.dispose(); } weapon = null; weaponId = null; weaponMapping = null; weaponStatus = 'No third-person weapon requested'; }
  function clear() {
    clearWeapon();
    if (active) { group.remove(active.root); active.dispose(); }
    if (missing) { group.remove(missing.root); missing.dispose(); }
    active = missing = null;
  }
  function selectWeapon(next) {
    next = typeof next === 'string' && /^[a-z0-9_]{1,40}$/.test(next) ? next : null;
    if (next === weaponId) return;
    clearWeapon(); weaponId = next;
    if (!next) { weaponStatus = 'No third-person weapon requested'; return; }
    const entry = manifest?.weapons?.[next];
    if (!entry) { weaponStatus = `Missing third-person weapon: ${next}; no geometry substituted`; notify(); return; }
    const ticket = weaponGeneration, owner = active;
    weaponStatus = `Loading third-person weapon: ${next}`;
    (async () => {
      const asset = await modelFor(cache, next, entry, true);
      if (disposed || ticket !== weaponGeneration || owner !== active) return;
      const shared = await texturesFor(THREE, cache, asset);
      if (disposed || ticket !== weaponGeneration || owner !== active) { shared.release(); return; }
      const map = asset.data.bones.map(b => owner.data.bones.findIndex(pb => pb.name.toLowerCase() === b.name.toLowerCase()));
      if (!map.some(n => n >= 0)) { shared.release(); throw new Error('No p_weapon bones match player bone names'); }
      weapon = buildPose(THREE, asset, shared, skinning); weaponMapping = map; group.add(weapon.root);
      weapon.pose(null, 0, state, active.matrices, weaponMapping);
      weaponStatus = `Merged ${map.filter(n => n >= 0).length}/${map.length} p_weapon bones by name`;
      notify();
    })().catch(cause => { if (ticket === weaponGeneration && !disposed) { weaponStatus = `Missing third-person weapon: ${next}: ${cause.message}`; notify(); } });
  }
  function setCharacter(nextId) {
    if (disposed) return Promise.resolve(info());
    nextId = String(nextId);
    if (nextId === id && (active || pending)) return pending || Promise.resolve(info());
    id = nextId;
    const ticket = ++generation;
    clear(); error = null; choose = sequence = null; elapsed = frame = actionRemaining = 0; action = 'idle';
    animationWarning = explicitKey = null; shotSeen = ammoSeen = animationTokenSeen = undefined; reloadSeen = false;
    missing = placeholder(THREE, id); group.add(missing.root);
    pending = (async () => {
      check(PLAYER_MODEL_IDS.includes(nextId), `Unknown player character: ${nextId}`);
      const loadedManifest = await manifestFor(cache);
      if (ticket !== generation || disposed) return info();
      manifest = loadedManifest;
      const asset = await modelFor(cache, nextId, manifest.models[nextId]);
      if (ticket !== generation || disposed) return info();
      const shared = await texturesFor(THREE, cache, asset);
      if (ticket !== generation || disposed) { shared.release(); return info(); }
      const built = buildPose(THREE, asset, shared, skinning);
      clear(); active = built; choose = selector(active.data); group.add(active.root);
      update(0, state);
      pending = null; notify(); return info();
    })().catch(cause => {
      if (ticket === generation && !disposed) { error = String(cause.message || cause); pending = null; notify(); }
      return info();
    });
    notify(); return pending;
  }
  function start(next, requested) {
    const fallback = choose('idle', state.crouch, state.weapon) || active.data.sequences.find(s => s.tracks || s.blendTracks) || null;
    const imported = next && (next.tracks || next.blendTracks);
    animationWarning = imported ? null : `No imported ${requested} sequence; ${fallback ? `showing ${fallback.name}` : 'bind pose only'}`;
    sequence = imported ? next : fallback; action = requested; frame = elapsed = 0;
  }
  function update(dt, p = {}) {
    if (disposed) return;
    p ||= {};
    // Copy only supported fields: no external objects or arbitrarily large state retained.
    for (const key of ['x', 'y', 'z', 'yaw', 'pitch', 'aimYaw', 'vx', 'vz', 'crouch', 'grounded', 'alive', 'dead', 'walk', 'weapon', 'reloading', 'reloadAt', 'lastShot', 'ammo', 'skin', 'body', 'playerSequence', 'playerFrame', 'animation', 'animationToken', 'blendX', 'blendY']) state[key] = p[key];
    if (Number.isFinite(p.x)) group.position.x = p.x;
    if (Number.isFinite(p.y)) group.position.y = p.y;
    if (Number.isFinite(p.z)) group.position.z = p.z;
    if (Number.isFinite(p.yaw)) group.rotation.y = p.yaw;
    if (!active) return;
    const step = clamp(finite(dt), 0, 0.25);
    actionRemaining = Math.max(0, actionRemaining - step);
    const explicit = p.playerSequence, key = explicit == null ? null : `${explicit}:${p.animationToken ?? ''}`;
    const reloading = !!(p.reloading || p.reloadAt), shot = Number.isFinite(p.lastShot) && Number.isFinite(shotSeen) && p.lastShot > shotSeen
      || Number.isFinite(p.ammo) && Number.isFinite(ammoSeen) && p.ammo < ammoSeen;
    if (key !== null) {
      if (key !== explicitKey) start(typeof explicit === 'number' ? active.data.sequences[explicit] : active.data.sequences.find(s => s.name === explicit), 'explicit');
    } else {
      const speed = Math.hypot(finite(p.vx), finite(p.vz));
      let desired = p.alive === false || p.dead ? 'death' : p.animation || (p.grounded === false ? 'jump' : speed > 0.12 ? (p.walk || speed < 3 ? 'walk' : 'run') : 'idle');
      if (desired !== 'death' && !p.animation) {
        if (reloading) desired = 'reload';
        else if (shot || action === 'shoot' && actionRemaining > 0) desired = 'shoot';
      }
      const selected = choose(desired, p.crouch, p.weapon);
      if (desired !== action || selected && selected !== sequence || explicitKey !== null || !sequence
        || desired === 'shoot' && shot || desired === 'reload' && !reloadSeen
        || p.animationToken != null && p.animationToken !== animationTokenSeen) {
        start(selected, desired);
        if (desired === 'shoot') actionRemaining = sequence ? Math.max(0.08, (sequence.frames - 1) / sequence.fps) : 0.15;
      }
    }
    explicitKey = key; shotSeen = p.lastShot; ammoSeen = p.ammo; reloadSeen = reloading; animationTokenSeen = p.animationToken;
    elapsed += step;
    if (sequence) {
      const span = Math.max(1, sequence.frames - 1);
      frame = Number.isFinite(p.playerFrame) && key !== null ? clamp(p.playerFrame, 0, sequence.frames - 1) : elapsed * sequence.fps;
      if (!(Number.isFinite(p.playerFrame) && key !== null)) frame = sequence.flags & 1 && action !== 'death' ? frame % span : Math.min(frame, sequence.frames - 1);
    }
    active.pose(sequence, frame, state);
    selectWeapon(p.weapon);
    if (weapon) weapon.pose(null, 0, state, active.matrices, weaponMapping);
  }
  function info() {
    return {
      id, source: active?.data.metadata.source || 'missing-asset-wireframe', loading: !!pending, disposed, error,
      sourceSHA256: active?.data.metadata.sourceSHA256 || null,
      baseSourceSHA256: active?.data.metadata.baseSourceSHA256 || null,
      convertedSHA256: active?.asset.entry.convertedSHA256 || null,
      convertedSHA256Verified: active?.asset.verified || false,
      sourceURL: active?.data.metadata.sourceURL || null,
      retailHashVerified: active?.data.metadata.retailHashVerified === true,
      sourceAuthenticity: active?.data.metadata.sourceAuthenticity || 'Not independently authenticated by renderer',
      counts: active?.data.metadata.counts ? {...active.data.metadata.counts} : null,
      sourceHashStatus: active ? 'MDL provenance declared by manifest; raw MDL not fetched by renderer' : 'no loaded source',
      customCosmetic: active?.data.metadata.source === 'custom-trump-face',
      sequence: sequence?.name || null, action, frame, animationWarning, skinning,
      blendSupport: active?.blendInfo() || 'none',
      availableSequences: active?.data.sequences.map((s, index) => ({index, name: s.name, frames: s.frames, fps: s.fps, blendCount: s.blendCount,
        imported: !!(s.tracks || s.blendTracks), allBlends: !!s.blendTracks || s.blendCount === 1})) || [],
      thirdPersonWeapon: {id: weaponId, loaded: !!weapon, status: weaponStatus,
        unmatchedBones: weapon ? weapon.data.bones.filter((b, i) => weaponMapping[i] < 0).map(b => b.name) : []},
      transform: {goldSrcToWorld: '(-Y,Z,-X)/40', scale: 1 / 40, origin: 'feet + (crouch ? 0.45 : 0.9)', yawZero: '-Z', layer: 0},
      limitations: ['Client animation selection is heuristic, not CS server animation/gait parity.',
        '1, 2, 4 and 9 source blends supported; other/missing blends expose blend-0 fallback.',
        'Palette textures use unlit materials; controller rest values only; no source engine lighting.'],
    };
  }
  function dispose() {
    if (disposed) return;
    disposed = true; generation++; pending = null; clear(); group.removeFromParent(); notify();
  }
  return {group, setCharacter, update, info, dispose};
}
