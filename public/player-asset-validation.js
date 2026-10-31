// Shared original asset limits and validation. No Three.js or DOM dependency.
export const ORIGINAL_PLAYER_IDS = Object.freeze('terror leet arctic guerilla urban gsg9 sas gign'.split(' '));
export const PLAYER_MODEL_IDS = Object.freeze([...ORIGINAL_PLAYER_IDS, ...ORIGINAL_PLAYER_IDS.slice(0, 4).map(id => `${id}_trump`)]);
const BASE = '/assets/players/';
export const LIMIT = Object.freeze({json: 64 * 1024 * 1024, manifest: 1024 * 1024, vertices: 500000, samples: 24000000});
export const SHA = /^[a-f0-9]{64}$/;
export const check = (yes, message) => { if (!yes) throw new Error(message); };
const index = (n, size) => Number.isInteger(n) && n >= 0 && n < size;
function array(value, max, label, min = 0) {
  check(Array.isArray(value) && value.length >= min && value.length <= max, `Invalid ${label} array`);
  return value;
}
export function playerAssetPath(file) {
  check(typeof file === 'string' && file.length <= 240 && /^[a-zA-Z0-9_./-]+\.json$/.test(file)
    && !file.startsWith('/') && !file.split('/').some(p => p === '..' || p === '.' || !p), 'Unsafe model path');
  return BASE + file;
}
export async function fetchPlayerBytes(url, max, expectedHash, {deferAbove=Infinity}={}) {
  if (expectedHash != null) check(SHA.test(expectedHash), 'Invalid converted SHA256');
  const response = await fetch(url, {signal: AbortSignal.timeout(20000)});
  check(response.ok, `${url}: HTTP ${response.status}`);
  const declared=Number(response.headers?.get('content-length')||0);
  check(declared<=max,'JSON exceeds byte limit');
  if(declared>deferAbove){await response.body?.cancel?.();return {deferred:true};}
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
        if(count>deferAbove){await reader.cancel();return {deferred:true};}
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
    if(bytes.byteLength>deferAbove)return {deferred:true};
  }
  let verified = false;
  if (expectedHash && globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const actual = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    check(actual === expectedHash, 'Converted model SHA256 mismatch');
    verified = true;
  }
  return {bytes, verified};
}
export function freezePlayerMetadata(value) {
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer) && !Object.isFrozen(value)) {
    Object.freeze(value);
    if (Array.isArray(value)) { for (const child of value) if (typeof child === 'object') freezePlayerMetadata(child); }
    else for (const key of Object.keys(value)) if (typeof value[key] === 'object') freezePlayerMetadata(value[key]);
  }
  return value;
}
export function validatePlayerModel(data, id, entry, weapon) {
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
export function validatePlayerProvenance(asset, id, entry) {
  check(asset.data.metadata.id === id && asset.data.metadata.source === entry.source
    && (entry.sourceSHA256 == null || asset.data.metadata.sourceSHA256 === entry.sourceSHA256)
    && asset.data.metadata.baseSourceSHA256 === entry.baseSourceSHA256, 'Cached asset provenance mismatch');
}

export {LIMIT as PLAYER_ASSET_LIMIT};
