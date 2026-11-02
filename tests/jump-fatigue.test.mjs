import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Game} from '../game.mjs';
import {RULES} from '../public/config.js';
import {GUNS} from '../public/arsenal.js';
import {movePlayer,traceMovement,bodyHeight,JUMP_FATIGUE_VERSION} from '../public/movement.js';
import {collides} from '../public/map.js';
import {reconcileMovement} from '../public/prediction.js';
import {flatSlowdownPose,slowdownCases,slowdownCaseTrace,slowdownColumns} from './fixtures/hit-slowdown-cases.mjs';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/jump-fatigue-baseline.json',import.meta.url)));
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const pose=(patch={})=>flatSlowdownPose({x:-21,yaw:-Math.PI/2,...patch});
const forward=p=>({f:1,yaw:p.yaw});
// Independent one-axis numeric reference: PM_ReduceTimers -> PM_Friction ->
// PM_WalkMove's existing-velocity penalty -> PM_Accelerate. 100 x 10ms commands.
// This is a flat-ground reference calculation, not a retail-client capture.
function reference100({speed=250,velocity=250,fatigue=650,seconds=.5}={}){
 const rows=[];let distance=0;
 for(let n=1;n<=Math.round(seconds*100);n++){
  fatigue=Math.max(0,fatigue-10);
  if(velocity>=.1)velocity=Math.max(0,velocity-Math.max(velocity,75)*4*.01);
  if(fatigue>0)velocity*=1-fatigue*.00019;
  velocity+=Math.min(Math.max(0,speed-velocity),5*speed*.01);
  distance+=velocity*.01;rows.push({time:n/100,speed:velocity,distance,fatigue});
 }
 return rows;
}
test('fatigued landing follows the 100 Hz reference speed and distance curve',()=>{
 const p=pose({vx:6.25,jumpFatigue:650}),x=p.x,reference=reference100();
 for(let tick=1;tick<=30;tick++){
  movePlayer(p,forward(p),1/60);
  if([6,15,30].includes(tick)){
   const expected=reference.find(r=>Math.abs(r.time-tick/60)<1e-8);
   near(p.vx*40,expected.speed,1.2);near((p.x-x)*40,expected.distance,.5);near(p.jumpFatigue,expected.fatigue);
  }
 }
 assert.ok((p.x-x)*40<64,'the old ~116-unit over-retention has been removed');
});
for(const hz of [30,60,120,144,240])test(`fatigue strength is anchored to elapsed time, ${hz} Hz updates`,()=>{
 const p=pose({vx:6.25,jumpFatigue:650}),x=p.x,expected=reference100().at(-1);
 for(let i=0;i<hz*.5;i++)movePlayer(p,forward(p),1/hz);
 near((p.x-x)*40,expected.distance,1.5);near(p.vx*40,expected.speed,4);near(p.jumpFatigue,150);
});
test('fatigue damps current horizontal momentum even after movement keys are released',()=>{
 const p=pose({vx:4,vz:3,jumpFatigue:650}),control={...p,jumpFatigue:0};
 movePlayer(p,{},1/120);movePlayer(control,{},1/120);
 assert.ok(Math.hypot(p.vx,p.vz)<Math.hypot(control.vx,control.vz));near(p.vx/p.vz,4/3);near(p.vy,control.vy);near(p.velocityModifier,1);
});
test('fatigue precedes ground acceleration, so steering and counter-strafing can still add speed',()=>{
 const p=pose({vx:4,jumpFatigue:650}),before=p.vx;movePlayer(p,{s:1,yaw:0},1/120);
 const ratio=(1-(650-1000/120)*.00019)**(100/120);
 const expected=before*(1-4/120)*ratio+5*6.25/120;near(p.vx,expected);assert.ok(p.vx>before*(1-4/120)*ratio);
 const q=pose({vx:4,jumpFatigue:650});movePlayer(q,{s:-1,yaw:0},1/120);assert.ok(q.vx<p.vx);assert.ok(q.vx>0);
});
for(const mode of [{walk:true},{crouch:true}])test(`fatigued ${JSON.stringify(mode)} remains steerable and recovers`,()=>{
 const p=pose({vx:6.25,jumpFatigue:650,...mode}),start=p.x;
 for(let i=0;i<90;i++){movePlayer(p,{...forward(p),...mode},1/120);assert.equal(collides(p.x,p.z,RULES.radius,p.y,bodyHeight(p)),false);}
 assert.ok(p.x>start);assert.equal(p.jumpFatigue,0);assert.ok(p.vx>0);assert.ok(p.vx<=6.25*(mode.walk?.52:.333)+1e-9);
});
for(const weapon of ['knife','ak47','m4a1','mp5navy','p90','awp'])test(`fatigue recovers to the unchanged ${weapon} weapon speed`,()=>{
 const p=pose({weapon,vx:(GUNS[weapon]?.maxSpeed||250)/40,jumpFatigue:650}),x=p.x;
 let recoveredAt=null;for(let i=1;i<=110;i++){movePlayer(p,forward(p),1/120);if(recoveredAt===null&&p.jumpFatigue===0)recoveredAt=i;}
 assert.equal(recoveredAt,78);near(p.vx,(GUNS[weapon]?.maxSpeed||250)/40);assert.ok(p.x>x);
});
test('airborne fatigue does not apply ground drag, but its existing timer still recovers',()=>{
 const p=pose({y:flatSlowdownPose().y+1,vx:4,vy:3,vz:2,grounded:false,jumpFatigue:650}),control={...p,jumpFatigueVersion:0};
 for(let i=0;i<8;i++){movePlayer(p,{},1/120);movePlayer(control,{},1/120);for(const k of ['x','y','z','vx','vy','vz','jumpFatigue','grounded'])assert.equal(p[k],control[k],k);}
});
test('a new jump skips ground fatigue, preserving the existing takeoff impulse and cap',()=>{
 for(const velocityModifier of [1,.5]){
  const p=pose({vx:6.25,jumpFatigue:650,velocityModifier}),old={...p,jumpFatigueVersion:0};movePlayer(p,{jump:true},1/60);movePlayer(old,{jump:true},1/60);
  for(const k of ['x','y','z','vx','vy','vz','jumpFatigue','grounded','velocityModifier'])assert.equal(p[k],old[k],k);
 }
});
test('pure vertical jumps, airborne crouch height and repeated-jump timing remain unchanged',()=>{
 for(const crouch of [false,true]){const p=pose(),old={...p,jumpFatigueVersion:0};for(let tick=0;tick<180;tick++){
  const input={jump:tick%4===0,crouch:crouch&&tick%60>=9};movePlayer(p,input,1/60);movePlayer(old,input,1/60);
  for(const k of ['y','vy','jumpFatigue','grounded','crouch','jumpHeld'])assert.equal(p[k],old[k],k+' at '+tick);
 }}
});
test('hit slowdown recovery and takeoff tagging remain independent of jump fatigue',()=>{
 const p=pose({vx:6.25,jumpFatigue:650,velocityModifier:.5}),old={...p,jumpFatigueVersion:0};
 for(let i=1;i<=60;i++){movePlayer(p,forward(p),1/60);movePlayer(old,forward(old),1/60);assert.equal(p.velocityModifier,old.velocityModifier);near(p.jumpFatigue,old.jumpFatigue);if(i===50)assert.equal(p.velocityModifier,1);}
});
for(const c of slowdownCases)test(`previous modern-collision trajectory stays exact in old-server fatigue mode: ${c.name}`,()=>{
 const expected=baseline.cases.find(r=>r.name===c.name),rows=slowdownCaseTrace(movePlayer,c,1,0);
 assert.equal(rows.length,expected.frames);assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),expected.sha256);
});
test('new snapshots advertise the fatigue capability; replay agrees with server through landing',()=>{
 const g=new Game(),p=g.add('local','Fatigue regression','T');g.begin();g.phase='live';g.time=10;g.endAt=1000;Object.assign(p,pose({id:'local',vx:6.25,jumpFatigue:650}));
 const s=g.snapshot(p.id);assert.equal(s.jumpFatigueVersion,JUMP_FATIGUE_VERSION);const me=s.players.find(p=>p.id==='local');me.jumpFatigueVersion=s.jumpFatigueVersion;
 const commands=Array.from({length:36},(_,i)=>({seq:i+1,round:g.round,input:{f:1,yaw:p.yaw,jump:i===8,crouch:i>15&&i<24}}));
 const predicted=reconcileMovement(me,commands,g.round).player;
 for(let i=0;i<commands.length;i+=8)g.inputBatch(p.id,commands.slice(i,i+8).map(c=>({...c.input,seq:c.seq,round:c.round})));
 for(const _ of commands)g.step();for(const k of slowdownColumns)assert.equal(predicted[k],p[k],k);
});
test('near-parallel BSP sweep backs off instead of installing a solid endpoint',()=>{
 const p=pose({x:-24.457174315743057,y:3.492827592481358,z:22.38008113005279,vy:2.214192171110433});
 const end={x:p.x+.46741814325143854/120,y:p.y+(p.vy-RULES.gravity/240)/120,z:p.z+.9348360300405776/120};
 const hit=traceMovement(p,end,bodyHeight(p),[],p);assert.equal(hit.fraction,0);assert.equal(collides(hit.end.x,hit.end.z,RULES.radius,hit.end.y,bodyHeight(p)),false);
});
test('picounit residual velocity cannot round a crouched body into the CT crate wall',()=>{
 const p=pose({x:18.31036815184897,y:.8141319907649027,z:-59.59999999999999,vx:-.7946107537652655,vy:.753402963059611,vz:-1.0726340395448498e-12,crouch:true,grounded:false,jumpFatigue:1074.1227623333355,yaw:Math.PI/2});
 for(let i=0;i<30;i++){movePlayer(p,{f:1,s:.35,yaw:p.yaw,crouch:true},1/120);assert.equal(collides(p.x,p.z,RULES.radius,p.y,bodyHeight(p)),false);}
});
