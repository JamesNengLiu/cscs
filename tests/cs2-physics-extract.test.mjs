import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

// Synthetic geometry only: no Valve assets, converter, browser or network.
const preamble=String.raw`
import copy, importlib.util, math, struct
spec=importlib.util.spec_from_file_location('physics_extract','tools/prepare-cs2-physics.py')
p=importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
HEADER='--- Data for block "PHYS" ---'+chr(10)+'<!-- kv3 test -->'+chr(10)
def expect_bad(call, message=None):
    try:
        call()
    except ValueError as error:
        if message is not None:
            assert message in str(error), str(error)
        return
    raise AssertionError('Malformed synthetic physics input was accepted')
def fixture():
    vertices=[(0,0,0),(1,0,0),(1,1,0),(0,1,0),(0,0,1),(1,0,1),(1,1,1),(0,1,1)]
    faces=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]
    records=[]
    directed={}
    for face_id,face in enumerate(faces):
        start=len(records)
        for offset,origin in enumerate(face):
            directed[(origin,face[(offset+1)%len(face)])]=len(records)
            records.append([start+(offset+1)%len(face),0,origin,face_id])
    for (origin,destination),index in directed.items():
        records[index][1]=directed[(destination,origin)]
    planes=[(0,0,-1,0),(0,0,1,1),(0,-1,0,0),(1,0,0,1),(0,1,0,1),(-1,0,0,0)]
    hull={'m_VertexPositions':b''.join(struct.pack('<fff',*v) for v in vertices),
          'm_Edges':b''.join(struct.pack('<BBBB',*edge) for edge in records),
          'm_Faces':bytes([0,4,8,12,16,20]),
          'm_Planes':b''.join(struct.pack('<ffff',*plane) for plane in planes),'m_nFlags':7}
    descriptor={'m_nCollisionAttributeIndex':0,'m_nSurfacePropertyIndex':0,'m_Hull':hull}
    mesh={'m_nCollisionAttributeIndex':0,'m_nSurfacePropertyIndex':0,
          'm_Mesh':{'m_Vertices':struct.pack('<9f',0,0,0,1,0,0,0,1,0),
                    'm_Triangles':struct.pack('<III',0,1,2),'m_Materials':[],'m_nFlags':0}}
    aggregate={'m_bindPose':[],'m_boneNames':[],'m_surfacePropertyHashes':[436732118],
               'm_collisionAttributes':[{'m_CollisionGroupString':'Default',
                                        'm_InteractAsStrings':[],'m_InteractExcludeStrings':[]}],
               'm_parts':[{'m_nFlags':2,'m_rnShape':{
                   'm_hulls':[descriptor],'m_meshes':[],'m_spheres':[],'m_capsules':[]}}]}
    return aggregate,descriptor,mesh
`;
function python(source){
 const result=spawnSync('python3',['-c',preamble+String.fromCharCode(10)+source],{encoding:'utf8',maxBuffer:1024*1024});
 assert.equal(result.status,0,[result.stderr,result.stdout].filter(Boolean).join(String.fromCharCode(10)));
}

test('PHYS StringToken agrees with fixed public tokens and only folds ASCII case',()=>python(String.raw`
assert p.string_token('')==0
assert p.string_token('default')==1977497166
assert p.string_token('DEFAULT')==1977497166
assert p.string_token('wood')==3076510970
assert p.string_token('Wood')==3076510970
assert p.string_token('concrete')==436732118
assert p.string_token('CoNcReTe')==436732118
assert p.string_token('Ä')!=p.string_token('ä')
`));

test('six compiled collision-tag classes have explicit separate query channels',()=>python(String.raw`
cases=[
    ({'m_InteractAsStrings':[]},['player','bullet','grenade','audio']),
    ({'m_InteractAsStrings':['passbullets']},['player','grenade']),
    ({'m_InteractAsStrings':['npcclip','playerclip']},['player']),
    ({'m_InteractAsStrings':[],'m_InteractExcludeStrings':['player']},['bullet','grenade','audio']),
    ({'m_InteractAsStrings':['csgo_grenadeclip']},['grenade']),
    ({'m_InteractAsStrings':['sky']},[]),
]
for attributes,expected in cases:
    before=copy.deepcopy(attributes)
    assert p.channels_for(attributes)==expected
    assert attributes==before
expect_bad(lambda:p.channels_for({'m_InteractAsStrings':'playerclip'}),'interaction tags')
expect_bad(lambda:p.channels_for({'m_InteractAsStrings':[123]}),'interaction tags')
expect_bad(lambda:p.channels_for({'m_InteractExcludeStrings':['x']*257}),'interaction tags')
`));

test('unknown physical tags and tokens never become guessed solids or concrete',()=>python(String.raw`
aggregate,descriptor,_=fixture()
aggregate['m_surfacePropertyHashes']=[0x1234ABCD]
aggregate['m_collisionAttributes'][0]['m_InteractAsStrings']=['unrecognized_future_tag']
aggregate['m_collisionAttributes'][0]['m_InteractExcludeStrings']=['future_exclusion']
shapes,materials,_=p.extract_shapes(aggregate,'synthetic_physics',{})
assert shapes[0]['channels']==[]
assert shapes[0]['source']['interactAs']==['unrecognized_future_tag']
assert shapes[0]['source']['interactExclude']==['future_exclusion']
assert shapes[0]['material'] is None and shapes[0]['materialHash']=='1234abcd'
assert materials==[{'hash':'1234abcd','name':None,'source':'original-phys-token-unresolved'}]
`));

test('synthetic hull retains vertices, faces, edges and plane orientation in metres',()=>python(String.raw`
aggregate,_,_=fixture()
shapes,materials,stats=p.extract_shapes(aggregate,'synthetic_cube',{436732118:'concrete'})
assert len(shapes)==1 and stats['hulls']==1 and stats['hullFaces']==6
shape=shapes[0]
assert len(shape['vertices'])==24 and len(shape['edges'])==12 and len(shape['faces'])==6
assert shape['bounds']=={'min':[0.0,0.0,0.0],'max':[p.SCALE,p.SCALE,p.SCALE]}
assert shape['source']['flags']==7 and materials[0]['name']=='concrete'
assert p.world([1,2,3])==[2*p.SCALE,3*p.SCALE,p.SCALE]
for plane in shape['planes']:
    assert abs(math.sqrt(sum(x*x for x in plane[:3]))-1)<1e-12
    for i in range(0,len(shape['vertices']),3):
        vertex=shape['vertices'][i:i+3]
        assert sum(vertex[k]*plane[k] for k in range(3))<=plane[3]+1e-12
`));

test('KV3 parser handles typed rows and skips unused SVM data without evaluating strings',()=>python(String.raw`
text=HEADER+r'''{
 m_parts = [ ]
 m_surfacePropertyHashes = [ 1, 2, ]
 m_collisionAttributes = [ { m_CollisionGroupString = "Default" m_InteractAsStrings = [ "custom_tag" ] } ]
 m_Planes = #[ 00 00 80 3F 00 00 00 00 ]
 m_pRegionSVM = { arbitrary_unneeded_data = #[ AA BB CC ] }
}'''
parsed=p.PhysicsKV3(text).value()
assert parsed['m_surfacePropertyHashes']==[1,2]
assert parsed['m_collisionAttributes'][0]['m_CollisionGroupString']=='Default'
assert parsed['m_collisionAttributes'][0]['m_InteractAsStrings']==['custom_tag']
assert parsed['m_Planes']==struct.pack('<ff',1,0)
assert 'm_pRegionSVM' not in parsed
`));

test('bad KV3 blobs, NaN, infinity, truncated coordinates and excessive nesting fail explicitly',()=>python(String.raw`
for text in [
    HEADER+'{ m_Planes = #[ GG ] }',
    HEADER+'{ m_Planes = #[ 00 01 }',
    HEADER+'{ m_surfacePropertyHashes = [ NaN ] }',
    HEADER+'{ m_surfacePropertyHashes = [ 1e999 ] }',
    HEADER+'{ m_parts = '+'['*70+']'*70+' }',
]:
    expect_bad(lambda text=text:p.PhysicsKV3(text).value())
expect_bad(lambda:p.floats(bytes([0]),3),'float blob')
expect_bad(lambda:p.floats(struct.pack('<fff',math.nan,0,0),3),'Non-finite')
expect_bad(lambda:p.floats(struct.pack('<ffff',0,0,math.inf,0),4),'Non-finite')
expect_bad(lambda:p.floats(b'',0),'float blob')
`));

test('unsafe capacities, noninteger indices and unsupported shapes fail before extraction',()=>python(String.raw`
def bad(mutate,message):
    aggregate,descriptor,mesh=fixture()
    mutate(aggregate,descriptor,mesh)
    expect_bad(lambda:p.extract_shapes(aggregate,'synthetic',{}),message)
bad(lambda a,d,m:a.update(m_parts=[{}]*(p.MAX_PARTS+1)),'part count')
bad(lambda a,d,m:a.update(m_surfacePropertyHashes=[1]*(p.MAX_MATERIALS+1)),'surface property count')
bad(lambda a,d,m:a.update(m_surfacePropertyHashes=[2**32]),'surface property count')
bad(lambda a,d,m:a['m_parts'][0]['m_rnShape'].update(m_hulls=[d]*(p.MAX_SHAPES+1)),'shape count')
bad(lambda a,d,m:d.update(m_nCollisionAttributeIndex=-1),'descriptor indices')
bad(lambda a,d,m:d.update(m_nCollisionAttributeIndex=True),'descriptor indices')
bad(lambda a,d,m:d.update(m_nSurfacePropertyIndex=0.5),'descriptor indices')
bad(lambda a,d,m:d['m_Hull'].update(m_VertexPositions=bytes((p.MAX_HULL_VERTICES+1)*12)),'vertex count')
bad(lambda a,d,m:d['m_Hull'].update(m_Edges=bytes((p.MAX_HULL_EDGES+1)*4)),'half-edge count')
bad(lambda a,d,m:d['m_Hull'].update(m_Faces=bytes(p.MAX_HULL_PLANES+1)),'face count')
bad(lambda a,d,m:d['m_Hull'].update(m_Planes=b''),'plane count')
bad(lambda a,d,m:a['m_parts'][0]['m_rnShape'].update(m_capsules=[{}]),'Unsupported sphere/capsule')
bad(lambda a,d,m:a.update(m_bindPose=[[1,0,0,0]*4]),'transformed/animated')
`));

test('mesh winding and per-triangle materials stay intact; bad geometry is rejected',()=>python(String.raw`
aggregate,_,mesh=fixture()
aggregate['m_parts'][0]['m_rnShape'].update(m_hulls=[],m_meshes=[mesh])
aggregate['m_surfacePropertyHashes'].append(0x12345678)
mesh['m_Mesh']['m_Materials']=[1]
shapes,materials,stats=p.extract_shapes(aggregate,'synthetic_mesh',{})
assert shapes[0]['indices']==[0,1,2] and shapes[0]['triangleMaterials']==[1]
assert shapes[0]['twoSided'] is None
assert materials[1]['name'] is None and stats['meshTriangles']==1
for update,message in [
    ({'m_Triangles':bytes(1)},'triangle index blob'),
    ({'m_Triangles':struct.pack('<III',0,1,9)},'mesh index out of range'),
    ({'m_Materials':[0,0]},'per-triangle material'),
    ({'m_Materials':[2]},'per-triangle material'),
    ({'m_Materials':[True]},'per-triangle material'),
    ({'m_Vertices':bytes((p.MAX_MESH_VERTICES+1)*12)},'vertex count'),
]:
    broken=copy.deepcopy(aggregate)
    broken['m_parts'][0]['m_rnShape']['m_meshes'][0]['m_Mesh'].update(update)
    expect_bad(lambda:p.extract_shapes(broken,'synthetic_mesh',{}),message)
`));
