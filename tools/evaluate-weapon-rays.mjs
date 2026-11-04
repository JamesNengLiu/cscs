// All-gun rollout versus an explicitly saved, user-accepted AK checkpoint.
// Actual offline Game shots, matched inputs and recoil streams; no live room.
import assert from 'node:assert/strict';import * as THREE from 'three';
import {readFile,writeFile,mkdir,mkdtemp,readdir,symlink,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
import {Game} from '../game.mjs';import {GUNS} from '../public/arsenal.js';import {blankInput,supportHeight} from '../public/shared.js';import {sourcePlayerSpread} from '../public/source-spread.js';
import {createShotFeedback} from '../public/shot-feedback.js';
const arg=process.argv.indexOf('--baseline-dir');assert.ok(arg>=0&&process.argv[arg+1],'Provide saved Game, weapons, gun-state and source-spread modules with --baseline-dir');
const baseline=path.resolve(process.argv[arg+1]),root=fileURLToPath(new URL('..',import.meta.url)),temp=await mkdtemp(path.join(tmpdir(),'cscs-weapon-rays-before-')),hash=x=>createHash('sha256').update(x).digest('hex');
const report={scope:'Saved accepted AK checkpoint versus current actual Game. All magazines, server-owned spread randomness, fixed recoil streams. Independent space/matrix checks; not a retail recording, GPU benchmark or physical LAN test.',weapons:[],rays:[],distances:[]};
function rng(seed){let a=seed>>>0;return ()=>{a=(a+0x6d2b79f5)>>>0;let x=Math.imul(a^(a>>>15),a|1);x^=x+Math.imul(x^(x>>>7),x|61);return ((x^(x>>>14))>>>0)/4294967296;};}
const bounds=points=>({minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))});
try{
 await mkdir(path.join(temp,'public'));await writeFile(path.join(temp,'package.json'),'{"type":"module"}');
 for(const name of await readdir(root))if(name.endsWith('.mjs')&&name!=='game.mjs')await symlink(path.join(root,name),path.join(temp,name));
 for(const name of await readdir(path.join(root,'public')))if(!['weapons.js','gun-state.js','shot-feedback.js'].includes(name))await symlink(path.join(root,'public',name),path.join(temp,'public',name));
 report.baseline={};for(const [from,to]of [['game.mjs','game.mjs'],['public_weapons.js','public/weapons.js'],['public_gun-state.js','public/gun-state.js'],['public_shot-feedback.js','public/shot-feedback.js']]){const data=await readFile(path.join(baseline,from));report.baseline[from]=hash(data);await writeFile(path.join(temp,to),data);}
 const savedKernel=await readFile(path.join(baseline,'public_source-spread.js'),'utf8'),currentKernel=await readFile(path.join(root,'public/source-spread.js'),'utf8');
 assert.equal(savedKernel.slice(savedKernel.indexOf('const SEEDS')),currentKernel.slice(currentKernel.indexOf('const SEEDS')),'accepted AK random kernel changed');
 const {Game:Before}=await import(pathToFileURL(path.join(temp,'game.mjs')).href);
 const {createShotFeedback:createBeforeFeedback}=await import(pathToFileURL(path.join(temp,'public/shot-feedback.js')).href);let predictionSteps=0;
 function trace(C,weapon,mode,prediction=false){
  const w=GUNS[weapon],g=new C({random:rng(12345),audioRandom:()=>.5}),p=g.add('p','Magazine',w.teams[0]);g.begin();g.phase='live';g.time=10;g.endAt=1000;p.money=16000;if(p.weapon!==weapon)g.buy(p.id,weapon);
  Object.assign(p,{x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),vx:0,vy:0,vz:0,grounded:true,yaw:0,pitch:0,nextAttackAt:0,nextShotAt:0,lastShot:-100,recoilSeed:123456,zoom:w.zoom?40:90,burstMode:mode&&w.modes?.includes('burst'),silenced:mode&&w.modes?.includes('silenced'),reserve:0});for(const key of Object.keys(p.ammoPool))p.ammoPool[key]=0;
  const rows=[],rays=[],shoot=g.shoot.bind(g),target=g.targetRay.bind(g);let firing=null;
  const feedback=prediction?[createBeforeFeedback(),createShotFeedback()]:[],snapshots=[];let auth={player:{...p},time:g.time};
  for(const f of feedback)f.observe(auth.player,{round:g.round,stateTime:auth.time,nowMs:0});
  g.shoot=(player,follow)=>{const random=g.random;firing={weapon,mode,follow:!!follow,rawYaw:player.yaw,rawPitch:player.pitch,punchYaw:player.recoilYaw||0,punchPitch:player.recoilPitch||0,draws:[],cursor:0,pellet:0};g.random=()=>{const r=random();firing.draws.push(r);return r;};try{return shoot(player,follow);}finally{g.random=random;firing=null;}};
  g.targetRay=(player,d,...rest)=>{if(firing&&!rest[3]){const draws=firing.draws.slice(firing.cursor);firing.cursor=firing.draws.length;rays.push({weapon,mode,follow:firing.follow,ordinal:player.shotsFired,pellet:firing.pellet++,rawYaw:firing.rawYaw,rawPitch:firing.rawPitch,punchYaw:firing.punchYaw,punchPitch:firing.punchPitch,spread:player.spread,draws,seed:Math.floor(draws[0]*0x100000000)>>>0,d:{...d}});}return target(player,d,...rest);};
  for(let seq=1;seq<=960;seq++){
   g.events=[];const command={seq,round:g.round,...blankInput(),yaw:0,pitch:0,crouch:mode,fire:w.automatic||p.burstMode?true:seq%8<4};g.inputBatch(p.id,[command]);g.step();rows.push(['ammo','reserve','shotsFired','burstCount','burstRemaining','accuracy','lastShot','nextShotAt','nextAttackAt','recoilYaw','recoilPitch','recoilDirection','reloadAt','x','y','z','vx','vy','vz'].map(k=>p[k]??null));
   if(prediction){
    snapshots.push({player:{...p,input:{...p.input}},time:g.time});const nowMs=seq*1000/60;
    if(seq>7&&seq%2===0){auth=snapshots[seq-8];const results=feedback.map(f=>f.observe(auth.player,{round:g.round,stateTime:auth.time,nowMs}));assert.deepEqual(results[0],results[1],weapon+' delayed authority presentation changed');}
    const results=feedback.map(f=>f.sample({player:auth.player,pose:p,input:command,seq,round:g.round,time:g.time,stateTime:auth.time,fixedStep:true,nowMs,allowed:true}));assert.deepEqual(results[0],results[1],weapon+' predicted shot changed');assert.deepEqual(feedback[0].view(),feedback[1].view(),weapon+' predicted recoil/ammo changed');assert.deepEqual(feedback[0].diagnostics(),feedback[1].diagnostics());predictionSteps++;
   }
  }
  assert.equal(p.ammo,0,weapon+' magazine incomplete');assert.equal(p.shotsFired,w.clip);assert.equal(rays.length,w.clip*w.pellets);return {rows,rays};
 }
 let maxMatrixError=0;
 for(const weapon of Object.keys(GUNS))for(const mode of [false,true]){
  const before=trace(Before,weapon,mode),after=trace(Game,weapon,mode,true);assert.deepEqual(after.rows,before.rows,weapon+' changed recoil/cadence/ammo/movement');
  if(weapon==='ak47')assert.deepEqual(after,before,'accepted AK trajectory changed');
  for(const ray of after.rays){
   let offset;if(GUNS[weapon].pellets>1){assert.equal(ray.draws.length%4,0);const d=ray.draws.slice(-4);offset={x:d[0]+d[1]-1,y:d[2]+d[3]-1};assert.ok(offset.x**2+offset.y**2<=1);}
   else{assert.equal(ray.draws.length,4);offset=sourcePlayerSpread(ray.seed);}
   const expected=new THREE.Vector3(offset.x*ray.spread,offset.y*ray.spread,-1).applyEuler(new THREE.Euler(ray.rawPitch+2*ray.punchPitch,ray.rawYaw+2*ray.punchYaw,0,'YXZ')).normalize();const error=Math.max(...['x','y','z'].map(k=>Math.abs(expected[k]-ray.d[k])));assert.ok(error<1e-10);maxMatrixError=Math.max(maxMatrixError,error);
  }
  report.weapons.push({weapon,mode,steps:after.rows.length,shots:GUNS[weapon].clip,pellets:after.rays.length,stateIdentical:true,acceptedAKIdentical:weapon==='ak47'});report.rays.push(...after.rays);
  const project=rows=>rows.filter(r=>r.d.z<-.01).map(r=>({x:r.d.x/-r.d.z,y:r.d.y/-r.d.z}));const a=project(before.rays),b=project(after.rays);
  for(const distance of [10,20,30])report.distances.push({weapon,mode,distance,samples:b.length,before:bounds(a.map(p=>({x:p.x*distance,y:p.y*distance}))),after:bounds(b.map(p=>({x:p.x*distance,y:p.y*distance})))});
 }
 report.referenceMatrix={samples:report.rays.length,maxError:maxMatrixError};report.prediction={steps:predictionSteps,delayedSnapshotsMs:7*1000/60,identical:true};report.status='passed';
}finally{await rm(temp,{recursive:true,force:true});await mkdir(path.join(root,'artifacts'),{recursive:true});await writeFile(path.join(root,'artifacts/weapon-ray-evaluation.json'),JSON.stringify(report));}
console.log(JSON.stringify({status:report.status,weaponModes:report.weapons.length,gunSteps:report.weapons.reduce((n,w)=>n+w.steps,0),shots:report.weapons.reduce((n,w)=>n+w.shots,0),pellets:report.rays.length,acceptedAKIdentical:report.weapons.filter(w=>w.acceptedAKIdentical).length,referenceMatrix:report.referenceMatrix,prediction:report.prediction},null,2));
