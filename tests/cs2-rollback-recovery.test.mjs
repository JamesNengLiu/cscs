import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadExperimentalWorld} from '../cs2-server.mjs';
import {createCS2Game} from '../cs2-game.mjs';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {createPresentationClock} from '../public/cs2-presentation-clock.js';
import {createTerrainCameraResponse,CS2_TERRAIN_CAMERA} from '../public/cs2-terrain-camera.js';

const world=await loadExperimentalWorld({movementProfile:CS2_MOVEMENT_PROFILE});
const m=world.movement,c=world.collision,rules=m.rules;
const continuity=(await readFile(new URL('../public/cs2-network-continuity.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'').replace(/\bexport /g,'');
const limit=new Function('RULES','trace','collides','maxMoveSpeed',continuity+'\nreturn predictionCorrectionLimit;')(rules,c.trace,c.collides,m.maxMoveSpeed);
const cameraSource=(await readFile(new URL('../public/cs2-player-camera.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'').replace('export function createPlayerCamera','function createPlayerCamera');
const predictionSource=await readFile(new URL('../public/cs2-prediction.js',import.meta.url),'utf8');
const correctionSource=predictionSource.slice(predictionSource.indexOf('export function visualCorrection')).replace(/\bexport /g,'');
const {visualCorrection,decayCorrection}=new Function(correctionSource+'\nreturn {visualCorrection,decayCorrection};')();
const game=createCS2Game(world,{weaponProfile:'cs2',random:()=>.5});game.add('recovery','Recovery','T','terror');game.begin();game.phase='live';game.endAt=1000;game.equip('recovery','knife');
const template=structuredClone(game.players.get('recovery'));
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<=(typeof e==='number'?e:1e-8),typeof e==='string'?e:a+' != '+b);
const length=p=>Math.hypot(p.x,p.y,p.z);
const authority=(extra={})=>({...template,...extra});
const player=(extra={})=>({...template,x:10,y:2,z:0,vx:6.35,vy:0,vz:0,...extra});
const clear=(a,b)=>({fraction:1,startSolid:false,end:{...b}});
function factory({trace=clear,movement=(p,input,dt)=>{p.x+=(p.vx||0)*dt;}}={}){
 return new Function('RULES','eyeHeight','movePlayer','maxMoveSpeed','trace','createPresentationClock','createTerrainCameraResponse','CS2_TERRAIN_CAMERA',cameraSource+'\nreturn createPlayerCamera;')(rules,m.eyeHeight,movement,m.maxMoveSpeed,trace,createPresentationClock,createTerrainCameraResponse,CS2_TERRAIN_CAMERA);
}
function context(extra={}){return{previousAuthority:authority(),authority:authority(),intervalSeconds:1/30,...extra};}

test('only evidenced short interruptions authorise a bounded larger same-life correction',()=>{
 for(const [gap,distance] of [[.45,1.9],[.65,3.25],[1,5.55],[1.033333333,6.3]]){
  const before=player(),after=player({x:10-distance}),allowed=limit(before,after,context({intervalSeconds:gap}));
  assert.ok(allowed>=distance&&allowed<=8);near(length(visualCorrection(before,after,undefined,{maxDistance:allowed})),distance);
 }
 const before=player(),after=player({x:6.8});
 near(limit(before,after,context()),.5);
 near(limit(before,after,context({intervalSeconds:.075})),.5);
 assert.ok(limit(before,after,context({authority:authority({skippedInputCommands:40})}))>=3.2);
 near(limit(before,after,context({intervalSeconds:1.10001})),.5);
 assert.ok(limit(before,after,context({intervalSeconds:1.1}))<=8);
});

test('ordinary states cannot discard an already authorised three-metre recovery offset',()=>{
 let before=player(),after=player({x:6.8}),offset=visualCorrection(before,after,undefined,{maxDistance:limit(before,after,context({intervalSeconds:.65}))});
 near(offset.x,3.2);
 let active=true,elapsed=0,largestDecay=0;
 for(let frame=0;frame<180;frame++){
  // Repeated fresh snapshots contain small normal prediction discrepancies.
  if(frame%3===0){
   before=after;after={...after,x:after.x-(frame<30?.001:0)};
   const allowed=limit(before,after,context({activeRecovery:active,correction:offset}));
   const next=visualCorrection(before,after,offset,{maxDistance:allowed});
   assert.ok(length(next)>.000001||length(offset)<.000001,'fresh small states must not truncate a large existing offset');
   offset=next;assert.ok(allowed<=8);
  }
  const previous=length(offset);offset=decayCorrection(offset,1/75,{maxSpeed:5.715});largestDecay=Math.max(largestDecay,previous-length(offset));elapsed+=1/75;
  if(length(offset)<.001)active=false;
 }
 assert.ok(largestDecay<=5.715/75+1e-12,'existing bounded recovery speed is retained');
 assert.ok(length(offset)<1e-7,'recovery converges without a permanent camera lag');
 assert.ok(elapsed>2);
});

test('the eight-metre cap settles at the existing stationary recovery speed without truncating its tail',()=>{
 let before=player({vx:0}),after=player({x:2,vx:0}),offset=visualCorrection(before,after,undefined,{maxDistance:limit(before,after,context({intervalSeconds:1}))});
 near(offset.x,8);
 let active=true,settledAt=null,largestDecay=0;
 for(let frame=1;frame<=600;frame++){
  // The actual client renders/decays between coalesced state applications.
  // Later states retain the old offset and add only tiny ordinary errors.
  const previous=length(offset);offset=decayCorrection(offset,1/75,{maxSpeed:2.5});largestDecay=Math.max(largestDecay,previous-length(offset));
  if(frame%3===0){
   before=after;after={...after,x:after.x-(frame<=75?.002:0)};
   const allowed=limit(before,after,context({activeRecovery:active,correction:offset})),next=visualCorrection(before,after,offset,{maxDistance:allowed});
   if(length(offset)>.001)assert.ok(length(next)>.001,'the old two-metre limit must not discard a large stationary recovery');
   offset=next;assert.ok(allowed<=8);
  }
  if(length(offset)<.001){active=false;settledAt??=frame/75;}
 }
 assert.ok(largestDecay<=2.5/75+1e-12);
 assert.ok(settledAt>3&&settledAt<5,'the bounded stationary recovery must finish in a finite few seconds');
 assert.ok(length(offset)<1e-12,'no permanent residual is retained');
});

test('a second evidenced gap or skipped prefix preserves the already authorised recovery offset',()=>{
 const before=player(),after=player({x:9}),offset={x:3.2,y:0,z:0};
 for(const evidence of [{intervalSeconds:.2},{authority:authority({skippedInputCommands:20})}]){
  const options=context({...evidence,activeRecovery:true,correction:offset});
  const ownBudget=limit(before,after,{...options,activeRecovery:false,correction:undefined});
  assert.ok(ownBudget>=1&&ownBudget<4.2,'evidence independently supports this new one-metre error');
  const allowed=limit(before,after,options),next=visualCorrection(before,after,offset,{maxDistance:allowed});
  near(next.x,4.2);assert.ok(allowed<=8);
 }
 // An ordinary small offset is valid even before active recovery is enabled.
 const small={x:.2,y:0,z:0},boundaryBudget=limit(before,after,context({intervalSeconds:.2})),boundaryAfter=player({x:10-boundaryBudget});
 const allowed=limit(before,boundaryAfter,context({intervalSeconds:.2,correction:small}));
 near(visualCorrection(before,boundaryAfter,small,{maxDistance:allowed}).x,.2+boundaryBudget);
});

test('compound recovery cannot justify a new error without its own evidence or exceed the absolute cap',()=>{
 const before=player(),after=player({x:9}),offset={x:3.2,y:0,z:0};
 for(const evidence of [{},{intervalSeconds:.1},{intervalSeconds:1.2},{intervalSeconds:.2,authority:authority({teleport:true})},{intervalSeconds:.2,authority:authority({lifeId:2})}]){
  const allowed=limit(before,after,context({...evidence,activeRecovery:true,correction:offset}));
  assert.deepEqual(visualCorrection(before,after,offset,{maxDistance:allowed}),{x:0,y:0,z:0});
 }
 const oversized={x:7.8,y:0,z:0},allowed=limit(before,after,context({intervalSeconds:.2,activeRecovery:true,correction:oversized}));
 near(allowed,8);assert.deepEqual(visualCorrection(before,after,oversized,{maxDistance:allowed}),{x:0,y:0,z:0});
 // A stale large vector without the active-recovery marker is not authorised.
 assert.deepEqual(visualCorrection(before,after,offset,{maxDistance:limit(before,after,context({intervalSeconds:.2,correction:offset}))}),{x:0,y:0,z:0});
});

test('life boundaries, explicit discontinuities and non-short gaps keep the hard reset policy',()=>{
 const patches=[{team:'CT'},{alive:false},{playedRound:template.playedRound+1},{recoilSeed:999},{teleport:true},{discontinuity:true},{teleportId:1},{teleportSeq:1},{spawnId:1},{spawnSeq:1},{lifeId:1}];
 for(const patch of patches)near(limit(player(),player({x:6.8}),context({authority:authority({...patch,skippedInputCommands:60}),intervalSeconds:.65,activeRecovery:true,correction:{x:3.2,y:0,z:0}})),.5);
 // Changing lifeId is still a boundary when a separate spawnId also exists.
 near(limit(player(),player({x:6.8}),context({previousAuthority:authority({spawnId:7,lifeId:1}),authority:authority({spawnId:7,lifeId:2}),intervalSeconds:.65})),.5);
 near(limit(player(),player({x:6.8}),context({intervalSeconds:2,activeRecovery:true,correction:{x:3.2,y:0,z:0}})),.5);
 near(limit(player(),player({x:7}),context({activeRecovery:true,correction:{x:3.2,y:0,z:0}})),.5,'a new unexplained large error does not inherit recovery permission');
 near(limit(player(),player({id:'other',x:9.9}),context({intervalSeconds:.65})),.5);
 near(limit(player(),player({x:9.9}),context({activeRecovery:true,correction:{x:NaN,y:0,z:0}})),.5);
});

for(const mode of ['baseline','responsive'])test(mode+' rebase preserves the completed-step camera phase during authorised recovery',()=>{
 const camera=factory()({mode,stablePresentation:true,terrainSmoothing:true}),p=player({x:0,vx:6.35});camera.reset(p);
 let accumulator=0,last=0;
 for(let frame=1;frame<=150;frame++){
  const now=frame/75,dt=now-last;last=now;accumulator+=dt;
  while(accumulator>=1/60-1e-10){p.x+=6.35/60;camera.push(p,{f:1,yaw:-Math.PI/2},[]);accumulator=Math.max(0,accumulator-1/60);}
  camera.update(p,{fractionSeconds:accumulator,dt,frameTimeMs:1000+now*1000});
 }
 const shown={...camera.position},saved=structuredClone(p),after={...p,x:p.x-3.2},offset=visualCorrection(p,after),options={fractionSeconds:accumulator,dt:0,frameTimeMs:1000+last*1000,correction:{x:3.2,y:0,z:0}};
 assert.deepEqual(offset,{x:0,y:0,z:0},'unapproved correction still hard resets by default');
 const resets=camera.diagnostics().presentationClock.resets;
 camera.rebase(p,after,{maxDistance:5.3});camera.update(after,options);
 for(const k of ['x','y','z'])near(camera.position[k],shown[k]);
 assert.deepEqual(p,saved,'camera rebase never changes simulation data');
 if(mode==='baseline')assert.equal(camera.diagnostics().presentationClock.resets,resets,'approved recovery must not erase interpolation history');
 camera.rebase(after,{...after,x:after.x+4});camera.update({...after,x:after.x+4},{fractionSeconds:0});
 near(camera.position.x,after.x+4,'unauthorised changes still reset');
});

test('real PHYS recovery keeps the original wall-point clipping during a large crouched offset',()=>{
 const create=factory({trace:c.trace,movement:m.movePlayer});
 const supported=(x,z)=>{
  const hit=c.findSupport(x,z,.8,{height:rules.crouchHeight,radius:rules.radius});assert.ok(hit);
  const p=player({...hit.end,x,z,vx:0,vy:0,vz:0,crouch:true,duckAmount:1,ducking:false,duckElapsed:1});
  assert.equal(c.collides(p.x,p.z,rules.radius,p.y,m.bodyHeight(p)),false);return p;
 };
 const before=supported(-4.9,16.51),after=supported(3.048,16.51),camera=create({mode:'baseline',stablePresentation:true,terrainSmoothing:true});
 camera.reset(before);camera.update(before,{fractionSeconds:0,frameTimeMs:1000});
 const offset={x:before.x-after.x,y:before.y-after.y,z:before.z-after.z};assert.ok(length(offset)<8);
 const origin={x:after.x,y:after.y+m.eyeHeight(after),z:after.z},target={x:before.x,y:before.y+m.eyeHeight(before),z:before.z},hit=c.trace(origin,target);
 assert.equal(hit.startSolid,false);assert.ok(hit.fraction<1,'the actual car must obstruct the intended old eye position');
 const saved=structuredClone(after);camera.rebase(before,after,{maxDistance:8});camera.update(after,{fractionSeconds:0,frameTimeMs:1000,correction:offset});
 assert.ok(camera.diagnostics().pointClamps>0);
 for(const k of ['x','y','z'])near(camera.position[k],hit.end[k],1e-6);
 assert.deepEqual(after,saved);
});

test('real PHYS slope recovery retains terrain/stance safety and settles to the original eye',()=>{
 const before={...template,vx:0,vy:0,vz:0},support=c.findSupport(before.x,before.z-3.2,before.y+.2,{height:rules.bodyHeight,radius:rules.radius});assert.ok(support);
 const after={...before,...support.end},create=factory({trace:c.trace,movement:m.movePlayer}),camera=create({mode:'baseline',stablePresentation:true,terrainSmoothing:true});
 assert.equal(c.collides(after.x,after.z,rules.radius,after.y,m.bodyHeight(after)),false);
 camera.reset(before);camera.update(before,{fractionSeconds:0,frameTimeMs:1000});
 let offset={x:before.x-after.x,y:before.y-after.y,z:before.z-after.z};camera.rebase(before,after,{maxDistance:5.3});
 const saved=structuredClone(after);
 for(let frame=0;frame<180;frame++){
  camera.update(after,{fractionSeconds:0,dt:1/75,frameTimeMs:1000+frame*1000/75,correction:offset});
  assert.ok(Object.values(camera.position).every(Number.isFinite));
  const origin={x:after.x,y:after.y+m.eyeHeight(after),z:after.z},hit=c.trace(origin,camera.position);
  assert.equal(hit.startSolid,false);assert.ok(hit.fraction>1-1e-6);
  offset=decayCorrection(offset,1/75,{maxSpeed:5.715});
 }
 near(camera.position.x,after.x,1e-6);near(camera.position.y,after.y+m.eyeHeight(after),1e-6);near(camera.position.z,after.z,1e-6);
 assert.deepEqual(after,saved);
 const crouched={...after,crouch:true,duckAmount:1,ducking:false};camera.rebase(after,crouched,{maxDistance:5.3});camera.update(crouched,{fractionSeconds:0,dt:1/75,frameTimeMs:5000});
 near(camera.diagnostics().terrainPresentation.offsetMetres,0);
});
