// Shared browser/server framing. A lost fragment never blocks a newer snapshot.
export const WIRE_VERSION=1,MAX_MESSAGE_BYTES=65536,MAX_FRAGMENTS=128,HEADER_BYTES=16;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
export function encodeDatagrams(message,{sequence=1,maxSize=1000}={}){
  const bytes=encoder.encode(JSON.stringify(message));
  if(bytes.length>MAX_MESSAGE_BYTES)throw new RangeError('Message too large');
  if(!Number.isInteger(sequence)||sequence<1||sequence>0xffffffff||!Number.isFinite(maxSize)||maxSize<256)throw new RangeError('Invalid framing options');
  const payload=Math.floor(Math.min(maxSize,1200))-HEADER_BYTES,count=Math.ceil(bytes.length/payload);
  if(count>MAX_FRAGMENTS)throw new RangeError('Too many fragments');
  return Array.from({length:count},(_,index)=>{const body=bytes.subarray(index*payload,(index+1)*payload),packet=new Uint8Array(HEADER_BYTES+body.length),view=new DataView(packet.buffer);
    view.setUint16(0,0x4c53);view.setUint8(2,WIRE_VERSION);view.setUint8(3,0);view.setUint32(4,sequence);view.setUint16(8,index);view.setUint16(10,count);view.setUint32(12,bytes.length);packet.set(body,HEADER_BYTES);return packet;});
}
export function createReassembler({now=()=>performance.now(),maxPending=8,maxAgeMs=200}={}){
  const pending=new Map();let expired=0,rejected=0,completed=0;
  function prune(){for(const [id,p]of pending)if(now()-p.at>maxAgeMs){pending.delete(id);expired++;}}
  return {push(packet){prune();try{
    if(!(packet instanceof Uint8Array)||packet.length<HEADER_BYTES||packet.length>1200)throw Error();
    const view=new DataView(packet.buffer,packet.byteOffset,packet.byteLength),id=view.getUint32(4),index=view.getUint16(8),count=view.getUint16(10),total=view.getUint32(12);
    if(view.getUint16(0)!==0x4c53||view.getUint8(2)!==WIRE_VERSION||!id||!count||count>MAX_FRAGMENTS||index>=count||!total||total>MAX_MESSAGE_BYTES)throw Error();
    let entry=pending.get(id);if(!entry){if(pending.size>=maxPending){pending.delete(pending.keys().next().value);expired++;}entry={at:now(),count,total,parts:new Map(),bytes:0};pending.set(id,entry);}
    if(entry.count!==count||entry.total!==total)throw Error();
    if(!entry.parts.has(index)){const body=packet.slice(HEADER_BYTES);entry.parts.set(index,body);entry.bytes+=body.length;if(entry.bytes>total)throw Error();}
    if(entry.parts.size!==count)return null;
    pending.delete(id);if(entry.bytes!==total)throw Error();const bytes=new Uint8Array(total);let cursor=0;for(let i=0;i<count;i++){const part=entry.parts.get(i);bytes.set(part,cursor);cursor+=part.length;}
    const message=JSON.parse(decoder.decode(bytes));completed++;return message;
  }catch{rejected++;return null;}},reset(){pending.clear();},diagnostics(){prune();return {pending:pending.size,expired,rejected,completed};}};
}
// Reliable control is newline framed and has strict per-message limits on BOTH endpoints.
export async function readReliable(readable,onMessage){
  const reader=readable.getReader();let buffer=new Uint8Array(0);
  try{while(true){const {value,done}=await reader.read();if(done)break;
    const next=new Uint8Array(buffer.length+value.length);next.set(buffer);next.set(value,buffer.length);buffer=next;
    let start=0;for(let i=0;i<buffer.length;i++)if(buffer[i]===10){if(i-start>MAX_MESSAGE_BYTES)throw Error('Control message too large');if(i>start)onMessage(JSON.parse(decoder.decode(buffer.subarray(start,i))));start=i+1;}
    buffer=buffer.slice(start);if(buffer.length>MAX_MESSAGE_BYTES)throw Error('Control message too large');
  }if(buffer.length)throw Error('Truncated reliable message');}finally{reader.releaseLock();}
}
export function encodeReliable(message){const bytes=encoder.encode(JSON.stringify(message)+'\n');if(bytes.length>MAX_MESSAGE_BYTES)throw RangeError('Control too large');return bytes;}
