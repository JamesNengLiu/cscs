// Fixture controls are available only to this loopback child process, never production HTTP.
import assert from 'node:assert/strict';
assert.equal(process.env.HOST,'127.0.0.1');assert.ok(process.send);
const {game}=await import('../server.mjs');
process.on('message',m=>{
  if(m.type==='start-load'){game.begin();game.phase='live';game.endAt=game.time+300;process.send({type:'load-ready'});}
  if(m.type==='stall'){const end=performance.now()+m.ms;while(performance.now()<end){}process.send({type:'stall-done'});}
});
