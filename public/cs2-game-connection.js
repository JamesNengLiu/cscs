// Same tested transport/action ordering with the isolated CS2 framing budget.
import {encodeDatagrams,createReassembler,readReliable,encodeReliable} from './cs2-net-wire.js';
import {createCS2InputRecovery} from './cs2-input-recovery.js';
import {isNeutralInput,normalizeInputCommand,MAX_INPUT_BATCH} from './cs2-input-protocol.js';
// WebSocket-compatible surface. Fallback only BEFORE join: reconnecting an active game requires a refresh.
export class GameConnection{
  constructor({mode=new URLSearchParams(location.search).get('transport')||'auto',timeoutMs=5000,deferStates=false}={}){
    this.readyState=0;this.bufferedAmount=0;this.transport='connecting';this.reason='';this.counters={sentDatagrams:0,receivedDatagrams:0,coalescedInputs:0,staleStates:0,coalescedStates:0};this.closed=false;this.mode=mode;this.timeoutMs=timeoutMs;this.sequence=0;this.actionSequence=0;this.latestInput=null;this.datagramBusy=false;this.controlQueue=Promise.resolve();this.reassembler=createReassembler();this.lastStateSeq=0;this.deferStates=deferStates;this.pendingState=null;queueMicrotask(()=>this.connect());
    this.pendingTimeline=[];this.counters.droppedTimelineStates=0;
    this.inputRecovery=createCS2InputRecovery();this.inputRecoveryPending=null;this.inputRecoveryBufferedBytes=0;this.datagramWriteStartedAt=null;
  }
  diagnostics(){return {transport:this.transport,fallbackReason:this.reason,...this.counters,pendingTimelineStates:this.pendingTimeline.length,reassembly:this.reassembler.diagnostics(),bufferedBytes:this.bufferedAmount,inputRecovery:{...this.inputRecovery?.diagnostics(),...this.inputRecoveryWrites,pendingReliableBytes:this.inputRecoveryBufferedBytes||0,pendingReliable:Boolean(this.inputRecoveryPending),writerPendingMs:Number.isFinite(this.datagramWriteStartedAt)?Math.max(0,performance.now()-this.datagramWriteStartedAt):0}};}
  // Also tolerate prototype-only diagnostic fixtures without opening a socket.
  recoveryHistory(){return this.inputRecovery??=createCS2InputRecovery();}
  trackInputHistory(commands,round,ack=0){return this.recoveryHistory().track(commands,round,ack);}
  observeInputAck(round,ack){const history=this.recoveryHistory(),before=history.round,result=history.observeAck(round,ack);if(result&&before!==history.round&&this.latestInput?.commands?.some(c=>c.round!==round))this.latestInput=null;return result;}
  cancelInputRecovery(round,throughSeq){const result=this.recoveryHistory().cancel(round,throughSeq);if(result)this.latestInput=null;return result;}
  recoverInputHistory(throughSeq=Infinity){
    if(this.transport!=='webtransport'||this.closed||this.readyState!==1||this.inputRecoveryPending||this.bufferedAmount>16384||!this.control)return false;
    const history=this.recoveryHistory(),writerStalled=Number.isFinite(this.datagramWriteStartedAt)&&performance.now()-this.datagramWriteStartedAt>=80,ackStalled=history.ackStalled();
    // An ACK must stop advancing for180ms, not merely lag eight commands.
    // This is a bounded redundancy probe, never a claim of measured loss.
    if(!writerStalled&&!ackStalled)return false;
    const plan=history.plan({throughSeq});if(!plan)return false;
    const actionSeq=this.actionSequence+1,initial=encodeReliable({type:'inputCritical',commands:plan.commands,actionSeq});
    if(initial.length>4096||!history.commit(plan))return false;
    // Reserve action order now, exactly like ordinary reliable messages. Doing
    // this inside the later promise would invalidate already-numbered Q/fire.
    this.actionSequence=actionSeq;const job={round:plan.round,actionSeq,writerTriggered:writerStalled,ackAtQueue:history.ack};this.inputRecoveryPending=job;this.inputRecoveryBufferedBytes=initial.length;
    const writes=this.inputRecoveryWrites??={writerTriggeredJobs:0,ackStallProbeJobs:0,submittedMessages:0,submittedCommands:0,submittedBytes:0,completedWrites:0,skippedBeforeWrite:0,writeFailures:0};
    if(writerStalled)writes.writerTriggeredJobs++;else writes.ackStallProbeJobs++;
    // A separate single <=4KiB slot cannot consume the main 64KiB action
    // admission budget or close a healthy action lane. It shares FIFO order.
    this.controlQueue=this.controlQueue.then(()=>{
      if(this.closed||this.readyState!==1){writes.skippedBeforeWrite++;return;}const commands=history.filter(plan);if(!commands.length){writes.skippedBeforeWrite++;return;}
      if(!job.writerTriggered&&history.ack>job.ackAtQueue){history.release(plan);writes.skippedBeforeWrite++;return;}
      const bytes=encodeReliable({type:'inputCritical',commands,actionSeq});if(bytes.length>4096){writes.skippedBeforeWrite++;return;}
      writes.submittedMessages++;writes.submittedCommands+=commands.length;writes.submittedBytes+=bytes.length;
      return Promise.resolve(this.control.write(bytes)).then(()=>{writes.completedWrites++;});
    }).catch(()=>{writes.writeFailures++;this.close();}).finally(()=>{if(this.inputRecoveryPending===job){this.inputRecoveryPending=null;this.inputRecoveryBufferedBytes=0;}});return true;
  }
  async connect(){
    if(this.mode!=='websocket')try{
      const response=await fetch('/transport-config',{cache:'no-store'}),config=await response.json();
      if(!config.webtransport)throw Error('Server WebTransport disabled');
      if(!isSecureContext||!globalThis.WebTransport)throw Error('Native WebTransport requires a secure context and supported browser');
      const wt=new WebTransport(new URL(config.path,location.origin).href,{requireUnreliable:true,congestionControl:'low-latency',serverCertificateHashes:[{algorithm:'sha-256',value:new Uint8Array(config.certificateHash)}]});this.wt=wt;wt.closed.catch(()=>{});
      let timer;try{await Promise.race([wt.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('QUIC connection timed out')),this.timeoutMs);})]);}finally{clearTimeout(timer);}
      const stream=await wt.createBidirectionalStream();this.control=stream.writable.getWriter();this.datagrams=wt.datagrams.writable.getWriter();
      this.transport='webtransport';this.readyState=1;this.onopen?.({});
      readReliable(stream.readable,m=>this.deliver(m)).then(()=>this.finish()).catch(()=>this.finish());
      (async()=>{for await(const bytes of wt.datagrams.readable){this.counters.receivedDatagrams++;const m=this.reassembler.push(bytes);if(m)this.deliver(m);}})().catch(()=>this.finish());
      wt.closed.then(()=>this.finish(),()=>this.finish());return;
    }catch(error){this.reason=String(error.message||error);try{this.wt?.close();}catch{}if(this.mode==='webtransport'){this.onerror?.({message:this.reason});this.finish();return;}}
    if(this.closed)return;
    this.transport='websocket';const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}`);this.ws=ws;
    ws.onopen=()=>{this.readyState=1;this.onopen?.({});};ws.onmessage=e=>{try{this.deliver(JSON.parse(e.data));}catch{this.finish();}};ws.onerror=e=>this.onerror?.(e);ws.onclose=()=>this.finish();
  }
  deliver(m){
    if(this.closed)return;
    if(m.type==='state'){const seq=m.net?.seq||0;if(seq&&seq<=this.lastStateSeq){this.counters.staleStates++;return;}this.lastStateSeq=Math.max(this.lastStateSeq,seq);}
    const event={data:JSON.stringify(m),receivedAtMs:performance.now()};
    if(m.type==='state'){
      this.onstatearrival?.(m,event);
      // Consume one newest state at the start of the game frame. Events and
      // reliable action acknowledgements still arrive immediately.
      if(this.deferStates&&m.net?.seq){if(this.pendingState)this.counters.coalescedStates++;this.pendingState=event;this.pendingTimeline.push({snapshot:m,receivedAtMs:event.receivedAtMs});if(this.pendingTimeline.length>32){this.pendingTimeline.shift();this.counters.droppedTimelineStates++;}return;}
    }
    this.onmessage?.(event);
  }
  flushState(){const event=this.pendingState,timeline=this.pendingTimeline;this.pendingState=null;this.pendingTimeline=[];if(event&&!this.closed){if(this.onstatehistory){this.onstatehistory(timeline);event.timelineBuffered=true;}this.onmessage?.(event);}}
  send(payload){
    if(this.readyState!==1)return;const m=typeof payload==='string'?JSON.parse(payload):payload;
    if((m.type==='inputBatch'||m.type==='inputCritical')&&Array.isArray(m.commands)){
      const round=m.commands?.[0]?.round??m.round;
      this.trackInputHistory(m.commands,round,this.inputRecovery?.round===round?this.inputRecovery.ack:0);
      if(m.type==='inputCritical'){
        const seqs=(m.commands||[]).map(c=>c.seq).filter(Number.isSafeInteger);
        if(seqs.length)this.recoverInputHistory(Math.min(...seqs)-1);
        this.recoveryHistory().noteReliable(m.commands,round);
      }
    }else if(['equip','drop','reload','secondary'].includes(m.type)&&Number.isSafeInteger(m.afterInputSeq)&&m.afterInputSeq>=0&&Array.isArray(m.commands)&&m.commands.length<=MAX_INPUT_BATCH&&m.commands.every(raw=>{const c=normalizeInputCommand(raw,m.round);return c&&c.seq<=m.afterInputSeq;})){
      // Scope-aware actions feed these commands through the same server input
      // queue. They are already reliably covered, not another resend target.
      this.trackInputHistory(m.commands,m.round,this.inputRecovery?.round===m.round?this.inputRecovery.ack:0);
      const seqs=m.commands.map(c=>c.seq??c.input?.seq);if(seqs.length)this.recoverInputHistory(Math.min(...seqs)-1);
      this.recoveryHistory().noteReliable(m.commands,m.round);
    }else if(m.type==='input'){
      const input=m.input??m;if(isNeutralInput(input))this.cancelInputRecovery(input.round??this.inputRecovery?.round,input.cancelThroughSeq);
    }
    if(this.transport==='websocket'){if(this.ws.bufferedAmount>65536){if(m.type==='inputBatch')return;this.close();return;}this.ws.send(JSON.stringify(m));this.bufferedAmount=this.ws.bufferedAmount;return;}
    if(m.type==='inputBatch'||m.type==='ping'){
      if(m.type==='inputBatch'){if(this.latestInput)this.counters.coalescedInputs++;this.latestInput=m;}else this.latestPing=m;
      if(m.type==='inputBatch')this.recoverInputHistory();
      if(!this.datagramBusy)this.flushDatagrams();return;
    }
    const message={...m,actionSeq:++this.actionSequence},bytes=encodeReliable(message);if(this.bufferedAmount+bytes.length>65536){this.close();return;}
    this.bufferedAmount+=bytes.length;this.controlQueue=this.controlQueue.then(()=>this.control.write(bytes)).catch(()=>this.close()).finally(()=>{this.bufferedAmount-=bytes.length;});
  }
  async flushDatagrams(){this.datagramBusy=true;try{while((this.latestInput||this.latestPing)&&!this.closed){const m=this.latestPing||this.latestInput;if(this.latestPing)this.latestPing=null;else this.latestInput=null;
    const packets=encodeDatagrams(m,{sequence:++this.sequence,maxSize:Math.min(1000,this.wt.datagrams.maxDatagramSize||1000)});
    for(const bytes of packets){this.datagramWriteStartedAt=performance.now();try{await this.datagrams.write(bytes);this.counters.sentDatagrams++;}finally{this.datagramWriteStartedAt=null;}}
  }}catch{this.close();}finally{this.datagramBusy=false;}}
  finish(){if(this.closed)return;this.closed=true;this.pendingState=null;this.pendingTimeline=[];this.latestInput=null;this.inputRecovery?.reset();this.inputRecoveryPending=null;this.inputRecoveryBufferedBytes=0;this.readyState=3;try{this.wt?.close();}catch{}this.ws?.close();this.onclose?.({});}
  close(){this.finish();}
}
