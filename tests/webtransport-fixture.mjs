import assert from 'node:assert/strict';
assert.equal(process.env.HOST,'127.0.0.1');assert.ok(process.send,'IPC-only loopback fixture');
const {game}=await import('../server.mjs');
process.on('message',message=>{
  if(message.type==='start'){game.begin();game.phase='live';game.endAt=game.time+300;game.buyEndAt=game.time+300;process.send({type:'started',round:game.round});}
  if(message.type==='finish'){game.finish('CT','fixture');process.send({type:'finished'});}
});
