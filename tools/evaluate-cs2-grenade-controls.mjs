// Offline, bounded CPU/trajectory receipt. No HTTP server, browser or GPU.
// The baseline is an immutable source commit, not a copied implementation oracle.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {createGrenadeRuntime} from '../cs2-grenades.mjs';
import {CS2_GRENADE_PROFILE,CS2_GRENADE_PROFILE_V2} from '../public/cs2-grenade-profile.js';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {createGrenadePrediction,GRENADE_PROTOCOL} from '../public/cs2-grenade-intent.js';
import {fixtureWorld} from '../tests/cs2-game-fixture.mjs';
import {loadExperimentalWorld} from '../cs2-server.mjs';

const BASELINE='46dd5103c692d200d2ae849ad221fb790f94594b';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'.local/cs2/grenade-controls-2026-11-07');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitSource=file=>execFileSync('git',['show',BASELINE+':'+file],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
const sourceFiles=['cs2-grenades.mjs','public/cs2-grenade-profile.js','public/cs2-grenade-controls.js','public/cs2-grenade-intent.js','cs2-grenade-launch.mjs','cs2-grenade-flight.mjs'];
const fingerprint=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,sha(await readFile(path.join(root,file)))])));
const baselineDependencies=['public/math.js','public/config.js','public/grenade-state.js','public/cs2-smoke-field.js'];
const baselineDependencySHA256={};
for(const file of baselineDependencies){const current=await readFile(path.join(root,file),'utf8'),prior=gitSource(file);assert.equal(current,prior,'Shared helper changed; baseline must load its historical version: '+file);baselineDependencySHA256[file]=sha(prior);}
async function importBaseline(file){
 const source=gitSource(file),absolute=source.replace(/from\s+(['"])(\.[^'"]+)\1/g,(_,quote,specifier)=>'from '+JSON.stringify(pathToFileURL(path.resolve(root,path.dirname(file),specifier)).href));
 return{source,module:await import('data:text/javascript;base64,'+Buffer.from(absolute).toString('base64'))};
}
const oldRuntime=await importBaseline('cs2-grenades.mjs'),oldProfile=await importBaseline('public/cs2-grenade-profile.js');
const oldIntent=await importBaseline('public/cs2-grenade-intent.js');
await mkdir(output,{recursive:true});
await writeFile(path.join(output,'baseline-cs2-grenades.mjs'),oldRuntime.source);
await writeFile(path.join(output,'baseline-cs2-grenade-profile.js'),oldProfile.source);
const before=await fingerprint();
const baselineWorld=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE});
const kinds=['hegrenade','flashbang','smokegrenade'];
const stances=[{name:'standing'},{name:'moving',vx:2,vz:-3},{name:'crouched',crouch:true,duckAmount:1},{name:'jumping',y:2,vy:5,grounded:false}];
const owner=(stance={},spawn={x:0,y:.02,z:4})=>({id:'owner',team:'T',alive:true,...spawn,yaw:.37,pitch:0,vx:0,vy:0,vz:0,grounded:true,...stance});
const fields=['x','y','z','vx','vy','vz','bornAt','detonateAt','simulatedAt','grounded','resting','bounces','airBounces','nextThinkAt','detonationQueued','groundBody'];
const state=p=>p?Object.fromEntries(fields.filter(key=>p[key]!==undefined).map(key=>[key,p[key]])):null;
function flight(factory,profile,p,kind){
 const runtime=factory(baselineWorld,{profile}),projectile=runtime.createGrenade(p,kind,0);
 assert.ok(projectile);const game={time:0,projectiles:[projectile],smokes:[],players:new Map(),events:[],emit(event){this.events.push(event);},damage(){}};
 const initial=state(projectile),samples=[];
 for(let tick=1;tick<=90;tick++){game.time=tick/60;runtime.stepGrenades(game,1/60);samples.push({tick,projectile:state(game.projectiles[0]),events:game.events.map(event=>({type:event.type,kind:event.kind,x:event.x,y:event.y,z:event.z}))});game.events=[];}
 return{initial,samples};
}
const trajectories=[];
for(const kind of kinds)for(const stance of stances)for(const pitch of [-.5,0,.65]){
 const p=owner({...stance,pitch}),prior=flight(oldRuntime.module.createGrenadeRuntime,oldProfile.module.CS2_GRENADE_PROFILE,p,kind),next=flight(createGrenadeRuntime,CS2_GRENADE_PROFILE_V2,p,kind);
 assert.deepEqual(next,prior,'Strong throw changed: '+[kind,stance.name,pitch].join('/'));
 trajectories.push({kind,stance:stance.name,pitch,initial:prior.initial,samples:prior.samples});
}
const runtime=createGrenadeRuntime(baselineWorld,{profile:CS2_GRENADE_PROFILE}),launch=[];
for(const kind of kinds)for(const strength of [0,.5,1]){
 const projectile=runtime.createGrenade(owner(),kind,0,{strength});assert.ok(projectile);
 const speed=Math.hypot(projectile.vx,projectile.vy,projectile.vz),expected=675*(.3+.7*strength)*.0254;
 assert.ok(Math.abs(speed-expected)<1e-10,'Candidate strength speed mismatch');
 launch.push({kind,strength,speedMetresPerSecond:speed,speedSourceUnitsPerSecond:speed/.0254,initial:state(projectile)});
}
// Real compiled Source 2 CPU collision data; no simulated retail server claims.
const world=await loadExperimentalWorld({movementProfile:CS2_MOVEMENT_PROFILE});
const spawn=world.resolveSpawn('T',0),players=new Map(Array.from({length:10},(_,i)=>{const p=owner({id:'peer-'+i,x:spawn.x+30+i*2,z:spawn.z+30,y:spawn.y});return[p.id,p];}));
const quantile=(sorted,q)=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*q))];
function bench(factory,profile,count){
 const sim=factory(world,{profile}),p=owner({y:spawn.y+2},spawn),game={time:0,projectiles:[],smokes:[],players,emit(){},damage(){}};
 const bank=Array.from({length:count},(_,i)=>{const grenade=sim.createGrenade({...p,yaw:i*.37,pitch:.3},kinds[i%kinds.length],0);assert.ok(grenade);return{...grenade,id:'bench-'+i};});
 const durations=[],work=180;
 for(let tick=0;tick<work+600;tick++){
  // Each measured call starts with identical inputs. Setup and clones are outside
  // the timer; the physics step (including its allocations) is inside it.
  game.time=1/60;game.projectiles=bank.map(grenade=>({...grenade}));game.smokes=[];
  const start=performance.now();sim.stepGrenades(game,1/60);const elapsed=performance.now()-start;
  if(tick>=work)durations.push(elapsed);
 }
 durations.sort((a,b)=>a-b);return{count,samples:durations.length,p50Ms:quantile(durations,.5),p95Ms:quantile(durations,.95),p99Ms:quantile(durations,.99),maxMs:durations.at(-1)};
}
const performanceRows=[];
// Alternate baseline/current/baseline so a later warmed run is not the only comparison.
for(const count of [0,4,32,64]){
 const first=bench(oldRuntime.module.createGrenadeRuntime,oldProfile.module.CS2_GRENADE_PROFILE,count),current=bench(createGrenadeRuntime,CS2_GRENADE_PROFILE,count),last=bench(oldRuntime.module.createGrenadeRuntime,oldProfile.module.CS2_GRENADE_PROFILE,count);
 performanceRows.push({count,baselineBefore:first,current,baselineAfter:last,p99DeltaToBaselineMeanMs:current.p99Ms-(first.p99Ms+last.p99Ms)/2});
}
function controlBench(factory,protocol,dual=false){
 let at=0,messages=0;const p={alive:true,weapon:'flashbang',grenades:{flashbang:2},nextAttackAt:0,grenadeProtocol:protocol},context={round:1,stateTime:0,phase:'live',yaw:0,pitch:0},prediction=factory({now:()=>at,send:()=>messages++}),durations=[],perBatch=64;
 for(let batch=0;batch<240;batch++){
  const start=performance.now();
  for(let n=0;n<perBatch;n++){
   at+=2;context.stateTime=at;assert.ok(prediction.press(p,context));
   if(dual){at+=.15;prediction.buttons(p,3,context);at+=.2;prediction.buttons(p,2,context);at+=.05;prediction.buttons(p,0,context);}
   else{at+=.6;assert.ok(prediction.release({yaw:0,pitch:0}));}
  }
  if(batch>=40)durations.push(performance.now()-start);
 }
 durations.sort((a,b)=>a-b);return{kind:dual?'left-to-dual-split-release':'left-release',samples:durations.length,throwsPerSample:perBatch,messagesPerThrow:messages/(240*perBatch),batchP50Ms:quantile(durations,.5),batchP95Ms:quantile(durations,.95),batchP99Ms:quantile(durations,.99),amortizedP99MsPerThrow:quantile(durations,.99)/perBatch};
}
const controlCPU={scope:'Cosmetic prediction plus message creation, 64-throw batches, no transport, DOM or GPU. Assertions and object setup are included equally.',baselineLeft:controlBench(oldIntent.module.createGrenadePrediction,oldIntent.module.GRENADE_PROTOCOL),currentLeft:controlBench(createGrenadePrediction,GRENADE_PROTOCOL),currentDual:controlBench(createGrenadePrediction,GRENADE_PROTOCOL,true)};
const after=await fingerprint();assert.deepEqual(after,before,'Source changed during measurement');
const receipt={schema:'cs2-grenade-controls-baseline-v1',createdAt:new Date().toISOString(),baselineCommit:BASELINE,baselineSHA256:{runtime:sha(oldRuntime.source),profile:sha(oldProfile.source),intent:sha(oldIntent.source)},baselineDependencySHA256,currentSHA256:before,worldContract:world.contract,scope:'Offline exact strong-throw preservation plus real-map CPU collision microbenchmark. Ten stationary synthetic players, single fixed-step inputs; no browser/GPU, physical mouse, LAN or retail trajectory certification.',strongTrajectories:trajectories.length,strongSamples:trajectories.length*90,exactStrongPreservation:true,preservationProfileId:CS2_GRENADE_PROFILE_V2.id,activeProfileId:CS2_GRENADE_PROFILE.id,launch,performance:performanceRows,controlCPU,sourcesStable:true};
await writeFile(path.join(output,'strong-trajectory-baseline.json'),JSON.stringify({baselineCommit:BASELINE,trajectories},null,2));
await writeFile(path.join(output,'cpu-and-trajectory-validation.json'),JSON.stringify(receipt,null,2));
console.log(JSON.stringify({...receipt,launch:launch.map(({kind,strength,speedSourceUnitsPerSecond})=>({kind,strength,speedSourceUnitsPerSecond}))},null,2));
