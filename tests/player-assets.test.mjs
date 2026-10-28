import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const assets = path.join(root, 'public/assets/players');
const ids = 'terror leet arctic guerilla urban gsg9 sas gign'.split(' ');
const weapons = 'glock18 usp p228 deagle elite fiveseven m3 xm1014 mac10 tmp mp5navy ump45 p90 galil famas ak47 m4a1 aug sg552 scout awp g3sg1 sg550 m249'.split(' ');
const installed = existsSync(path.join(assets, 'manifest.json'));
const hash = data => createHash('sha256').update(data).digest('hex');
const readJSON = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const python = code => {
  const result = spawnSync('python3', ['-B', '-c', code], {cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024});
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  return result.stdout;
};

const fixture = String.raw`
import runpy,struct,json,hashlib
m=runpy.run_path('tools/import-players.py'); f=runpy.run_path('tools/fetch-player-assets.py')
d=bytearray(244)
def alloc(n):
 offset=len(d);d.extend(bytes(n));return offset
def put(fmt,off,*v):struct.pack_into('<'+fmt,d,off,*v)
def text(off,value):d[off:off+len(value)]=value.encode()
bone=alloc(224)
for i,name in enumerate(['Bip01','Bip01 Head']):
 off=bone+i*112;text(off,name);put('2i',off+32,i-1,0);put('6i',off+40,*([-1]*6))
 put('6f',off+64,10,20,30,.1,.2,.3);put('6f',off+88,*([.25]*6))
hitbox=alloc(32);put('2i6f',hitbox,1,1,-2,-3,-4,2,3,4)
group=alloc(104);text(group,'default')
seq=alloc(176);text(seq,'nine_way');put('f6i',seq+32,30,1,13,7,0,0,4)
put('2i',seq+68,0,0);put('6f',seq+96,-1,-2,-3,1,2,3)
anim=alloc(9*2*12);put('2i',seq+120,9,anim);put('2i4fi',seq+128,8,16,-45,-90,45,90,0)
for blend in range(9):
 for bi in range(2):
  ao=anim+(blend*2+bi)*12
  for axis in [0,3]:
   channel=alloc(6);put('H',ao+axis*2,channel-ao)
   put('BBhh',channel,2,4,blend*100+bi*10+axis,blend*100+bi*10+axis+50)
texture=alloc(80);text(texture,'exact_palette');pixels=alloc(4+768)
put('4i',texture+64,64,2,2,pixels);d[pixels:pixels+4]=bytes([0,1,255,2])
d[pixels+4:pixels+772]=bytes(i%256 for i in range(768))
skins=alloc(4);put('2h',skins,0,0)
body=alloc(76);text(body,'body');submodels=alloc(224);put('3i',body+64,2,1,submodels)
text(submodels,'original');text(submodels+112,'blank')
mesh=alloc(20);verts=alloc(48);norms=alloc(24);vb=alloc(4);nb=alloc(2)
put('12f',verts,4,8,12,40,8,12,4,80,12,40,80,12);put('6f',norms,0,0,1,0,1,0)
d[vb:vb+4]=bytes([0,0,1,1]);d[nb:nb+2]=bytes([1,0])
commands=alloc(36);put('h',commands,4)
for i,corner in enumerate([(0,0,-2,0),(1,0,2,0),(2,1,0,2),(3,1,3,2)]):put('4h',commands+2+i*8,*corner)
put('5i',mesh,2,commands,0,2,0)
put('if10i',submodels+64,0,99,1,mesh,4,vb,verts,2,nb,norms,0,0)
transitions=alloc(4);d[transitions:transitions+4]=bytes([0,1,1,0])
put('4si',0,b'IDST',10);text(8,'synthetic-nine-way.mdl');put('i',72,len(d))
put('20i',140,2,bone,0,0,1,hitbox,1,seq,1,group,1,texture,pixels,1,2,skins,1,body,0,0)
put('2i',236,2,transitions)
original=bytes(d)
source={'url':'https://example.invalid/synthetic.mdl','sha256':hashlib.sha256(d).hexdigest(),'retrievedUTC':'2026-10-28T00:00:00Z','rights':'unknown'}
`;

test('synthetic nine-blend MDLv10 preserves every blend, body option, bone, hitbox and source coordinate', () => {
  python(fixture + String.raw`
model,pngs=m['convert'](d,'synthetic',source)
assert bytes(d)==original
assert model['schema']=='goldsrc-player-v1'
assert model['metadata']['headBones']==[{'index':1,'name':'Bip01 Head'}]
assert model['metadata']['provenance']==source
assert model['hitboxes']==[{'bone':1,'group':1,'min':[-2,-3,-4],'max':[2,3,4]}]
assert model['skins']==[[0],[0]] and len(model['bodyparts'][0]['models'])==2
assert model['meshes'][0]['positions'][:6]==[4,8,12,40,8,12]
assert model['meshes'][0]['normalBones']==[1,1,0,0]
assert model['meshes'][0]['uvPixels']==[-2,0,2,0,0,2,3,2]
assert model['meshes'][0]['indices']==[0,2,1,2,3,1]
s=model['sequences'][0]
assert s['tracks'] is s['blendTracks'][0]
assert s['blendCount']==9 and s['blendType']==[8,16] and s['blendStart']==[-45,-90] and s['blendEnd']==[45,90]
for blend in range(9):
 for bi in range(2):
  for axis in range(6):
   c=s['blendTracks'][blend][bi][axis]
   if axis in (0,3):
    v=blend*100+bi*10+axis
    assert c=={'values':[v,v+50,v+50,v+50],'positionHold':[1]}
   else:assert c is None
assert model['metadata']['counts']['animationSamples']==144
assert json.loads(json.dumps(model))['sequences'][0]['tracks']==s['blendTracks'][0]
assert set(pngs)=={'texture-0.png'}
assert f['asset_path']('weapons','mp5navy')=='p_mp5.mdl'
`);
});

test('malformed later blends, hitboxes, geometry, budgets and escaping paths fail closed', () => {
  python(fixture + String.raw`
def rejected(fn):
 try:fn()
 except (m['MDLError'],ValueError):return
 raise AssertionError('Malformed input accepted')
def damaged(fmt,off,*values):
 bad=bytearray(original);struct.pack_into('<'+fmt,bad,off,*values)
 rejected(lambda:m['convert'](bad,'bad',source))
damaged('i',72,1)
damaged('i',140,129)
damaged('i',hitbox,2)
damaged('i',hitbox+4,-1)
damaged('f',hitbox+8,5)
damaged('f',hitbox+8,float('nan'))
damaged('i',seq+120,17)
damaged('i',seq+156,1)
damaged('i',seq+124,1)
damaged('f',seq+136,float('nan'))
damaged('H',anim+8*2*12,65535)
damaged('H',anim+8*2*12,1)
later=anim+8*2*12+struct.unpack_from('<H',original,anim+8*2*12)[0]
damaged('BB',later,0,0)
damaged('BB',later,3,2)
damaged('h',commands+2,99)
damaged('h',commands+4,99)
damaged('B',vb,2)
damaged('f',verts,float('inf'))
damaged('i',texture+68,4097)
damaged('i',mesh,20001)
damaged('i',body+64,33)
damaged('h',skins,1)
damaged('i',group+100,244)
damaged('i',seq+88,244)
damaged('i',236,257)
damaged('i',bone+112+32,1)
rejected(lambda:m['decode_channel'](m['Reader'](original),later,10001))
rejected(lambda:m['contained'](m['ROOT'],'../weapons/raw/v_ak47.mdl'))
rejected(lambda:f['asset_path']('models','../../escape'))
rejected(lambda:f['validate'](b'IDST'))
rejected(lambda:f['download']('http://example.invalid/no-network-call'))
# Aggregate sample cap counts all blends before decoding or allocating their samples.
globals_=m['preflight'].__globals__;previous=globals_['MAX_SAMPLES'];globals_['MAX_SAMPLES']=143
rejected(lambda:m['convert'](original,'bad',source));globals_['MAX_SAMPLES']=previous
`);
});

test('all eight locally acquired players have complete hashed model/texture/blend contracts', {skip: !installed && 'Private fixtures absent; run fetch-player-assets.py and import-players.py'}, async () => {
  const manifest = await readJSON(path.join(assets, 'manifest.json'));
  const sources = await readJSON(path.join(assets, 'sources.json'));
  assert.equal(manifest.schema, 'goldsrc-players-v1');
  for (const id of ids) {
    const entry = manifest.models[id], source = sources.models[id];
    assert.equal(entry.source, 'original-mdl', id);
    assert.equal(entry.file, `${id}/model.json`);
    const raw = await fs.readFile(path.join(assets, source.file));
    assert.equal(hash(raw), source.sha256, id);
    assert.equal(source.sha256, entry.sourceSHA256);
    assert.equal(source.url, `https://www.vertigogaming.org/downloads/cstrike/models/player/${id}/${id}.mdl`);
    assert.ok(Number.isFinite(Date.parse(source.retrievedUTC)));
    assert.match(source.rights, /unknown/);
    assert.equal(source.retailHashVerified, false);
    const bytes = await fs.readFile(path.join(assets, entry.file));
    assert.equal(hash(bytes), entry.convertedSHA256, id);
    assert.equal(bytes.length, entry.convertedBytes);
    const model = JSON.parse(bytes);
    assert.equal(model.schema, 'goldsrc-player-v1');
    assert.equal(model.metadata.id, id);
    assert.deepEqual(model.metadata.provenance, source);
    assert.equal(model.metadata.counts.sequences, 111);
    assert.equal(model.sequences.filter(s => s.blendCount === 9).length, 66);
    assert.equal(model.metadata.counts.blends, 639);
    assert.equal(model.metadata.headBoneNames[0], 'Bip01 Head');
    assert.equal(model.bones[model.metadata.headBoneIndices[0]].name, 'Bip01 Head');
    assert.equal(model.hitboxes.length, entry.counts.hitboxes);
    let vertices = 0, triangles = 0, samples = 0, distinctLateBlends = 0;
    for (const mesh of model.meshes) {
      const n = mesh.vertexBones.length;
      assert.equal(mesh.positions.length, n * 3);
      assert.equal(mesh.normals.length, n * 3);
      assert.equal(mesh.uvPixels.length, n * 2);
      assert.ok(mesh.indices.every(i => Number.isInteger(i) && i >= 0 && i < n));
      assert.ok(mesh.vertexBones.concat(mesh.normalBones).every(i => i >= 0 && i < model.bones.length));
      vertices += n; triangles += mesh.indices.length / 3;
    }
    for (const seq of model.sequences) {
      assert.equal(seq.blendTracks.length, seq.blendCount);
      assert.deepEqual(seq.tracks, seq.blendTracks[0]);
      assert.equal(seq.blendType.length, 2);
      assert.equal(seq.blendStart.length, 2);
      assert.equal(seq.blendEnd.length, 2);
      if (seq.blendCount === 9 && JSON.stringify(seq.blendTracks[8]) !== JSON.stringify(seq.blendTracks[0])) distinctLateBlends++;
      for (const blend of seq.blendTracks) {
        assert.equal(blend.length, model.bones.length);
        for (const channels of blend) {
          assert.equal(channels.length, 6);
          for (const channel of channels) if (channel) {
            assert.equal(channel.values.length, seq.frames);
            assert.ok(channel.values.every(v => Number.isInteger(v) && v >= -32768 && v <= 32767));
            assert.ok(channel.positionHold.every(v => Number.isInteger(v) && v >= 0 && v < seq.frames - 1));
            samples += channel.values.length;
          }
        }
      }
    }
    assert.ok(distinctLateBlends > 50, `${id}: later aim blends must contain original differing motion`);
    assert.equal(samples, entry.counts.animationSamples);
    assert.equal(vertices, entry.counts.renderVertices);
    assert.equal(triangles, entry.counts.triangles);
    for (const texture of model.textures) {
      const png = await fs.readFile(path.join(assets, id, texture.file));
      assert.equal(hash(png), texture.sha256);
      assert.equal(png.readUInt32BE(16), texture.width);
      assert.equal(png.readUInt32BE(20), texture.height);
    }
  }
});

test('independent source-byte checks cover every palette texel, mesh corner, hitbox and animation sample', {skip: !installed && 'Private fixtures absent'}, () => {
  python(String.raw`
from pathlib import Path
import json,struct,zlib,hashlib
root=Path('public/assets/players');manifest=json.loads((root/'manifest.json').read_text())
jobs=list(manifest['models'].items())+list(manifest.get('weapons',{}).items())
def name(data,off,size):return data[off:off+size].split(b'\0',1)[0].decode('ascii','replace')
for identity,entry in jobs:
 if entry['source']!='original-mdl':continue
 raw=(root/entry['provenance']['file']).read_bytes();model=json.loads((root/entry['file']).read_text())
 def u(fmt,off):return struct.unpack_from('<'+fmt,raw,off)
 def integer(off):return u('i',off)[0]
 for i,bone in enumerate(model['bones']):
  off=integer(144)+i*112
  assert bone['name']==name(raw,off,32)
  assert bone['parent']==integer(off+32)
  assert bone['flags']==integer(off+36) and bone['controllers']==list(u('6i',off+40))
  assert bone['value']==list(u('6f',off+64)) and bone['scale']==list(u('6f',off+88))
 assert model['skins']==[list(u(str(integer(192))+'h',integer(200)+i*integer(192)*2)) for i in range(integer(196))]
 for i,h in enumerate(model['hitboxes']):
  off=integer(160)+i*32
  assert [h['bone'],h['group']]==list(u('2i',off))
  assert h['min']+h['max']==list(u('6f',off+8))
 for i,texture in enumerate(model['textures']):
  flags,w,h,start=u('4i',integer(184)+i*80+64);indices=raw[start:start+w*h];palette=raw[start+w*h:start+w*h+768]
  assert hashlib.sha256(palette).hexdigest()==texture['paletteSHA256']
  assert texture['paletteRGB']==list(palette)
  assert hashlib.sha256(indices).hexdigest()==texture['pixelIndicesSHA256']
  png=(root/entry['file']).parent.joinpath(texture['file']).read_bytes();pos=8;compressed=b''
  while pos<len(png):
   size=struct.unpack_from('>I',png,pos)[0];kind=png[pos+4:pos+8];body=png[pos+8:pos+8+size]
   assert zlib.crc32(kind+body)&0xffffffff==struct.unpack_from('>I',png,pos+8+size)[0]
   if kind==b'IDAT':compressed+=body
   pos+=size+12
  decoded=zlib.decompress(compressed);assert len(decoded)==h*(w*4+1)
  for y in range(h):
   row=decoded[y*(w*4+1):(y+1)*(w*4+1)]
   assert row[0]==0
   assert row[1:]==bytes(c for p in indices[y*w:(y+1)*w] for c in (*palette[p*3:p*3+3],0 if flags&64 and p==255 else 255))
 for bp in model['bodyparts']:
  assert bp['name']==name(raw,bp['sourceOffset'],64) and bp['base']==integer(bp['sourceOffset']+68)
  for sm in bp['models']:
   mo=sm['sourceOffset'];g=sm['sourceGeometry'];nv=integer(mo+80);nn=integer(mo+92)
   assert g['positions']==list(u(str(nv*3)+'f',integer(mo+88)))
   assert g['normals']==list(u(str(nn*3)+'f',integer(mo+100)))
   assert g['vertexBones']==list(raw[integer(mo+84):integer(mo+84)+nv])
   assert g['normalBones']==list(raw[integer(mo+96):integer(mo+96)+nn])
   for mi in sm['meshIndices']:
    mesh=model['meshes'][mi];cursor=integer(mesh['sourceOffset']+4);lookup={};expected=[]
    while True:
     cmd=u('h',cursor)[0];cursor+=2
     if not cmd:break
     corners=[]
     for _ in range(abs(cmd)):
      key=u('4h',cursor);cursor+=8;vi,ni,s,t=key
      if key not in lookup:
       index=len(lookup);lookup[key]=index
       assert mesh['positions'][index*3:index*3+3]==g['positions'][vi*3:vi*3+3]
       assert mesh['normals'][index*3:index*3+3]==g['normals'][ni*3:ni*3+3]
       assert mesh['vertexBones'][index]==g['vertexBones'][vi]
       assert mesh['normalBones'][index]==g['normalBones'][ni]
       assert mesh['uvPixels'][index*2:index*2+2]==[s,t]
      corners.append(lookup[key])
     for j in range(2,len(corners)):
      a,b,c=(corners[0],corners[j-1],corners[j]) if cmd<0 else ((corners[j-2],corners[j-1],corners[j]) if j%2==0 else (corners[j-1],corners[j-2],corners[j]))
      expected.extend([a,c,b])
    assert mesh['indices']==expected
 for si,seq in enumerate(model['sequences']):
  off=integer(168)+si*176;nb=integer(140)
  assert seq['name']==name(raw,off,32) and seq['fps']==u('f',off+32)[0]
  assert [seq['flags'],seq['activity'],seq['activityWeight']]==list(u('3i',off+36))
  assert seq['bbMin']+seq['bbMax']==list(u('6f',off+96))
  assert seq['linearMovement']==list(u('3f',off+76))
  assert len(seq['events'])==integer(off+48)
  for ei,event in enumerate(seq['events']):
   eo=integer(off+52)+ei*76
   assert [event['frame'],event['event'],event['type']]==list(u('3i',eo))
   assert event['options']==name(raw,eo+12,64)
  assert seq['blendType']==list(u('2i',off+128))
  assert seq['blendStart']==list(u('2f',off+136)) and seq['blendEnd']==list(u('2f',off+144))
  assert seq['blendParent']==integer(off+152)
  for blend,tracks in enumerate(seq['blendTracks']):
   for bi,channels in enumerate(tracks):
    ao=integer(off+124)+(blend*nb+bi)*12
    for axis,c in enumerate(channels):
     relative=u('H',ao+axis*2)[0]
     if not relative:assert c is None;continue
     cursor=ao+relative;values=[];holds=[]
     while len(values)<seq['frames']:
      valid,total=u('BB',cursor);explicit=u(str(valid)+'h',cursor+2)
      holds.append(len(values)+valid-1)
      for frame in range(total):values.append(explicit[min(frame,valid-1)])
      cursor+=(valid+1)*2
     assert c['values']==values[:seq['frames']],(identity,si,blend,bi,axis)
     assert c['positionHold']==[h for h in holds if h<seq['frames']-1]
print('All raw geometry, palette texels and all-blend samples match')
`);
});

test('optional third-person weapon manifest reports originals or explicit unavailable sources', {skip: !installed && 'Private fixtures absent'}, async t => {
  const manifest = await readJSON(path.join(assets, 'manifest.json'));
  if (!Object.keys(manifest.weapons || {}).length) return t.skip('Optional p_* assets not requested');
  for (const id of weapons) {
    const entry = manifest.weapons[id];
    assert.ok(entry, `${id}: absence must be recorded`);
    if (entry.source === 'unavailable') { assert.ok(entry.error); continue; }
    assert.equal(entry.source, 'original-mdl');
    assert.equal(entry.file, `weapons/${id}/model.json`);
    assert.equal(entry.assetKind, 'third-person-weapon');
    assert.equal(hash(await fs.readFile(path.join(assets, entry.provenance.file))), entry.sourceSHA256);
    const bytes = await fs.readFile(path.join(assets, entry.file));
    assert.equal(hash(bytes), entry.convertedSHA256);
    const model = JSON.parse(bytes);
    assert.equal(model.metadata.id, id);
    assert.ok(model.bones.some(b => b.name.startsWith('Bip01')), `${id}: original merge bone names`);
    assert.ok(model.sequences.every(s => s.blendTracks.length === s.blendCount));
  }
});
