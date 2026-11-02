import {createHash} from 'node:crypto';
import {Game} from '../../game.mjs';
import {movePlayer,maxMoveSpeed} from '../../public/movement.js';
import {flatSlowdownPose,slowdownColumns} from './hit-slowdown-cases.mjs';
export const RECOVERY_WEAPONS=['ak47','m4a1','mp5navy','p90','awp','famas'];
export const RECOVERY_MODES=['run','stop','strafe','crouch','jump'];
export function recoveryTrace({weapon='glock18',modifier=.5,profile='baseline',mode='run',hz=60,seconds=1.2,move=movePlayer,repeatSeconds=0,actualHits=false}={}){
 const g=new Game({random:()=>.5,audioRandom:()=>.5,hitRecovery:profile}),p=g.add('victim','Recovery fixture','CT'),a=g.add('attacker','Fixture opponent','T');g.begin();g.phase='live';g.endAt=1000;g.time=10;
 Object.assign(p,flatSlowdownPose({weapon,hp:10000}));const max=maxMoveSpeed(p);p.vz=-max;
 Object.assign(a,flatSlowdownPose({id:'attacker',hp:10000,z:p.z+3}));
 const origin={x:p.x,z:p.z},rows=[],dt=1/hz;let distance=0,nextHit=0,groundTime=0,tagEvents=0;
 const hit=()=>{tagEvents++;if(actualHits){a.x=p.x;a.y=p.y;a.z=p.z+3;g.damage(p,1,a,{kind:weapon,hitgroup:'chest'});}else p.velocityModifier=modifier;};
 hit();nextHit=repeatSeconds||Infinity;
 rows.push({time:0,groundTime:0,speed:Math.hypot(p.vx,p.vz),modifier:p.velocityModifier,values:slowdownColumns.map(k=>p[k]??null)});
 for(let n=1;n<=Math.round(seconds*hz);n++){
  const time=(n-1)/hz;if(time+1e-9>=nextHit){hit();nextHit+=repeatSeconds;}
  const input={f:mode==='stop'?0:mode==='strafe'?0:1,s:mode==='strafe'?1:0,yaw:0,pitch:0,jump:mode==='jump'&&n===1,crouch:mode==='crouch'};
  const grounded=p.grounded;move(p,input,dt);if(grounded)groundTime+=dt;
  distance+=Math.hypot(p.x-origin.x,p.z-origin.z)*40;
  rows.push({time:n/hz,groundTime,speed:Math.hypot(p.vx,p.vz),modifier:p.velocityModifier,values:slowdownColumns.map(k=>p[k]===0?0:p[k]??null)});
  // Recenter X/Z only, retaining velocities, Y, stance and all movement state.
  // This repeats one real flat BSP patch; distant walls cannot fake a speed dip.
  p.x=origin.x;p.z=origin.z;g.time+=dt;
 }
 const minimum=rows.reduce((a,b)=>b.speed<a.speed?b:a),after=rows.filter(r=>r.time>=minimum.time),first=q=>after.find(r=>r.speed>=max*q)?.time??null;
 const summary={weapon,mode,profile,hz,seconds,tagEvents,maxSpeedSource:max*40,modifierRestoredAt:rows.find(r=>r.modifier===1)?.time??null,minimumSpeedSource:minimum.speed*40,recovered50:first(.5),recovered80:first(.8),recovered95:first(.95),distanceSource:distance};
 return {summary,rows,hash:createHash('sha256').update(JSON.stringify(rows.map(r=>r.values))).digest('hex')};
}
// Independent straight/dry/flat/no-knockback reference equations, using exactly
// 100 x 10ms PreThink/PM commands. This is not a retail-client capture.
export function referenceRecovery100(modifier,maxSource=250,seconds=1.2){
 let speed=maxSource,distance=0;const rows=[{time:0,speed,modifier}];
 for(let n=1;n<=Math.round(seconds*100);n++){
  if(modifier<1){modifier+=.01;speed*=modifier;if(modifier>1)modifier=1;}
  if(speed>=.1)speed=Math.max(0,speed-Math.max(speed,75)*4*.01);
  speed+=Math.min(Math.max(0,maxSource-speed),5*maxSource*.01);distance+=speed*.01;rows.push({time:n/100,speed,modifier});
 }
 const minimum=rows.reduce((a,b)=>b.speed<a.speed?b:a),after=rows.filter(r=>r.time>=minimum.time),first=q=>after.find(r=>r.speed>=maxSource*q)?.time??null;
 return {summary:{referenceHz:100,modifierRestoredAt:rows.find(r=>r.modifier>=1-1e-9)?.time??null,minimumSpeedSource:minimum.speed,recovered50:first(.5),recovered80:first(.8),recovered95:first(.95),distanceSource:distance},rows};
}
