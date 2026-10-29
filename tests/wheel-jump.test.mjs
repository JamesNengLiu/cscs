import test from 'node:test';
import assert from 'node:assert/strict';
import {RULES,SPAWN_POINTS,supportHeight,movePlayer,eyeHeight,bodyHeight,traceMovement,collides,trace} from '../public/shared.js';
import {createPlayerCamera} from '../public/player-camera.js';
import {queueJumpPulse} from '../public/controls.js';
import {DOWNHILL_CASES,slopeStart,sampleSlope} from './downhill-fixtures.mjs';
const close=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} vs ${b}`);
const player=()=>{const s=SPAWN_POINTS.T[0];return {...s,id:'wheel',weapon:'glock18',y:supportHeight(s.x,s.z,s.y+.1),vx:0,vy:0,vz:0,yaw:0,pitch:0,crouch:false,grounded:true,jumpHeld:false};};

for(const fps of [30,60,120,144])for(const rate of [10,30,90])for(const crouch of [false,true])test(`wheel camera: ${fps} FPS, ${rate} detents/s, ${crouch?'crouched':'standing'} renders bounded continuous jump motion`,()=>{
  const p=player();p.crouch=crouch;p.duckAmount=crouch?1:0;
  const camera=createPlayerCamera(),edges=[];let accumulator=0,nextWheel=.1,lastHeight=camera.update(p),launches=0;
  for(let frame=1;frame<=fps*5;frame++){
    const time=frame/fps;while(nextWheel<=time+1e-9){queueJumpPulse(edges,{yaw:0,jump:false,crouch});nextWheel+=1/rate;}
    accumulator+=1/fps;
    while(accumulator>=1/60){const beforeVy=p.vy;movePlayer(p,edges.shift()||{yaw:0,jump:false,crouch},1/60);if(beforeVy<=0&&p.vy>1)launches++;camera.push(p);accumulator-=1/60;}
    const height=camera.update(p,{dt:1/fps,fractionSeconds:accumulator});
    assert.ok((height-lastHeight)*fps<8,`excess upward camera speed ${(height-lastHeight)*fps}`);
    assert.equal(collides(p.x,p.z,RULES.radius,p.y,bodyHeight(p)),false);
    lastHeight=height;
  }
  assert.ok(launches>=6&&launches<=9,`${launches} jumps`);
});

test('landing tolerance settles the feet before giving a fresh wheel jump its impulse',()=>{
  const grounded=player(),near={...grounded,y:grounded.y+.02769,vy:-6.62513,jumpFatigue:650},onFloor={...grounded,vy:-6.62513,jumpFatigue:650};
  movePlayer(near,{jump:true},1/60);movePlayer(onFloor,{jump:true},1/60);
  close(near.y,onFloor.y);close(near.vy,onFloor.vy);assert.ok(near.vy>0);
});
test('falling beyond the contact tolerance cannot jump, while landing without a pulse ends on the floor',()=>{
  const p=player(),floor=p.y;p.y+=.06;p.vy=-3;movePlayer(p,{jump:true},1/60);assert.ok(p.vy<=0);
  for(let i=0;i<20;i++)movePlayer(p,{jump:true},1/60);close(p.y,floor,.002);assert.equal(p.vy,0);assert.equal(p.grounded,true);
});
test('player support settles on the same body surface before jumping',()=>{
  const support={...player(),id:'support',alive:true},p={...player(),y:support.y+1.8+.02769,vy:-3};
  const onTop={...p,y:support.y+1.8+.0001};movePlayer(p,{jump:true},1/60,[support]);movePlayer(onTop,{jump:true},1/60,[support]);close(p.y,onTop.y,.0002);close(p.vy,onTop.vy);
});
test('camera interpolates all axes within the same completed physics interval without mutating simulation',()=>{
  const p=player(),camera=createPlayerCamera();p.y+=.5;p.grounded=false;camera.reset(p);
  const before={...p};p.x+=.04;p.y+=.05;p.z+=.03;camera.push(p);const saved={...p};
  camera.update(p,{fractionSeconds:1/120});
  close(camera.position.x,(before.x+p.x)/2);close(camera.position.y,(before.y+p.y)/2+eyeHeight(p));close(camera.position.z,(before.z+p.z)/2);
  camera.update(p,{fractionSeconds:1});close(camera.position.y,p.y+eyeHeight(p));assert.deepEqual(p,saved);
});
for(const hz of [30,60,120,144])test(`camera smooths horizontal 0/2-step cadence at ${hz} FPS`,()=>{
  const p=player(),camera=createPlayerCamera();camera.reset(p);let accumulator=0,t=0,last=null;
  for(let i=0;i<hz*2;i++){
    const dt=(i%2?.996:1.004)/hz;t+=dt;accumulator+=dt;
    while(accumulator+1e-10>=1/60){p.x+=.1/60;camera.push(p);accumulator=Math.max(0,accumulator-1/60);}
    camera.update(p,{fractionSeconds:accumulator});
    if(last&&t>.1)close((camera.position.x-last.x)/dt,.1,1e-8);
    last={...camera.position};
  }
});
for(const step of [-.156,.45])test(`ground step ${step} offset persists continuously through takeoff`,()=>{
  const p=player(),camera=createPlayerCamera();camera.reset(p);const initial=p.y+eyeHeight(p);
  p.y+=step;camera.push(p);close(camera.update(p,{fractionSeconds:1/60}),initial);
  p.grounded=false;p.y+=.1;p.vy=6;camera.push(p);
  const start=camera.update(p),end=camera.update(p,{fractionSeconds:1/60});close(start,initial);
  assert.ok(end-start>=0&&end-start<.15,`takeoff rise ${end-start}`);
});
test('reconciliation shifts both render samples once, visual correction preserves the view',()=>{
  const p=player(),camera=createPlayerCamera();camera.reset(p);p.x+=.04;camera.push(p);
  camera.update(p,{fractionSeconds:1/120});const before={...camera.position},after={...p,x:p.x+.02,y:p.y+.01};
  camera.rebase(p,after);camera.update(after,{fractionSeconds:1/120,correction:{x:-.02,y:-.01,z:0}});
  for(const k of ['x','y','z'])close(camera.position[k],before[k]);
  const teleported={...after,x:after.x+2};camera.rebase(after,teleported);camera.update(teleported);close(camera.position.x,teleported.x);
});
test('camera point sweep prevents interpolation through BSP geometry',()=>{
  const p=player(),camera=createPlayerCamera();camera.reset({...p,x:p.x-10});camera.push(p);
  camera.update(p,{fractionSeconds:0});assert.equal(trace({x:p.x,y:p.y+eyeHeight(p),z:p.z},camera.position).startSolid,false);
});

for(const route of DOWNHILL_CASES)for(const uphill of [false,true])for(const hz of [30,60,120,144])test(`moving wheel camera: ${route.name} ${uphill?'up':'down'} at ${hz} FPS has no takeoff pop`,()=>{
  let start=slopeStart(route);
  if(uphill){const point=sampleSlope(route,120).samples.find(s=>Math.hypot(s.x-route.start[0],s.z-route.start[2])>=route.distance*.85);
    start={...point,vx:0,vy:0,vz:0,yaw:Math.atan2(route.direction[0],route.direction[1])};}
  const p={...player(),...start,grounded:true},camera=createPlayerCamera(),edges=[];camera.reset(p);
  let accumulator=0,nextWheel=.25,lastHeight=camera.update(p),maxRise=0;
  for(let i=1;i<=hz*2;i++){
    const dt=(i%2?.996:1.004)/hz,time=i/hz;
    while(nextWheel<=time){queueJumpPulse(edges,{f:1,yaw:p.yaw,jump:false});nextWheel+=1/30;}
    accumulator+=dt;
    while(accumulator>=1/60){movePlayer(p,edges.shift()||{f:1,yaw:p.yaw,jump:false},1/60);camera.push(p);accumulator-=1/60;}
    const height=camera.update(p,{fractionSeconds:accumulator});maxRise=Math.max(maxRise,(height-lastHeight)/dt);lastHeight=height;
    assert.equal(trace(camera.position,camera.position).startSolid,false,'rendered eye remains outside BSP solids');
  }
  assert.ok(maxRise<10,`upward camera speed ${maxRise}`);
});
test('standing up on the ground retains the smooth eye transition through the following jump',()=>{
  const p={...player(),crouch:true,duckAmount:1},camera=createPlayerCamera();camera.reset(p);const before=camera.update(p);
  movePlayer(p,{crouch:false},1/60);camera.push(p);close(camera.update(p,{fractionSeconds:1/60}),before);
  movePlayer(p,{jump:true},1/60);camera.push(p);const height=camera.update(p,{fractionSeconds:1/60});
  assert.ok(height>before&&height-before<.17,`standing jump view rise ${height-before}`);
});
