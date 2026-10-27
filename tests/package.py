"""Verify actual receipts. Optional code-only archive omits proprietary map assets."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import hashlib,json,re,subprocess,sys,zipfile
root=Path(__file__).resolve().parents[1];art=root/'artifacts';art.mkdir(exist_ok=True)
files=sorted(str(p.relative_to(root))for p in(root/'tests').glob('*.test.mjs'))
run=subprocess.run(['node','--test',*files],cwd=root,capture_output=True,text=True)
(art/'unit-tests.txt').write_text(run.stdout+run.stderr)
assert run.returncode==0,run.stdout+run.stderr
counts={}
for key in ['tests','pass','fail']:
    match=re.search(r'^# '+key+r' (\d+)\s*$',run.stdout,re.M);assert match,key;counts[key]=int(match[1])
assert counts['tests']==counts['pass'] and counts['fail']==0
read=lambda name:json.loads((art/name).read_text())
browser=read('browser-report.json');geometry=read('geometry-verification.json');routes=read('routes-report.json');lifecycle=read('server-lifecycle.json');tuning=read('tuning-report.json');imported=read('map-import.json');sky=read('sky-sources.json')
assert browser['status']=='passed' and not browser['errors'] and not browser['externalRequests']
assert geometry['status']==routes['status']=='passed'
assert len(routes['routes'])==routes['routesVerified']==5 and all(r['status']=='passed'for r in routes['routes'])
assert lifecycle['shutdown']=='graceful' and lifecycle['portClosed']
assert len(sky['faces'])==6 and not sky['errors']
assert geometry['sourceSHA256']==routes['sourceSHA256']==imported['sourceSHA256']
assert tuning['stopFromFullSpeed']['counter']['seconds']<tuning['stopFromFullSpeed']['release']['seconds']
for p in [*(root/'public').rglob('*'),root/'server.mjs',root/'game.mjs']:
    if p.is_file():assert p.stat().st_mtime<=(art/'browser-report.json').stat().st_mtime,'Stale browser report: '+str(p)
for p in ['public/map-data.js','public/assets/dust2/render.json']:
    assert(root/p).stat().st_mtime<=(art/'geometry-verification.json').stat().st_mtime
for p in ['public/map.js','public/movement.js','public/config.js']:
    assert(root/p).stat().st_mtime<=(art/'routes-report.json').stat().st_mtime
assert json.loads((root/'package.json').read_text())['version']==json.loads((root/'package-lock.json').read_text())['version']=='0.3.0'
report={'verifiedAt':datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),'version':'0.3.0',
        'unitTests':counts,'browserChecks':len(browser['checks']),'browserStatus':browser['status'],
        'geometry':geometry,'movementRoutes':{'count':len(routes['routes']),'names':[r['name']for r in routes['routes']],'method':'Actual shared movement simulation, not physical computer tests'},
        'textures':imported['textures'],'skyFaces':len(sky['faces']),
        'temporaryTestServerStopped':lifecycle['portClosed'],'existingOtherServersStopped':False,
        'physicalMultiComputerTest':'not performed','tenPlayerLoadTest':'not performed',
        'mapFidelity':'BSP geometry/UV/hulls/entities preserved and verified; legacy renderer/gameplay not fully replicated',
        'distribution':'Original/derived map assets remain local; omitted from optional code-only archive'}
(art/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
if '--code-only' in sys.argv:
    output=root.parent.parent/'outputs'/(root.name+'-code-only.zip');output.parent.mkdir(exist_ok=True)
    paths=[]
    for p in sorted(root.rglob('*')):
        if not p.is_file():continue
        rel=p.relative_to(root)
        if set(rel.parts)&{'node_modules','.git','__pycache__','assets'} or p.name in {'.DS_Store','map-data.js'}:continue
        if rel.parts[0]=='artifacts' and p.name!='verification.json':continue
        paths.append(p)
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
        for p in paths:archive.write(p,str(Path(root.name)/p.relative_to(root)))
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip()is None and len(archive.namelist())==len(paths)
        assert not any('/assets/'in name or name.endswith('/map-data.js')for name in archive.namelist())
    print(json.dumps({'archive':str(output),'files':len(paths),'bytes':output.stat().st_size,
                      'standalonePlayable':False,'requiresLocalMapImport':True},ensure_ascii=False))
