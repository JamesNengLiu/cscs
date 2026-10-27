import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.mjs';
import {RULES,blankInput,movePlayer} from '../public/shared.js';
import {PREDICTION_DT,reconcileMovement,visualCorrection,decayCorrection} from '../public/prediction.js';
import {DOWNHILL_CASES,slopeStart,sampleSlope} from './downhill-fixtures.mjs';
import {simulateDownhill} from './downhill-network.mjs';
for(const c of DOWNHILL_CASES)for(const hz of [30,60,120,144])for(const options of [{},{walk:true},{crouch:true}]){
  const mode=options.crouch?'crouch':options.walk?'walk':'run';
  test(`downhill physical: ${c.name}, ${hz}Hz, ${mode}`,()=>{const r=sampleSlope(c,hz,options),speed=options.crouch?RULES.crouchSpeed:options.walk?RULES.walkSpeed:RULES.speed;
    assert.equal(r.stalls,0);assert.equal(r.solid,0);assert.equal(r.air,0);assert.equal(r.upward,0);assert.ok(r.travel>=c.distance);assert.ok(r.minSpeed>=speed*.99,JSON.stringify({...r,samples:undefined}));
  });
}
for(const c of DOWNHILL_CASES)for(const hz of [30,60,120,144])for(const latency of [0,.02,.06]){
  test(`downhill network: ${c.name}, ${hz}Hz, ${latency*2000}ms RTT with jitter`,()=>{
    const r=simulateDownhill(c,{hz,latency,jitter:true});assert.equal(r.solids,0);assert.equal(r.air,0);assert.equal(r.poseGaps,0);assert.ok(r.maxPending<20);assert.ok(r.travel>c.distance-.5);assert.ok(Number.isFinite(r.cameraVelocityVariation));
  });
}
for(const c of DOWNHILL_CASES)test(`downhill reproducer: obsolete snapshot height resets eliminated, ${c.name}`,()=>{
  const old=simulateDownhill(c,{legacy:true}),fixed=simulateDownhill(c);assert.ok(old.upwardResets>0);assert.equal(fixed.upwardResets,0);
});
function liveGame(){const g=new Game();g.add('t','T','T');g.add('ct','CT','CT');g.begin();g.phase='live';g.endAt=1000;return g;}
test('prediction: ACK is published only after the authoritative movement step',()=>{
  const g=liveGame(),p=g.players.get('t');g.input('t',{...blankInput(),seq:1,round:g.round,f:1,yaw:p.yaw});assert.equal(g.snapshot().players.find(p=>p.id==='t').ackInputSeq,0);g.step();assert.equal(g.snapshot().players.find(p=>p.id==='t').ackInputSeq,1);
});
test('prediction: duplicate, out-of-order, invalid and old-round commands do not overwrite input',()=>{
  const g=liveGame(),p=g.players.get('t');g.input('t',{seq:5,round:g.round,f:1});for(const raw of [{seq:4,round:g.round},{seq:5,round:g.round},{seq:-1,round:g.round},{seq:Infinity,round:g.round},{seq:6,round:g.round-1},{seq:6.1,round:g.round}])g.input('t',{...raw,f:-1});assert.equal(p.input.f,1);assert.equal(p.lastInputSeq,5);
});
test('prediction: reset ACK on respawn, and keep jump-held state for exact replay',()=>{
  const g=liveGame(),p=g.players.get('t');p.lastInputSeq=30;p.ackInputSeq=29;p.jumpHeld=true;assert.equal(g.snapshot().players.find(p=>p.id==='t').jumpHeld,true);g.begin();assert.equal(p.ackInputSeq,0);assert.equal(p.lastInputSeq,0);
});
test('prediction: replay complete poses, skip ACKed and previous-round commands',()=>{
  const authoritative=slopeStart(DOWNHILL_CASES[0]);authoritative.ackInputSeq=2;
  const input={...blankInput(),f:1,yaw:authoritative.yaw},commands=[{seq:3,round:0,input},{seq:2,round:1,input},{seq:3,round:1,input},{seq:4,round:1,input}];
  const expected={...authoritative};movePlayer(expected,input,PREDICTION_DT);movePlayer(expected,input,PREDICTION_DT);
  const r=reconcileMovement(authoritative,commands,1);assert.deepEqual(r.player,expected);assert.equal(r.pending.length,2);assert.equal(authoritative.x,DOWNHILL_CASES[0].start[0]);
});
test('prediction: held jump is not spuriously retriggered on landing after a snapshot',()=>{
  const p=slopeStart(DOWNHILL_CASES[0]);p.jumpHeld=true;p.ackInputSeq=1;
  const r=reconcileMovement(p,[{seq:2,round:1,input:{...blankInput(),yaw:p.yaw,jump:true}}],1);assert.equal(r.player.vy,0);assert.ok(Math.abs(r.player.y-p.y)<.001);
});
test('prediction: visual smoothing preserves the displayed pose then decays, teleport correction is not hidden',()=>{
  const previous={x:1,y:2,z:3},next={x:1.1,y:1.95,z:3},offset=visualCorrection(previous,next);assert.ok(Math.abs(next.y+offset.y-previous.y)<1e-12);assert.ok(Math.abs(decayCorrection(offset,1).y)<Math.abs(offset.y));assert.deepEqual(visualCorrection(previous,{x:10,y:10,z:10}),{x:0,y:0,z:0});
});
test('prediction: a burst of client commands cannot add authoritative simulation time or position',()=>{
  const g=liveGame(),p=g.players.get('t'),before={...p};for(let seq=1;seq<=100;seq++)g.input('t',{seq,round:g.round,f:1,yaw:p.yaw,x:1000,y:1000,z:1000,dt:10});g.step();assert.ok(Math.hypot(p.x-before.x,p.z-before.z)<=RULES.speed/RULES.tick+.001);assert.equal(p.ackInputSeq,100);
});
