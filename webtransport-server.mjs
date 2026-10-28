import {EventEmitter} from 'node:events';
import {randomBytes} from 'node:crypto';
import {Http3Server} from '@fails-components/webtransport';
import {encodeDatagrams,createReassembler,readReliable,encodeReliable,MAX_MESSAGE_BYTES} from './public/net-wire.js';
export async function startWebTransport({port,host,cert,key,onPeer}){
  const sessions=new Set();
  const server=new Http3Server({port,host,cert,privKey:key,secret:randomBytes(32).toString('hex')});
  server.setRequestCallback(async({header})=>{const allowed=header[':path']==='/wt'&&header.origin===`https://${header[':authority']}`;if(!allowed)console.warn('WebTransport origin/path rejected',JSON.stringify({path:header[':path'],origin:header.origin,authority:header[':authority']}));return {status:allowed?200:403,path:'/wt'};});
  const stream=server.sessionStream('/wt');server.startServer();
  await Promise.race([server.ready,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('HTTP/3 server startup timeout')),8000);t.unref();})]);
  (async()=>{for await(const session of stream){sessions.add(session);attach(session).catch(()=>session.close());}})().catch(()=>{});
  async function attach(session){
    const timeout=setTimeout(()=>session.close({closeCode:1,reason:'Control stream timeout'}),5000);timeout.unref();
    session.closed.catch(()=>{}).finally(()=>{sessions.delete(session);clearTimeout(timeout);});
    const reader=session.incomingBidirectionalStreams.getReader();let channel;
    try{const result=await reader.read();if(result.done)return;channel=result.value;}finally{reader.releaseLock();}
    clearTimeout(timeout);const control=channel.writable.getWriter(),datagrams=session.datagrams.writable.getWriter(),reassembler=createReassembler();
    const peer=new EventEmitter();let queue=Promise.resolve(),sequence=0,sending=false,latest=null,closed=false;
    Object.assign(peer,{transport:'webtransport',readyState:1,bufferedAmount:0,transportCounters:{sentDatagrams:0,receivedDatagrams:0,coalescedStates:0,droppedStates:0},close(){if(closed)return;closed=true;peer.readyState=3;session.close();peer.emit('close');},terminate(){peer.close();},send(payload){
      if(closed)return;const message=JSON.parse(payload);
      if(message.type==='state'){
        if(latest)peer.transportCounters.coalescedStates++;latest=message;if(!sending)flushStates();return;
      }
      const bytes=encodeReliable(message);if(peer.bufferedAmount+bytes.length>MAX_MESSAGE_BYTES*2){peer.close();return;}
      peer.bufferedAmount+=bytes.length;queue=queue.then(()=>control.write(bytes)).catch(()=>peer.close()).finally(()=>{peer.bufferedAmount-=bytes.length;});
    }});
    async function flushStates(){sending=true;try{while(latest&&!closed){const message=latest;latest=null;
      const packets=encodeDatagrams(message,{sequence:++sequence,maxSize:Math.min(1000,session.datagrams.maxDatagramSize||1000)});
      for(const packet of packets){await datagrams.write(packet);peer.transportCounters.sentDatagrams++;}
    }}catch{peer.transportCounters.droppedStates++;}finally{sending=false;}}
    onPeer(peer,{headers:{}});
    session.closed.catch(()=>{}).finally(()=>{if(!closed){closed=true;peer.readyState=3;peer.emit('close');}});
    readReliable(channel.readable,message=>peer.emit('message',Buffer.from(JSON.stringify(message)))).then(()=>peer.close()).catch(()=>peer.close());
    (async()=>{for await(const packet of session.datagrams.readable){peer.transportCounters.receivedDatagrams++;const message=reassembler.push(packet);if(message){if(message.type!=='inputBatch'&&message.type!=='ping'){peer.close();return;}peer.emit('message',Buffer.from(JSON.stringify(message)));}}})().catch(()=>peer.close());
    // Reject extra control streams; one ordered control stream per session is the application contract.
    (async()=>{for await(const extra of session.incomingBidirectionalStreams){await extra.readable.cancel();await extra.writable.abort();}})().catch(()=>{});
  }
  return {server,close(){for(const session of sessions)session.close();server.stopServer();},address:()=>server.address()};
}
