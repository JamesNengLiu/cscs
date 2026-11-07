// Runtime envelope is separate from the extractor-owned content manifest.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {compileActorRig} from './build-cs2-actor-rigs.mjs';
import {actorActionsForTeam} from './cs2-actor-action-map.mjs';
const manifest=JSON.parse(await readFile('public/assets/cs2-content/manifest.json','utf8'));
manifest.files=manifest.files.filter(row=>!['manifest.json','runtime.json'].includes(row.path));
if(process.argv.includes('--build-rigs')){
 const clipStrides=JSON.parse(await readFile('public/assets/cs2-content/locomotion-strides.json','utf8'));if(clipStrides.schema!=='cscs.cs2.clip-strides.v1')throw Error('Native stride evidence required; run tools/cs2-content-locomotion-audit.mjs --family=all --publish');
 manifest.actorRigs={};await mkdir('public/assets/cs2-content/rigs',{recursive:true});
 const clips=manifest.clips.filter(c=>c.key.startsWith('world.')&&!c.additive).map(c=>({...c,file:path.resolve('public'+c.url)}));
 for(const [team,key] of [['T','tm_phoenix'],['CT','ctm_sas']]){const {actions,actionsByWeapon}=actorActionsForTeam(team);const model=manifest.models.find(m=>m.key===key);if(!model)throw Error('Native actor missing '+team);const rig=await compileActorRig({modelFile:path.resolve('public'+model.url),metadataFile:path.resolve('public'+model.metadata),clips,actions,actionsByWeapon,clipStrides,output:path.resolve('public/assets/cs2-content/rigs/'+team+'.rig')});manifest.actorRigs[team]={model:key,rig:'/assets/cs2-content/rigs/'+team+'.rig.json',sourceSHA256:rig.source.sha256,bufferSHA256:rig.bufferSHA256,bufferBytes:rig.bufferBytes};}
}else if(!manifest.actorRigs){
 try{manifest.actorRigs=JSON.parse(await readFile('public/assets/cs2-content/runtime.json','utf8')).actorRigs;}catch{try{manifest.actorRigs=JSON.parse(await readFile('.local/cs2/content/actor-rig-entries.json','utf8'));}catch{throw Error('Run node tools/prepare-cs2-runtime.mjs --build-rigs to compile native actors');}}
}
for(const [team,entry] of Object.entries(manifest.actorRigs)){
 const file=path.join('public',entry.rig),rig=JSON.parse(await readFile(file,'utf8')),buffer=await readFile(path.join(path.dirname(file),rig.buffer));
 if(buffer.length!==rig.bufferBytes||createHash('sha256').update(buffer).digest('hex')!==rig.bufferSHA256)throw Error('Rig digest mismatch '+team);
 if(!manifest.models.some(m=>m.key===entry.model))throw Error('Rig model absent '+team);
 entry.rigSHA256=createHash('sha256').update(await readFile(file)).digest('hex');
}
manifest.runtime={schema:'cscs.cs2.runtime.v1',weaponProfile:'cs2-vdata-experimental-v1',movementProfile:'cs2-meter-movement-v1',actorPose:'shared-gltf-pose-v3-continuous-phase-aim',audioEvents:'normalized-source-events-v1',perShellReload:'source-add-ammo-markers-v1',optics:'native-ads-pose-lens-adapter-v1',audio:'/assets/cs2-content/audio.json',smoke:'depth-limited-four-volume-eight-step-v1'};
await writeFile('public/assets/cs2-content/runtime.json',JSON.stringify(manifest));
console.log(JSON.stringify({models:manifest.models.length,clips:manifest.clips.length,teams:Object.keys(manifest.actorRigs),totalContentMiB:Math.round(manifest.totalBytes/1048576)}));
