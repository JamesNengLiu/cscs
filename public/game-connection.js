import {encodeDatagrams,createReassembler,readReliable,encodeReliable} from './net-wire.js';
// WebSocket-compatible surface. Fallback only BEFORE join: reconnecting an active game requires a refresh.
export class GameConnection{
  constructor({mode=new URLSearchParams(location.search).get('transport')||'auto',timeoutMs=5000}={}){
    this.readyState=0;this.bufferedAmount=0;this.transport='connecting';this.reason='';this.counters={sentDatagrams:0,receivedDatagrams:0,coalescedInputs:0,staleStates:0};this.closed=false;this.mode=mode;this.timeoutMs=timeoutMs;this.sequence=0;this.actionSequence=0;this.latestInput=null;this.datagramBusy=false;this.controlQueue=Promise.resolve();this.reassembler=createReassembler();this.lastStateSeq=0;queueMicrotask(()=>this.connect());
  }
  diagnostics(){return {transport:this.transport,fallbackReason:this.reason,...this.counters,reassembly:this.reassembler.diagnostics(),bufferedBytes:this.bufferedAmount};}
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
    this.onmessage?.({data:JSON.stringify(m)});
  }
  send(payload){
    if(this.readyState!==1)return;const m=typeof payload==='string'?JSON.parse(payload):payload;
    if(this.transport==='websocket'){if(this.ws.bufferedAmount>65536){if(m.type==='inputBatch')return;this.close();return;}this.ws.send(JSON.stringify(m));this.bufferedAmount=this.ws.bufferedAmount;return;}
    if(m.type==='inputBatch'||m.type==='ping'){
      if(m.type==='inputBatch'){if(this.latestInput)this.counters.coalescedInputs++;this.latestInput=m;}else this.latestPing=m;
      if(!this.datagramBusy)this.flushDatagrams();return;
    }
    const message={...m,actionSeq:++this.actionSequence},bytes=encodeReliable(message);if(this.bufferedAmount+bytes.length>65536){this.close();return;}
    this.bufferedAmount+=bytes.length;this.controlQueue=this.controlQueue.then(()=>this.control.write(bytes)).catch(()=>this.close()).finally(()=>{this.bufferedAmount-=bytes.length;});
  }
  async flushDatagrams(){this.datagramBusy=true;try{while((this.latestInput||this.latestPing)&&!this.closed){const m=this.latestPing||this.latestInput;if(this.latestPing)this.latestPing=null;else this.latestInput=null;
    const packets=encodeDatagrams(m,{sequence:++this.sequence,maxSize:Math.min(1000,this.wt.datagrams.maxDatagramSize||1000)});
    for(const bytes of packets){await this.datagrams.write(bytes);this.counters.sentDatagrams++;}
  }}catch{this.close();}finally{this.datagramBusy=false;}}
  finish(){if(this.closed)return;this.closed=true;this.readyState=3;try{this.wt?.close();}catch{}this.ws?.close();this.onclose?.({});}
  close(){this.finish();}
}
