"""Convert locally acquired BSP30/WAD3 data without resizing or remodeling.
GoldSrc -> browser: (X,Y,Z) -> (X,Z,-Y)/40. Original coordinates retained for audit.
Assets are for private local validation; no redistribution license is assumed.
"""
from pathlib import Path
from collections import defaultdict
import argparse
import hashlib
import json
import math
import re
import struct
import zlib

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--source',type=Path,default=ROOT.parent/'lan-strike-original-map-2026-10-27')
args=parser.parse_args()
source=args.source
out=ROOT/'public/assets/dust2'
out.mkdir(parents=True,exist_ok=True)
art=ROOT/'artifacts';art.mkdir(exist_ok=True)
data=(source/'de_dust2-csboost.bsp').read_bytes()
assert struct.unpack_from('<i',data)[0]==30
names=['entities','planes','textures','vertices','visibility','nodes','texinfo','faces','lighting','clipnodes','leaves','marksurfaces','edges','surfedges','models']
lumps={}
for i,name in enumerate(names):
    off,n=struct.unpack_from('<ii',data,4+8*i)
    assert 0<=off<=len(data)-n and n>=0
    lumps[name]=data[off:off+n]
read=lambda name,fmt:list(struct.iter_unpack(fmt,lumps[name]))
entities=[dict(re.findall(r'"([^"\n]*)"\s*"([^"\n]*)"',b))for b in re.findall(r'\{([^{}]*)\}',lumps['entities'].decode('latin1'))]
planes=read('planes','<4fi');vertices=read('vertices','<3f');edges=read('edges','<2H')
surfedges=[v[0]for v in read('surfedges','<i')];texinfo=read('texinfo','<8fii')
faces=read('faces','<Hhihh4Bi');models=read('models','<9f7i')
clipnodes=read('clipnodes','<ihh');nodes=read('nodes','<i2h6h2H');leaves=read('leaves','<ii6h2H4B')
vec=lambda v:[v[0]/40,v[2]/40,-v[1]/40]

def png(path,w,h,rgba):
    assert len(rgba)==w*h*4
    def chunk(kind,payload):
        return struct.pack('>I',len(payload))+kind+payload+struct.pack('>I',zlib.crc32(kind+payload)&0xffffffff)
    rows=b''.join(b'\0'+rgba[y*w*4:(y+1)*w*4]for y in range(h))
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>2I5B',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b''))

wad={}
for p in sorted(source.glob('*.wad')):
    raw=p.read_bytes();assert raw[:4]==b'WAD3'
    count,directory=struct.unpack_from('<2i',raw,4)
    assert 0<=directory<=len(raw)-32*count
    for i in range(count):
        off,n,size,kind,compression,name=struct.unpack_from('<iiiBB2x16s',raw,directory+32*i)
        assert 0<=off<=len(raw)-n
        if kind==67 and not compression:
            wad.setdefault(name.split(b'\0')[0].decode('latin1').lower(),raw[off:off+n])
tex=lumps['textures'];count=struct.unpack_from('<i',tex)[0]
offsets=struct.unpack_from('<'+str(count)+'i',tex,4)
textures=[]
for i,off in enumerate(offsets):
    assert off>=0
    name,w,h,*mips=struct.unpack_from('<16s6I',tex,off)
    name=name.split(b'\0')[0].decode('latin1')
    raw=tex[off:] if mips[0] else wad[name.lower()]
    _,rw,rh,*mips=struct.unpack_from('<16s6I',raw)
    assert (rw,rh)==(w,h)
    palette_start=mips[3]+(w//8)*(h//8)
    palette_count=struct.unpack_from('<H',raw,palette_start)[0]
    assert palette_count<=256 and palette_start+2+3*palette_count<=len(raw)
    palette=raw[palette_start+2:palette_start+2+3*palette_count]
    pixels=raw[mips[0]:mips[0]+w*h];assert len(pixels)==w*h
    rgba=bytearray()
    for index in pixels:
        assert index<palette_count
        rgba.extend(palette[index*3:index*3+3])
        rgba.append(0 if name.startswith('{') and index==255 else 255)
    filename=f'texture-{i:02}.png';png(out/filename,w,h,rgba)
    textures.append({'name':name,'width':w,'height':h,'image':filename,'masked':name.startswith('{')})

entity_models={int(e['model'][1:]):e for e in entities if e.get('model','').startswith('*')}
model_data=[]
for i,m in enumerate(models):
    corner=[vec(m[:3]),vec(m[3:6])]
    model_data.append({'index':i,'mins':[min(c[j]for c in corner)for j in range(3)],
                       'maxs':[max(c[j]for c in corner)for j in range(3)],
                       'origin':vec(m[6:9]),'heads':list(m[9:13]),'firstFace':m[-2],'numFaces':m[-1],
                       'entity':entity_models.get(i,{'classname':'worldspawn'})})
face_models={f:i for i,m in enumerate(models)for f in range(m[-2],m[-2]+m[-1])}
# Pack exact per-face lightmap samples into an atlas; retain source styles in provenance.
ATLAS=2048;atlas=bytearray([255])*(ATLAS*ATLAS*4)
ax,ay,row_h=1,1,0
polygons=[];excluded=defaultdict(int);lightmapped=0
for index,f in enumerate(faces):
    plane,side,first,n,ti,*rest=f;style=rest[:4];light=rest[4]
    model_index=face_models[index];kind=model_data[model_index]['entity']['classname']
    t=texinfo[ti];texture=textures[t[8]];name=texture['name'].lower()
    if kind in ['func_bomb_target','func_buyzone'] or name in ['aaatrigger','clip','origin','null','hint','skip','sky']:
        excluded[kind+':'+name]+=1;continue
    ids=[]
    for se in surfedges[first:first+n]:
        edge=edges[abs(se)];ids.append(edge[0] if se>=0 else edge[1])
    poly=[vertices[i]for i in ids]
    normal=[p*(-1 if side else 1)for p in planes[plane][:3]]
    # BSP splits often create collinear first vertices. Use the entire polygon's
    # Newell normal, not only its first triangle, to determine front-face winding.
    cross=[0.,0.,0.]
    for a,b in zip(poly,poly[1:]+poly[:1]):
        cross[0]+=(a[1]-b[1])*(a[2]+b[2])
        cross[1]+=(a[2]-b[2])*(a[0]+b[0])
        cross[2]+=(a[0]-b[0])*(a[1]+b[1])
    assert sum(cross[j]*cross[j]for j in range(3))>1e-10,index
    if sum(cross[j]*normal[j]for j in range(3))<0:poly.reverse()
    st=[(sum(v[j]*t[j]for j in range(3))+t[3],sum(v[j]*t[j+4]for j in range(3))+t[7])for v in poly]
    s0=math.floor(min(p[0]for p in st)/16);t0=math.floor(min(p[1]for p in st)/16)
    lw=math.ceil(max(p[0]for p in st)/16)-s0+1;lh=math.ceil(max(p[1]for p in st)/16)-t0+1
    rect=None
    if light>=0 and not(t[9]&1):
        assert lw+2<ATLAS and lh+2<ATLAS
        if ax+lw+1>=ATLAS:ax=1;ay+=row_h+2;row_h=0
        assert ay+lh+1<ATLAS,'Lightmap atlas overflow'
        assert light+lw*lh*3<=len(lumps['lighting'])
        samples=lumps['lighting'][light:light+lw*lh*3]
        # Replicate the one-pixel border to prevent atlas filtering seams.
        for yy in range(-1,lh+1):
            for xx in range(-1,lw+1):
                src=(min(lh-1,max(0,yy))*lw+min(lw-1,max(0,xx)))*3
                dst=((ay+yy)*ATLAS+ax+xx)*4
                atlas[dst:dst+4]=samples[src:src+3]+b'\xff'
        rect=[ax,ay,lw,lh];ax+=lw+2;row_h=max(row_h,lh);lightmapped+=1
    polygons.append({'sourceFace':index,'model':model_index,'texture':t[8],
                     'vertices':[vec(v)for v in poly],
                     'uv':[[s/texture['width'],1-tt/texture['height']]for s,tt in st],
                     'lightUv':[[(rect[0]+s/16-s0+.5)/ATLAS,1-(rect[1]+tt/16-t0+.5)/ATLAS]if rect else [.5/ATLAS,1-.5/ATLAS]for s,tt in st],
                     'normal':[normal[0],normal[2],-normal[1]],'lightStyles':style})
png(out/'lightmap.png',ATLAS,ATLAS,atlas)
spawns={'T':[],'CT':[]}
for i,e in enumerate(entities):
    if e['classname'] in ['info_player_start','info_player_deathmatch']:
        team='CT'if e['classname']=='info_player_start'else'T'
        origin=[float(x)for x in e['origin'].split()];v=vec(origin)
        angles=[float(x)for x in e.get('angles','0 0 0').split()]
        spawns[team].append({'x':v[0],'y':v[1]-.9,'z':v[2],'yaw':math.radians(angles[1]-90),'sourceEntity':i,'sourceOrigin':origin})
sites=[]
for i,e in enumerate(entities):
    if e['classname']=='func_bomb_target':
        idx=int(e['model'][1:]);m=model_data[idx];a,b=m['mins'],m['maxs']
        sites.append({'name':'A'if e.get('target')=='tgt_a'else'B','model':idx,
                      'x':(a[0]+b[0])/2,'y':a[1],'z':(a[2]+b[2])/2,'r':max(b[0]-a[0],b[2]-a[2])/2,
                      'mins':a,'maxs':b,'sourceEntity':i})
sites.sort(key=lambda s:s['name'])
map_data={'version':'de_dust2-bsp30-0.3','sourceSHA256':hashlib.sha256(data).hexdigest(),
          'unitsPerWorldUnit':40,'axisMapping':'(X,Z,-Y)/40',
          'planes':[[p[0],p[2],-p[1],p[3]/40]for p in planes],
          'clipnodes':[list(n)for n in clipnodes],
          'nodes':[[n[0],*(child if child>=0 else leaves[-child-1][0]for child in n[1:3])]for n in nodes],
          'models':model_data,'spawns':spawns,'sites':sites,
          'bounds':{'min':[min(vec(v)[j]for v in vertices)for j in range(3)],'max':[max(vec(v)[j]for v in vertices)for j in range(3)]}}
(ROOT/'public/map-data.js').write_text('// Generated from BSP; preserve geometry. Private local resource.\nexport const MAP_DATA='+json.dumps(map_data,separators=(',',':'))+';\n')
render={'textures':textures,'polygons':polygons,'lightmap':'lightmap.png','lightmapSize':ATLAS,'sourceSHA256':map_data['sourceSHA256']}
(out/'render.json').write_text(json.dumps(render,separators=(',',':')))
# GoldSrc overview geometry is only for the minimap; it does not replace collision hulls.
report={'sourceSHA256':map_data['sourceSHA256'],'sourceVertices':len(vertices),'sourceFaces':len(faces),
        'renderedFaces':len(polygons),'renderedTriangles':sum(len(p['vertices'])-2 for p in polygons),
        'excludedFaces':dict(excluded),'textures':len(textures),'lightmappedFaces':lightmapped,
        'originalModels':len(models),'collisionModels':[m['index']for m in model_data if m['index']==0 or m['entity']['classname']=='func_breakable'],
        'spawns':{k:len(v)for k,v in spawns.items()},'sites':sites,
        'coordinateConversion':map_data['axisMapping'],'geometryRemodeling':False,
        'skyFacesAvailable':sum((out/f'sky-{face}.png').exists()for face in ['rt','lf','up','dn','ft','bk']),
        'limitations':['Static light style 0; original gamma not pixel-matched','Bomb-explosion breakable models remain static','Original engine movement not ported','Official Valve checksum not independently verified']}
(art/'map-import.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
