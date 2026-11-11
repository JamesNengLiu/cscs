// Experimental adapter: preserves the proven v1.0 algorithm with the CS2 world.
import {movePlayer} from './cs2-client-world.js';
import {INPUT_DT,MAX_INPUT_QUEUE,INPUT_BACKLOG_LIMIT,orderedInputCommands,sameHeldInput} from './cs2-input-protocol.js';
import {reconcileMovementTimeline} from './cs2-movement-timeline.js';
export const PREDICTION_DT=INPUT_DT;
export const MAX_PENDING_COMMANDS=MAX_INPUT_QUEUE;
// ACK covers applied commands AND explicitly skipped stale/gap/cancelled slots.
// Replacing Y alone while retaining future X/Z creates an invalid slope pose.
// `options.clock` is the client's movement prediction clock; it lets a measured
// applied-command tick re-anchor both the pending labels and future samples.
export function reconcileMovement(authoritative,commands,round,players=[],options={}){
  return reconcileMovementTimeline(authoritative,commands,round,movePlayer,players,{...options,dt:PREDICTION_DT,maxPending:MAX_PENDING_COMMANDS,order:orderedInputCommands,backlogLimit:INPUT_BACKLOG_LIMIT,sameInput:sameHeldInput});
}
export function visualCorrection(previous,next,offset={x:0,y:0,z:0},{maxDistance=.5}={}){
  const value={x:previous.x+offset.x-next.x,y:previous.y+offset.y-next.y,z:previous.z+offset.z-next.z};
  return Math.hypot(value.x,value.y,value.z)<=maxDistance?value:{x:0,y:0,z:0};
}
export function decayCorrection(offset,dt,{maxSpeed=Infinity}={}){const time=Math.max(0,dt),exponential=Math.exp(-16*time);if(!Number.isFinite(maxSpeed))return {x:offset.x*exponential,y:offset.y*exponential,z:offset.z*exponential};const distance=Math.hypot(offset.x,offset.y,offset.z),drop=Math.min(distance*(1-exponential),Math.max(0,maxSpeed)*time),factor=distance?1-drop/distance:0;return {x:offset.x*factor,y:offset.y*factor,z:offset.z*factor};}
