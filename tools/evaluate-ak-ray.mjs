// Offline comparison against explicitly saved pre-ray-change firing modules.
// Same recoil samples and random draws, perpendicular planes at 10/20/30m.
import assert from 'node:assert/strict';import * as THREE from 'three';
import {readFile,writeFile,mkdir,mkdtemp,readdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
import {Game} from '../game.mjs';import {GUNS} from '../public/arsenal.js';import {blankInput,supportHeight} from '../public/shared.js';import {sourcePlayerSpread} from '../public/source-spread.js';
const arg=process.argv.indexOf('--baseline-dir');assert.ok(arg>=0&&process.argv[arg+1],'Provide --baseline-dir containing saved firing modules');
const baseline=path.resolve(process.argv[arg+1]),root=fileURLToPath(new URL('..',import.meta.url)),temp=await mkdtemp(path.join(tmpdir(),'cscs-ak-ray-before-')),hash=x=>createHash('sha256').update(x).digest('hex');
const report={scope:'Current Game versus saved pre-ray-change Game/weapons/gun-state on the same unchanged BSP and common modules. Matched samples; synthetic analytic wall planes, not retail-client measurements, GPU FPS or LAN certification.',weapons:[],rays:[],distances:[]};
function rng(seed){let a=seed>>>0;return ()=>{a=(a+0x6d2b79f5)>>>0;let x=Math.imul(a^(a>>>15),a|1);x^=x+Math.imul(x^(x>>>7),x|61);return ((x^(x>>>14))>>>0)/4294967296;};}
function bounds(rows){return {minX:Math.min(...rows.map(r=>r.x)),maxX:Math.max(...rows.map(r=>r.x)),minY:Math.min(...rows.map(r=>r.y)),maxY:Math.max(...rows.map(r=>r.y))};}
try{
 await mkdir(path.join(temp,'public'));await writeFile(path.join(temp,'package.json'),'{"type":"module"}');
 for(const name of await readdir(root))if(name.endsWith('.mjs')&&name!=='game.mjs')await symlink(path.join(root,name),path.join(temp,name));
 for(const name of await readdir(path.join(root,'public')))if(!['weapons.js','gun-state.js'].includes(name))await symlink(path.join(root,'public',name),path.join(temp,'public',name));
 report.baseline={};for(const [from,to]of [['game.mjs','game.mjs'],['public_weapons.js','public/weapons.js'],['public_gun-state.js','public/gun-state.js']]){const data=await readFile(path.join(baseline,from));report.baseline[from]=hash(data);await writeFile(path.join(temp,to),data);}
 assert.notEqual(report.baseline['public_weapons.js'],hash(await readFile(path.join(root,'public/weapons.js'))));
 assert.equal(hash(await readFile(path.join(baseline,'public_source-spread.js'))),hash(await readFile(path.join(root,'public/source-spread.js'))),'sampling kernel must not change in the ray-only comparison');
 const {Game:Before}=await import(pathToFileURL(path.join(temp,'game.mjs')).href);
 function trace(C,id,seed=12345){
  const w=GUNS[id],g=new C({random:rng(seed),audioRandom:()=>.5}),p=g.add('p','P',w.teams[0]),q=g.add('q','Q',w.teams[0]==='T'?'CT':'T');g.begin();g.phase='live';g.time=10;g.endAt=1000;if(p.weapon!==id)g.buy(p.id,id);q.alive=false;
  Object.assign(p,{x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),vx:0,vy:0,vz:0,grounded:true,yaw:0,pitch:0,nextAttackAt:0,nextShotAt:0,lastShot:-100,zoom:w.zoom?40:90,recoilSeed:(123456^seed)>>>0});if(['famas','glock18'].includes(id))p.burstMode=true;
  const rays=[],seen=new Set(),shoot=g.shoot.bind(g),target=g.targetRay.bind(g);let firing=null;
  g.shoot=(p,follow)=>{const original=g.random,draws=[];firing={rawYaw:p.yaw,rawPitch:p.pitch,punchYaw:p.recoilYaw||0,punchPitch:p.recoilPitch||0};g.random=()=>{const r=original();draws.push(r);return r;};firing.draws=draws;try{return shoot(p,follow);}finally{g.random=original;firing=null;}};
  g.targetRay=(p,d,...rest)=>{if(!seen.has(p.shotsFired)){seen.add(p.shotsFired);rays.push({ordinal:p.shotsFired,d:{...d},spread:p.spread,...(id==='ak47'?{...firing,draws:[...firing.draws],seed:Math.floor(firing.draws[0]*0x100000000)>>>0}:{})});}return target(p,d,...rest);};
  const rows=[];for(let seq=1;seq<=240;seq++){g.events=[];g.inputBatch(p.id,[{seq,round:g.round,...blankInput(),yaw:0,pitch:0,fire:w.automatic||p.burstMode?seq<190:seq%100===1}]);g.step();rows.push({state:['ammo','reserve','shotsFired','burstCount','burstRemaining','accuracy','lastShot','nextShotAt','nextAttackAt','recoilYaw','recoilPitch','recoilDirection','reloadAt','x','y','z','vx','vy','vz'].map(k=>p[k]??null),events:g.events.filter(e=>e.type==='shot').map(({from,to,spread,recoilYaw,recoilPitch,burst})=>({from,to,spread,recoilYaw,recoilPitch,burst}))});}return {rows,rays};
 }
 for(const id of Object.keys(GUNS)){const before=trace(Before,id),after=trace(Game,id);assert.deepEqual(after.rows.map(r=>r.state),before.rows.map(r=>r.state),id+' changed recoil/cadence/ammo/movement');if(id!=='ak47')assert.deepEqual(after,before,id+' ray changed');report.weapons.push({id,steps:after.rows.length,stateIdentical:true,raysIdentical:id!=='ak47'});}
 let maxMatrixError=0;const oldPoints=[],newPoints=[];
 for(let magazine=0;magazine<32;magazine++){
  const seed=12345+magazine*997,before=trace(Before,'ak47',seed),after=trace(Game,'ak47',seed);assert.equal(after.rays.length,30);assert.deepEqual(after.rows.map(r=>r.state),before.rows.map(r=>r.state));
  for(let i=0;i<30;i++){
   const a=before.rays[i],b=after.rays[i];for(const key of ['rawYaw','rawPitch','punchYaw','punchPitch','spread','seed','draws'])assert.deepEqual(b[key],a[key]);assert.equal(b.draws.length,4);
   const offset=sourcePlayerSpread(b.seed),expected=new THREE.Vector3(offset.x*b.spread,offset.y*b.spread,-1).applyEuler(new THREE.Euler(b.rawPitch+2*b.punchPitch,b.rawYaw+2*b.punchYaw,0,'YXZ')).normalize();const error=Math.max(...['x','y','z'].map(k=>Math.abs(expected[k]-b.d[k])));assert.ok(error<1e-10);maxMatrixError=Math.max(maxMatrixError,error);
   assert.ok(a.d.z<0&&b.d.z<0);oldPoints.push({x:a.d.x/-a.d.z,y:a.d.y/-a.d.z});newPoints.push({x:b.d.x/-b.d.z,y:b.d.y/-b.d.z});report.rays.push({magazine,...b});
  }
 }
 report.distances=[10,20,30].map(distance=>({distance,samples:newPoints.length,before:bounds(oldPoints.map(p=>({x:p.x*distance,y:p.y*distance}))),after:bounds(newPoints.map(p=>({x:p.x*distance,y:p.y*distance})))}));
 report.referenceMatrix={samples:report.rays.length,maxError:maxMatrixError};report.status='passed';
}finally{await rm(temp,{recursive:true,force:true});await mkdir(path.join(root,'artifacts'),{recursive:true});await writeFile(path.join(root,'artifacts/ak-ray-evaluation.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({status:report.status,weapons:report.weapons.length,gunSteps:report.weapons.reduce((n,w)=>n+w.steps,0),unchangedRays:report.weapons.filter(w=>w.raysIdentical).length,referenceMatrix:report.referenceMatrix,distances:report.distances},null,2));
