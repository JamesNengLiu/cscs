// Real MDLv10 geometry/skins and embedded skeletal tracks, converted locally.
import {createRigidSkinning} from './rigid-skinning.js';
// No proprietary assets are embedded in this module. See docs/weapon-model-fidelity.md.
export const WEAPON_MODEL_IDS = Object.freeze('glock18 usp p228 deagle elite fiveseven m3 xm1014 mac10 tmp mp5navy ump45 p90 galil famas ak47 m4a1 aug sg552 scout awp g3sg1 sg550 m249 knife hegrenade flashbang smokegrenade c4 shield'.split(' '));
const BASE = '/assets/weapons/';
const LEGACY_ORIGIN = [0.25, -0.24, -0.42];
const SCALE = 1 / 40; // Same uniform GoldSrc-unit conversion as the map importer.
const FOREGROUND = 100;
const check = (condition, message) => { if (!condition) throw new Error(message); };
const index = (value, count) => Number.isInteger(value) && value >= 0 && value < count;

async function fetchJSON(path, expectedHash) {
  const response = await fetch(path, {signal: AbortSignal.timeout(20000)});
  check(response.ok, `${path}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  check(bytes.byteLength <= 32 * 1024 * 1024, 'Converted model exceeds size limit');
  let verified = false;
  if (expectedHash && globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const actual = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    check(actual === expectedHash, 'Converted model SHA256 mismatch');
    verified = true;
  }
  return {data: JSON.parse(new TextDecoder().decode(bytes)), verified};
}

function validate(data, id, entry) {
  check(data.schema === 'goldsrc-viewmodel-v1' && data.metadata?.id === id, 'Wrong converted model schema/id');
  check(data.metadata.source === 'original-mdl' && /^[a-f0-9]{64}$/.test(data.metadata.sourceSHA256) && data.metadata.sourceSHA256 === entry.sourceSHA256, 'Missing or inconsistent MDL provenance');
  check(data.bones?.length > 0 && data.bones.length <= 128 && data.meshes?.length > 0, 'Missing bones/geometry');
  for (const [i, b] of data.bones.entries()) {
    check(Number.isInteger(b.parent) && b.parent >= -1 && b.parent < i, 'Invalid bone parent');
    check(b.value.length === 6 && b.scale.length === 6 && [...b.value, ...b.scale].every(Number.isFinite), 'Invalid bone transforms');
  }
  check(data.textures?.length > 0 && data.textures.length <= 256, 'Missing textures');
  for (const t of data.textures) check(/^texture-\d+\.png$/.test(t.file) && t.width > 0 && t.height > 0, 'Invalid texture');
  for (const skin of data.skins) check(skin.every(t => index(t, data.textures.length)), 'Invalid skin family');
  for (const m of data.meshes) {
    const n = m.vertexBones.length;
    check(n <= 1000000 && m.positions.length === n * 3 && m.normals.length === n * 3 && m.normalBones.length === n && m.uvPixels.length === n * 2, 'Invalid vertex arrays');
    check([...m.positions, ...m.normals, ...m.uvPixels].every(Number.isFinite), 'Non-finite geometry');
    check(m.indices.length % 3 === 0 && m.indices.every(i => index(i, n)), 'Invalid triangle index');
    check([...m.vertexBones, ...m.normalBones].every(i => index(i, data.bones.length)), 'Invalid vertex bone');
    check(index(m.bodypart, data.bodyparts.length) && index(m.model, data.bodyparts[m.bodypart].models.length), 'Invalid bodypart');
    check(index(m.skinref, data.skins[0].length), 'Invalid mesh skin reference');
  }
  for (const a of data.attachments) check(index(a.bone, data.bones.length) && a.origin.length === 3 && a.origin.every(Number.isFinite), 'Invalid attachment');
  for (const s of data.sequences) {
    check(Number.isInteger(s.frames) && s.frames > 0 && s.frames <= 10000 && Number.isFinite(s.fps) && s.fps > 0, 'Invalid sequence');
    if (!s.tracks) continue;
    check(s.tracks.length === data.bones.length, 'Invalid sequence bone count');
    for (const channels of s.tracks) {
      check(channels.length === 6, 'Invalid animation channels');
      for (const c of channels) if (c) check(c.values.length === s.frames && c.values.every(v => Number.isInteger(v) && v >= -32768 && v <= 32767), 'Invalid animation samples');
    }
  }
}

function foreground(object) {
  object.layers.set(1);
  object.renderOrder = FOREGROUND;
  object.frustumCulled = false;
  if (object.isMesh) {
    object.castShadow = object.receiveShadow = false;
    object.material.depthTest = object.material.depthWrite = true;
    object.material.fog = false;
    object.material.toneMapped = false;
  }
}

function fallback(THREE, id) {
  // Deliberately schematic magenta wire shapes, never an imitation retail model.
  const root = new THREE.Group();
  root.name = `procedural-fallback:${id}`;
  const material = new THREE.MeshBasicMaterial({color: 0xff61bd, wireframe: true, depthTest: false, depthWrite: false});
  const utility = ['hegrenade', 'flashbang', 'smokegrenade', 'c4'].includes(id);
  const pistol = ['glock18', 'usp', 'p228', 'deagle', 'elite', 'fiveseven'].includes(id);
  let geometry;
  if (utility) geometry = new THREE.IcosahedronGeometry(0.09, 0);
  else if (id === 'shield') geometry = new THREE.CircleGeometry(0.22, 8);
  else if (id === 'knife') geometry = new THREE.ConeGeometry(0.035, 0.3, 3);
  else geometry = new THREE.CylinderGeometry(0.025, 0.04, pistol ? 0.22 : 0.42, 6);
  const mesh = new THREE.Mesh(geometry, material);
  if (!utility && id !== 'shield') mesh.rotation.x = Math.PI / 2;
  root.add(mesh);
  root.traverse(foreground);
  return root;
}

function disposeTree(root) {
  root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); } });
}

async function buildOriginal(THREE, id, entry, skinningMode) {
  check(entry?.source === 'original-mdl' && entry.file === `${id}/model.json`, 'No converted original asset');
  const {data, verified} = await fetchJSON(BASE + entry.file, entry.convertedSHA256);
  validate(data, id, entry);
  const loader = new THREE.TextureLoader();
  const loaded = await Promise.allSettled(data.textures.map(t => loader.loadAsync(`${BASE}${id}/${t.file}`)));
  if (loaded.some(r => r.status === 'rejected')) {
    for (const r of loaded) if (r.status === 'fulfilled') r.value.dispose();
    throw new Error('Original texture load failed');
  }
  const matrices = data.bones.map(() => new THREE.Matrix4());
  const skinning = createRigidSkinning(THREE, matrices, skinningMode);
  const materials = loaded.map((result, i) => {
    const texture = result.value, spec = data.textures[i];
    // Original pixel S/T is top-left. flipY=false preserves S and T directly.
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = spec.flags & 8 ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = !(spec.flags & 8);
    texture.needsUpdate = true;
    return new THREE.MeshBasicMaterial({map: texture, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
      alphaTest: spec.flags & 64 ? 0.5 : 0, transparent: !!(spec.flags & 32),
      blending: spec.flags & 32 ? THREE.AdditiveBlending : THREE.NormalBlending});
  });
  materials.forEach(m => skinning.material(m));
  const root = new THREE.Group();
  root.name = `original-mdl:${id}`;
  root.matrixAutoUpdate = false;
  // Stock CS viewmodels are authored on the left. The right-hand reflection is
  // camera X=+GoldSrc Y, Y=Z, Z=-X. No UV mirroring or per-weapon shape edits.
  // Cancel only the caller's fixed legacy origin, retaining its recoil deltas.
  root.matrix.set(0, SCALE, 0, -LEGACY_ORIGIN[0], 0, 0, SCALE, -LEGACY_ORIGIN[1], -SCALE, 0, 0, -LEGACY_ORIGIN[2], 0, 0, 0, 1);
  const meshes = data.meshes.map(spec => {
    const geometry = new THREE.BufferGeometry();
    skinning.geometry(geometry, spec);
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(spec.uvPixels.length), 2));
    geometry.setIndex(spec.indices);
    const mesh = new THREE.Mesh(geometry, materials[data.skins[0][spec.skinref]]);
    root.add(mesh);
    return mesh;
  });
  root.traverse(foreground);
  const position = new THREE.Vector3(), unit = new THREE.Vector3(1, 1, 1), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'ZYX');
  const a = new Array(6), b = new Array(6);
  const adjustment = (data.controllers || []).map(c => {
    const value = c.type & 0x8000 ? c.start + c.rest * 360 / 256 : c.start + (c.end - c.start) * c.rest / 255;
    return c.type & (8 | 16 | 32) ? value * Math.PI / 180 : value;
  });
  let currentSkin = -1, currentBody = -1;
  function pose(sequence, frame, skin = 0, body = 0) {
    skin = index(skin, data.skins.length) ? skin : 0;
    body = Number.isInteger(body) && body >= 0 ? body : 0;
    if (skin !== currentSkin || body !== currentBody) {
      data.meshes.forEach((spec, i) => {
        const part = data.bodyparts[spec.bodypart];
        meshes[i].visible = Math.floor(body / part.base) % part.models.length === spec.model;
        const ti = data.skins[skin][spec.skinref], texture = data.textures[ti];
        meshes[i].material = materials[ti];
        const uv = meshes[i].geometry.attributes.uv;
        for (let j = 0; j < uv.count; j++) uv.setXY(j, spec.uvPixels[j * 2] / texture.width, spec.uvPixels[j * 2 + 1] / texture.height);
        uv.needsUpdate = true;
      });
      currentSkin = skin; currentBody = body;
    }
    const time = Math.max(0, Math.min(sequence ? sequence.frames - 1 : 0, frame));
    const first = Math.floor(time), next = Math.min(first + 1, (sequence?.frames || 1) - 1), blend = time - first;
    data.bones.forEach((bone, i) => {
      const channels = sequence?.tracks?.[i];
      for (let axis = 0; axis < 6; axis++) {
        const track = channels?.[axis];
        const adj = adjustment[bone.controllers[axis]] || 0;
        a[axis] = bone.value[axis] + (track?.values[first] || 0) * bone.scale[axis] + adj;
        b[axis] = bone.value[axis] + (track?.values[next] || 0) * bone.scale[axis] + adj;
        if (axis < 3 && track?.positionHold.includes(first)) b[axis] = a[axis];
      }
      position.set(a[0] + (b[0] - a[0]) * blend, a[1] + (b[1] - a[1]) * blend, a[2] + (b[2] - a[2]) * blend);
      if (sequence?.motionBone === i) for (let axis = 0; axis < 3; axis++) if (sequence.motionType & (1 << axis)) position.setComponent(axis, 0);
      q.setFromEuler(euler.set(a[3], a[4], a[5], 'ZYX'));
      q2.setFromEuler(euler.set(b[3], b[4], b[5], 'ZYX'));
      q.slerp(q2, blend);
      matrices[i].compose(position, q, unit);
      if (bone.parent >= 0) matrices[i].premultiply(matrices[bone.parent]);
    });
    skinning.update(meshes);
  }
  function muzzlePosition(target) {
    const attachment = data.attachments[0];
    if (attachment) target.fromArray(attachment.origin).applyMatrix4(matrices[attachment.bone]).applyMatrix4(root.matrix);
    else target.set(0, 0, -0.43);
  }
  return {root, data, pose, muzzlePosition, verified, dispose() {
    skinning.dispose(); meshes.forEach(m => m.geometry.dispose());
    materials.forEach(m => { m.map.dispose(); m.dispose(); });
  }};
}

/** Camera child with caller-owned outer recoil transform. setWeapon returns a
 * promise (safe to ignore); fallback is immediate and late loads cannot win races.
 * update accepts optional weaponSequence (label/index), weaponFrame, animationToken,
 * skin/body; otherwise draw/idle/reload and observed ammo/lastShot changes drive it.
 */
export async function createWeaponView(THREE, camera, {skinning = 'gpu'} = {}) {
  const group = new THREE.Group();
  group.name = 'first-person-weapon';
  group.layers.set(1);
  group.position.fromArray(LEGACY_ORIGIN);
  group.renderOrder = FOREGROUND;
  camera.add(group);
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({color: 0xffca69, depthTest: false, depthWrite: false, toneMapped: false}));
  muzzle.name = 'procedural-muzzle-flash';
  foreground(muzzle);
  muzzle.visible = false;
  muzzle.renderOrder = FOREGROUND + 10;
  muzzle.frustumCulled = false;
  group.add(muzzle);
  const cache = new Map();
  let manifest = null, manifestError = null;
  try { manifest = (await fetchJSON(BASE + 'manifest.json')).data; check(manifest.schema === 'goldsrc-viewmodels-v1', 'Invalid weapon manifest'); }
  catch (error) { manifestError = String(error.message || error); }
  let id = null, active = null, placeholder = null, generation = 0, pending = null, error = null, disposed = false;
  let sequence = null, elapsed = 0, frame = 0, idle = null, previous = {}, explicitKey = null, skin = 0, body = 0;
  const find = pattern => active?.data.sequences.find(s => s.tracks && pattern.test(s.name));
  function start(s) { sequence = s || idle; elapsed = 0; frame = 0; }
  function removeCurrent() {
    if (active) group.remove(active.root);
    if (placeholder) { group.remove(placeholder); disposeTree(placeholder); }
    active = placeholder = null;
  }
  function setWeapon(nextId) {
    if (disposed) return Promise.resolve(info());
    if (nextId === id) return pending || Promise.resolve(info());
    id = String(nextId);
    const ticket = ++generation;
    removeCurrent();
    previous = {}; explicitKey = null; sequence = idle = null; frame = elapsed = skin = body = 0;
    error = null;
    muzzle.visible = false;
    muzzle.position.set(0, 0, -0.43);
    placeholder = fallback(THREE, id);
    group.add(placeholder);
    if (!WEAPON_MODEL_IDS.includes(id) || !manifest?.weapons?.[id]?.file) {
      error = !WEAPON_MODEL_IDS.includes(id) ? `Unknown canonical weapon id: ${id}` : manifest?.weapons?.[id]?.error || manifestError || 'Original asset not imported';
      pending = null;
      return Promise.resolve(info());
    }
    if (!cache.has(id)) {
      const modelId = id;
      const promise = buildOriginal(THREE, id, manifest.weapons[id], skinning).catch(cause => { if(cache.get(modelId)===promise)cache.delete(modelId); throw cause; });
      cache.set(id, promise);
      // Bound cached geometry/textures to the four most recent weapons.
      if (cache.size > 4) {
        const oldest = cache.keys().next().value, evicted = cache.get(oldest); cache.delete(oldest);
        evicted.then(model => model.dispose(), () => {});
      }
    }
    const cached=cache.get(id);cache.delete(id);cache.set(id,cached);
    pending = cached.then(model => {
      if (ticket !== generation) return info();
      removeCurrent(); active = model; group.add(model.root);
      idle = find(/^idle/i) || model.data.sequences.find(s => s.tracks) || null;
      start(find(/^draw/i) || idle);
      active.pose(sequence, 0); active.muzzlePosition(muzzle.position);
      pending = null;
      return info();
    }).catch(cause => {
      if (ticket === generation) { error = String(cause.message || cause); pending = null; }
      return info();
    });
    return pending;
  }
  function update(dt, state = {}) {
    if (!active || disposed) return;
    state ||= {};
    const specified = state.weaponSequence;
    const key = specified == null ? null : `${specified}:${state.animationToken ?? ''}`;
    if (key !== null) {
      const selected = typeof specified === 'number' ? active.data.sequences[specified] : active.data.sequences.find(s => s.name === specified);
      if (selected?.tracks && key !== explicitKey) start(selected);
    } else {
      if (explicitKey !== null) start(idle);
      const reloading = Boolean(state.reloading || state.reloadAt);
      if (reloading && !previous.reloading) start(find(/^reload/i));
      else if (!reloading && ((Number.isFinite(state.ammo) && Number.isFinite(previous.ammo) && state.ammo < previous.ammo) || (Number.isFinite(state.lastShot) && Number.isFinite(previous.lastShot) && state.lastShot > previous.lastShot))) start(find(/^(shoot|fire|slash)/i));
      previous = {reloading, ammo: state.ammo, lastShot: state.lastShot};
    }
    explicitKey = key;
    elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (sequence) {
      const span = Math.max(1, sequence.frames - 1);
      frame = elapsed * sequence.fps;
      if (Number.isFinite(state.weaponFrame) && key !== null) frame = Math.max(0, Math.min(sequence.frames - 1, state.weaponFrame));
      else if (sequence.flags & 1) frame %= span;
      else if (frame > span && key === null) { start(idle); frame = 0; }
      else frame = Math.min(frame, sequence.frames - 1);
    }
    skin = Number.isInteger(state.skin) ? state.skin : 0;
    body = Number.isInteger(state.body) ? state.body : 0;
    active.pose(sequence, frame, skin, body);
    active.muzzlePosition(muzzle.position);
    // Outer group.position/rotation and muzzle.visible belong to the caller.
  }
  function info() {
    return {
      ...(active ? active.data.metadata : {id, source: 'procedural-fallback', sourceSHA256: null, animationSupport: 'none'}),
      id, loading: !!pending, error, sequence: sequence?.name || null, frame, skinning, disposed, cachedModels:cache.size,
      convertedSHA256Verified: active?.verified || false,
      availableSequences: active?.data.sequences.map(s => ({name: s.name, fps: s.fps, frames: s.frames, imported: !!s.tracks})) || [],
      transform: {goldSrcToCamera: '(Y,Z,-X)/40 (right hand)', legacyOrigin: [...LEGACY_ORIGIN], uniformScale: SCALE},
      presentation: 'Original palette textures with unlit Three materials; layer1 foreground pass with its own depth buffer',
      eventPlayback: 'Explicit sequence/frame or heuristic draw/idle/reload/fire; not engine timing parity',
      muzzleSource: active?.data.attachments.length ? 'procedural-flash-at-original-attachment-0' : 'procedural-flash-at-fallback-position',
    };
  }
  function dispose() {
    if (disposed) return;
    disposed = true; generation++; pending = null; removeCurrent();
    for (const promise of cache.values()) promise.then(model => model.dispose(), () => {});
    cache.clear(); muzzle.geometry.dispose(); muzzle.material.dispose(); group.removeFromParent();
  }
  await setWeapon('glock18');
  return {group, muzzle, setWeapon, update, info, dispose};
}
