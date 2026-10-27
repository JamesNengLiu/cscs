import {RULES} from './config.js';
import {movePlayer} from './movement.js';
export const PREDICTION_DT=1/RULES.tick;
export const MAX_PENDING_COMMANDS=128;
// Replay only simulation commands newer than the server's actually applied input.
// Replacing Y alone while retaining future X/Z creates an invalid slope pose.
export function reconcileMovement(authoritative,commands,round){
  const pending=commands.filter(c=>c.round===round&&c.seq>(authoritative.ackInputSeq||0));
  const player={...authoritative};
  for(const command of pending)movePlayer(player,command.input,PREDICTION_DT);
  return {player,pending};
}
export function visualCorrection(previous,next,offset={x:0,y:0,z:0}){
  const value={x:previous.x+offset.x-next.x,y:previous.y+offset.y-next.y,z:previous.z+offset.z-next.z};
  return Math.hypot(value.x,value.y,value.z)<=.5?value:{x:0,y:0,z:0};
}
export function decayCorrection(offset,dt){const factor=Math.exp(-16*Math.max(0,dt));return {x:offset.x*factor,y:offset.y*factor,z:offset.z*factor};}
