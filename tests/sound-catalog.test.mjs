import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {SHOT_SOUNDS,ACTION_SOUNDS,ALL_SOUNDS,SOUND_GROUPS,SOUND_BUDGET,safeSound,gunSound} from '../public/sound-catalog.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const all = new Set(ALL_SOUNDS);
const guns = ['glock18','usp','p228','deagle','elite','fiveseven','m3','xm1014','mac10','tmp','mp5navy','ump45','p90','galil','famas','ak47','m4a1','aug','sg552','scout','awp','g3sg1','sg550','m249'];

test('24 default gun paths and silenced compatibility, no inherited properties', () => {
  assert.deepEqual(Object.keys(SHOT_SOUNDS).sort(), [...guns].sort());
  for(const id of guns) { assert.equal(gunSound(id),SHOT_SOUNDS[id]); assert.ok(all.has(gunSound(id))); }
  assert.equal(gunSound('m4a1',true),'weapons/m4a1-1.wav');
  assert.equal(gunSound('usp',true),'weapons/usp1.wav');
  for(const id of ['toString','constructor','__proto__','unknown',null]) assert.equal(gunSound(id),undefined);
});

test('flat explicit literal catalog is unique, frozen and within the same 512 budget', () => {
  assert.equal(SOUND_BUDGET,512); assert.ok(ALL_SOUNDS.length>250 && ALL_SOUNDS.length<=SOUND_BUDGET);
  assert.equal(all.size,ALL_SOUNDS.length); assert.ok(ALL_SOUNDS.every(safeSound));
  for(const value of [SHOT_SOUNDS,ACTION_SOUNDS,ALL_SOUNDS,SOUND_GROUPS]) assert.ok(Object.isFrozen(value));
  const text=readFileSync(root+'public/sound-catalog.js','utf8');
  const literalNames=new Set([...text.matchAll(/["']((?:weapons|player|items|radio|buttons|debris|ambience|common)\/[^"'\r\n]+\.wav)["']/g)].map(m=>m[1]));
  assert.deepEqual([...literalNames].sort(),[...all].sort());
  assert.deepEqual(new Set([...Object.values(SHOT_SOUNDS),...ACTION_SOUNDS]),all);
});

test('safeSound rejects traversal, nested paths, URL/control/encoding tricks', () => {
  for(const name of ['weapons/a.wav','player/pl_step1.wav','items/9mmclip1.wav','radio/ctwin.wav','buttons/spark5.wav','debris/wood1.wav','ambience/test.wav','common/wpn_select.wav']) assert.equal(safeSound(name),true,name);
  for(const name of [null,undefined,4,{},['weapons/a.wav'],'../weapons/a.wav','weapons/../a.wav','weapons/a/b.wav','weapons\\a.wav','/weapons/a.wav','https://example.com/a.wav','//evil/a.wav','weapons/%2e%2e.wav','weapons/a.wav?x=1','weapons/a.wav#x','weapons/a.wav\n','weapons/a.wav\r','weapons/a.wav\r\n','weapons/a.wav\0','weapons/.wav','weapons/a.WAV','hostage/hos1.wav','weapons/a..wav','weapons/é.wav']) assert.equal(safeSound(name),false,String(name));
});

test('every family is a frozen flat array of catalog names; every gun has variants/actions', () => {
  for(const [key,names] of Object.entries(SOUND_GROUPS)) {
    assert.ok(Object.isFrozen(names),key); assert.equal(new Set(names).size,names.length,key);
    for(const name of names) assert.ok(all.has(name),key+': '+name);
  }
  for(const id of guns) {
    assert.ok(SOUND_GROUPS['shot.'+id].includes(SHOT_SOUNDS[id]),id);
    assert.ok(Array.isArray(SOUND_GROUPS['action.'+id]),id);
  }
  assert.ok(SOUND_GROUPS['shot.m4a1'].includes('weapons/m4a1-1.wav'));
  assert.ok(SOUND_GROUPS['shot.usp'].includes('weapons/usp2.wav'));
  assert.ok(SOUND_GROUPS['shot.famas'].includes('weapons/famas-burst.wav'));
  assert.ok(SOUND_GROUPS['action.awp'].includes('weapons/boltup.wav'));
});

test('material footsteps and important missing event families are present', () => {
  for(const material of ['concrete','metal','dirt','vent','grate','tile','slosh','wade','ladder','snow']) assert.ok(SOUND_GROUPS['step.'+material].length>=4,material);
  assert.equal(SOUND_GROUPS['step.tile'].length,5); assert.equal(SOUND_GROUPS['step.snow'].length,4);
  for(const family of ['knife.deploy','knife.swing','knife.body','knife.stab','knife.wall','hit.flesh','hit.helmet','hit.kevlar','hit.head','ricochet.generic','ricochet.metal','ricochet.concrete','impact.wood','impact.glass','impact.metal','impact.concrete','landing.pain','player.pain','player.death','grenade.pin','grenade.bounce.he','grenade.bounce.other','grenade.he','grenade.flash','grenade.smoke','c4.click','c4.plant','c4.defuseStart','c4.defused','c4.beeps','c4.explosion','pickup.weapon','pickup.ammo','pickup.armor','nvg.on','nvg.off','round.start','round.ctWin','round.tWin','round.draw','radio.fireInHole']) assert.ok(SOUND_GROUPS[family].length,family);
  assert.equal(SOUND_GROUPS['c4.beeps'].length,5);
  assert.equal(SOUND_GROUPS['radio.menu1'].length,6); assert.equal(SOUND_GROUPS['radio.menu2'].length,6); assert.equal(SOUND_GROUPS['radio.menu3'].length,10);
  assert.ok(SOUND_GROUPS['radio.menu1'].includes('radio/fireassis.wav'));
  assert.ok(!ALL_SOUNDS.some(n=>/hostage|rescued|vip|lose\.wav/.test(n)));
});

test('all available imported original MDL5004 options are catalogued', () => {
  const dir=root+'public/assets/weapons/'; if(!existsSync(dir)) return;
  let count=0;
  for(const id of readdirSync(dir)) {
    const p=dir+id+'/model.json'; if(!existsSync(p))continue;
    for(const seq of JSON.parse(readFileSync(p)).sequences||[]) for(const e of seq.events||[]) if(e.event===5004) {count++;assert.ok(safeSound(e.options),id);assert.ok(all.has(e.options),id+': '+e.options);}
  }
  // Local assets optional on a clean checkout; no fabricated model fixture masquerades as evidence.
  if(count) assert.ok(count>=87);
});

test('Python extraction, PCM limits, fallback, source/cache preservation and budget guards', () => {
  const program=String.raw`
import importlib.util, pathlib, io, wave, json, struct, tempfile, argparse, hashlib, time
root=pathlib.Path.cwd()
spec=importlib.util.spec_from_file_location('prep',root/'tools/prepare-sounds.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
names,refs=p.collect_names();expected=json.loads('''${JSON.stringify([...all].sort())}''')
assert names==expected,(set(names)-set(expected),set(expected)-set(names))
assert p.BUDGET==512 and p.MAX_SECONDS==20 and p.MAX_BYTES==2097152
assert p.safe_sound('radio/ctwin.wav') and not p.safe_sound('radio/a.wav\n')
# PCM unit fixtures are generated in memory only; never installed as game assets.
def pcm(seconds=.02):
 b=io.BytesIO()
 with wave.open(b,'wb') as w:w.setparams((1,2,8000,0,'NONE','not compressed'));w.writeframes(b'\0\0'*int(seconds*8000))
 return b.getvalue()
def rejects(f,x):
 try:f(x)
 except (ValueError,wave.Error):return
 raise AssertionError('Expected rejection')
data=pcm();assert p.validate_wav(data)['frames']==160
for x in [b'<html>404</html>',data[:-2],data+b'extra',b'x'*(p.MAX_BYTES+1),pcm(20.01)]:rejects(p.validate_wav,x)
assert p.validate_wav(pcm(19.9))['durationSeconds']>15
# GoldSrc legacy PCM: missing odd-byte padding is accepted without rewriting bytes.
fmt=struct.pack('<HHIIHH',1,1,8000,8000,1,8)
body=b'WAVEfmt '+struct.pack('<I',16)+fmt+b'data'+struct.pack('<I',3)+b'\x80'*3
legacy=b'RIFF'+struct.pack('<I',len(body))+body
assert 'legacy-missing-final-odd-byte-padding' in p.validate_wav(legacy)['validationWarnings']
body+=b'LIST'+struct.pack('<I',4)+b'INFO'
legacy=b'RIFF'+struct.pack('<I',len(body))+body
assert 'legacy-missing-interchunk-odd-byte-padding' in p.validate_wav(legacy)['validationWarnings']
assert p.validate_materials(b'C CONCRETE\nM METAL1\n//comment\n')['entries']==2
for x in [b'<html>error</html>',b'C '+b'a'*100,b'Q unknown',b'\0']:rejects(p.validate_materials,x)
with tempfile.TemporaryDirectory(prefix='sound-unit-',dir=root/'artifacts') as d:
 base=pathlib.Path(d);p.OUT=base/'out';p.OUT.mkdir();source=base/'source';(source/'weapons').mkdir(parents=True)
 name='weapons/test.wav';(source/name).write_bytes(data)
 args=argparse.Namespace(source=source,fetch=False,mirrors=[],timeout=1)
 _,entry=p.prepare_one(name,args,{},time.monotonic()+5);assert entry['source']=='local-wav' and entry['acquiredBy']=='local-source'
 target=p.OUT/name;before=target.read_bytes();_,cached=p.prepare_one(name,args,{name:entry},time.monotonic()+5)
 assert cached['cacheIntegrity']=='sha256-match' and target.read_bytes()==before
 target.write_bytes(pcm(.03));changed=target.read_bytes()
 _,bad=p.prepare_one(name,args,{name:entry},time.monotonic()+5);assert bad['source']=='unavailable' and bad['sha256']==entry['sha256'] and target.read_bytes()==changed
 _,bad_again=p.prepare_one(name,args,{name:bad},time.monotonic()+5);assert bad_again['source']=='unavailable'
 # Invalid mirror response must fall through; never write it to disk.
 calls=[]
 def mocked_get(url,*unused):
  calls.append(url);return (b'<html>missing</html>' if len(calls)==1 else data),url
 p.get_bytes=mocked_get;args.source=None;args.fetch=True;args.mirrors=['https://bad/sound/','https://good/sound/']
 _,got=p.prepare_one('radio/test.wav',args,{},time.monotonic()+5)
 assert got['source']=='local-wav' and len(calls)==2 and len(got['attempts'])==2 and got['url'].startswith('https://good/')
 # Symlink and invalid model/cap protection.
 (p.OUT/'items').symlink_to(source/'weapons',target_is_directory=True)
 rejects(lambda _:p.checked_target(p.OUT,'items/test.wav'),None)
 fixture=base/'fixture';(fixture/'public/assets/weapons/a').mkdir(parents=True)
 catalog=fixture/'public/sound-catalog.js';catalog.write_text("const x=['weapons/ok.wav'];")
 model=fixture/'public/assets/weapons/a/model.json';model.write_text(json.dumps({'sequences':[{'events':[{'event':5004,'options':'../bad.wav'}]}]}))
 rejects(p.collect_names,fixture)
 model.write_text('{}');catalog.write_text(';'.join("'weapons/x%d.wav'"%i for i in range(513)));rejects(p.collect_names,fixture)
 catalog.write_text("'weapons/../bad.wav'");rejects(p.collect_names,fixture)
print(json.dumps({'catalog':len(names),'mdl5004Unique':len(refs),'wavAndIntegrityGuards':'passed'}))
`;
  const result=spawnSync('python3',['-'],{input:program,cwd:root,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr+'\n'+result.stdout); assert.match(result.stdout,/"wavAndIntegrityGuards": "passed"/);
});

test('prepared local WAV receipt integrity, if assets are present', () => {
  const manifest=root+'public/assets/sounds/manifest.json';if(!existsSync(manifest))return;
  const program=String.raw`
import importlib.util,json,pathlib,hashlib
r=pathlib.Path.cwd();s=importlib.util.spec_from_file_location('p',r/'tools/prepare-sounds.py');p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
m=json.loads((p.OUT/'manifest.json').read_text());ready=0
for n in m['summary']['readyNames']:
 e=m['assets'][n];d=(p.OUT/n).read_bytes();assert hashlib.sha256(d).hexdigest()==e['sha256'];assert len(d)==e['bytes'];p.validate_wav(d);assert e['retailHashVerified'] is False;ready+=1
assert ready==m['summary']['ready'];assert len(m['summary']['missingNames'])==m['summary']['missing'];assert ready+m['summary']['missing']==m['summary']['requested']
print('Verified',ready,'real local WAVs')
`;
  const result=spawnSync('python3',['-'],{input:program,cwd:root,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
});
