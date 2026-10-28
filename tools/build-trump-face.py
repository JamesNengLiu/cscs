#!/usr/bin/env python3
"""Local CS cosmetic build: unchanged original body + custom portrait-projected head.
Requires Pillow. Uses an authored low-poly head, not a facial scan. All source
and derived assets stay ignored; never execute downloaded data or alter hitboxes.
"""
import argparse,copy,hashlib,io,json,math,re,shutil,urllib.request
from pathlib import Path
from PIL import Image,ImageDraw,ImageFilter
ROOT=Path(__file__).resolve().parents[1]
PORTRAIT_URL='https://www.whitehouse.gov/wp-content/uploads/2025/06/President-Donald-Trump-Official-Presidential-Portrait.png'
PORTRAIT_SHA256='6a8c6ad2fae3ca32fd43454cc788a91683f513a0a830fa4539ecb405b661e562'
BASES=['terror','leet','arctic','guerilla']
CROP=(1060,104,1916,1244)
CYCLE,HEIGHT=1024,512

def sha(data):return hashlib.sha256(data).hexdigest()
def mul(a,b):return [[sum(a[i][k]*b[k][j]for k in range(3))for j in range(3)]for i in range(3)]
def vec(a,v):return [sum(a[i][k]*v[k]for k in range(3))for i in range(3)]
def transpose(a):return list(map(list,zip(*a)))
def matrix(v):
    x,y,z=v[3:];cx,sx,cy,sy,cz,sz=math.cos(x),math.sin(x),math.cos(y),math.sin(y),math.cos(z),math.sin(z)
    return [[cz*cy,cz*sy*sx-sz*cx,cz*sy*cx+sz*sx],[sz*cy,sz*sy*sx+cz*cx,sz*sy*cx-cz*sx],[-sy,cy*sx,cy*cx]]
def globals_for(bones):
    result=[]
    for bone in bones:
        r,t=matrix(bone['value']),bone['value'][:3];parent=bone['parent']
        if parent>=0:
            pr,pt=result[parent];t=[a+b for a,b in zip(vec(pr,t),pt)];r=mul(pr,r)
        result.append((r,t))
    return result

def neutral(model):
    sequence=next(s for s in model['sequences']if s['name']=='ref_aim_ak47');posed=copy.deepcopy(model['bones']);tracks=sequence['blendTracks'][4]
    for i,bone in enumerate(posed):
        for axis in range(6):
            channel=tracks[i][axis]
            if channel:bone['value'][axis]+=channel['values'][0]*bone['scale'][axis]
            controller=bone['controllers'][axis]
            if controller>=0:
                c=model['controllers'][controller];value=c['start']+c['rest']*360/256 if c['type']&0x8000 else c['start']+(c['end']-c['start'])*c['rest']/255
                bone['value'][axis]+=value*math.pi/180 if c['type']&(8|16|32) else value
    return globals_for(posed)

def head_ids(model):
    head=next(i for i,b in enumerate(model['bones'])if b['name'].lower().replace(' ','').endswith('head'));ids={head}
    for i,b in enumerate(model['bones']):
        if b['parent']in ids:ids.add(i)
    return head,ids

def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)

def atlas(portrait):
    image=Image.open(portrait).convert('RGB');assert image.size==(3000,1688);face=image.crop(CROP);mask=Image.new('L',face.size,0)
    silhouette=[(1210,174),(1330,126),(1540,108),(1730,138),(1872,244),(1900,404),(1860,622),(1868,790),(1795,952),(1740,1080),(1620,1205),(1480,1240),(1340,1195),(1230,1080),(1176,916),(1100,830),(1070,672),(1060,446),(1090,272)]
    ImageDraw.Draw(mask).polygon([(x-CROP[0],y-CROP[1])for x,y in silhouette],fill=255);mask=mask.filter(ImageFilter.GaussianBlur(7));fill=Image.new('RGB',face.size,(181,137,111));draw=ImageDraw.Draw(fill)
    for y in range(face.height):draw.line((0,y,face.width,y),fill=(178,164,137)if y/face.height<.36 else(181,137,111))
    photo=Image.composite(face,fill,mask).resize((512,HEIGHT),Image.Resampling.LANCZOS);src=photo.load();assert src is not None
    tile=Image.new('RGBA',(CYCLE,HEIGHT));pixels=tile.load();assert pixels is not None
    columns=[]
    for x in range(CYCLE):
        theta=2*math.pi*x/(CYCLE-1)-math.pi;c=math.cos(theta);columns.append((theta,c,math.sin(theta),smooth(-.02,.65,c)))
    for y in range(HEIGHT):
        v=y/(HEIGHT-1);latitude_width=math.sqrt(max(0,1-(1-2*v)**2))
        for x,(theta,c,sine,weight)in enumerate(columns):
            photo_x=int(max(0,min(511,(.5-.5*latitude_width*sine)*511)))
            hair=1-smooth(.39+.025*math.sin(theta),.45+.025*math.sin(theta),v);strand=3*math.sin(theta*28+v*10);light=.88+.12*c
            scalp=[(170+strand)*light,(157+strand)*light,(135+strand)*light];skin=[181*light,137*light,111*light];base=[hair*a+(1-hair)*b for a,b in zip(scalp,skin)];color=src[photo_x,y];assert isinstance(color,tuple)
            ear_u=(abs(theta)-math.pi/2)/.18;ear_v=(v-.56)/.115;rho=ear_u*ear_u+ear_v*ear_v
            if rho<1:
                amount=1-smooth(.75,1,rho);fold=math.exp(-((ear_u+.1)**2/.25+ear_v**2/.6));ear=[191-40*fold,145-40*fold,118-32*fold];base=[amount*a+(1-amount)*b for a,b in zip(ear,base)];weight*=1-amount
            pixels[x,y]=tuple(int(max(0,min(255,weight*a+(1-weight)*b)))for a,b in zip(color,base))+(255,)
    # Two identical tiles allow UV unwrapping through the back seam without
    # requiring any renderer wrap-mode changes or a front/back material cut.
    output=Image.new('RGBA',(CYCLE*2,HEIGHT));output.paste(tile,(0,0));output.paste(tile,(CYCLE,0));buffer=io.BytesIO();output.save(buffer,format='PNG');return buffer.getvalue()

def human_head(dx,wy,hz,joint):
    triangles=[]
    def add(a,b,c):
        u=[b[0][i]-a[0][i]for i in range(3)];v=[c[0][i]-a[0][i]for i in range(3)];cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
        if sum(x*x for x in cross)>1e-12:triangles.append([a,b,c])
    def ellipsoid(center,radii,rows,cols,kind='skull',side=0):
        grid=[]
        for row in range(rows+1):
            lat=-math.pi/2+math.pi*row/rows;cl,sl=math.cos(lat),math.sin(lat)
            for col in range(cols+1):
                angle=-math.pi+2*math.pi*col/cols;ca,sa=math.cos(angle),math.sin(angle);local=[radii[0]*cl*ca,radii[1]*cl*sa,radii[2]*sl]
                if kind=='skull':
                    local[0]*=.83+.17*smooth(-.9,-.2,sl)
                    local[0]+=max(0,ca)**4*(1.3*math.exp(-(local[1]/.8)**2-((local[2]+hz*.34)/1.1)**2)+.3*math.exp(-(local[1]/.7)**2-((local[2]+hz*.05)/1.5)**2))
                p=[a+b for a,b in zip(center,local)];n=[cl*ca/radii[0],cl*sa/radii[1],sl/radii[2]];theta=angle if kind=='skull' else side*math.pi/2-side*local[0]/radii[0]*.18;grid.append((p,n,theta))
        for row in range(rows):
            for col in range(cols):
                a=row*(cols+1)+col;b=a+cols+1;add(grid[a],grid[a+1],grid[b]);add(grid[a+1],grid[b+1],grid[b])
    ellipsoid([0,0,0],[dx,wy,hz],24,32)
    for side in [-1,1]:ellipsoid([-dx*.02,side*wy*.96,-hz*.12],[.6,.4,1.15],8,12,'ear',side)
    for col in range(32):
        a=2*math.pi*col/32;b=2*math.pi*(col+1)/32
        quad=[([joint[0]+1.6*math.cos(t),joint[1]+1.45*math.sin(t),z],[math.cos(t),math.sin(t),0],math.pi)for z,t in[(joint[2]-1.2,a),(joint[2]-1.2,b),(joint[2]+1.5,a),(joint[2]+1.5,b)]];add(quad[0],quad[1],quad[2]);add(quad[1],quad[3],quad[2])
    return triangles

def make_head(model):
    head,ids=head_ids(model);transforms=globals_for(model['bones']);points=[]
    for mesh in model['meshes']:
        for i,bone in enumerate(mesh['vertexBones']):
            if bone in ids:
                r,t=transforms[bone];points.append([a+b for a,b in zip(vec(r,mesh['positions'][i*3:i*3+3]),t)])
    if not points:raise ValueError('No source head vertices')
    lo=[min(p[i]for p in points)for i in range(3)];hi=[max(p[i]for p in points)for i in range(3)];bind_r,bind_t=transforms[head];pose_r=neutral(model)[head][0]
    transport=transpose(mul(pose_r,transpose(bind_r)));axes=[vec(transport,v)for v in[[1,0,0],[0,1,0],[0,0,1]]]
    projected=[[sum(p[k]*axis[k]for k in range(3))for axis in axes]for p in points];lower=[min(p[i]for p in projected)for i in range(3)];upper=[max(p[i]for p in projected)for i in range(3)]
    hz=min(6.3,max(5.35,(upper[2]-lower[2])*.5));wy=min(4.4,max(3.55,(upper[1]-lower[1])*.5));dx=3.9;half=[dx,wy,hz];center_coords=[(a+b)/2 for a,b in zip(lower,upper)];center_coords[2]=lower[2]+hz;center=[sum(axes[i][k]*center_coords[i]for i in range(3))for k in range(3)]
    removed=0
    for mesh in model['meshes']:
        keep=[]
        for i in range(0,len(mesh['indices']),3):
            tri=mesh['indices'][i:i+3]
            if all(mesh['vertexBones'][v]in ids for v in tri):removed+=1
            else:keep.extend(tri)
        mesh['indices']=keep
    remap={};kept=[]
    for i,mesh in enumerate(model['meshes']):
        if mesh['indices']:remap[i]=len(kept);mesh['baseMeshIndex']=i;kept.append(mesh)
    model['meshes']=kept
    for part in model['bodyparts']:
        for submodel in part['models']:submodel['meshIndices']=[remap[i]for i in submodel['meshIndices']if i in remap]
    joint=[sum((bind_t[k]-center[k])*axis[k]for k in range(3))for axis in axes]
    triangles=human_head(dx,wy,hz,joint);inv=transpose(bind_r);positions=[];normals=[];uv=[];front=[];back=[]
    for tri in triangles:
        components=[p for p,_,_ in tri];us=[.5+theta/(2*math.pi)for _,_,theta in tri]
        if max(us)-min(us)>.5:us=[u+1 if u<.5 else u for u in us]
        first=len(positions)//3
        for j,((_,normal,_),p)in enumerate(zip(tri,components)):
            world=[center[k]+sum(axes[i][k]*p[i]for i in range(3))for k in range(3)];positions.extend(vec(inv,[a-b for a,b in zip(world,bind_t)]))
            n=[sum(axes[i][k]*normal[i]for i in range(3))for k in range(3)];length=math.sqrt(sum(x*x for x in n));normals.extend(vec(inv,[x/length for x in n]));uv.extend([us[j]*CYCLE,max(0,min(1,.5-p[2]/(2*hz)))*HEIGHT])
        (front if sum(p[0]for p in components)>0 else back).extend([first,first+1,first+2])
    skinref=len(model['skins'][0]);texture_index=len(model['textures']);new=[]
    for i,indices in enumerate([front,back]):
        name=f'texture-{texture_index+i}.png';model['textures'].append({'name':name,'file':name,'width':CYCLE*2,'height':HEIGHT,'flags':0})
        for skin in model['skins']:skin.append(texture_index+i)
        mesh={'bodypart':0,'model':0,'skinref':skinref+i,'positions':positions.copy(),'normals':normals.copy(),'vertexBones':[head]*(len(positions)//3),'normalBones':[head]*(len(positions)//3),'uvPixels':uv.copy(),'indices':indices,'customHead':True};index=len(model['meshes']);model['meshes'].append(mesh);model['bodyparts'][0]['models'][0]['meshIndices'].append(index);new.append(index)
    return {'headBone':head,'headBones':sorted(ids),'sourceHeadBounds':{'min':lo,'max':hi},'customCenter':center,'halfSize':half,'bindFaceAxes':axes,'removedSourceHeadTriangles':removed,'newMeshes':new,'headTemplate':'authored skull, nose, jaw, ears and neck; not a facial scan','headTriangles':len(triangles),'hasEarGeometry':True,'textureMapping':'continuous latitude-correct portrait-to-scalp cylindrical atlas with duplicated seam tile'}

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--root',type=Path,default=ROOT/'public/assets/players');ap.add_argument('--portrait',type=Path,default=ROOT/'public/assets/portraits/trump-official-2025.png');ap.add_argument('--fetch-portrait',action='store_true',help='Download pinned official portrait only if missing; never overwrite source');args=ap.parse_args();args.root=args.root.resolve()
    if not args.root.is_relative_to((ROOT/'public/assets/players').resolve()):raise ValueError('Build output must remain inside ignored player assets')
    if args.fetch_portrait and not args.portrait.exists():
        if not args.portrait.resolve().is_relative_to((ROOT/'public/assets/portraits').resolve()):raise ValueError('Portrait download escapes ignored assets')
        with urllib.request.urlopen(PORTRAIT_URL,timeout=30)as response:download=response.read(8*1024*1024+1)
        if len(download)>8*1024*1024 or sha(download)!=PORTRAIT_SHA256:raise ValueError('Downloaded portrait differs from pinned source')
        args.portrait.parent.mkdir(parents=True,exist_ok=True);args.portrait.write_bytes(download)
    if sha(args.portrait.read_bytes())!=PORTRAIT_SHA256:raise ValueError('Unexpected portrait checksum')
    mf=args.root/'manifest.json';manifest=json.loads(mf.read_text());models={};source_bytes={};report=[]
    for base in BASES:
        entry=manifest['models'][base]
        if entry['file']!=f'{base}/model.json':raise ValueError('Unexpected base path')
        source=args.root/entry['file']
        if not source.resolve().is_relative_to(args.root):raise ValueError('Source escapes ignored assets')
        data=source.read_bytes()
        if sha(data)!=entry['convertedSHA256']:raise ValueError('Base hash mismatch')
        models[base]=json.loads(data);source_bytes[base]=data
    texture_bytes=atlas(args.portrait)
    for base in BASES:
        entry=manifest['models'][base];source=args.root/entry['file'];model=copy.deepcopy(models[base]);id=base+'_trump';directory=args.root/id
        if not directory.resolve().is_relative_to(args.root):raise ValueError('Output escapes ignored assets')
        directory.mkdir(parents=True,exist_ok=True)
        for texture in model['textures']:
            if not re.fullmatch(r'texture-\d+\.png',texture['file']):raise ValueError('Unexpected texture path')
            origin=source.parent/texture['file'];target=directory/texture['file']
            if not origin.resolve().is_relative_to(args.root)or not target.resolve().is_relative_to(args.root):raise ValueError('Texture escapes ignored assets')
            shutil.copy2(origin,target)
        texture_count=len(model['textures'])
        for i in range(2):(directory/f'texture-{texture_count+i}.png').write_bytes(texture_bytes)
        info=make_head(model)
        for texture in model['textures']:texture['sha256']=sha((directory/texture['file']).read_bytes())
        model['metadata'].update({'id':id,'source':'custom-trump-face','baseModel':base,'baseSourceSHA256':entry['sourceSHA256'],'baseConvertedSHA256':entry['convertedSHA256'],'customFace':{'name':'Donald Trump','fictionalCosmetic':True,'portraitURL':PORTRAIT_URL,'portraitSHA256':PORTRAIT_SHA256,'portraitCrop':CROP,'method':'Authored low-poly skull, nose, ears and neck, portrait projection and approximate side/rear coloring; NOT a facial scan or official endorsement','bodyUnmodified':True,**info}})
        model['metadata']['counts'].update(renderVertices=sum(len(m['vertexBones'])for m in model['meshes']),triangles=sum(len(m['indices'])//3 for m in model['meshes']),textures=len(model['textures']),meshes=len(model['meshes']))
        output=json.dumps(model,separators=(',',':'),allow_nan=False).encode();(directory/'model.json').write_bytes(output);manifest['models'][id]={**model['metadata'],'file':f'{id}/model.json','convertedSHA256':sha(output),'convertedBytes':len(output)};report.append({'id':id,'baseModel':base,'sha256':sha(output),**info});assert source.read_bytes()==source_bytes[base]
    manifest['customCosmetics']={'trump':{'fictional':True,'officialEndorsement':False,'portraitURL':PORTRAIT_URL,'portraitSHA256':PORTRAIT_SHA256,'portraitRightsReference':'https://commons.wikimedia.org/wiki/File:President-Donald-Trump-Official-Presidential-Portrait.png','note':'Official portrait provenance is separate from publicity/endorsement rights and CS asset redistribution; all assets remain local.'}}
    mf.write_text(json.dumps(manifest,indent=2)+'\n');(args.root/'trump-build-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()
