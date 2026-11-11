// Local prediction metadata only. Command ACKs and weapon barriers retain their
// existing meaning; a movement tick is never permission to discard a command.
export const MOVEMENT_TIMELINE_VERSION=1;
export const MAX_MOVEMENT_REPLAY_TICKS=128;
const validTick=value=>Number.isSafeInteger(value)&&value>=0;

export function authoritativeMovementTick(player){
  return player?.movementTimelineVersion===MOVEMENT_TIMELINE_VERSION&&validTick(player.movementTick)?player.movementTick:null;
}

// The clock starts from the last received authority tick, which is older than
// the tick at which a fresh sample will really execute (transport delay plus
// queue depth). Its labels therefore stay provisional until an applied command
// anchors them; see alignAppliedMovement.
export function createMovementPredictionClock(){
  let tick=null,labelTick=null,anchored=false;
  return {
    reset(player=null){tick=labelTick=authoritativeMovementTick(player);anchored=false;},
    observe(player){const received=authoritativeMovementTick(player);if(received===null)tick=labelTick=null;else{tick=Math.max(received,tick??received);labelTick=Math.max(received,labelTick??received);}return tick;},
    next(){if(labelTick===null||labelTick===Number.MAX_SAFE_INTEGER||tick===Number.MAX_SAFE_INTEGER)return null;tick++;return ++labelTick;},
    // Keep future labels on the same timeline as the pending samples that an
    // applied-command anchor just moved, in either direction.
    shift(delta){if(tick!==null&&Number.isSafeInteger(delta)&&delta!==0){tick=Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,tick+delta));labelTick=Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,labelTick+delta));}return tick;},
    raise(value){if(tick!==null&&validTick(value)&&value>labelTick){tick=Math.min(Number.MAX_SAFE_INTEGER,tick+value-labelTick);labelTick=value;}return tick;},
    // Retired samples keep their ordered nominal labels, but consume no future
    // physical step. Commit both horizons rather than mislabelling the pose.
    commit(physical,nominal=physical){if(validTick(physical)){tick=physical;labelTick=validTick(nominal)?Math.max(physical,nominal):physical;}return tick;},
    markAnchored(){if(tick!==null)anchored=true;return anchored;},
    get anchored(){return anchored;},
    get tick(){return tick;},
    get labelTick(){return labelTick;},
  };
}

export function supportsAppliedMovementAnchor(player){
  return authoritativeMovementTick(player)!==null&&validTick(player.movementAppliedTick);
}

// The authority publishes the physics tick that consumed its newest applied
// command. That measured pair re-labels the still pending samples in BOTH
// directions: forwards when delivery delay or queue depth made the command run
// later than its provisional label, and backwards when the queue became
// shorter again. Without the backward move every later replay would insert
// idle steps that the authority never runs. A skipped command is acknowledged
// but never applied, so it cannot be an anchor.
export function alignAppliedMovement(authoritative,commands,round){
  const none={commands,shift:0,anchored:false};
  if(!supportsAppliedMovementAnchor(authoritative)||!Array.isArray(commands))return none;
  const tick=authoritativeMovementTick(authoritative),seq=authoritative.lastAppliedInputSeq,appliedTick=authoritative.movementAppliedTick;
  if(!Number.isSafeInteger(seq)||seq<=0||seq>(authoritative.ackInputSeq||0)||appliedTick<=0||appliedTick>tick)return none;
  const applied=commands.find(command=>command?.round===round&&command.seq===seq&&validTick(command.predictionTick));
  if(!applied)return none;
  const shift=appliedTick-applied.predictionTick;
  if(!shift)return {commands,shift:0,anchored:true};
  return {shift,anchored:true,commands:commands.map(command=>command?.round===round&&command.seq>=seq&&validTick(command.predictionTick)?{...command,predictionTick:Math.max(0,command.predictionTick+shift)}:command)};
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

// The authority retires redundant held-input samples while its queue is deeper
// than `limit` (see INPUT_BACKLOG_LIMIT). Mirror that rule on the still pending
// samples so prediction neither runs ahead by the whole backlog nor steps back
// once per retired command. `appliedInput` is the input of the newest applied
// command. The result marks, never removes: a marked sample keeps its ACK,
// weapon-order and resend duties and only stops consuming a predicted step.
export function markRetiredBacklog(pending,{backlog,queuedSeqs,protectedSeqs=[],limit,appliedInput,same}={}){
  const clean=pending.some(command=>command.predictionRetired)?pending.map(command=>{if(!command.predictionRetired)return command;const {predictionRetired,...rest}=command;return rest;}):pending;
  if(!Number.isSafeInteger(backlog)||!Number.isSafeInteger(limit)||limit<1||backlog<=limit||!appliedInput||typeof same!=='function'||!Array.isArray(queuedSeqs)||queuedSeqs.length!==backlog)return clean;
  // A queue depth alone cannot distinguish received commands from future
  // in-flight ones. Only mirror a fully known queued prefix; never invent new
  // arrivals to keep its depth artificially constant while draining it.
  if(queuedSeqs.some((seq,index)=>!Number.isSafeInteger(seq)||seq<=0||index>0&&seq<=queuedSeqs[index-1]||clean[index]?.seq!==seq))return clean;
  const protectedSet=new Set(protectedSeqs);
  let depth=backlog,applied=appliedInput,changed=false;const result=clean.slice();
  for(let index=0;index<queuedSeqs.length&&depth>0;index++){
    const command=result[index],following=result[index+1];
    if(depth>limit&&index+1<queuedSeqs.length&&following.seq===command.seq+1&&!protectedSet.has(command.seq)&&!command.input.fire&&!command.input.use&&same(command.input,applied)&&same(command.input,following.input)){
      // The authority retires this sample and simulates its successor in the
      // same tick, so the successor itself is never the next candidate.
      result[index]={...command,predictionRetired:true};depth-=2;changed=true;applied=following.input;index++;
    }else{applied=command.input;depth--;}
  }
  return changed?result:clean;
}

export function replayMovementTimeline(authoritative,pending,movePlayer,players=[],{dt=1/60,targetTick,sequential=false}={}){
  const player={...authoritative},serverTick=authoritativeMovementTick(authoritative);
  let previous=-1,hasLocalTicks=true;
  for(const command of pending){
    if(!validTick(command.predictionTick)||command.predictionTick<=previous){hasLocalTicks=false;break;}
    previous=command.predictionTick;
  }
  // Samples the authority is expected to retire consume no physical step, so
  // every later sample runs that many steps earlier than its stored label.
  const active=[];let retired=0;
  for(const command of pending){if(command.predictionRetired)retired++;else active.push({command,tick:hasLocalTicks?Math.max(0,command.predictionTick-retired):null});}
  if(serverTick===null||!hasLocalTicks){
    for(const {command} of active)movePlayer(player,command.input,dt,players);
    return {player,pending,timeline:{version:0,replayedTicks:active.length,coveredCommands:0,retiredCommands:retired}};
  }
  const target=validTick(targetTick)?Math.max(0,targetTick-retired):serverTick;
  const requested=Math.max(serverTick,target,...active.map(sample=>sample.tick));
  const endTick=Math.min(requested,serverTick+MAX_MOVEMENT_REPLAY_TICKS),byTick=new Map(active.map(sample=>[sample.tick,sample.command]));
  // Elapsed time does not prove that an unacknowledged jump/stance edge ran.
  // Keep the established speculative edge path until its real command ACK;
  // otherwise an input gap can cancel a wheel jump or restore a released latch.
  let jump=Boolean(player.jumpHeld),crouch=Boolean(player.ducking||player.crouch),walk=Boolean(player.walk),edge=null;
  for(const {command,tick} of active){
    if(tick>serverTick)break;
    const input=command.input;
    if(Boolean(input.jump)!==jump){edge='jump';break;}
    if(Boolean(input.crouch)!==crouch){edge='stance';break;}
    if(Boolean(input.walk)!==walk){edge='walk';break;}
    jump=Boolean(input.jump);crouch=Boolean(input.crouch);walk=Boolean(input.walk);
  }
  // Provisional labels (no applied-command anchor since the last clock reset)
  // carry no evidence about when their samples run. An unacknowledged command
  // cannot have executed, so the earliest consistent schedule is one command
  // per step after the authority tick. Treating them as already covered would
  // switch local prediction off for a full round trip after every reset.
  if(sequential&&!edge&&active.length)edge='unanchored';
  if(edge){
    // Rebase the private labels to the edge path we actually simulated. This
    // keeps its phase when a later ACK removes the edge from pending; retaining
    // the old labels would discard the next sample and undo part of the jump.
    const rebased=pending.map((command,index)=>({...command,predictionTick:serverTick+index+1}));
    for(const command of rebased)if(!command.predictionRetired)movePlayer(player,command.input,dt,players);
    player.movementTick=serverTick+active.length;
    return {player,pending:rebased,timeline:{version:MOVEMENT_TIMELINE_VERSION,strategy:edge==='unanchored'?'unanchored-replay':'edge-replay',edge:edge==='unanchored'?null:edge,authoritativeTick:serverTick,predictedTick:player.movementTick,replayedTicks:active.length,coveredCommands:0,retiredCommands:retired,physicalReplayEndTick:player.movementTick,bounded:false}};
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
  return {player,pending,timeline:{version:MOVEMENT_TIMELINE_VERSION,strategy:'physical-time',authoritativeTick:serverTick,predictedTick:endTick,replayedTicks:endTick-serverTick,neutralTicks,coveredCommands:active.filter(sample=>sample.tick<=serverTick).length,retiredCommands:retired,bounded:requested!==endTick}};
}

// Shared by the browser client and the Node regressions: order the still
// pending samples, anchor their private labels, then replay. `clock` is the
// client's createMovementPredictionClock(); without it the caller-provided
// targetTick keeps the previous stateless behaviour.
export function reconcileMovementTimeline(authoritative,commands,round,movePlayer,players=[],{clock=null,targetTick,dt=1/60,maxPending=128,order,backlogLimit=0,sameInput}={}){
  if(typeof order!=='function')throw new TypeError('Movement reconciliation requires the input ordering function');
  const wrongRound=authoritative.playedRound!==undefined&&authoritative.playedRound!==round;
  let samples=commands,sequential=false,anchorShift=0;
  if(!wrongRound){
    const applied=alignAppliedMovement(authoritative,commands,round);
    anchorShift=applied.shift;
    if(applied.anchored&&clock){clock.shift(applied.shift);clock.markAnchored();}
    samples=applied.anchored?applied.commands:alignAcknowledgedMovementEdge(authoritative,applied.commands,round);
    sequential=Boolean(clock)&&!clock.anchored&&supportsAppliedMovementAnchor(authoritative);
  }
  let pending=wrongRound?[]:restorePredictionTicks(order(samples,round,authoritative.ackInputSeq||0,maxPending),samples);
  if(!wrongRound&&backlogLimit){
    const applied=commands.find(command=>command?.round===round&&command.seq===authoritative.lastAppliedInputSeq);
    pending=markRetiredBacklog(pending,{backlog:authoritative.inputBacklog,queuedSeqs:authoritative.inputBacklogSeqs,protectedSeqs:authoritative.inputBacklogProtected,limit:backlogLimit,appliedInput:authoritative.inputBacklogAppliedInput||applied?.input,same:sameInput});
  }
  if(clock&&!wrongRound)clock.observe(authoritative);
  const target=wrongRound?authoritativeMovementTick(authoritative):clock?clock.labelTick:validTick(targetTick)?Math.max(0,targetTick+anchorShift):targetTick;
  const result=replayMovementTimeline(authoritative,pending,movePlayer,players,{dt,sequential,...(target===null||target===undefined?{}:{targetTick:target})});
  // Labels retain the nominal ordered horizon; tick reports the actual replay
  // pose. A later sample advances each once, without relabelling an old input.
  if(clock&&!wrongRound){const newest=result.pending.at(-1)?.predictionTick;clock.commit(result.player.movementTick,Math.max(result.player.movementTick,clock.labelTick??0,validTick(newest)?newest:0));}
  return result;
}
