import {Game} from '../game.mjs';
import {RULES,blankInput,movePlayer,isGrounded,collides,supportHeight,eyeHeight} from '../public/shared.js';
import {reconcileMovement,PREDICTION_DT,visualCorrection,decayCorrection} from '../public/prediction.js';
import {slopeStart} from './downhill-fixtures.mjs';
export function simulateDownhill(c,{hz=60,latency=.02,legacy=false,jitter=false}={}){
  const game=new Game();game.add('t','SlopeT','T');game.add('ct','SlopeCT','CT');game.begin();game.phase='live';game.endAt=1000;
  const server=game.players.get('t');Object.assign(server,slopeStart(c));
  let local={...server},seq=0,pending=[],accumulator=0,offset={x:0,y:0,z:0},cameraY=local.y+eyeHeight(local);
  const samples=[],events=[];let order=0,tick=0,packet=0,poseGaps=0,air=0,solids=0,upwardResets=0,maxPending=0;
  const duration=c.distance/RULES.speed+.15;
  const schedule=(at,fn)=>events.push({at,order:order++,fn});
  const input=()=>({...blankInput(),f:1,yaw:local.yaw});
  function networkDelay(){packet++;return Math.max(0,latency+(jitter?[-.008,.004,.012,-.004][packet%4]:0));}
  function send(at,command){schedule(at+networkDelay(),()=>game.input('t',command));}
  function state(at,me){const before={...local};
    if(legacy){local.x+=(me.x-local.x)*.4;local.z+=(me.z-local.z)*.4;local.y=me.y;local.vy=me.vy;local.vx=me.vx;local.vz=me.vz;local.grounded=me.grounded;}
    else {const result=reconcileMovement(me,pending,1);offset=visualCorrection(local,result.player,offset);local=result.player;pending=result.pending;}
    if(local.y-before.y>.002)upwardResets++;
  }
  function serverStep(at){game.step();tick++;if(tick%4===0){const me=game.snapshot().players.find(p=>p.id==='t');schedule(at+networkDelay(),()=>state(at,me));}schedule(at+1/RULES.tick,serverStep);}
  function heartbeat(at){send(at,input());schedule(at+PREDICTION_DT,heartbeat);}
  function frame(at){const dt=1/hz;
    if(legacy)movePlayer(local,input(),dt);
    else {accumulator+=dt;while(accumulator+1e-9>=PREDICTION_DT){const command={seq:++seq,round:1,input:input()};pending.push(command);movePlayer(local,command.input,PREDICTION_DT);send(at,{...command.input,seq:command.seq,round:1});accumulator-=PREDICTION_DT;}maxPending=Math.max(maxPending,pending.length);}
    offset=decayCorrection(offset,dt);const targetY=local.y+eyeHeight(local)+offset.y;cameraY+=(targetY-cameraY)*Math.min(1,dt*22);
    if(at>.35){air+=!isGrounded(local);solids+=collides(local.x,local.z,RULES.radius,local.y);poseGaps+=Math.abs(local.y-supportHeight(local.x,local.z,local.y+.1))>.012;}
    samples.push({t:at,x:local.x,y:local.y,z:local.z,cameraY,pending:pending.length,grounded:isGrounded(local)});schedule(at+dt,frame);
  }
  schedule(PREDICTION_DT,serverStep);schedule(1/hz,frame);if(legacy)schedule(0,heartbeat);
  while(events.length){events.sort((a,b)=>a.at-b.at||a.order-b.order);const event=events.shift();if(event.at>duration)break;event.fn(event.at);}
  const cameraVelocities=samples.slice(1).map((s,i)=>(s.cameraY-samples[i].cameraY)*hz),accelerations=cameraVelocities.slice(1).map((v,i)=>Math.abs(v-cameraVelocities[i]));
  const avg=accelerations.reduce((a,b)=>a+b,0)/accelerations.length;
  return {name:c.name,hz,latency,legacy,jitter,poseGaps,air,solids,upwardResets,maxPending,cameraVelocityVariation:avg,travel:Math.hypot(local.x-c.start[0],local.z-c.start[2]),samples};
}
