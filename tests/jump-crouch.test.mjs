import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.mjs';
import {RULES,SPAWN_POINTS,blankInput,movePlayer,bodyHeight,supportHeight,isGrounded,collides} from '../public/shared.js';
import {PREDICTION_DT,reconcileMovement} from '../public/prediction.js';

const close=(a,b,epsilon=1e-8)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
function player(x=SPAWN_POINTS.T[0].x,y=SPAWN_POINTS.T[0].y,z=SPAWN_POINTS.T[0].z){
  return {x,y:supportHeight(x,z,y+.1),z,yaw:0,pitch:0,vx:0,vy:0,vz:0,crouch:false,jumpHeld:false};
}
const center=p=>p.y+bodyHeight(p)/2;
const blocked=p=>collides(p.x,p.z,RULES.radius,p.y,bodyHeight(p));

for(const hz of [30,60,120,144])for(const duck of [false,true])test(`jump height: ${hz}Hz, ${duck?'jump then crouch':'ordinary jump'}`,()=>{
  const p=player(),base=p.y;let peak=base;
  for(let i=0;i<hz*1.5;i++){
    movePlayer(p,{jump:true,crouch:duck&&i>=Math.ceil(hz*.15)},1/hz);
    peak=Math.max(peak,p.y);
    assert.equal(blocked(p),false);
  }
  close((peak-base)*40,duck?63:45,.15);
  assert.equal(isGrounded(p),true);
  close(p.y,base,.002);
});

test('jump crouch: airborne stance changes preserve hull center and vertical velocity',()=>{
  const p=player();movePlayer(p,{jump:true},.1);
  const feet=p.y,origin=center(p),vy=p.vy;
  assert.equal(isGrounded(p),false);
  movePlayer(p,{crouch:true},0);
  close(p.y-feet,18/40);close(center(p),origin);close(p.vy,vy);
  for(let i=0;i<20;i++)movePlayer(p,{crouch:true},0);
  close(center(p),origin);
  movePlayer(p,{crouch:false},0);
  close(p.y,feet);close(center(p),origin);close(p.vy,vy);
});

test('jump crouch: repeatedly changing stance in flight does not add height or velocity',()=>{
  const p=player(),plain={...p};p.y+=3;plain.y=p.y;
  for(let i=0;i<24;i++){
    movePlayer(p,{crouch:i%2===0},1/120);
    movePlayer(plain,{},1/120);
    close(center(p),center(plain));close(p.vy,plain.vy);
    assert.equal(blocked(p),false);
  }
});

test('jump crouch: ground stance changes keep feet planted and crouching before jumping gives no airborne lift',()=>{
  const p=player(),base=p.y;
  movePlayer(p,{crouch:true},0);close(p.y,base);assert.equal(isGrounded(p),true);
  movePlayer(p,{},0);close(p.y,base);assert.equal(p.crouch,false);
  movePlayer(p,{crouch:true},0);
  let peak=p.y;
  for(let i=0;i<90;i++){movePlayer(p,{jump:true,crouch:true},1/60);peak=Math.max(peak,p.y);}
  close((peak-base)*40,45,.15);
});

test('jump crouch: releasing crouch near the floor waits for a safe standing hull',()=>{
  const p=player(),floor=p.y;p.y+=.2;p.crouch=true;
  movePlayer(p,{},0);
  assert.equal(p.crouch,true);close(p.y,floor+.2);assert.equal(blocked(p),false);
  for(let i=0;i<30;i++){movePlayer(p,{},1/60);assert.equal(blocked(p),false);}
  assert.equal(p.crouch,false);assert.equal(isGrounded(p),true);close(p.y,floor,.002);
});

test('jump crouch: releasing crouch beneath a low ceiling keeps the player crouched',()=>{
  const p=player(39,-1.6,-5);p.crouch=true;
  assert.equal(isGrounded(p),true);assert.equal(blocked(p),false);
  assert.equal(collides(p.x,p.z,RULES.radius,p.y,RULES.bodyHeight),true);
  movePlayer(p,{},1/60);assert.equal(p.crouch,true);assert.equal(blocked(p),false);
});

// Current imported Dust2 collision: CT spawn ramp -> main crate -> upper small crate.
// Coordinates are test fixtures only; no map geometry or production teleport API changes.
const CRATES=[
  {name:'CT ramp to main crate',start:[18.9,-1.5,-58.8],top:0,bounds:[16,18.4,-60,-57.6],duckRequired:true},
  {name:'CT main crate to upper crate',start:[16.5,0,-59.2],top:1,bounds:[14.4,16,-60,-58.4],duckRequired:false},
];
function climb(c,hz,duck){
  const p=player(...c.start);p.yaw=Math.PI/2;
  assert.equal(blocked(p),false);assert.equal(isGrounded(p),true);
  let landed=false;
  for(let i=0;i<hz;i++){
    movePlayer(p,{f:1,yaw:p.yaw,jump:true,crouch:duck&&i>=Math.ceil(hz*.15)},1/hz);
    assert.equal(blocked(p),false);
    if(isGrounded(p)&&Math.abs(p.y-c.top)<.01&&p.x>=c.bounds[0]&&p.x<=c.bounds[1]&&p.z>=c.bounds[2]&&p.z<=c.bounds[3])landed=true;
  }
  return landed;
}
for(const c of CRATES)for(const hz of [30,60,120,144])test(`Dust2 jump: ${c.name}, ${hz}Hz`,()=>{
  assert.equal(climb(c,hz,true),true);
  assert.equal(climb(c,hz,false),!c.duckRequired);
});

for(const hz of [30,60,120,144])test(`Dust2 jump: climb the complete CT crate stack without repositioning, ${hz}Hz`,()=>{
  const p=player(...CRATES[0].start);p.yaw=Math.PI/2;
  for(const top of [0,1]){
    let landed=false;
    for(let i=0;i<hz;i++){
      movePlayer(p,{f:1,yaw:p.yaw,jump:true,crouch:i>=Math.ceil(hz*.15)},1/hz);
      assert.equal(blocked(p),false);
      landed||=isGrounded(p)&&Math.abs(p.y-top)<.01;
    }
    assert.equal(landed,true);
    // Release jump and stand on the crate before taking the next jump.
    movePlayer(p,{f:1,yaw:p.yaw,jump:false,crouch:false},1/hz);
  }
});

test('Dust2 jump: jump crouch cannot clear a 96-unit crate',()=>{
  const p=player(11.6,0,-38.1);p.yaw=Math.PI;
  let landed=false;
  for(let i=0;i<90;i++){
    movePlayer(p,{f:1,yaw:p.yaw,jump:true,crouch:i>=9},1/60);
    assert.equal(blocked(p),false);
    landed||=isGrounded(p)&&p.y>=2.4;
  }
  assert.equal(landed,false);
});

for(const acknowledged of [3,14])test(`jump prediction: replay from ACK ${acknowledged} preserves stance across snapshot corrections`,()=>{
  const g=new Game(),p=g.add('p','CT jump','CT');g.step();Object.assign(p,player(...CRATES[0].start));
  const commands=Array.from({length:60},(_,i)=>({seq:i+1,round:g.round,input:{...blankInput(),f:1,yaw:Math.PI/2,jump:true,crouch:i>=9&&i<45}}));
  const apply=c=>{g.input(p.id,{...c.input,seq:c.seq,round:c.round});g.step(PREDICTION_DT);};
  for(const c of commands.slice(0,acknowledged))apply(c);
  const snapshot=g.snapshot(p.id).players[0];
  const replay=reconcileMovement(snapshot,commands,g.round).player;
  for(const c of commands.slice(acknowledged))apply(c);
  for(const key of ['x','y','z','vx','vy','vz'])close(replay[key],p[key]);
  assert.equal(replay.crouch,p.crouch);assert.equal(replay.jumpHeld,p.jumpHeld);
  assert.equal(blocked(replay),false);
});
