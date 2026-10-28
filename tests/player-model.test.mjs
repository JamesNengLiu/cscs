import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {createPlayerActor, ORIGINAL_PLAYER_IDS, PLAYER_MODEL_IDS} from '../public/player-model.js';

const assets = new URL('../public/assets/players/', import.meta.url);
const sha = text => createHash('sha256').update(text).digest('hex');
const SOURCE = 'a'.repeat(64);
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-5, `${message || ''}: ${a} != ${b}`);
const tracks = (x = [0, 0, 0]) => [[{values: x, positionHold: []}, null, null, null, null, null], [null, null, null, null, null, null]];
const seq = (name, x, extra = {}) => ({name, fps: 10, flags: /idle|walk|run|aim/.test(name) ? 1 : 0,
  frames: 3, blendCount: 1, motionType: 0, motionBone: 0, tracks: tracks(x), ...extra});
function fixture(id = 'terror') {
  const custom = id.endsWith('_trump');
  return {
    schema: 'goldsrc-player-v1',
    metadata: {id, source: custom ? 'custom-trump-face' : 'original-mdl',
      ...(custom ? {baseSourceSHA256: SOURCE} : {sourceSHA256: SOURCE})},
    bones: [{name: 'Bip01', parent: -1, value: [0, 0, 0, 0, 0, 0], scale: [1, 1, 1, 1, 1, Math.PI / 2], controllers: [-1, -1, -1, -1, -1, -1]},
      {name: 'Bip01 Head', parent: 0, value: [0, 0, 0, 0, 0, 0], scale: [1, 1, 1, 1, 1, 1], controllers: [-1, -1, -1, -1, -1, -1]}],
    controllers: [], textures: [{file: 'texture-0.png', width: 2, height: 2, flags: 0}], skins: [[0]],
    bodyparts: [{base: 1, models: [{}]}], attachments: [],
    meshes: [{bodypart: 0, model: 0, skinref: 0, positions: [40, 0, -36, 40, 40, -36, 40, 0, 4],
      normals: [1, 0, 0, 1, 0, 0, 1, 0, 0], vertexBones: [1, 1, 1], normalBones: [1, 1, 1], uvPixels: [0, 0, 2, 0, 0, 2], indices: [0, 1, 2]}],
    sequences: [seq('idle', [0, 0, 0]), seq('walk', [0, 4, 8]), seq('run', [0, 8, 16]), seq('crouch_idle', [0, 0, 0]),
      seq('crouch_walk', [0, 2, 4]), seq('jump', [0, 5, 10]), seq('death1', [0, 10, 20]),
      seq('ref_aim_ak47', [0, 0, 0]), seq('ref_shoot_ak47', [0, 2, 0]), seq('ref_reload_ak47', [0, 3, 0]),
      seq('nine_blend', [0, 0, 0], {blendCount: 9, blendStart: [-90, -90], blendEnd: [90, 90],
        blendTracks: Array.from({length: 9}, (_, i) => tracks([i * 10, i * 10, i * 10]))})],
  };
}
function setup(t, models = [fixture()], {weapons = [], fetcher, loader} = {}) {
  const manifest = {schema: 'goldsrc-players-v1', models: {}, weapons: {}}, files = new Map(), loadedTextures = [], requests = [];
  for (const [kind, collection] of [['models', models], ['weapons', weapons]]) for (const model of collection) {
    const id = model.metadata.id, file = `${kind === 'weapons' ? 'weapons/' : ''}${id}/model.json`, text = JSON.stringify(model);
    manifest[kind][id] = {...model.metadata, file, convertedSHA256: sha(text)};
    files.set(`/assets/players/${file}`, text);
  }
  const previous = globalThis.fetch;
  globalThis.fetch = async url => {
    requests.push(url);
    const body = url.endsWith('manifest.json') ? JSON.stringify(manifest) : files.get(url);
    if (fetcher) { const response = await fetcher(url, body); if (response) return response; }
    return new Response(body || 'missing', {status: body ? 200 : 404});
  };
  t.after(() => { globalThis.fetch = previous; });
  class TextureLoader {
    async loadAsync(url) {
      if (loader) return loader(url);
      const texture = new THREE.Texture(); texture.image = {width: 2, height: 2}; loadedTextures.push(texture); return texture;
    }
  }
  const three = {...THREE, TextureLoader};
  const actors = [];
  const actor = () => { const a = createPlayerActor(three, {skinning:'cpu'}); actors.push(a); return a; };
  t.after(() => actors.forEach(a => a.dispose()));
  return {actor, three, manifest, files, loadedTextures, requests};
}
const meshOf = actor => actor.group.children.find(o => o.name.includes('-mdl:') || o.name.startsWith('custom-trump-face:')).children[0];
const settle = async predicate => {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); }
  assert.ok(predicate(), 'Async asset work did not finish');
};

test('synchronous actor, canonical identities, source geometry and right-handed feet/world mapping', async t => {
  const {actor} = setup(t), a = actor();
  assert.equal(typeof a.then, 'undefined'); assert.equal(a.group.layers.mask, 1);
  assert.equal(PLAYER_MODEL_IDS.length, 12); assert.equal(ORIGINAL_PLAYER_IDS.length, 8);
  await a.setCharacter('terror');
  assert.equal(a.info().source, 'original-mdl', a.info().error);
  assert.equal(a.info().convertedSHA256Verified, true);
  a.update(0, {x: 2, y: 3, z: 4, yaw: 0, playerSequence: 'idle', playerFrame: 0});
  const mesh = meshOf(a), basis = mesh.parent.matrix;
  near(basis.determinant(), 1 / 40 ** 3, 'positive determinant');
  assert.deepEqual(a.group.scale.toArray(), [1, 1, 1]);
  a.group.updateMatrixWorld(true);
  const v = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, 0).applyMatrix4(mesh.matrixWorld);
  near(v.x, 2); near(v.y, 3); near(v.z, 3);
  const uv = mesh.geometry.attributes.uv;
  assert.deepEqual([...uv.array], [0, 0, 1, 0, 0, 1]); assert.equal(mesh.material.map.flipY, false);
  assert.equal(mesh.material.depthTest, true); assert.equal(mesh.material.depthWrite, true); assert.equal(mesh.layers.mask, 1);
  assert.equal(mesh.renderOrder, 0);
  a.update(0, {x: 2, y: 3, z: 4, yaw: Math.PI / 2, crouch: true, playerSequence: 'idle', playerFrame: 0});
  near(basis.elements[13], 0.45); assert.deepEqual(a.group.scale.toArray(), [1, 1, 1]);
  a.group.updateMatrixWorld(true); v.set(40, 0, 0).applyMatrix4(mesh.matrixWorld);
  near(v.x, 1); near(v.z, 4);
});

test('source time interpolation, positionHold, quaternion rotation and nine source blends', async t => {
  const model = fixture();
  const held = seq('held', [0, 10, 20]); held.tracks[0][0].positionHold = [0];
  held.tracks[0][5] = {values: [0, 1, 2], positionHold: []}; model.sequences.push(held);
  const {actor} = setup(t, [model]), a = actor(); await a.setCharacter('terror');
  a.update(0, {playerSequence: 'held', playerFrame: 0.5});
  const output = meshOf(a).geometry.attributes.position;
  near(output.getX(0), 40 / Math.sqrt(2), 'held translation and slerped rotation X');
  near(output.getY(0), 40 / Math.sqrt(2), 'rotation Y');
  a.update(0, {playerSequence: 'nine_blend', playerFrame: 0, blendX: 0.25, blendY: 0.75});
  near(output.getX(0), 90, 'bilinear source blends 3,4,6,7 average to 50');
  assert.match(a.info().blendSupport, /9 source blends/);
  a.update(0, {playerSequence: 'nine_blend', playerFrame: 0, blendX: 1, blendY: 1}); near(output.getX(0), 120);
  a.update(0, {playerSequence: 'nine_blend', playerFrame: 0, pitch: 0, aimYaw: 0}); near(output.getX(0), 80);
});

test('real sequence selection follows locomotion, crouch, jump, shot, reload and terminal death', async t => {
  const {actor} = setup(t), a = actor(); await a.setCharacter('terror');
  const state = {weapon: 'ak47', grounded: true, alive: true, lastShot: 10, ammo: 30};
  a.update(0, state); assert.equal(a.info().sequence, 'ref_aim_ak47');
  a.update(0.1, {...state, vx: 1}); assert.equal(a.info().sequence, 'walk');
  a.update(0.1, {...state, vx: 5}); assert.equal(a.info().sequence, 'run');
  a.update(0.1, {...state, crouch: true}); assert.equal(a.info().sequence, 'crouch_idle');
  a.update(0.1, {...state, grounded: false}); assert.equal(a.info().sequence, 'jump');
  a.update(0.01, {...state, lastShot: 11, ammo: 29}); assert.equal(a.info().sequence, 'ref_shoot_ak47');
  a.update(0.1, {...state, reloading: true, reloadAt: 100}); assert.equal(a.info().sequence, 'ref_reload_ak47');
  a.update(0.1, {...state, animation: 'idle', animationToken: 1}); assert.ok(a.info().frame > 0);
  a.update(0, {...state, animation: 'idle', animationToken: 2}); assert.equal(a.info().frame, 0);
  a.update(0.1, {...state, alive: false}); assert.equal(a.info().sequence, 'death1');
  for (let i = 0; i < 10; i++) a.update(0.1, {...state, alive: false});
  assert.equal(a.info().frame, 2); assert.equal(a.group.visible, true);
});

test('shared immutable assets/textures have independent poses and reference-counted disposal', async t => {
  const {actor, loadedTextures, requests} = setup(t), a = actor(), b = actor();
  await Promise.all([a.setCharacter('terror'), b.setCharacter('terror')]);
  assert.equal(loadedTextures.length, 1);
  assert.equal(requests.filter(url => url.endsWith('/terror/model.json')).length, 1);
  const am = meshOf(a), bm = meshOf(b);
  assert.notEqual(am.geometry, bm.geometry); assert.notEqual(am.material, bm.material); assert.equal(am.material.map, bm.material.map);
  let geometryDisposed = 0, textureDisposed = 0;
  am.geometry.addEventListener('dispose', () => geometryDisposed++);
  loadedTextures[0].addEventListener('dispose', () => textureDisposed++);
  a.update(0, {playerSequence: 'walk', playerFrame: 2}); b.update(0, {playerSequence: 'idle', playerFrame: 0});
  near(am.geometry.attributes.position.getX(0), 48); near(bm.geometry.attributes.position.getX(0), 40);
  a.dispose(); assert.equal(geometryDisposed, 1); assert.equal(textureDisposed, 0);
  b.update(0, {playerSequence: 'run', playerFrame: 2}); near(bm.geometry.attributes.position.getX(0), 56);
  b.dispose(); await settle(() => textureDisposed === 1); a.dispose(); assert.equal(geometryDisposed, 1);
});

test('late selection/texture completion and dispose cannot install stale characters', async t => {
  let finish, entered = false, disposedTexture = 0;
  const late = new Promise(resolve => { finish = resolve; });
  const {actor} = setup(t, [fixture('terror'), fixture('leet')], {loader: async url => {
    const texture = new THREE.Texture(); texture.image = {width: 2, height: 2};
    if (url.includes('/terror/')) { entered = true; await late; texture.addEventListener('dispose', () => disposedTexture++); }
    return texture;
  }});
  const a = actor(), first = a.setCharacter('terror'); await settle(() => entered);
  const second = a.setCharacter('leet'); await second; finish(); await first;
  assert.equal(a.info().id, 'leet'); assert.equal(a.group.children.length, 1); assert.equal(a.info().source, 'original-mdl');
  await settle(() => disposedTexture === 1);
  const b = actor(), loading = b.setCharacter('terror'); b.dispose(); await loading;
  assert.equal(b.info().disposed, true); assert.equal(b.group.children.length, 0);
});

test('custom provenance stays custom; absent source blends and weapons are explicitly reported', async t => {
  const custom = fixture('terror_trump'); delete custom.sequences.at(-1).blendTracks;
  const {actor} = setup(t, [custom]), a = actor(); await a.setCharacter('terror_trump');
  assert.equal(a.info().source, 'custom-trump-face', a.info().error); assert.equal(a.info().baseSourceSHA256, SOURCE);
  assert.equal(a.info().sourceSHA256, null); assert.equal(a.info().customCosmetic, true);
  a.update(0, {playerSequence: 'nine_blend', playerFrame: 1, weapon: 'ak47'});
  assert.match(a.info().blendSupport, /blend 0 only/); assert.match(a.info().thirdPersonWeapon.status, /Missing.*ak47/);
  assert.equal(a.group.children.length, 1);
});

test('optional p_weapon geometry merges named bones from the current player pose', async t => {
  const {actor} = setup(t, [fixture()], {weapons: [fixture('ak47')]}), a = actor(); await a.setCharacter('terror');
  a.update(0, {weapon: 'ak47', playerSequence: 'walk', playerFrame: 2});
  await settle(() => a.info().thirdPersonWeapon.loaded);
  const weapon = a.group.getObjectByName('original-mdl:ak47'); assert.ok(weapon);
  near(weapon.children[0].geometry.attributes.position.getX(0), 48);
  assert.equal(weapon.children[0].layers.mask, 1); assert.deepEqual(a.info().thirdPersonWeapon.unmatchedBones, []);
});

test('missing, oversized, corrupt and malformed remote assets produce honest depth-tested fallbacks', async t => {
  for (const scenario of ['404', 'bytes', 'hash', 'array', 'path', 'provenance', 'texture']) {
    await t.test(scenario, async t => {
      const model = fixture(); if (scenario === 'array') model.bones = new Array(129).fill(model.bones[0]);
      const config = setup(t, [model], {fetcher: async (url, body) => {
        if (scenario === '404') return new Response('missing', {status: 404});
        if (scenario === 'bytes') return new Response('{}', {headers: {'content-length': '999999999'}});
        if (scenario === 'hash' && url.endsWith('/model.json')) return new Response(body + ' ');
      }, loader: scenario === 'texture' ? async () => { throw new Error('missing'); } : undefined});
      if (scenario === 'path') config.manifest.models.terror.file = '../escape.json';
      if (scenario === 'provenance') config.manifest.models.terror.source = 'custom-trump-face';
      const a = config.actor(); await a.setCharacter('terror');
      assert.equal(a.info().source, 'missing-asset-wireframe'); assert.ok(a.info().error, scenario);
      assert.equal(a.info().sourceSHA256, null); assert.equal(a.info().availableSequences.length, 0);
      const fallback = a.group.children[0].children[0];
      assert.equal(fallback.material.color.getHex(), 0xff00ff); assert.equal(fallback.material.wireframe, true);
      assert.equal(fallback.material.depthWrite, true); assert.equal(fallback.material.depthTest, true); assert.equal(fallback.layers.mask, 1);
    });
  }
});

test('unknown identities, missing actions and callback diagnostics remain observable', async t => {
  const {three} = setup(t);
  const notices = [], a = createPlayerActor(three, {onChange: info => notices.push(info)}); t.after(() => a.dispose());
  await a.setCharacter('unknown'); assert.match(a.info().error, /Unknown/);
  await a.setCharacter('terror'); a.update(0, {animation: 'not_imported'});
  assert.match(a.info().animationWarning, /No imported/); assert.ok(notices.some(i => i.loading));
  a.info().availableSequences.length = 0; assert.ok(a.info().availableSequences.length > 0);
});

test('file-backed real player assets load with Three, exact hashes and animated poses', {
  skip: !existsSync(new URL('manifest.json', assets)) && 'Real player assets not installed yet; fixture runtime was exercised above',
}, async t => {
  const manifest = JSON.parse(await fs.readFile(new URL('manifest.json', assets), 'utf8'));
  const previous = globalThis.fetch;
  globalThis.fetch = async url => {
    try { return new Response(await fs.readFile(new URL(`../public${url}`, import.meta.url))); }
    catch { return new Response('missing', {status: 404}); }
  };
  t.after(() => { globalThis.fetch = previous; });
  class FileTextures {
    async loadAsync(url) {
      const bytes = await fs.readFile(new URL(`../public${url}`, import.meta.url));
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      const texture = new THREE.Texture(); texture.image = {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)}; return texture;
    }
  }
  const a = createPlayerActor({...THREE, TextureLoader: FileTextures}, {skinning:'cpu'}); t.after(() => a.dispose());
  const available = PLAYER_MODEL_IDS.filter(id => manifest.models[id]?.file);
  assert.ok(available.length > 0, 'Manifest exists but has no usable assets');
  for (const id of available) {
    await a.setCharacter(id); const info = a.info();
    assert.equal(info.error, null, `${id}: ${info.error}`);
    assert.equal(info.source, id.endsWith('_trump') ? 'custom-trump-face' : 'original-mdl');
    assert.equal(info.convertedSHA256Verified, true, id);
    const model = JSON.parse(await fs.readFile(new URL(manifest.models[id].file, assets), 'utf8'));
    const motion = model.sequences.find(s => /reload/i.test(s.name) && s.frames > 2 && s.tracks)
      || model.sequences.find(s => /walk|run/i.test(s.name) && s.frames > 2 && s.tracks);
    assert.ok(motion, `${id} must have source locomotion/action animation`);
    a.update(0, {playerSequence: motion.name, playerFrame: 0});
    const mesh = meshOf(a), initial = [...mesh.geometry.attributes.position.array];
    a.update(0, {playerSequence: motion.name, playerFrame: (motion.frames - 1) / 2});
    assert.ok(mesh.geometry.attributes.position.array.some((value, i) => Math.abs(value - initial[i]) > 0.001), `${id}: source tracks must deform geometry`);
    for (const seq of model.sequences.filter(s => s.blendCount === 9)) {
      a.update(0, {playerSequence: seq.name, playerFrame: 0, blendX: 0.25, blendY: 0.75});
      assert.match(a.info().blendSupport, /9 source blends/);
    }
    a.group.traverse(o => { if (o.isMesh) { assert.equal(o.layers.mask, 1); assert.equal(o.material.depthTest, true); assert.equal(o.material.depthWrite, true); assert.ok(o.geometry.attributes.position.array.every(Number.isFinite)); } });
  }
  t.diagnostic(`File-backed runtime exercised ${available.length} actual imported models: ${available.join(', ')}`);
  const weapons = Object.entries(manifest.weapons || {}).filter(([, entry]) => entry.file).map(([id]) => id);
  await a.setCharacter('terror');
  for (const id of weapons) {
    a.update(0, {weapon: id});
    for (let i = 0; i < 500 && a.info().thirdPersonWeapon.status.startsWith('Loading'); i++) await new Promise(resolve => setTimeout(resolve, 2));
    assert.equal(a.info().thirdPersonWeapon.loaded, true, `${id}: ${a.info().thirdPersonWeapon.status}`);
    assert.match(a.info().thirdPersonWeapon.status, /Merged/);
    const gun = a.group.getObjectByName(`original-mdl:${id}`);
    assert.ok(gun, id);
    gun.traverse(o => { if (o.isMesh) { assert.equal(o.layers.mask, 1); assert.equal(o.material.depthTest, true); assert.ok(o.geometry.attributes.position.array.every(Number.isFinite)); } });
  }
  t.diagnostic(`File-backed runtime merged ${weapons.length} actual imported third-person weapons`);
});
