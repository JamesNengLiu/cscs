import {RULES} from './config.js';
import {sanitizedInput} from './movement.js';

export const MOVEMENT_SYNC='command-queue-v2';
export const INPUT_DT=1/RULES.tick;
export const MAX_INPUT_SEQUENCE=2147483647;
export const MAX_INPUT_QUEUE=128;
export const MAX_INPUT_BATCH=32;
export const MAX_INPUT_AGE_TICKS=30;
export const INPUT_REORDER_TICKS=2;
export const INPUT_REDUNDANCY=8;
export const LEGACY_INPUT_GRACE_SECONDS=.1;
// Sequenced commands represent exactly one tick, never an indefinitely held intent.
// A zero-tick hold grace avoids simulating lost history twice during replay.
export const SEQUENCED_INPUT_GRACE_TICKS=0;

export function validInputSequence(seq){return Number.isSafeInteger(seq)&&seq>0&&seq<=MAX_INPUT_SEQUENCE;}
export function normalizeInputCommand(command,round){
  if(!command||typeof command!=='object'||Array.isArray(command))return null;
  const input=command.input===undefined?command:command.input;
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const seq=command.seq===undefined?input.seq:command.seq;
  const commandRound=command.round===undefined?input.round:command.round;
  if(!validInputSequence(seq)||!Number.isSafeInteger(commandRound)||commandRound!==round)return null;
  return {seq,round:commandRound,input:sanitizedInput(input)};
}
// First copy wins: redundant datagrams cannot rewrite an already queued edge.
export function orderedInputCommands(commands,round,ack=0,limit=MAX_INPUT_QUEUE){
  if(!Array.isArray(commands))return [];
  const unique=new Map();
  for(const raw of commands.slice(0,MAX_INPUT_QUEUE)){
    const c=normalizeInputCommand(raw,round);
    if(c&&c.seq>ack&&!unique.has(c.seq))unique.set(c.seq,c);
  }
  return [...unique.values()].sort((a,b)=>a.seq-b.seq).slice(0,Math.max(0,Math.min(MAX_INPUT_QUEUE,limit)));
}
// Transport-independent UDP/WebTransport payload. Send after every fixed sample;
// repeat the newest eight unacknowledged samples, not just the latest intent.
// This bounds packet size; recovery beyond this window requires explicit resend.
export function buildInputBatch(commands,round,ack=0){
  const ordered=orderedInputCommands(commands,round,ack);
  return {type:'inputBatch',commands:ordered.slice(-INPUT_REDUNDANCY).map(c=>({seq:c.seq,round:c.round,...c.input}))};
}
export function isNeutralInput(input){
  return input.f===0&&input.s===0&&!input.fire&&!input.jump&&!input.crouch&&!input.walk&&!input.use;
}
