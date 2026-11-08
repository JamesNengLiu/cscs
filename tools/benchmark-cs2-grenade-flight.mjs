// CPU-only A/B/A. Eight continuing player ticks per window exercise the 2/3
// half-step pattern at 60 Hz; a reset-every-tick benchmark would miss that P99.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {createGrenadeRuntime} from '../cs2-grenades.mjs';
import {CS2_GRENADE_PROFILE} from '../public/cs2-grenade-profile.js';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {loadExperimentalWorld} from '../cs2-server.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),output=path.join(root,'.local/cs2/grenade-trajectory-2026-11-07');
const baselineCommit='46dd5103c692d200d2ae849ad221fb790f94594b',manifest={commit:baselineCommit,files:{}};
const sha=b=>createHash('sha256').update(b).digest('hex');
async function baseline(file){const bytes=execFileSync('git',['show',baselineCommit+':'+file],{cwd:root,maxBuffer:4*1024*1024});manifest.files[file]=sha(bytes);const source=bytes.toString().replace(/from\s+(['"])(\.[^'"]+)\1/g,(_,q,p)=>'from '+JSON.stringify(pathToFileURL(path.resolve(root,path.dirname(file),p)).href));return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));}
const oldRuntime=await baseline('cs2-grenades.mjs'),oldProfile=await baseline('public/cs2-grenade-profile.js');
const sources=['cs2-grenades.mjs','cs2-grenade-flight.mjs','cs2-grenade-launch.mjs','public/cs2-grenade-profile.js','public/cs2-collision.js'];
const fingerprints=async()=>Object.fromEntries(await Promise.all(sources.map(async f=>[f,sha(await readFile(path.join(root,f)))])));
const before=await fingerprints(),world=await loadExperimentalWorld({movementProfile:CS2_MOVEMENT_PROFILE}),spawn=world.resolveSpawn('T',0),kinds=['hegrenade','flashbang','smokegrenade'];
const players=new Map(Array.from({length:10},(_,i)=>{const p={id:'peer-'+i,team:i<5?'T':'CT',alive:true,x:spawn.x+30+i*2,y:spawn.y,z:spawn.z+30,vx:0,vy:0,vz:0};return[p.id,p];}));
function measure(factory,profile,count){
 const runtime=factory(world,{profile}),owner={id:'owner',alive:true,team:'T',...spawn,y:spawn.y+2,pitch:.3,vx:0,vy:0,vz:0},bank=Array.from({length:count},(_,i)=>{const p=runtime.createGrenade({...owner,yaw:i*.37},kinds[i%3],0);assert.ok(p);return{...p,id:'bench-'+i};}),samples=[],queries=[],queryOriginal=world.collision.trace;let queryCount=0;
 world.collision.trace=function(...args){queryCount++;return Reflect.apply(queryOriginal,this,args);};
 try{
  const game={time:0,projectiles:[],smokes:[],players,emit(){},damage(){}};
  for(let block=0;block<100;block++){
   game.time=0;game.projectiles=bank.map(p=>({...p}));game.smokes=[];
   for(let tick=1;tick<=8;tick++){game.time=tick/60;const q=queryCount,start=performance.now();runtime.stepGrenades(game,1/60);const elapsed=performance.now()-start;if(block>=20){samples.push(elapsed);queries.push(queryCount-q);}assert.equal(game.projectiles.length,count);}
  }
 }finally{world.collision.trace=queryOriginal;}
 samples.sort((a,b)=>a-b);queries.sort((a,b)=>a-b);const at=(a,q)=>a[Math.ceil((a.length-1)*q)];return{count,samples:samples.length,p50Ms:at(samples,.5),p95Ms:at(samples,.95),p99Ms:at(samples,.99),maxMs:samples.at(-1),traceP99:at(queries,.99),traceMax:queries.at(-1)};
}
const cases=[];for(const count of [0,4,32,64]){const a=measure(oldRuntime.createGrenadeRuntime,oldProfile.CS2_GRENADE_PROFILE,count),b=measure(createGrenadeRuntime,CS2_GRENADE_PROFILE,count),c=measure(oldRuntime.createGrenadeRuntime,oldProfile.CS2_GRENADE_PROFILE,count),delta=b.p99Ms-(a.p99Ms+c.p99Ms)/2;cases.push({count,before:a,current:b,after:c,p99IncrementMs:delta});console.log(JSON.stringify(cases.at(-1)));}
const after=await fingerprints();assert.deepEqual(before,after);for(const c of cases){if(c.count===4)assert.ok(c.p99IncrementMs<=.3,'Typical four-projectile CPU budget exceeded');if(c.count===32)assert.ok(c.p99IncrementMs<=1,'Thirty-two projectile CPU budget exceeded');}
const report={status:'completed',createdAt:new Date().toISOString(),scope:'Real map CPU-only replay with ten stationary synthetic bodies and 640 measured continuing-tick samples per case. No browser/GPU or physical LAN claim.',baselineManifest:manifest,worldContract:world.contract,sourceHashesBefore:before,sourceHashesAfter:after,sourcesStable:true,cases};await mkdir(output,{recursive:true});await writeFile(path.join(output,'flight-cpu-benchmark.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,sourcesStable:true}));
