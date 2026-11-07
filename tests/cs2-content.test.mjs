import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gunAudioProfile} from '../public/weapon-audio.js';
import {GUNS} from '../public/arsenal.js';

const root=resolve(import.meta.dirname,'..');
function python(code){
  const result=spawnSync('python3',['-c',`import sys\nsys.path.insert(0,'tools')\n${code}`],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
  return result.stdout;
}

test('CS2 KV3 reader retains typed strings, nested arrays and multiline data without evaluation',()=>{
  python(`from importlib import import_module
m=import_module('cs2-content-kv3')
s='''<!-- kv3 text --> { base = { n = 36 values = [ true, false, null, 2.5 ] } resource = resource:"safe/model.vmdl" text = """line one\\nline two""" bytes = #[ 00 ff 12 ] }'''
v=m.TextKV3(s).read()
assert v['base']['n']==36 and v['base']['values']==[True,False,None,2.5]
assert v['resource']=={'$type':'resource','value':'safe/model.vmdl'}
assert v['text']=='line one\\nline two'
assert v['bytes']=={'$binaryHex':'00ff12'}
for bad in ['{ x = 1 x = 2 }','{ x = NaN }','{ x = #[ F ] }','{ x = 1 } __import__("os")','['*66+']'*66]:
 try: m.TextKV3(bad).read()
 except ValueError: pass
 else: raise AssertionError('Unsafe/malformed KV3 accepted: '+bad)
`);
});

test('CS2 weapon inheritance preserves overrides and rejects missing/cyclic base chains',()=>{
  python(`from importlib import import_module
m=import_module('cs2-content-kv3')
rows={'base':{'damage':42,'config':{'a':1,'b':2}},'rifle':{'_base':'base','config':{'a':3}},'ak':{'_base':'rifle','damage':36}}
v=m.resolve_bases(rows,'ak')
assert v['damage']==36 and v['config']=={'a':3,'b':2}
for bad in [{'a':{'_base':'b'},'b':{'_base':'a'}},{'a':{'_base':'missing'}}]:
 try: m.resolve_bases(bad,'a')
 except ValueError: pass
 else: raise AssertionError('Invalid base chain accepted')
`);
});

test('CS2 compact mount preserves bytes and CRC with bounded streaming',()=>{
  python(`from importlib import import_module
from pathlib import Path
from tempfile import TemporaryDirectory
m=import_module('prepare-cs2-content');v=import_module('inspect-cs2-assets')
for bad in ['/outside/file','../parent','a/../../outside',r'a\\b']:
 try: m.safe_resource(bad)
 except ValueError: pass
 else: raise AssertionError('Unsafe resource path accepted')
with TemporaryDirectory() as d:
 root=Path(d);raw=root/'raw';(raw/'models').mkdir(parents=True)
 content=bytes(range(256))*8193
 (raw/'models/test.vmdl_c').write_bytes(content)
 target=root/'pak01_dir.vpk';m.build_mount(raw,target)
 index=v.inspect_vpk(target,True)
 assert index['indexComplete'] and index['entries']==1
 assert v.read_entry(target,index['resources'][0])==content
`);
});

const manifestPath=resolve(root,'public/assets/cs2-content/manifest.json');
test('prepared genuine CS2 actors expose distinct Source capsule metadata and world animation tracks',{skip:!existsSync(manifestPath)},()=>{
  const manifest=JSON.parse(readFileSync(manifestPath));
  assert.equal(manifest.schema,'cscs.cs2.content.v1');
  const clips=new Map(manifest.clips.map(c=>[c.key,c]));
  for(const name of ['ctm_sas','tm_phoenix']){
    const model=manifest.models.find(m=>m.key===name);
    assert.ok(model&&model.skins>0&&model.meshes>0);
    assert.match(model.source.sha256,/^[a-f0-9]{64}$/);
    const metadata=JSON.parse(readFileSync(resolve(root,'public'+model.metadata)));
    assert.equal(metadata.schema,'cscs.cs2.model-metadata.v1');
    assert.ok(metadata.skeleton.m_boneName.length>70);
    assert.equal(metadata.hitboxSets.cstrike.m_HitBoxes.length,19);
    const head=metadata.hitboxSets.cstrike.m_HitBoxes.find(h=>h.m_name==='head_0');
    assert.equal(head.m_nShapeType,2);assert.ok(head.m_flShapeRadius>0);
    for(const action of ['idle','run','crouch','crouchMove','jump','fire','hit','hitHead','death']){
      const clip=clips.get(model.actions[action]);
      assert.ok(clip,`missing ${name} ${action}`);
      assert.ok(clip.key.startsWith(['hit','hitHead','death'].includes(action)?'world.shared.':'world.rifle.'));
      assert.match(clip.skeleton,/characters\/worldmodel\.vnmskel$/);
      assert.ok(clip.duration>0&&clip.frames>0);
      if(['hit','hitHead','death'].includes(action))assert.equal(clip.additive,false);
    }
  }
});

test('prepared CS2 content has verified file sizes and no broken glTF buffer/image links',{skip:!existsSync(manifestPath)},()=>{
  python(`from pathlib import Path
from importlib import import_module
import json
m=import_module('prepare-cs2-content');root=Path('public/assets/cs2-content')
data=json.loads((root/'manifest.json').read_text())
assert not any(row['path'] in ('manifest.json','runtime.json') for row in data['files'])
assert not any(row['path'].startswith('rigs/') for row in data['files'])
for row in data['files']:
 p=root/row['path'];assert p.is_file() and p.stat().st_size==row['bytes']
for row in data['models']+data['clips']:
 m.verify_gltf(Path('public'+row['url']),require_skin=row in data['models'] and row['key'] not in ('hegrenade','flashbang','smokegrenade'))
`);
});

test('prepared CS2 audio bridge points to real WAV/MP3 content with matching extensions',{skip:!existsSync(resolve(root,'public/assets/cs2-content/audio.json'))},()=>{
  const audio=JSON.parse(readFileSync(resolve(root,'public/assets/cs2-content/audio.json')));
  assert.equal(audio.schema,'cscs.cs2.audio.v1');
  for(const sound of Object.values(audio.sounds)){
    const bytes=readFileSync(resolve(root,'public'+sound.url));
    assert.equal(bytes.length,sound.bytes);
    if(sound.codec==='wav'){
      assert.ok(sound.url.endsWith('.wav'));
      assert.equal(bytes.toString('ascii',0,4),'RIFF');
      assert.equal(bytes.toString('ascii',8,12),'WAVE');
    }else{
      assert.equal(sound.codec,'mp3');assert.ok(sound.url.endsWith('.mp3'));
      assert.ok(bytes.toString('ascii',0,3)==='ID3'||bytes[0]===255&&(bytes[1]&224)===224);
    }
  }
  for(const name of ['weapons/ak47-1.wav','weapons/awp1.wav','weapons/usp1.wav','weapons/m4a1-1.wav']){
    assert.ok(audio.legacy[name]);
    assert.ok(existsSync(resolve(root,'public'+audio.legacy[name])));
  }
  for(const weapon of Object.keys(GUNS))for(const silenced of [false,true])for(const burstMode of [false,true])for(const random of [0,.99]){
    const name=gunAudioProfile({weapon,silenced,burstMode},()=>random)?.name;
    assert.ok(name&&audio.legacy[name],`missing native direct-shot bridge: ${weapon} ${name}`);
  }
});

test('prepared CS2 catalog covers all 24 guns with valid first-person basic clips',{skip:!existsSync(manifestPath)},()=>{
  const manifest=JSON.parse(readFileSync(manifestPath));
  const models=new Map(manifest.models.map(model=>[model.key,model]));
  const clips=new Set(manifest.clips.map(clip=>clip.key));
  const clipEntries=new Map(manifest.clips.map(clip=>[clip.key,clip]));
  for(const oldKey of Object.keys(GUNS)){
    const model=models.get(manifest.legacyModelKeys?.[oldKey]);
    assert.ok(model,`missing native model for ${oldKey}`);
    assert.match(model.weaponSourceId,/^weapon_/);
    for(const action of ['draw','idle','reload','fire']){
      assert.ok(clips.has(model.viewmodelActions?.[action]),`missing ${oldKey} ${action}`);
    }
  }
  assert.equal(manifest.legacyModelKeys.m4a1,'m4a1_silencer');
  assert.ok(models.has('m4a4')&&models.has('c4'));
  const weaponRows=JSON.parse(readFileSync(resolve(root,'public/assets/cs2-content/weapons-reference.json'))).weapons;
  for(const model of models.values())if(model.weaponSourceId){
    const expected=weaponRows[model.weaponSourceId].m_szAnimSkeleton;
    assert.equal(model.weaponSkeleton,expected);
    for(const [action,key] of Object.entries(model.viewmodelActions)){
      assert.ok(clipEntries.get(key)?.secondarySkeletons.includes(expected),`${model.key}/${action} uses another weapon skeleton`);
    }
  }
  python(`from pathlib import Path
from PIL import Image
import json
root=Path('public/assets/cs2-content');data=json.loads((root/'manifest.json').read_text())
for row in data['models']:
 p=Path('public'+row['url']);g=json.loads(p.read_text())
 for image in g.get('images',[]):
  with Image.open(p.parent/image['uri']) as source:
   assert max(source.size)<=1024,(row['key'],source.size)
`);
});

test('native clip sound cues use real case-insensitive bank events and ADS keeps original static pose metadata',{skip:!existsSync(manifestPath)},()=>{
  const manifest=JSON.parse(readFileSync(manifestPath));
  const audio=JSON.parse(readFileSync(resolve(root,'public/assets/cs2-content/audio.json')));
  const clips=new Map(manifest.clips.map(clip=>[clip.key,clip]));
  const weaponRows=JSON.parse(readFileSync(resolve(root,'public/assets/cs2-content/weapons-reference.json'))).weapons;
  for(const model of manifest.models)for(const key of Object.values(model.viewmodelActions||{})){
    const clip=clips.get(key);
    for(const event of clip.events||[])if(event._class==='CNmSoundEvent'){
      const bank=audio.events?.[event.m_name.toLowerCase()];
      assert.ok(bank?.urls.length,`missing source cue ${event.m_name}`);
      assert.ok(event.m_flStartTime.m_flValue>=0&&event.m_flStartTime.m_flValue<=1);
      for(const url of bank.urls)assert.ok(existsSync(resolve(root,'public'+url)));
    }
  }
  for(const id of ['aug','sg556']){
    const model=manifest.models.find(row=>row.key===id),source=weaponRows[model.weaponSourceId];
    for(const [key,field] of Object.entries(model.ironSight.sourceFields))assert.equal(model.ironSight[key],source[field]);
    assert.match(model.ironSight.source.sha256,/^[a-f0-9]{64}$/);
    const idle=clips.get(model.viewmodelActions.zoomIdle),fire=clips.get(model.viewmodelActions.zoomFire);
    assert.ok(idle.staticPose);assert.equal(idle.frames,1);assert.equal(idle.duration,0);assert.equal(idle.additive,false);
    assert.equal(fire.frames,9);assert.equal(fire.additive,false);
    assert.equal(model.viewmodelActions.zoomIn,undefined);assert.equal(model.viewmodelActions.zoomOut,undefined);
  }
});

test('published locomotion stride candidates bind exact clips and label every unmeasured fallback',{skip:!existsSync(resolve(root,'public/assets/cs2-content/locomotion-strides.json'))},()=>{
  const manifest=JSON.parse(readFileSync(manifestPath)),clips=new Map(manifest.clips.map(clip=>[clip.key,clip]));
  const data=JSON.parse(readFileSync(resolve(root,'public/assets/cs2-content/locomotion-strides.json')));
  assert.equal(data.schema,'cscs.cs2.clip-strides.v1');assert.equal(Object.keys(data.clipStrides).length,72);
  const hashCache=new Map(),hash=url=>{if(!hashCache.has(url))hashCache.set(url,createHash('sha256').update(readFileSync(resolve(root,'public'+url))).digest('hex'));return hashCache.get(url);};
  const counts={};
  for(const [key,row] of Object.entries(data.clipStrides)){
    const clip=clips.get(key),reference=clips.get(row.referenceClip);
    assert.ok(clip&&reference);assert.ok(Number.isFinite(row.strideMeters)&&row.strideMeters>0);
    assert.equal(row.durationSeconds,clip.duration);
    assert.equal(hash(clip.url),row.clipGLTFSHA256);assert.equal(hash(reference.url),row.referenceGLTFSHA256);
    for(const [entry,buffers] of [[clip,row.clipBuffers],[reference,row.referenceBuffers]])for(const buffer of buffers){
      const url=new URL(buffer.uri,'https://local.invalid'+entry.url).pathname;
      assert.equal(hash(url),buffer.sha256);
    }
    counts[row.classification]=(counts[row.classification]||0)+1;
    if(row.classification==='bilateral-derived-candidate')assert.equal(row.referenceClip,key);
    else{
      assert.equal(row.classification,'family-mode-n-fallback');
      const family=key.split('.')[1],mode=key.split('.')[2].split('_')[0];
      assert.equal(row.referenceClip,`world.${family}.${mode}_n_${family}`);
      assert.equal(row.uncertainty.classification,'fallback-not-bilaterally-confirmed-for-target');
    }
  }
  assert.deepEqual(counts,{'bilateral-derived-candidate':48,'family-mode-n-fallback':24});
});
