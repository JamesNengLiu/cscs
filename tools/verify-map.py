"""Compare every imported visible face, UV, hull and spawn to raw source BSP."""
from pathlib import Path
import hashlib,json,math,runpy,struct
ROOT=Path(__file__).resolve().parents[1]
source=ROOT.parent/'lan-strike-original-map-2026-10-27'
helpers=runpy.run_path(str(ROOT/'tools/audit-bsp.py'))
raw,lumps,counts,entities,textures,vertices=helpers['bsp'](source/'de_dust2-csboost.bsp')
render=json.loads((ROOT/'public/assets/dust2/render.json').read_text())
module=(ROOT/'public/map-data.js').read_text();data=json.loads(module.split('export const MAP_DATA=',1)[1].removesuffix(';\n'))
faces=list(struct.iter_unpack('<Hhihh4Bi',lumps['faces']))
edges=list(struct.iter_unpack('<HH',lumps['edges']))
surfedges=[e[0]for e in struct.iter_unpack('<i',lumps['surfedges'])]
texinfos=list(struct.iter_unpack('<8fii',lumps['texinfo']))
planes=list(struct.iter_unpack('<4fi',lumps['planes']))
source_hash=hashlib.sha256(raw).hexdigest()
assert data['sourceSHA256']==render['sourceSHA256']==source_hash
assert data['clipnodes']==[list(v)for v in struct.iter_unpack('<ihh',lumps['clipnodes'])]
assert data['planes']==[[v[0],v[2],-v[1],v[3]/40]for v in planes]
roundtrip_error=0.;gpu_error=0.;uv_error=0.;lightmap_samples=0
seen=set()
for poly in render['polygons']:
    idx=poly['sourceFace'];assert idx not in seen;seen.add(idx)
    face=faces[idx];plane,side,first,n,ti,*tail=face
    ids=[edges[abs(se)][0 if se>=0 else 1]for se in surfedges[first:first+n]]
    expected=[vertices[i]for i in ids]
    decoded=[(v[0]*40,-v[2]*40,v[1]*40)for v in poly['vertices']]
    assert len(decoded)==len(expected)
    for a,b in zip(sorted(decoded),sorted(expected)):
        roundtrip_error=max(roundtrip_error,max(abs(x-y)for x,y in zip(a,b)))
    assert roundtrip_error<1e-5
    t=texinfos[ti];texture=textures[t[8]];assert poly['texture']==t[8]
    for v,original,uv in zip(poly['vertices'],decoded,poly['uv']):
        s=sum(original[j]*t[j]for j in range(3))+t[3]
        tt=sum(original[j]*t[j+4]for j in range(3))+t[7]
        uv_error=max(uv_error,abs(uv[0]-s/texture['width']),abs(uv[1]-(1-tt/texture['height'])))
        for value in v:gpu_error=max(gpu_error,abs(value-struct.unpack('<f',struct.pack('<f',value))[0])*40)
    assert uv_error<1e-7
    normal=[p*(-1 if side else 1)for p in planes[plane][:3]]
    assert poly['normal']==[normal[0],normal[2],-normal[1]]
    vs=poly['vertices'];area=[0.,0.,0.]
    for a,b in zip(vs,vs[1:]+vs[:1]):
        area[0]+=(a[1]-b[1])*(a[2]+b[2]);area[1]+=(a[2]-b[2])*(a[0]+b[0]);area[2]+=(a[0]-b[0])*(a[1]+b[1])
    assert sum(area[i]*poly['normal'][i]for i in range(3))>0,idx
    if tail[-1]>=0:lightmap_samples+=1
models=list(struct.iter_unpack('<9f7i',lumps['models']))
assert len(data['models'])==len(models)
for m,original in zip(data['models'],models):
    assert m['heads']==list(original[9:13])
    assert m['origin']==[0.,0.,0.],'Nonzero brush origins need explicit transforms'
for team,points in data['spawns'].items():
    for p in points:
        e=entities[p['sourceEntity']];origin=[float(v)for v in e['origin'].split()]
        assert p['sourceOrigin']==origin
        assert (p['x'],p['y'],p['z'])==(origin[0]/40,origin[2]/40-.9,-origin[1]/40)
for site in data['sites']:assert entities[site['sourceEntity']]['classname']=='func_bomb_target'
report=json.loads((ROOT/'artifacts/map-import.json').read_text())
assert len(seen)+sum(report['excludedFaces'].values())==len(faces)
assert gpu_error<.001
result={'status':'passed','sourceSHA256':source_hash,'visibleFacesVerified':len(seen),
        'allSourceFacesAccountedFor':len(faces),'maxCoordinateRoundtripErrorGoldSrcUnits':roundtrip_error,
        'maxGPUFloat32CoordinateErrorGoldSrcUnits':gpu_error,'maxUVError':uv_error,
        'allPolygonWindingsCorrect':True,'originalCollisionPlanesVerified':len(planes),
        'originalClipnodesVerified':len(data['clipnodes']),'originalBrushHeadsVerified':len(models),
        'spawnEntitiesVerified':sum(map(len,data['spawns'].values())),'bombTriggerModelsVerified':len(data['sites']),
        'lightmappedVisibleFaces':lightmap_samples,
        'notVerified':['Pixel-identical legacy renderer gamma/light styles','Original gameplay/weapon engine behavior','Physical dual-computer network play']}
(ROOT/'artifacts/geometry-verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
