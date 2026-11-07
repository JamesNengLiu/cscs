import test from 'node:test';import assert from 'node:assert/strict';import * as legacy from '../public/net-wire.js';import * as experimental from '../public/cs2-net-wire.js';
test('CS2 wire keeps valid legacy datagram bytes and reliable framing exactly identical',()=>{
 for(const message of [{type:'ping',sent:12},{type:'inputBatch',commands:[{seq:1,round:1,fire:true}]},{type:'state',players:Array.from({length:10},(_,i)=>({id:i,name:'中文玩家',x:12.123,y:2,z:5,extra:'a'.repeat(600)}))}])for(const maxSize of [256,900,1000,1200]){
  assert.deepEqual(experimental.encodeDatagrams(message,{sequence:8,maxSize}),legacy.encodeDatagrams(message,{sequence:8,maxSize}));assert.deepEqual(experimental.encodeReliable(message),legacy.encodeReliable(message));
 }
});
test('86 KiB state reassembles reordered/duplicate fragments and reliable chunks with strict limits',async()=>{
 const message={type:'state',probe:'x'.repeat(86000)},packets=experimental.encodeDatagrams(message,{sequence:1,maxSize:1000});assert.ok(packets.length>64&&packets.length<=128);assert.ok(packets.every(p=>p.length<=1000));const r=experimental.createReassembler();let result;for(const p of packets.slice().reverse()){result=r.push(p)||result;r.push(p);}assert.deepEqual(result,message);assert.ok(r.diagnostics().pending<=8);assert.ok(r.diagnostics().pendingBytes<=120*1024*8);assert.throws(()=>legacy.encodeDatagrams(message),/too large/);
 const bytes=experimental.encodeReliable(message),out=[];await experimental.readReliable(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=733)c.enqueue(bytes.slice(i,i+733));c.close();}}),m=>out.push(m));assert.deepEqual(out,[message]);
});
test('120 KiB and 128 fragment budgets remain explicit and malformed assemblies release their storage',()=>{
 assert.equal(experimental.MAX_MESSAGE_BYTES,120*1024);assert.equal(experimental.MAX_FRAGMENTS,128);for(const budget of [{maxPending:9},{maxPending:0},{maxAgeMs:0},{maxAgeMs:Infinity}])assert.throws(()=>experimental.createReassembler(budget),/budget/);
 assert.throws(()=>experimental.encodeDatagrams({x:'x'.repeat(123000)}),/too large/);assert.throws(()=>experimental.encodeDatagrams({x:'x'.repeat(86000)},{maxSize:256}),/fragments/);
 const r=experimental.createReassembler();for(let i=1;i<=12;i++)r.push(experimental.encodeDatagrams({x:'x'.repeat(86000)},{sequence:i})[0]);assert.equal(r.diagnostics().pending,8);assert.ok(r.diagnostics().maxPendingBodyBytes<1024*1024);
 const p=experimental.encodeDatagrams({x:'x'.repeat(86000)},{sequence:12})[1],view=new DataView(p.buffer);view.setUint32(12,1);r.push(p);assert.equal(r.diagnostics().pending,7);assert.ok(r.diagnostics().rejected>0);
});
test('oversize reliable chunks, truncation and unbounded pending data are rejected',async()=>{
 await assert.rejects(experimental.readReliable(new ReadableStream({start(c){c.enqueue(new Uint8Array(experimental.MAX_MESSAGE_BYTES*2+1));c.close();}}),()=>{}),/chunk too large/);
 await assert.rejects(experimental.readReliable(new ReadableStream({start(c){c.enqueue(new Uint8Array(experimental.MAX_MESSAGE_BYTES+1));c.close();}}),()=>{}),/too large/);
 await assert.rejects(experimental.readReliable(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"missing":"newline"}'));c.close();}}),()=>{}),/Truncated/);
});
