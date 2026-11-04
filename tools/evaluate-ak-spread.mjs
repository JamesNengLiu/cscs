// Requires explicitly saved pre-change modules; never substitutes current code
// for a missing baseline. All tests are offline, without a listening service.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,readdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Game} from '../game.mjs';import {GUNS} from '../public/arsenal.js';import {blankInput,supportHeight} from '../public/shared.js';
import {sourcePlayerSpread} from '../public/source-spread.js';
const at=process.argv.indexOf('--baseline-dir');assert.ok(at>=0&&process.argv[at+1],'Provide --baseline-dir with saved game.mjs, public_weapons.js and public_gun-state.js');
const baseline=path.resolve(process.argv[at+1]),root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(path.join(tmpdir(),'cscs-ak-before-'));
const digest=x=>createHash('sha256').update(x).digest('hex');
const report={scope:'Saved firing modules and Game versus current Game on the same BSP. Source spread is independently covered across all 256 seeds. Not a retail-client recording, browser FPS or physical LAN claim.',weapons:[],patterns:{},distribution:{}};
function rng(seed){let a=seed>>>0;return ()=>{a=(a+0x6d2b79f5)>>>0;let x=Math.imul(a^(a>>>15),a|1);x^=x+Math.imul(x^(x>>>7),x|61);return ((x^(x>>>14))>>>0)/4294967296;};}
try{
 await mkdir(path.join(temporary,'public'));await writeFile(path.join(temporary,'package.json'),'{"type":"module"}');
 for(const name of await readdir(root))if(name.endsWith('.mjs')&&name!=='game.mjs')await symlink(path.join(root,name),path.join(temporary,name));
 for(const name of await readdir(path.join(root,'public')))if(!['weapons.js','gun-state.js'].includes(name))await symlink(path.join(root,'public',name),path.join(temporary,'public',name));
 const saved={};for(const [source,destination] of [['game.mjs','game.mjs'],['public_weapons.js','public/weapons.js'],['public_gun-state.js','public/gun-state.js']]){const body=await readFile(path.join(baseline,source));await writeFile(path.join(temporary,destination),body);saved[source]=digest(body);}
 assert.notEqual(saved['public_weapons.js'],digest(await readFile(path.join(root,'public/weapons.js'))),'baseline must predate the sampling fix');
 const {Game:Before}=await import(pathToFileURL(path.join(temporary,'game.mjs')).href);report.baseline=saved;
 function trace(C,id,seed=12345){
  const w=GUNS[id],g=new C({random:rng(seed),audioRandom:()=>.5}),p=g.add('p','P',w.teams[0]),q=g.add('q','Q',w.teams[0]==='T'?'CT':'T');g.begin();g.phase='live';g.time=10;g.endAt=1000;
  if(p.weapon!==id)g.buy(p.id,id);q.alive=false;Object.assign(p,{x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),vx:0,vy:0,vz:0,grounded:true,yaw:0,pitch:0,nextAttackAt:0,nextShotAt:0,lastShot:-100,zoom:w.zoom?40:90,recoilSeed:123456});
  if(['famas','glock18'].includes(id))p.burstMode=true;
  const directions=[],seen=new Set(),target=g.targetRay.bind(g);g.targetRay=(p,d,...rest)=>{if(!seen.has(p.shotsFired)){seen.add(p.shotsFired);directions.push({ordinal:p.shotsFired,d:{...d},x:20*d.x/-d.z,y:20*d.y/-d.z});}return target(p,d,...rest);};
  const rows=[];for(let seq=1;seq<=240;seq++){g.events=[];g.inputBatch(p.id,[{seq,round:g.round,...blankInput(),yaw:0,pitch:0,fire:w.automatic||p.burstMode?seq<190:seq%100===1}]);g.step();rows.push({state:['ammo','reserve','shotsFired','burstCount','burstRemaining','accuracy','lastShot','nextShotAt','nextAttackAt','recoilYaw','recoilPitch','recoilDirection','reloadAt','x','y','z','vx','vy','vz'].map(k=>p[k]??null),shots:g.events.filter(e=>e.type==='shot').map(({from,to,spread,recoilYaw,recoilPitch,burst})=>({from,to,spread,recoilYaw,recoilPitch,burst}))});}
  return {rows,directions};
 }
 for(const id of Object.keys(GUNS)){
  const before=trace(Before,id),after=trace(Game,id);assert.deepEqual(after.rows.map(r=>r.state),before.rows.map(r=>r.state),id+' state changed');
  if(id==='ak47'){assert.equal(before.directions.length,30);assert.equal(after.directions.length,30);assert.notDeepEqual(after.directions,before.directions);report.patterns={distanceMetres:20,before:before.directions,after:after.directions};}
  else assert.deepEqual(after,before,id+' non-AK ray changed');
  report.weapons.push({id,steps:after.rows.length,stateIdentical:true,raysIdentical:id!=='ak47',stateSHA256:digest(JSON.stringify(after.rows.map(r=>r.state)))});
 }
 const source=Array.from({length:256},(_,seed)=>sourcePlayerSpread(seed)),random=rng(987654),independent=Array.from({length:200000},()=>({x:random()+random()-1,y:random()+random()-1}));
 function stats(rows){const mean={x:0,y:0};for(const p of rows){mean.x+=p.x/rows.length;mean.y+=p.y/rows.length;}let xx=0,yy=0,xy=0,r2=0,outside=0;for(const p of rows){xx+=(p.x-mean.x)**2/rows.length;yy+=(p.y-mean.y)**2/rows.length;xy+=(p.x-mean.x)*(p.y-mean.y)/rows.length;r2+=(p.x*p.x+p.y*p.y)/rows.length;if(p.x*p.x+p.y*p.y>1)outside++;}return {samples:rows.length,mean,std:{x:Math.sqrt(xx),y:Math.sqrt(yy)},correlation:xy/Math.sqrt(xx*yy),rmsRadius:Math.sqrt(r2),outsideUnitDisk:outside/rows.length};}
 report.distribution={before:stats(independent),reference:stats(source),source};report.distribution.rmsRatio=report.distribution.reference.rmsRadius/report.distribution.before.rmsRadius;
 report.status='passed';
}finally{await rm(temporary,{recursive:true,force:true});await mkdir(path.join(root,'artifacts'),{recursive:true});await writeFile(path.join(root,'artifacts/ak-spread-evaluation.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({status:report.status,weapons:report.weapons.length,steps:report.weapons.reduce((n,r)=>n+r.steps,0),unchangedRays:report.weapons.filter(r=>r.raysIdentical).length,distribution:report.distribution},(_,v)=>Array.isArray(v)&&v.length>100?`${v.length} rows in receipt`:v,2));
