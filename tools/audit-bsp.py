"""Bounds-checked BSP30/WAD3 inventory; does not execute downloaded data."""
from pathlib import Path
from collections import Counter
import hashlib
import json
import re
import struct

ROOT = Path(__file__).resolve().parent
LUMP_NAMES = ['entities','planes','textures','vertices','visibility','nodes','texinfo','faces',
              'lighting','clipnodes','leaves','marksurfaces','edges','surfedges','models']
SIZES = {'planes':20,'vertices':12,'nodes':24,'texinfo':40,'faces':20,'clipnodes':8,
         'leaves':28,'marksurfaces':2,'edges':4,'surfedges':4,'models':64}

def bsp(path):
    data = path.read_bytes()
    assert len(data) >= 124 and struct.unpack_from('<i', data)[0] == 30
    lumps, counts = {}, {}
    for index, name in enumerate(LUMP_NAMES):
        offset, length = struct.unpack_from('<ii', data, 4 + index * 8)
        assert 0 <= offset <= len(data) and 0 <= length <= len(data) - offset, name
        lumps[name] = data[offset:offset+length]
        if name in SIZES:
            assert length % SIZES[name] == 0, name
            counts[name] = length // SIZES[name]
    vertices = list(struct.iter_unpack('<fff', lumps['vertices']))
    entities = [dict(re.findall(r'"([^"\n]*)"\s*"([^"\n]*)"', block))
                for block in re.findall(r'\{([^{}]*)\}', lumps['entities'].decode('latin1'))]
    tex = lumps['textures']
    n = struct.unpack_from('<i', tex)[0]
    assert 0 <= n <= (len(tex)-4)//4
    textures = []
    for offset, in struct.iter_unpack('<i', tex[4:4+4*n]):
        if offset == -1:
            textures.append({'missingHeader': True})
            continue
        assert 0 <= offset <= len(tex)-40
        name, width, height, m0,m1,m2,m3 = struct.unpack_from('<16s6I', tex, offset)
        name = name.split(b'\0')[0].decode('latin1')
        assert width > 0 and height > 0
        textures.append({'name':name,'width':width,'height':height,'embedded':bool(m0)})
    return data, lumps, counts, entities, textures, vertices

def wad(path):
    data = path.read_bytes()
    assert data[:4] == b'WAD3'
    count, directory = struct.unpack_from('<ii', data, 4)
    assert count >= 0 and 0 <= directory <= len(data)-count*32
    result = {}
    for index in range(count):
        offset, length, size, kind, compression, name = struct.unpack_from('<iiiBB2x16s', data, directory+index*32)
        assert 0 <= offset <= len(data) and 0 <= length <= len(data)-offset
        name = name.split(b'\0')[0].decode('latin1')
        if kind == 67 and not compression and length >= 40:
            width, height = struct.unpack_from('<II', data, offset+16)
            result[name.lower()] = {'file':path.name,'name':name,'width':width,'height':height,
                                   'sha256':hashlib.sha256(data[offset:offset+length]).hexdigest()}
    return result

if __name__ == '__main__':
    path = ROOT / 'de_dust2-csboost.bsp'
    data, lumps, counts, entities, textures, vertices = bsp(path)
    external = [t for t in textures if t.get('name') and not t['embedded']]
    wads = {p.name:wad(p) for p in sorted(ROOT.glob('*.wad'))}
    coverage, missing = [], []
    for texture in external:
        matches = [inventory[texture['name'].lower()] for inventory in wads.values()
                   if texture['name'].lower() in inventory]
        matches = [m for m in matches if (m['width'],m['height']) == (texture['width'],texture['height'])]
        coverage.append({'texture':texture,'matches':matches})
        if not matches:
            missing.append(texture['name'])
    classes = dict(Counter(e.get('classname','') for e in entities))
    second = ROOT/'de_dust2-ds.bsp'
    report = {'file':path.name,'format':'GoldSrc BSP30','bytes':len(data),
              'sha256':hashlib.sha256(data).hexdigest(),
              'independentMirrorByteIdentical':second.exists() and second.read_bytes() == data,
              'officialValveChecksumVerified':False,'lumpsValidated':len(lumps),'counts':counts,
              'entityCounts':classes,'entities':entities,'texturesTotal':len(textures),
              'texturesEmbedded':sum(t.get('embedded',False) for t in textures),
              'texturesExternal':len(external),'externalTextureCoverage':coverage,
              'missingTextures':missing,
              'boundsGoldSrcUnits':{'min':[min(v[i]for v in vertices)for i in range(3)],
                                    'max':[max(v[i]for v in vertices)for i in range(3)]},
              'acceptance':'Source inventory only, not browser gameplay import or 1:1 completion.'}
    (ROOT/'bsp-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({k:v for k,v in report.items() if k not in ['entities','externalTextureCoverage']},ensure_ascii=False,indent=2))
