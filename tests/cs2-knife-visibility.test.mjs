import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const project=fileURLToPath(new URL('../',import.meta.url));
const assetPath=url=>path.join(project,'public',new URL(url,'https://cs2-offline.invalid/').pathname);
const readJSON=async filename=>JSON.parse(await readFile(filename,'utf8'));
const execFileAsync=promisify(execFile);

// The audit reads the actual native loader, model, original clips, weighted
// vertices, and presentation helpers. Only textures/rendering are stripped.
// Check all of its local geometry/pose inputs so an unprepared checkout skips
// explicitly; malformed manifests or corrupted existing assets still fail.
async function missingOriginalAsset(){
  try{
    const manifest=await readJSON(assetPath('/assets/cs2-content/runtime.json'));
    for(const entry of Object.values(manifest.actorRigs)){
      const rig=await readJSON(assetPath(entry.rig));
      await access(assetPath(new URL(rig.buffer,new URL(entry.rig,'https://cs2-offline.invalid/')).pathname));
    }
    const modelKeys=new Set(['arms','knife',...Object.values(manifest.actorRigs).map(entry=>entry.model)]);
    const knife=manifest.models.find(entry=>entry.key==='knife');
    assert.ok(knife,'runtime manifest must declare the original knife');
    const documents=[...modelKeys].map(key=>{
      const entry=manifest.models.find(row=>row.key===key);assert.ok(entry,`missing native model mapping: ${key}`);return entry.url;
    });
    for(const action of ['draw','idle','light','heavy']){
      const entry=manifest.clips.find(row=>row.key===knife.viewmodelActions?.[action]);
      assert.ok(entry,`missing original knife ${action} clip mapping`);documents.push(entry.url);
    }
    for(const url of documents){
      const document=await readJSON(assetPath(url));
      for(const buffer of document.buffers||[])if(buffer.uri&&!buffer.uri.startsWith('data:')){
        await access(assetPath(new URL(buffer.uri,new URL(url,'https://cs2-offline.invalid/')).pathname));
      }
    }
    return null;
  }catch(error){
    if(error.code==='ENOENT')return `Original CS2 knife/arms/clips/rig assets are not prepared locally: ${path.relative(project,error.path)}`;
    throw error;
  }
}

test('native loading preserves the original knife body_legacy mesh and visible weighted idle vertices',async t=>{
  const missing=await missingOriginalAsset();if(missing){t.skip(missing);return;}
  // Isolates the audit's local-only fetch/GLTF adapters from the test process.
  const {stdout}=await execFileAsync(process.execPath,[path.join(project,'tools/cs2-knife-visibility-audit.mjs')],{cwd:project,timeout:10000,maxBuffer:256*1024});
  const report=JSON.parse(stdout);
  assert.equal(report.modelSource.path,'weapons/models/knife/knife_default_ct/weapon_knife_default_ct.vmdl_c');
  const meshes=report.meshesAfterNativeLoader;
  assert.equal(meshes.length,1,'the real default CT knife has one original render mesh');
  assert.match(meshes[0].name,/body_legacy$/i);
  assert.equal(meshes[0].visible,true,'body_legacy is the knife itself and must survive actual native model loading');
  assert.equal(meshes[0].vertices,4756);
  const idle=report.results.find(row=>row.action==='idle');
  assert.ok(idle);assert.equal(idle.clip,'viewmodel.knife.idle_knife');
  assert.equal(idle.frames.length,5);
  for(const frame of idle.frames){
    assert.equal(frame.total,4756,`idle ${frame.fraction}: original weighted knife vertices`);
    assert.equal(frame.inFrontOfNearPlane,4756,`idle ${frame.fraction}: knife is in front of the native camera near plane`);
    assert.equal(frame.insideFrustum,4756,`idle ${frame.fraction}: complete knife remains in the actual presentation frustum`);
    assert.equal(frame.visibleInsideFrustum,4756,`idle ${frame.fraction}: original knife is visible through its full parent hierarchy`);
  }
});
