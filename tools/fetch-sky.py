from pathlib import Path
from urllib.request import Request,urlopen
from concurrent.futures import ThreadPoolExecutor,as_completed
import hashlib,json,struct,zlib
ROOT=Path(__file__).resolve().parents[1]
out=ROOT/'public/assets/dust2';out.mkdir(parents=True,exist_ok=True)
def png(path,w,h,rgba):
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    raw=b''.join(b'\0'+rgba[y*w*4:(y+1)*w*4]for y in range(h))
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>2I5B',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b''))
def download(face):
    url='https://luxserv.ge/cstrike/gfx/env/Des'+face+'.tga'
    with urlopen(Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=30) as r:data=r.read(4*1024*1024)
    assert len(data)>=18
    ident,cmap,kind=struct.unpack_from('<BBB',data);w,h=struct.unpack_from('<HH',data,12);bits,flags=data[16:18]
    assert cmap==0 and kind in [2,10] and bits in [24,32] and 0<w<=2048 and 0<h<=2048
    bpp=bits//8;pos=18+ident;pixels=[]
    if kind==2:
        assert pos+w*h*bpp<=len(data)
        pixels=[data[i:i+bpp]for i in range(pos,pos+w*h*bpp,bpp)]
    else:
        while len(pixels)<w*h:
            packet=data[pos];pos+=1;n=(packet&127)+1
            if packet&128:pixels.extend([data[pos:pos+bpp]]*n);pos+=bpp
            else:pixels.extend(data[i:i+bpp]for i in range(pos,pos+n*bpp,bpp));pos+=n*bpp
    assert len(pixels)==w*h
    rgba=bytearray(w*h*4)
    for i,p in enumerate(pixels):
        assert len(p)==bpp;x=i%w;y=i//w
        if not(flags&32):y=h-1-y
        if flags&16:x=w-1-x
        dst=(y*w+x)*4;rgba[dst:dst+4]=bytes([p[2],p[1],p[0],255])
    png(out/f'sky-{face}.png',w,h,rgba)
    return {'face':face,'url':url,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'width':w,'height':h,'image':f'sky-{face}.png'}
report={'sourceIndex':'https://luxserv.ge/cstrike/gfx/env/','faces':[],'errors':[]}
with ThreadPoolExecutor(max_workers=3) as pool:
    futures={pool.submit(download,face):face for face in ['rt','lf','up','dn','ft','bk']}
    for f in as_completed(futures):
        try:report['faces'].append(f.result());print('Downloaded sky',futures[f],flush=True)
        except Exception as e:report['errors'].append({'face':futures[f],'error':str(e)});print('Failed sky',futures[f],str(e),flush=True)
        (ROOT/'artifacts/sky-sources.json').write_text(json.dumps(report,indent=2))
assert len(report['faces'])==6 and not report['errors'],report
print('All six sky faces decoded and stored.')
