// Independent real-engine endpoint replay. Raw author captures remain local and
// ignored; this tool never imports third-party simulator code or downloads tools.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {loadExperimentalWorld} from '../cs2-server.mjs';
import {createGrenadeRuntime} from '../cs2-grenades.mjs';
import {CS2_GRENADE_PROFILE} from '../public/cs2-grenade-profile.js';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {sourcePointToMeters,metersPointToSource} from '../public/experimental-world-contract.js';

const root=fileURLToPath(new URL('../',import.meta.url)),baseline='46dd5103c692d200d2ae849ad221fb790f94594b';
const directory=path.join(root,'.local/cs2/grenade-trajectory-evidence-2026-11-07');
const output=path.join(root,'.local/cs2/grenade-trajectory-2026-11-07');
const references=[
 {name:'a_site_center',file:'data__validation__de_dust2-20260909-225038.json',sha256:'9ea003fe73a88b1109c6f8c171e85a9ac85c906858a2f418d5fa3ad4df894f4b',heldOut:false},
 {name:'top_door',file:'data__validation__de_dust2-20260909-224949.json',sha256:'b9b941ec2454c5a7a1805e46d75025f2eccdae0857a1114c2b7f1c9de7fff356',heldOut:true},
 {name:'top_window',file:'data__validation__de_dust2-20260909-225013.json',sha256:'8941f7bdd74f01e72bf81f21c1b95987764ec9ba5b72334111c684d1b232480b',heldOut:true}
];
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceFiles=['cs2-grenades.mjs','cs2-grenade-flight.mjs','cs2-grenade-launch.mjs','public/cs2-grenade-profile.js','public/cs2-collision.js','public/cs2-world.js'];
const fingerprints=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,sha(await readFile(path.join(root,f)))])));
const git=f=>execFileSync('git',['show',baseline+':'+f],{encoding:'utf8',cwd:root,maxBuffer:4*1024*1024});
async function prior(file){const source=git(file),code=source.replace(/from\s+(['"])(\.[^'"]+)\1/g,(_,q,s)=>'from '+JSON.stringify(pathToFileURL(path.resolve(root,path.dirname(file),s)).href));return{hash:sha(source),exports:await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))};}
for(const f of ['public/math.js','public/config.js','public/grenade-state.js','public/cs2-smoke-field.js'])assert.equal(await readFile(path.join(root,f),'utf8'),git(f),'Legacy oracle dependency changed: '+f);
const oldRuntime=await prior('cs2-grenades.mjs'),oldProfile=await prior('public/cs2-grenade-profile.js'),before=await fingerprints();
const world=await loadExperimentalWorld({movementProfile:CS2_MOVEMENT_PROFILE});
const old=oldRuntime.exports.createGrenadeRuntime(world,{profile:oldProfile.exports.CS2_GRENADE_PROFILE});
const next=createGrenadeRuntime(world,{profile:CS2_GRENADE_PROFILE});
const quantile=(a,q)=>a.length?a[Math.ceil((a.length-1)*q)]:null;
function summarize(results){const errors=results.map(r=>r.errorSourceUnits).filter(Number.isFinite).sort((a,b)=>a-b);return{samples:results.length,detonated:errors.length,missing:results.length-errors.length,within3:errors.filter(e=>e<=3).length,within8:errors.filter(e=>e<=8).length,within48:errors.filter(e=>e<=48).length,medianSourceUnits:quantile(errors,.5),p95SourceUnits:quantile(errors,.95),maxSourceUnits:errors.at(-1)??null,exactBounceCounts:results.filter(r=>r.detonated&&r.simulatedBounces===r.capturedBounces).length,errorsDescribeSuccessfulSubsetOnly:true};}
function replay(runtime,row){
 assert.ok([row.Pos,row.Vel,row.RealRest].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)));
 const velocity=sourcePointToMeters(row.Vel),p={id:'reference-'+row.Index,ownerId:'reference',team:'T',kind:'smokegrenade',...sourcePointToMeters(row.Pos),vx:velocity.x,vy:velocity.y,vz:velocity.z,bornAt:0,detonateAt:1.5,simulatedAt:0,grounded:false,resting:false,bounces:0,nextThinkAt:.1,detonationQueued:false};
 const events=[],game={time:0,projectiles:[p],smokes:[],players:new Map(),emit(e){if(e.type==='explosion')events.push(e);},damage(){}};
 let peakBounces=0;for(let i=1;i<=1201&&game.projectiles.length;i++){game.time=i/60;runtime.stepGrenades(game,1/60);peakBounces=Math.max(peakBounces,p.bounces);}
 const event=events[0],rest=event?metersPointToSource(event):null;
 return{index:row.Index,type:row.Type,strength:row.Strength,capturedRest:row.RealRest,capturedBounces:row.RealBounces,simulatedRest:rest,simulatedBounces:peakBounces,errorSourceUnits:rest?Math.hypot(...rest.map((v,i)=>v-row.RealRest[i])):null,detonated:!!event,detonatedAt:event?game.time:null};
}
const cohorts=[];
for(const ref of references){
 const bytes=await readFile(path.join(directory,ref.file));assert.equal(sha(bytes),ref.sha256);
 const captured=JSON.parse(bytes);assert.equal(captured.map,'de_dust2');assert.equal(captured.name,ref.name);assert.equal(captured.results.length,60);
 const baselineRows=captured.results.map(r=>replay(old,r)),currentRows=captured.results.map(r=>replay(next,r)),baselineSummary=summarize(baselineRows),currentSummary=summarize(currentRows);
 assert.ok(currentSummary.detonated>=baselineSummary.detonated,'Lost previously valid terminal captures: '+ref.name);
 assert.equal(currentSummary.detonated,60,'All reference smokes must reach a legal terminal state: '+ref.name);
 cohorts.push({...ref,build:captured.build,serverBuild:captured.serverBuild,timestamp:captured.timestamp,baseline:baselineSummary,current:currentSummary,baselineRows,currentRows});
 console.log(JSON.stringify({cohort:ref.name,heldOut:ref.heldOut,baseline:baselineSummary,current:currentSummary}));
}
const after=await fingerprints();assert.deepEqual(after,before);
const report={status:'completed',createdAt:new Date().toISOString(),baselineCommit:baseline,baselineRuntimeSHA256:oldRuntime.hash,baselineProfileSHA256:oldProfile.hash,referenceCommit:'7ebba5b0443292886d2b2134e67b44736752d82d',referenceRepository:'https://github.com/NC1107/cs2-smoke-solver',worldContract:world.contract,activeProfileId:CS2_GRENADE_PROFILE.id,sourceHashesBefore:before,sourceHashesAfter:after,sourcesStable:true,scope:'Independent raw real-engine synthetic launch-to-rest replay, not retail player throw, per-tick or exact smoke-bloom timing certification. Source reports omit map VPK hash; builds differ. Two final cohorts were held out from parameter selection. No third-party implementation copied.',aggregate:{baseline:summarize(cohorts.flatMap(c=>c.baselineRows)),current:summarize(cohorts.flatMap(c=>c.currentRows))},cohorts};
await mkdir(output,{recursive:true});await writeFile(path.join(output,'retail-trajectory-replay.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,aggregate:report.aggregate,sourcesStable:true}));
