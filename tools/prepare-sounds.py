#!/usr/bin/env python3
"""Prepare ignored local WAV assets. Use --source for owned local files or --fetch for mirrors."""
import argparse, concurrent.futures, datetime, hashlib, io, json, re, urllib.request, wave
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/assets/sounds'
MIRRORS=['https://luxserv.ge/cstrike/sound/','https://packnt.com/files/games/gamecache/cstrike_new/pb/sound/']
SAFE=re.compile(r'^(weapons|player|items)/[a-zA-Z0-9_-]+\.wav$')
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',type=Path);parser.add_argument('--fetch',action='store_true');args=parser.parse_args()
    if not args.source and not args.fetch:parser.error('Choose --source or --fetch')
    names=set(re.findall(r"'(.*?)'",(ROOT/'public/sound-catalog.js').read_text()))
    for path in (ROOT/'public/assets/weapons').glob('*/model.json'):
        for seq in json.loads(path.read_text()).get('sequences',[]):
            names.update(e.get('options','') for e in seq.get('events',[]) if e.get('event')==5004)
    names=sorted(n for n in names if SAFE.fullmatch(n))
    if len(names)>256:raise ValueError('Sound budget exceeded')
    OUT.mkdir(parents=True,exist_ok=True)
    manifest=OUT/'manifest.json';previous=json.loads(manifest.read_text()).get('assets',{}) if manifest.is_file() else {}
    def prepare(name):
        target=OUT/name;errors=[];url=None
        if target.exists():
            data=target.read_bytes();old=previous.get(name,{})
            if old.get('sha256') and old['sha256']!=hashlib.sha256(data).hexdigest():raise ValueError('Existing WAV changed: '+name)
            url=old.get('url')
        elif args.source and (args.source/name).is_file():data=(args.source/name).read_bytes()
        elif args.fetch:
            data=None
            for base in MIRRORS:
                try:
                    url=base+name
                    with urllib.request.urlopen(url,timeout=15) as response:data=response.read(2*1024*1024+1)
                    if data[:4]!=b'RIFF' or data[8:12]!=b'WAVE':raise ValueError('Not WAV')
                    break
                except Exception as error:errors.append(str(error));data=None
            if data is None:return name,{'source':'unavailable','errors':errors}
        else:return name,{'source':'unavailable'}
        if len(data)>2*1024*1024:raise ValueError('WAV byte limit')
        with wave.open(io.BytesIO(data)) as wav:
            if wav.getnchannels()>2 or wav.getnframes()/wav.getframerate()>15:raise ValueError('WAV format/duration limit')
        if not target.exists():target.parent.mkdir(exist_ok=True,parents=True);target.write_bytes(data)
        return name,{'source':'local-wav','url':url,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'retailHashVerified':False}
    entries=dict(concurrent.futures.ThreadPoolExecutor(max_workers=6).map(prepare,names))
    (OUT/'manifest.json').write_text(json.dumps({'schema':'local-sounds-v1','preparedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'assets':entries},indent=2))
    ready=sum(e['source']=='local-wav' for e in entries.values());print(f'Prepared {ready}/{len(entries)} local WAV files; assets remain ignored.')
    for n,e in entries.items():
        if e['source']=='unavailable':print('Unavailable:',n)
if __name__=='__main__':main()
