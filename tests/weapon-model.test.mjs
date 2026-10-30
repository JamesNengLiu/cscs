import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import * as THREE from 'three';
import {createWeaponView, WEAPON_MODEL_IDS} from '../public/weapon-model.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const assets = path.join(root, 'public/assets/weapons');
const hasAssets = existsSync(path.join(assets, 'manifest.json'));
const hash = data => createHash('sha256').update(data).digest('hex');
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));

test('MDL reader rejects truncated headers, invalid offsets/counts and malformed RLE', () => {
  const code = `
import importlib.util,struct
s=importlib.util.spec_from_file_location('weapons','tools/import-weapons.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def rejected(fn):
 try: fn()
 except m.MDLError: return
 raise AssertionError('Malformed model accepted')
rejected(lambda:m.Reader(b'IDST'))
d=bytearray(256);struct.pack_into('<4si',d,0,b'IDST',10);struct.pack_into('<i',d,72,len(d))
r=m.Reader(d)
rejected(lambda:r.span(-1,1));rejected(lambda:r.span(250,10))
rejected(lambda:r.table(-1,244,112));rejected(lambda:r.table(1000000000,244,112))
rejected(lambda:r.table(1,0,12))
rejected(lambda:m.decode_channel(r,244,5))
d[244:250]=struct.pack('<BBhh',2,4,-300,450)
c=m.decode_channel(m.Reader(d),244,4)
assert c['values']==[-300,450,450,450] and c['positionHold']==[1]
d[244:246]=bytes([3,2]);rejected(lambda:m.decode_channel(m.Reader(d),244,4))
`;
  const result = spawnSync('python3', ['-B', '-c', code], {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
});

test('all locally imported original models have valid hashes, counts, indices and exact palette PNGs', {skip: !hasAssets && 'Private MDL fixtures not installed; run fetch/import locally'}, async () => {
  const manifest = await json(path.join(assets, 'manifest.json'));
  const sources = await json(path.join(assets, 'sources.json'));
  assert.equal(WEAPON_MODEL_IDS.length, 30);
  for (const id of WEAPON_MODEL_IDS) {
    const entry = manifest.weapons[id];
    assert.equal(entry.source, 'original-mdl', id);
    assert.equal(hash(await fs.readFile(path.join(assets, sources.assets[id].file))), entry.sourceSHA256, id);
    const bytes = await fs.readFile(path.join(assets, entry.file));
    assert.equal(hash(bytes), entry.convertedSHA256, id);
    const model = JSON.parse(bytes);
    let triangles = 0, vertices = 0;
    for (const m of model.meshes) {
      const n = m.vertexBones.length;
      assert.equal(m.positions.length, n * 3);
      assert.equal(m.normals.length, n * 3);
      assert.equal(m.uvPixels.length, n * 2);
      assert.equal(m.indices.length % 3, 0);
      assert.ok(m.indices.every(i => Number.isInteger(i) && i >= 0 && i < n), id);
      assert.ok(m.vertexBones.concat(m.normalBones).every(i => i < model.bones.length), id);
      triangles += m.indices.length / 3; vertices += n;
    }
    assert.equal(triangles, entry.counts.triangles, id);
    assert.equal(vertices, entry.counts.renderVertices, id);
    assert.equal(model.sequences.filter(s => s.tracks).length, model.sequences.length, id);
    assert.ok(model.sequences.every(s => s.blendCount === 1 && s.sequenceGroup === 0), id);
    for (const texture of model.textures) {
      const png = await fs.readFile(path.join(assets, id, texture.file));
      assert.equal(hash(png), texture.sha256, id);
      assert.equal(png.readUInt32BE(16), texture.width);
      assert.equal(png.readUInt32BE(20), texture.height);
    }
  }
  assert.deepEqual([manifest.weapons.ak47.counts.sourceVertices, manifest.weapons.ak47.counts.triangles, manifest.weapons.ak47.counts.bones, manifest.weapons.ak47.counts.textures], [564, 1050, 42, 11]);
  const result = spawnSync('python3', ['-B', '-c', `
from pathlib import Path
import json,struct,zlib,importlib.util
root=Path('public/assets/weapons');sources=json.loads((root/'sources.json').read_text())['assets']
spec=importlib.util.spec_from_file_location('weaponimport','tools/import-weapons.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
for weapon,entry in sources.items():
 raw=(root/entry['file']).read_bytes();nt,offset=struct.unpack_from('<2i',raw,180)
 model=json.loads((root/weapon/'model.json').read_text())
 for i in range(nt):
  flags,w,h,start=struct.unpack_from('<4i',raw,offset+i*80+64)
  palette=raw[start+w*h:start+w*h+768];pixels=raw[start:start+w*h]
  png=(root/weapon/model['textures'][i]['file']).read_bytes();pos=8;compressed=b''
  while pos<len(png):
   size=struct.unpack_from('>I',png,pos)[0];kind=png[pos+4:pos+8];body=png[pos+8:pos+8+size]
   assert zlib.crc32(kind+body)&0xffffffff==struct.unpack_from('>I',png,pos+8+size)[0]
   if kind==b'IDAT':compressed+=body
   pos+=12+size
  decoded=zlib.decompress(compressed);assert len(decoded)==h*(w*4+1)
  for y in range(h):
   row=decoded[y*(w*4+1):(y+1)*(w*4+1)];assert row[0]==0
   expected=bytes(c for p in pixels[y*w:(y+1)*w] for c in (*palette[p*3:p*3+3],0 if flags&64 and p==255 else 255))
   assert row[1:]==expected,(weapon,i,y)
 # Check geometry and animation corruption are rejected by the real importer.
 if weapon=='ak47':
  body=struct.unpack_from('<i',raw,208)[0];modeloff=struct.unpack_from('<i',raw,body+72)[0]
  meshoff=struct.unpack_from('<i',raw,modeloff+76)[0];trioff=struct.unpack_from('<i',raw,meshoff+4)[0]
  damaged=bytearray(raw);struct.pack_into('<h',damaged,trioff+2,32767)
  try:m.convert(damaged,weapon,entry)
  except m.MDLError:pass
  else:raise AssertionError('Out-of-range vertex accepted')
print('Every PNG texel exactly matches its MDL palette and index; malformed triangle rejected')
`], {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
});

class FileTextureLoader {
  async loadAsync(url) {
    const png = await fs.readFile(path.join(root, 'public', url));
    const t = new THREE.Texture();
    t.image = {width: png.readUInt32BE(16), height: png.readUInt32BE(20)};
    return t;
  }
}
const three = {...THREE, TextureLoader: FileTextureLoader};
const localFetch = async url => {
  try { return new Response(await fs.readFile(path.join(root, 'public', url))); }
  catch { return new Response('missing', {status: 404}); }
};

test('predicted firearm token starts the real model before authority and never restarts on confirmation', {skip: !hasAssets && 'Private fixtures absent'}, async t => {
  const old=globalThis.fetch;globalThis.fetch=localFetch;t.after(()=>{globalThis.fetch=old;});
  const view=await createWeaponView(three,new THREE.PerspectiveCamera(),{skinning:'cpu'});t.after(()=>view.dispose());
  await view.setWeapon('ak47');
  const state={ammo:30,lastShot:-100,weaponShotToken:'base:1:ak47',weaponShotAt:-100};
  view.update(.6,state,1);view.update(.01,{...state,ammo:29,weaponShotToken:'shot:1:1',weaponShotAt:1.01},1.01);
  assert.match(view.info().sequence,/shoot|fire/);const frame=view.info().frame;
  view.update(.04,{...state,ammo:29,lastShot:50,weaponShotToken:'shot:1:1',weaponShotAt:1.01},1.05);
  assert.ok(view.info().frame>frame,'authority arrival must advance the existing animation');
  view.update(.01,{...state,ammo:28,lastShot:50,weaponShotToken:'shot:1:2',weaponShotAt:1.06},1.06);
  assert.ok(view.info().frame<frame+1,'a new logical shot restarts its firing animation');
  // A delayed model load or weapon switch must not replay an old shot token.
  await view.setWeapon('usp');view.update(.01,{ammo:11,lastShot:50,weaponShotToken:'shot:1:2',weaponShotAt:1.06},3);
  assert.doesNotMatch(view.info().sequence,/shoot|fire/);
});

test('runtime loads all canonical weapons, samples real skeletal motion, preserves caller transforms and handles races', {skip: !hasAssets && 'Private fixtures absent'}, async t => {
  const old = globalThis.fetch;
  globalThis.fetch = localFetch;
  t.after(() => { globalThis.fetch = old; });
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.06, 450);
  const view = await createWeaponView(three, camera, {skinning:'cpu'}); t.after(()=>view.dispose());
  assert.equal(view.group.parent, camera);
  assert.equal(view.muzzle.isMesh, true);
  for (const id of WEAPON_MODEL_IDS) {
    await view.setWeapon(id);
    assert.equal(view.info().source, 'original-mdl', `${id}: ${view.info().error}`);
    assert.equal(view.info().convertedSHA256Verified, true);
    assert.ok(view.info().cachedModels<=4,'Viewmodel cache must remain bounded during all-weapon cycling');
    view.update(0.016, {weaponSequence: view.info().availableSequences.find(s => s.name.startsWith('idle')).name, weaponFrame: 0});
    view.group.traverse(o => { if (o.isMesh) { assert.equal(o.material.depthTest, true); assert.equal(o.material.depthWrite, true); assert.equal(o.layers.mask,2); assert.ok(o.renderOrder >= 100); assert.ok(o.geometry.attributes.position.array.every(Number.isFinite)); } });
  }
  await view.setWeapon('ak47');
  view.update(0, {weaponSequence: 'idle1', weaponFrame: 0});
  camera.updateMatrixWorld(true);
  const muzzle = view.muzzle.getWorldPosition(new THREE.Vector3());
  // Independent expected original attachment after right-hand basis conversion.
  assert.ok(Math.abs(muzzle.x - 7.109107558 / 40) < 0.00001);
  assert.ok(Math.abs(muzzle.y + 4.173401579 / 40) < 0.00001);
  assert.ok(Math.abs(muzzle.z + 28.234886204 / 40) < 0.00001);
  const original = view.group.getObjectByName('original-mdl:ak47');
  const source = await json(path.join(assets, 'ak47/model.json'));
  const spec = source.meshes[0], texture = source.textures[source.skins[0][spec.skinref]];
  const uv = original.children[0].geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    assert.ok(Math.abs(uv.getX(i) - spec.uvPixels[i * 2] / texture.width) < 0.000001, 'U must not be mirrored');
    assert.ok(Math.abs(uv.getY(i) - spec.uvPixels[i * 2 + 1] / texture.height) < 0.000001, 'T must not be flipped');
  }
  let outward = 0, inward = 0;
  for (const m of source.meshes) for (let i = 0; i < m.indices.length; i += 3) {
    const [a, b, c] = m.indices.slice(i, i + 3);
    if (m.vertexBones[a] !== m.vertexBones[b] || m.vertexBones[a] !== m.vertexBones[c] || m.vertexBones[a] !== m.normalBones[a]) continue;
    const v = j => new THREE.Vector3().fromArray(m.positions, j * 3);
    const facing = v(b).sub(v(a)).cross(v(c).sub(v(a))).dot(new THREE.Vector3().fromArray(m.normals, a * 3));
    if (facing > 0.000001) outward++;
    if (facing < -0.000001) inward++;
  }
  assert.ok(outward > 700 && outward > inward * 10, 'Converted CCW faces must agree with source outward normals');
  const snapshots = () => original.children.flatMap(o => [...o.geometry.attributes.position.array]);
  view.update(0, {weaponSequence: 'reload', weaponFrame: 0});
  const initial = snapshots();
  view.group.position.set(0.26, -0.23, -0.40); view.group.rotation.x = 0.01; view.muzzle.visible = true;
  view.update(0, {weaponSequence: 'reload', weaponFrame: 35});
  assert.ok(snapshots().some((v, i) => Math.abs(v - initial[i]) > 1), 'Real reload must change bone-deformed geometry');
  assert.deepEqual(view.group.position.toArray(), [0.26, -0.23, -0.40]);
  assert.equal(view.group.rotation.x, 0.01); assert.equal(view.muzzle.visible, true);
  const first = view.setWeapon('awp'), second = view.setWeapon('knife');
  await Promise.all([first, second]);
  assert.equal(view.info().id, 'knife');
  assert.equal(view.group.children.filter(o => o.name.startsWith('original-mdl:')).length, 1);
  await view.setWeapon('not-a-weapon');
  assert.equal(view.info().source, 'procedural-fallback');
  assert.equal(view.info().sourceSHA256, null);
});

test('grenade viewmodels play pullpin, hold the final pose, and play throw from authoritative timing', {skip: !hasAssets && 'Private fixtures absent'}, async t => {
  const old=globalThis.fetch;globalThis.fetch=localFetch;t.after(()=>{globalThis.fetch=old;});
  const view=await createWeaponView(three,new THREE.PerspectiveCamera(),{skinning:'cpu'});t.after(()=>view.dispose());
  for(const weapon of ['hegrenade','flashbang','smokegrenade']){
    await view.setWeapon(weapon);assert.equal(view.info().sequence,'deploy');
    view.update(0,{grenadePhase:'pin',grenadeStartedAt:2},2.2);
    assert.equal(view.info().sequence,'pullpin');assert.ok(view.info().frame>0&&view.info().frame<40);
    const object=view.group.getObjectByName(`original-mdl:${weapon}`);
    const positions=()=>object.children.flatMap(o=>[...o.geometry.attributes.position.array]);
    const before=positions();
    view.update(0,{grenadePhase:'hold',grenadeStartedAt:2},4);
    assert.equal(view.info().sequence,'pullpin');assert.equal(view.info().frame,40);
    assert.notDeepEqual(positions(),before);
    view.update(0,{grenadePhase:'hold',grenadeStartedAt:2},5);assert.equal(view.info().frame,40);
    view.update(0,{grenadePhase:'throw',grenadeThrownAt:5},5.2);
    assert.equal(view.info().sequence,'throw');assert.ok(Math.abs(view.info().frame-6)<1e-6);
    if(weapon==='flashbang'){
      view.update(0,{grenadePhase:'pin',grenadeStartedAt:5.5},5.6);
      assert.equal(view.info().sequence,'pullpin');assert.ok(Math.abs(view.info().frame-4.1)<1e-6);
      view.update(0,{grenadePhase:'hold',grenadeStartedAt:5.5},8);
      assert.equal(view.info().sequence,'pullpin');assert.equal(view.info().frame,40);
    }
  }
});

test('grenade viewmodel never rewinds one pin/throw animation when the estimated server clock regresses', {skip: !hasAssets && 'Private fixtures absent'}, async t => {
  const old=globalThis.fetch;globalThis.fetch=localFetch;t.after(()=>{globalThis.fetch=old;});
  const sounds=[];
  const view=await createWeaponView(three,new THREE.PerspectiveCamera(),{skinning:'cpu',onSound:name=>sounds.push(name)});t.after(()=>view.dispose());
  for(const weapon of ['hegrenade','flashbang','smokegrenade']){
    const pinSounds=sounds.filter(s=>s==='weapons/pinpull.wav').length;
    await view.setWeapon(weapon);
    view.update(0,{grenadePhase:'pin',grenadeStartedAt:2},2.4);const pinFrame=view.info().frame;
    assert.ok(pinFrame>0&&pinFrame<40);
    view.update(0,{grenadePhase:'pin',grenadeStartedAt:2},2.1);assert.equal(view.info().frame,pinFrame);
    view.update(0,{grenadePhase:'hold',grenadeStartedAt:2},4);assert.equal(view.info().frame,40);
    view.update(0,{grenadePhase:'pin',grenadeStartedAt:2},2.2);assert.equal(view.info().frame,40);
    assert.equal(sounds.filter(s=>s==='weapons/pinpull.wav').length,pinSounds+1,'one pin emits its authored sound event once');
    view.update(0,{grenadePhase:'throw',grenadeThrownAt:5},5.2);const throwFrame=view.info().frame;
    view.update(0,{grenadePhase:'throw',grenadeThrownAt:5},5.1);assert.equal(view.info().frame,throwFrame);
    view.update(0,{grenadePhase:'pin',grenadeStartedAt:6},6.1);assert.ok(view.info().frame>0&&view.info().frame<pinFrame,'a genuinely new grenade must still start its own pin');
  }
});

test('missing assets and rejected texture loads report honest playable fallbacks', async t => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => new Response('missing', {status: 404});
  t.after(() => { globalThis.fetch = old; });
  const view = await createWeaponView(three, new THREE.PerspectiveCamera());
  assert.equal(view.info().source, 'procedural-fallback');
  assert.equal(view.info().animationSupport, 'none');
  assert.equal(view.info().sourceSHA256, null);
  assert.match(view.info().error, /404/);
  assert.equal(view.muzzle.isMesh, true);
  if (hasAssets) {
    globalThis.fetch = localFetch;
    class BrokenTextures { async loadAsync() { throw new Error('texture unavailable'); } }
    const broken = await createWeaponView({...three, TextureLoader: BrokenTextures}, new THREE.PerspectiveCamera());
    assert.equal(broken.info().source, 'procedural-fallback');
    assert.match(broken.info().error, /texture load failed/);
    globalThis.fetch = async url => {
      const response = await localFetch(url);
      return url.endsWith('/glock18/model.json') ? new Response((await response.text()) + ' ') : response;
    };
    const altered = await createWeaponView(three, new THREE.PerspectiveCamera());
    assert.equal(altered.info().source, 'procedural-fallback');
    assert.equal(altered.info().sourceSHA256, null);
    assert.match(altered.info().error, /SHA256 mismatch/);
  }
});
