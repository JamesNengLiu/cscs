// Local prediction metadata only. Command ACKs and weapon barriers retain their
// existing meaning; a movement tick is never permission to discard a command.
export const MOVEMENT_TIMELINE_VERSION=1;
export const MAX_MOVEMENT_REPLAY_TICKS=128;
const validTick=value=>Number.isSafeInteger(value)&&value>=0;

export function authoritativeMovementTick(player){
  return player?.movementTimelineVersion===MOVEMENT_TIMELINE_VERSION&&validTick(player.movementTick)?player.movementTick:null;
}

export function createMovementPredictionClock(){
  let tick=null;
  return {
    reset(player=null){tick=authoritativeMovementTick(player);},
    observe(player){const received=authoritativeMovementTick(player);tick=received===null?null:Math.max(received,tick??received);return tick;},
    next(){return tick===null||tick===Number.MAX_SAFE_INTEGER?null:++tick;},
    get tick(){return tick;},
  };
}

// Normalizing a wire command deliberately drops this field. Recover it from
// the local immutable samples after ordering; never add it to network payloads.
export function restorePredictionTicks(ordered,localCommands){
  const ticks=new Map();
  for(const command of localCommands||[]){
    const key=command?.round+':'+command?.seq;
    if(!ticks.has(key)&&validTick(command?.predictionTick))ticks.set(key,command.predictionTick);
  }
  return ordered.map(command=>{const tick=ticks.get(command.round+':'+command.seq);return tick===undefined?command:{...command,predictionTick:tick};});
}

// A newly acknowledged movement edge can have executed later than its local
// sample (for example, a jump after a short input gap). Anchor its following
// samples to that actual step, so the first ACK cannot erase a predicted jump
// step merely because the remaining samples have the same held-button level.
export function alignAcknowledgedMovementEdge(authoritative,commands,round){
  const tick=authoritativeMovementTick(authoritative),seq=authoritative?.movementEdgeSeq,edgeTick=authoritative?.movementEdgeTick;
  if(tick===null||!Number.isSafeInteger(seq)||seq<=0||seq>(authoritative.ackInputSeq||0)||!validTick(edgeTick)||edgeTick>tick||!Array.isArray(commands))return commands;
  const edge=commands.find(command=>command?.round===round&&command.seq===seq&&validTick(command.predictionTick));
  if(!edge)return commands;
  return commands.map(command=>{
    if(command.round!==round||command.seq<seq||!validTick(command.predictionTick))return command;
    const anchored=edgeTick+command.seq-seq;
    return anchored>command.predictionTick?{...command,predictionTick:anchored}:command;
  });
}

export function replayMovementTimeline(authoritative,pending,movePlayer,players=[],{dt=1/60,targetTick}={}){
  const player={...authoritative},serverTick=authoritativeMovementTick(authoritative);
  let previous=-1,hasLocalTicks=true;
  for(const command of pending){
    if(!validTick(command.predictionTick)||command.predictionTick<=previous){hasLocalTicks=false;break;}
    previous=command.predictionTick;
  }
  if(serverTick===null||!hasLocalTicks){
    for(const command of pending)movePlayer(player,command.input,dt,players);
    return {player,pending,timeline:{version:0,replayedTicks:pending.length,coveredCommands:0}};
  }
  const requested=Math.max(serverTick,validTick(targetTick)?targetTick:serverTick,...pending.map(command=>command.predictionTick));
  const endTick=Math.min(requested,serverTick+MAX_MOVEMENT_REPLAY_TICKS),byTick=new Map(pending.map(command=>[command.predictionTick,command]));
  // Elapsed time does not prove that an unacknowledged jump/stance edge ran.
  // Keep the established speculative edge path until its real command ACK;
  // otherwise an input gap can cancel a wheel jump or restore a released latch.
  let jump=Boolean(player.jumpHeld),crouch=Boolean(player.ducking||player.crouch),walk=Boolean(player.walk),edge=null;
  for(const command of pending){
    if(command.predictionTick>serverTick)break;
    const input=command.input;
    if(Boolean(input.jump)!==jump){edge='jump';break;}
    if(Boolean(input.crouch)!==crouch){edge='stance';break;}
    if(Boolean(input.walk)!==walk){edge='walk';break;}
    jump=Boolean(input.jump);crouch=Boolean(input.crouch);walk=Boolean(input.walk);
  }
  if(edge){
    // Rebase the private labels to the edge path we actually simulated. This
    // keeps its phase when a later ACK removes the edge from pending; retaining
    // the old labels would discard the next sample and undo part of the jump.
    const rebased=pending.map((command,index)=>({...command,predictionTick:serverTick+index+1}));
    for(const command of rebased)movePlayer(player,command.input,dt,players);
    player.movementTick=serverTick+rebased.length;
    return {player,pending:rebased,timeline:{version:MOVEMENT_TIMELINE_VERSION,strategy:'edge-replay',edge,authoritativeTick:serverTick,predictedTick:player.movementTick,replayedTicks:rebased.length,coveredCommands:0,physicalReplayEndTick:player.movementTick,bounded:false}};
  }
  let neutralTicks=0;
  for(let tick=serverTick+1;tick<=endTick;tick++){
    const command=byTick.get(tick);
    if(command)movePlayer(player,command.input,dt,players);
    else {
      // A locally missing slot has no command to replay. Match the authority's
      // safe idle physics, including its jump-edge preservation, exactly once.
      const heldJump=player.jumpHeld;
      movePlayer(player,{f:0,s:0,yaw:player.yaw||0,pitch:player.pitch||0,fire:false,jump:false,crouch:false,walk:false,use:false},dt,players);
      player.jumpHeld=heldJump;neutralTicks++;
    }
  }
  player.movementTick=endTick;
  return {player,pending,timeline:{version:MOVEMENT_TIMELINE_VERSION,strategy:'physical-time',authoritativeTick:serverTick,predictedTick:endTick,replayedTicks:endTick-serverTick,neutralTicks,coveredCommands:pending.filter(command=>command.predictionTick<=serverTick).length,bounded:requested!==endTick}};
}
