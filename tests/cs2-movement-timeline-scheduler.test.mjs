import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtureGame,fixtureWorld} from './cs2-game-fixture.mjs';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {buildInputBatch,orderedInputCommands,MAX_INPUT_QUEUE} from '../public/cs2-input-protocol.js';
import {createMovementPredictionClock,restorePredictionTicks,replayMovementTimeline,alignAcknowledgedMovementEdge,MAX_MOVEMENT_REPLAY_TICKS} from '../public/cs2-movement-timeline.js';

const DT=1/60,FRAME_RATES=[60,75,120,144];
const movementFields=['x','y','z','vx','vy','vz','grounded','jumpHeld','jumpFatigue','duckAmount','duckElapsed','ducking','crouch','walk'];
const pose=p=>Object.fromEntries(movementFields.map(k=>[k,p[k]]));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);

// Pure synthetic scheduling of the real game/movement kernel. Network delay is
// deterministic here; these tests are neither browser FPS nor physical LAN QA.
function schedule({hz=75,jitter=false,pause=false,longFrame=false,reset=false,scenario='controls',durationMs=3400},mode){
 const world=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE});
 const {g,t,ct}=fixtureGame({world,weaponProfile:'cs2'});
 t.money=16000;g.buy(t.id,'ak47');g.equip(t.id,'ak47');
 const place=()=>{Object.assign(t,{x:-8,y:scenario==='inertia'?20:.0005,z:8,vx:scenario==='inertia'?2:0,vy:scenario==='inertia'?3:0,vz:scenario==='inertia'?-3:0,grounded:scenario!=='inertia',yaw:0,pitch:0,nextAttackAt:0,nextShotAt:0});Object.assign(ct,{x:18,y:.0005,z:-18,hp:1000000});g.endAt=g.buyEndAt=1000;};
 place();
 const clock=createMovementPredictionClock();clock.reset(t);
 let local={...t},pending=[],seq=0,ack=0,round=g.round,acc=0,lastRAF=0,serverSteps=0,lastStateServerTick=-1,resetDone=false;
 let inflight=[],states=[];
 const frames=[],reconciles=[],wire=[],physical=[],strategies=new Set();
 const events=[];
 for(let n=1;n*1000/hz<=durationMs+1e-7;n++){
  const at=n*1000/hz;
  if(longFrame&&at>=1540&&at<1740)continue;
  events.push({at,type:'frame'});
 }
 for(let n=0;8.333333333+n*1000/60<=durationMs+1e-7;n++)events.push({at:8.333333333+n*1000/60,type:'server'});
 events.sort((a,b)=>a.at-b.at||a.type.localeCompare(b.type));
 const controls=(now,n)=>{
  const input=world.movement.blankInput();
  if(scenario==='inertia'||now<500)return input;
  if(scenario==='edge'){input.jump=now>=1010&&now<1045;return input;}
  return {...input,f:1,s:Math.floor(n/36)%2?1:-1,yaw:n*.018,jump:n%60===40,crouch:n%120>=70&&n%120<82,walk:n%120>=100&&n%120<110,fire:n%18>=2&&n%18<5};
 };
 const isPaused=at=>pause&&at>=990&&at<1050;
 for(const event of events){
  const now=event.at;
  if(event.type==='server'){
   if(reset&&!resetDone&&now>=2200){g.begin();g.phase='live';place();resetDone=true;}
   const delivered=inflight.filter(packet=>packet.at<=now).sort((a,b)=>a.at-b.at);inflight=inflight.filter(packet=>packet.at>now);
   for(const packet of delivered)g.inputBatch(t.id,packet.message.commands);
   g.step();serverSteps++;
   physical.push({serverTick:g.serverTick,round:g.round,ack:t.ackInputSeq,applied:t.appliedInputCommands,skipped:t.skippedInputCommands,movementTick:t.movementTick,weapon:t.weapon,ammo:t.ammo,recoilPitch:t.recoilPitch,recoilYaw:t.recoilYaw,...pose(t)});
   if(serverSteps%2===0)states.push({at:now+1,serverTick:g.serverTick,round:g.round,authority:structuredClone(g.snapshot(t.id).players.find(p=>p.id===t.id))});
   continue;
  }
  const due=states.filter(state=>state.at<=now);states=states.filter(state=>state.at>now);
  // Match the deferred client connection: coalesced arrivals apply only the
  // latest authority, without replaying intermediate stale snapshots.
  const snapshot=due.sort((a,b)=>b.serverTick-a.serverTick)[0];
  if(snapshot&&snapshot.serverTick>lastStateServerTick){
   lastStateServerTick=snapshot.serverTick;const authority=snapshot.authority;
   if(snapshot.round!==round){round=snapshot.round;pending=[];seq=ack=0;acc=0;local={...authority};clock.reset(authority);}
   else{
    const prior={...local},samples=mode==='new'?alignAcknowledgedMovementEdge(authority,pending,round):pending,ordered=orderedInputCommands(samples,round,authority.ackInputSeq||0,MAX_INPUT_QUEUE);
    if(mode==='new'){
     const tagged=restorePredictionTicks(ordered,samples),result=replayMovementTimeline(authority,tagged,world.movement.movePlayer,[],{dt:DT,targetTick:clock.observe(authority)});
     local=result.player;pending=result.pending;clock.observe(local);strategies.add(result.timeline.strategy);
     assert.ok(result.timeline.replayedTicks<=MAX_MOVEMENT_REPLAY_TICKS,'Replay work must stay bounded across long frames and edge protection');
     assert.ok(clock.tick>=authority.movementTick);
     assert.equal(clock.tick,local.movementTick);
     for(let i=0;i<pending.length;i++){
      assert.ok(Number.isSafeInteger(pending[i].predictionTick));
      if(i)assert.ok(pending[i].predictionTick>pending[i-1].predictionTick,'Retagged local samples remain ordered');
     }
    }else{local={...authority};pending=ordered;for(const c of pending)world.movement.movePlayer(local,c.input,DT,[]);}
    reconciles.push({at:now,round,correction:distance(local,prior),prior:pose(prior),after:pose(local),pending:pending.length,authorityMovementTick:authority.movementTick,clockTick:mode==='new'?clock.tick:null});
   }
   ack=authority.ackInputSeq||0;
  }
  acc=Math.min(.1,acc+Math.min(.05,(now-lastRAF)/1000));lastRAF=now;
  let sampled=false;
  while(acc>=DT&&pending.length<MAX_INPUT_QUEUE){
   const command={seq:++seq,round,input:controls(now,seq)};
   if(mode==='new'){command.predictionTick=clock.next();assert.ok(Number.isSafeInteger(command.predictionTick));}
   world.movement.movePlayer(local,command.input,DT,[]);
   if(mode==='new')local.movementTick=command.predictionTick;
   pending.push(command);sampled=true;acc-=DT;
  }
  if((sampled||pending.length)&&pending.length){
   const message=buildInputBatch(pending,round,ack),body=JSON.stringify(message);
   assert.equal(body.includes('predictionTick'),false,'Private prediction ticks must never leak into network batches');
   assert.equal(body.includes('movementTick'),false);
   wire.push({at:now,message});
   const pattern=[0,1,.2,.8,0,.4,.6,0],variation=jitter?6*pattern[wire.length%pattern.length]:0;
   inflight.push({at:(isPaused(now)?1050:now)+1+variation,message});
  }
  frames.push({at:now,round,seq,pending:pending.length,clockTick:mode==='new'?clock.tick:null,...pose(local)});
  assert.ok(pending.length<=MAX_INPUT_QUEUE);
 }
 return {wire,physical,shots:g.events.filter(e=>e.type==='shot'),frames,reconciles,strategies:[...strategies],round,clockTick:clock.tick};
}

function compareAuthority(options){
 const old=schedule(options,'old'),current=schedule(options,'new');
 assert.deepEqual(current.wire,old.wire,'Private timing metadata must not change any transmitted command, input edge, or retransmission');
 assert.deepEqual(current.physical,old.physical,'Authoritative movement, jump, ACK, ammo and recoil must be identical');
 assert.deepEqual(current.shots,old.shots,'Shot origins, directions and impacts must be identical');
 return {old,current};
}

for(const hz of FRAME_RATES)test(`CS2 ${hz}Hz scheduled steady controls preserve authoritative shots and the no-fault predicted path`,()=>{
 const {old,current}=compareAuthority({hz});
 const oldFrames=old.frames.filter(f=>f.at>=700),newFrames=current.frames.filter(f=>f.at>=700);
 assert.equal(oldFrames.length,newFrames.length);
 for(let i=0;i<oldFrames.length;i++)assert.deepEqual(pose(newFrames[i]),pose(oldFrames[i]),`No-fault steady movement changed at ${newFrames[i].at}ms`);
 assert.ok(current.shots.length>0,'The regression must exercise actual authoritative shooting');
});

for(const hz of FRAME_RATES)for(const fault of ['jitter','pause','longFrame','reset'])test(`CS2 ${hz}Hz ${fault} leaves wire, server movement and shooting unchanged`,()=>{
 const {current}=compareAuthority({hz,[fault]:true});
 assert.ok(current.frames.length>60);assert.ok(current.physical.length>60);
 assert.ok(current.strategies.includes('physical-time'));
 if(fault==='reset'){
  assert.equal(new Set(current.frames.map(f=>f.round)).size,2);assert.equal(current.round,current.frames[0].round+1);
  const first=current.frames.find(f=>f.round===current.round);assert.ok(first.seq<=3);assert.ok(first.clockTick<10,'A new round must not inherit the old physical clock');
 }
});

for(const hz of FRAME_RATES)test(`CS2 ${hz}Hz combined jitter, input pause, long frame and round reset remain bounded`,()=>{
 const {current}=compareAuthority({hz,jitter:true,pause:true,longFrame:true,reset:true});
 assert.equal(new Set(current.frames.map(f=>f.round)).size,2);
 assert.ok(current.frames.every(f=>f.pending<=MAX_INPUT_QUEUE));
 const first=current.frames.find(f=>f.round===current.round);
 assert.ok(first.clockTick<10,'The long-frame/pause history must not escape into the next round');
});

for(const hz of FRAME_RATES)test(`CS2 ${hz}Hz an input pause does not integrate an extra airborne gravity interval`,()=>{
 const {old,current}=compareAuthority({hz,pause:true,scenario:'inertia',durationMs:1450});
 const afterWarmup=current.reconciles.filter(r=>r.at>500),oldAfter=old.reconciles.filter(r=>r.at>500);
 assert.ok(afterWarmup.length>10);
 assert.ok(Math.max(...oldAfter.map(r=>r.correction))>.04,'The old replay must actually exhibit the repeated physics-time error');
 assert.ok(Math.max(...afterWarmup.map(r=>r.correction))<1e-9,'Pure inertia/air gravity must remain on one physical timeline');
 assert.ok(current.frames.every(f=>!f.grounded),'The isolated gravity case must remain clear of the floor');
});

for(const hz of FRAME_RATES)test(`CS2 ${hz}Hz a delayed jump edge survives physical-time coverage and exits edge replay`,()=>{
 const {current}=compareAuthority({hz,pause:true,scenario:'edge',durationMs:2100});
 assert.ok(current.strategies.includes('edge-replay'),'The pause must cover an actual unacknowledged jump edge');
 assert.ok(current.strategies.includes('physical-time'));
 const takeoff=current.frames.find(f=>!f.grounded);assert.ok(takeoff);
 const risingWindow=current.frames.filter(f=>f.at>=takeoff.at&&f.at<takeoff.at+350);
 assert.ok(risingWindow.every(f=>!f.grounded),'A later ACK must not undo the jump or pop the player back to the floor');
 assert.ok(current.frames.at(-1).grounded,'The same jump must land and settle normally');
});
