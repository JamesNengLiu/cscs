import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {decodeTexturedMap} from '../public/cs2-textured-format.js';
import {identifyLightmapCoordinate,textureCoordinateName} from '../tools/cs2-material-coordinates.mjs';

test('forced second texture UV stays separate from the third lightmap channel; wind colors never imply lighting',()=>{
 const scale=1.14283965,attribute=(values)=>({count:values.length/2,width:2,get:(i,k)=>values[i*2+k]});
 const original={TEXCOORD_0:attribute([.1,.2,.3,.4]),TEXCOORD_1:attribute([.2,.9,.4,.6]),TEXCOORD_2:attribute([.1,.6,.5,.8])};
 const current={...original,TEXCOORD_2:attribute([.1,.6,.5,.8].map(x=>Math.fround(x*scale)))};
 assert.equal(textureCoordinateName({F_FORCE_UV2:1}),'TEXCOORD_1');assert.equal(identifyLightmapCoordinate(current,original),'TEXCOORD_2');assert.equal(identifyLightmapCoordinate({...original,COLOR_0:attribute([1,0,1,1])},original),null);
 assert.throws(()=>identifyLightmapCoordinate({...current,TEXCOORD_1:attribute([.2,.9,.4,.6].map(x=>x*scale))},original),/Ambiguous/);
});

function fixture(){
 const arrays={position:new Float32Array([0,0,0,1,0,0,0,1,0]),normal:new Int16Array(9),tangent:new Int16Array(12),uv:new Float32Array([0,0,1,0,0,1]),uv1:new Float32Array([.1,.1,.2,.1,.1,.2]),blend:new Uint8Array(12),color:new Uint8Array(9).fill(255),baked:new Uint16Array(9),index:new Uint32Array([0,1,2])};
 let bytes=0;const chunk={material:0,mode:'lightmap'};for(const [key,a]of Object.entries(arrays)){bytes=Math.ceil(bytes/4)*4;chunk[key]={offset:bytes,length:a.length};bytes+=a.byteLength;}
 const buffer=new ArrayBuffer(bytes);for(const [key,a]of Object.entries(arrays))new Uint8Array(buffer,chunk[key].offset,a.byteLength).set(new Uint8Array(a.buffer));
 return{buffer,manifest:{format:'cs2-map-textured-v1',materials:[{}],geometry:{bytes,vertices:3,triangles:1,chunks:[chunk]}}};
}
test('textured geometry keeps authored UV/lightmap attributes as zero-copy views',async()=>{
 const {manifest,buffer}=fixture(),[d]=await decodeTexturedMap(manifest,buffer);assert.equal(d.uv1.buffer,buffer);assert.equal(d.tangent.buffer,buffer);assert.deepEqual([...d.uv],[0,0,1,0,0,1]);assert.equal(d.index[2],2);
});
test('textured geometry rejects incompatible materials, corrupt UVs and overlapping buffers',async()=>{
 for(const mutate of [(m,b)=>m.geometry.chunks[0].material=9,(m,b)=>m.geometry.chunks[0].uv.offset=m.geometry.chunks[0].position.offset,(m,b)=>new Float32Array(b,m.geometry.chunks[0].uv1.offset,6)[0]=NaN,(m,b)=>m.geometry.chunks[0].mode='guess']){
  const {manifest,buffer}=fixture();mutate(manifest,buffer);await assert.rejects(()=>decodeTexturedMap(manifest,buffer),/贴图地图包无效/);
 }
});
function python(source){const r=spawnSync('python3',['-c',`import importlib.util,struct,zlib,tempfile\nfrom pathlib import Path\ndef load(name,file):\n s=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m\nt=load('textures','tools/prepare-cs2-textured.py')\nc=load('chunks','tools/cs2-depot-chunks.py')\n${source}`],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
test('native VTEX packing preserves mip order and exact BC bytes for 2D and cube textures',()=>python(`
for faces in [1,6]:
 header=bytearray(28);struct.pack_into('<IHHII',header,0,68,12,1,8,1);struct.pack_into('<4sII',header,16,b'DATA',8,40)
 data=bytearray(40);struct.pack_into('<HH',data,0,1,16 if faces==6 else 0);struct.pack_into('<HHHBB',data,20,8,8,1,1,2)
 small=b's'*(8*faces);large=b'L'*(32*faces)
 meta,mips=t.texture_mips(bytes(header+data)+small+large,8)
 assert meta['faces']==faces and len(mips)==2
 assert mips[0]['data']==large and mips[1]['data']==small
 _,bounded=t.texture_mips(bytes(header+data)+small+large,4)
 assert len(bounded)==1 and bounded[0]['data']==small
 try:t.texture_mips(bytes(header+data)+small+large[:-1],8);assert False
 except ValueError:pass
`));
test('compact resource VPK round-trips CRC and bytes through the independent VPK parser',()=>python(`
v=load('vpk','tools/inspect-cs2-assets.py')
with tempfile.TemporaryDirectory() as directory:
 path=Path(directory)/'pak01_dir.vpk';resources={'materials/a.vmat_c':b'authored-material','materials/nested/b.vtex_c':b'authored-native-blocks'}
 path.write_bytes(t.vpk_bytes(resources));report=v.inspect_vpk(path,True)
 assert report['indexComplete'] and report['entries']==2
 for entry in report['resources']:assert v.read_entry(path,entry)==resources[entry['path']]
`));
test('subset download plan retains exact covering chunks and refuses gaps or unsafe paths',()=>python(`
def record(name):
 mapping=c.field(1,name.encode())+c.field(2,12,0)+c.field(5,b'f'*20)
 for offset in [0,4,8]:
  chunk=c.field(1,bytes([offset])*20)
  chunk+=c.field(3,offset,0)+c.field(4,4,0)+c.field(5,3,0)
  mapping+=c.field(6,chunk)
 return c.field(1,mapping)
metadata=c.field(1,2347770,0)+c.field(2,12345,0)+c.field(4,0,0)+c.field(5,12,0)+c.field(6,9,0)+c.field(7,3,0)+c.field(9,0,0)
def manifest(name):
 return b''.join(struct.pack('<II',magic,len(block))+block for magic,block in [(0x71F617D0,record(name)),(0x1F4812BE,metadata),(0x1B81B817,b'')])+struct.pack('<I',0x32C415AB)
subset,meta,audit=c.subset_manifest(manifest('game/pak01_001.vpk'),{'game/pak01_001.vpk':[(4,8)]})
assert len(audit)==1 and [x['offset'] for x in audit[0]['chunks']]==[4]
assert audit[0]['chunks'][0]['sha1']=='04'*20
assert c.read_manifest(subset)[1][2]==12345
try:c.read_manifest(subset[:-4]);assert False
except ValueError:pass
for name,ranges in [('game/pak01_001.vpk',[(10,13)]),('../escape',[(0,4)])]:
 try:c.subset_manifest(manifest(name),{name:ranges});assert False
 except ValueError:pass
try:c.fields(b'\\x0a\\x08short');assert False
except ValueError:pass
`));
