import test from 'node:test';
import assert from 'node:assert/strict';
import {installMovementFaultProbe} from './fixtures/cs2-movement-timeline-regression.mjs';

test('CS2 input-delay fixture flushes a held window once when delivery wins the timer race',async()=>{
 const sent=[],socket={send:m=>sent.push(m)};let now=0;
 const probe=installMovementFaultProbe(socket,()=>now),message=seq=>({type:'inputBatch',commands:[{seq,round:1}]});
 try{
  probe.arm(60);socket.send(message(1));assert.equal(sent.length,0);
  socket.send({type:'equip',weapon:'last'});assert.equal(sent.length,1,'Reliable weapon ordering must not be held with datagrams');
  now=61;socket.send(message(2));
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.deepEqual(sent.map(m=>m.type==='equip'?'equip':m.commands[0].seq),['equip',1,2]);
  assert.equal(probe.snapshot().events.filter(e=>e.kind==='fault-flush').length,1);
 }finally{probe.dispose();}
});
