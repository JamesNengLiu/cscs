import {MAX_INPUT_QUEUE,MAX_INPUT_BATCH,MAX_INPUT_SEQUENCE,normalizeInputCommand,inputViewMetadata} from './cs2-input-protocol.js';

// Bounded first-copy command history. No simulation, timers or network writes.
// Retired entries retain only a seq/age tombstone until ACK/cap eviction, so a
// delayed send cannot make an already expired fire/jump command young again.
export function createCS2InputRecovery({now=()=>performance.now(),maxAgeMs=500,intervalMs=80,maxPerSecond=12,maxCommands=MAX_INPUT_QUEUE,maxBatch=12,maxBytes=4096}={}){
 if(typeof now!=='function'||!Number.isFinite(maxAgeMs)||maxAgeMs<1||maxAgeMs>1000||!Number.isFinite(intervalMs)||intervalMs<20||!Number.isInteger(maxPerSecond)||maxPerSecond<1||maxPerSecond>20||!Number.isInteger(maxCommands)||maxCommands<1||maxCommands>MAX_INPUT_QUEUE||!Number.isInteger(maxBatch)||maxBatch<1||maxBatch>MAX_INPUT_BATCH||!Number.isInteger(maxBytes)||maxBytes<128||maxBytes>8192)throw RangeError('Invalid CS2 input recovery limits');
 const entries=new Map(),recent=[],encoder=new TextEncoder();let round=null,ack=0,watermark=0,retiredThrough=0,highest=0,generation=0,lastRepairAt=-Infinity,lastAckProgressAt=null,serial=0;
 const counts={ackProgress:0,tracked:0,expired:0,capacityRetired:0,ackPurged:0,cancelled:0,roundChanges:0,reliableObserved:0,repairMessages:0,repairCommands:0,resets:0};
 const validRound=r=>Number.isSafeInteger(r)&&r>=0,validAck=a=>Number.isSafeInteger(a)&&a>=0&&a<=MAX_INPUT_SEQUENCE;
 const wire=c=>({seq:c.seq,round:c.round,...c.input,...inputViewMetadata(c)});
 const copy=c=>({...c});
 function clear(){entries.clear();recent.length=0;ack=watermark=retiredThrough=highest=0;lastRepairAt=-Infinity;lastAckProgressAt=null;generation++;}
 function acceptRound(r){if(!validRound(r)||round!==null&&r<round)return false;if(round!==r){clear();if(round!==null)counts.roundChanges++;round=r;lastAckProgressAt=now();}return true;}
 function prune(){const time=now();for(const entry of entries.values())if(entry.command&&time-entry.at>maxAgeMs){entry.command=null;counts.expired++;}while(recent.length&&time-recent[0]>=1000)recent.shift();return time;}
 function observeAck(r,value){if(!validAck(value)||!acceptRound(r))return false;if(value>ack){ack=value;lastAckProgressAt=now();counts.ackProgress++;}highest=Math.max(highest,ack);for(const [seq]of entries)if(seq<=ack){entries.delete(seq);counts.ackPurged++;}prune();return true;}
 function track(commands,r,value=0){if(!Array.isArray(commands)||!observeAck(r,value))return 0;const time=now();let accepted=0;for(const raw of commands.slice(0,MAX_INPUT_QUEUE)){const c=normalizeInputCommand(raw,r);if(!c||c.seq<=Math.max(ack,watermark,retiredThrough)||entries.has(c.seq))continue;entries.set(c.seq,{command:wire(c),at:time,reliable:false,originalReliable:false,repairId:null});highest=Math.max(highest,c.seq);counts.tracked++;accepted++;}while(entries.size>maxCommands){const seq=Math.min(...entries.keys());entries.delete(seq);retiredThrough=Math.max(retiredThrough,seq);counts.capacityRetired++;}return accepted;}
 function filter(plan){prune();if(!plan||plan.round!==round||plan.generation!==generation)return[];return plan.commands.map(c=>entries.get(c.seq)).filter(e=>e?.command&&e.command.seq>Math.max(ack,watermark,retiredThrough)&&e.command.seq<=ack+MAX_INPUT_QUEUE).map(e=>copy(e.command));}
 return{
  track,observeAck,
  cancel(r,through){if(!acceptRound(r))return false;watermark=Math.max(watermark,highest,validAck(through)?through:0,ack);counts.cancelled+=entries.size;entries.clear();generation++;return true;},
  noteReliable(commands,r){if(!Array.isArray(commands))return;track(commands,r,round===r?ack:0);if(r!==round)return;for(const c of commands||[]){const seq=c?.seq??c?.input?.seq,e=entries.get(seq);if(e?.command){if(!e.originalReliable)counts.reliableObserved++;e.originalReliable=e.reliable=true;}}},
  plan({throughSeq=Infinity}={}){const time=prune();if(round===null||time-lastRepairAt<intervalMs||recent.length>=maxPerSecond)return null;const commands=[];for(const [seq,e]of [...entries].sort((a,b)=>a[0]-b[0])){if(!e.command||e.reliable||seq<=Math.max(ack,watermark,retiredThrough)||seq>Math.min(throughSeq,ack+MAX_INPUT_QUEUE))continue;const next=commands.concat(copy(e.command));if(encoder.encode(JSON.stringify({type:'inputCritical',actionSeq:Number.MAX_SAFE_INTEGER,commands:next})+'\n').length>maxBytes)break;commands.push(copy(e.command));if(commands.length>=maxBatch)break;}return commands.length?{id:++serial,round,generation,commands}:null;},
  commit(plan){const commands=filter(plan),fresh=commands.filter(c=>!entries.get(c.seq).reliable);if(!fresh.length)return false;for(const c of fresh){const e=entries.get(c.seq);e.reliable=true;e.repairId=plan.id;}lastRepairAt=now();recent.push(lastRepairAt);counts.repairMessages++;counts.repairCommands+=fresh.length;return true;},
  filter,
  release(plan){if(!plan||plan.round!==round||plan.generation!==generation)return;for(const c of plan.commands){const e=entries.get(c.seq);if(e?.repairId===plan.id&&!e.originalReliable){e.reliable=false;e.repairId=null;}}},
  ackStalled(){return round!==null&&highest-ack>8&&lastAckProgressAt!==null&&now()-lastAckProgressAt>=180;},
  reset(){clear();round=null;counts.resets++;},
  get round(){return round;},
  get ack(){return ack;},
  diagnostics(){prune();const active=[...entries.values()].filter(e=>e.command),seqs=active.map(e=>e.command.seq);return{...counts,round,ack,cancelThrough:watermark,retiredThrough,highestSeen:highest,entries:entries.size,commands:active.length,reliableCovered:active.filter(e=>e.reliable).length,minSeq:seqs.length?Math.min(...seqs):null,maxSeq:seqs.length?Math.max(...seqs):null,maxCommands,maxAgeMs,intervalMs,maxPerSecond,maxBatch,maxBytes,lastAckProgressAt,ackProgressAgeMs:lastAckProgressAt===null?null:Math.max(0,now()-lastAckProgressAt),highestMinusAck:highest-ack,lastRepairAt:Number.isFinite(lastRepairAt)?lastRepairAt:null,scope:'First-copy input history only. repairMessages counts admitted reliable jobs, not writes or applied commands; ACK purges applied and skipped history alike.'};}
 };
}
