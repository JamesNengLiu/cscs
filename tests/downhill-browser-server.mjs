// Test-only fixture control over the parent's local IPC channel, never HTTP/WebSocket.
import {game} from '../server.mjs';
import {DOWNHILL_CASES,slopeStart} from './downhill-fixtures.mjs';
if(!process.send||process.env.HOST!=='127.0.0.1')throw Error('Fixture server requires local parent IPC and loopback binding');
process.on('message',message=>{
  if(message.type!=='fixture')return;
  try{const c=DOWNHILL_CASES.find(c=>c.name===message.name);if(!c)throw Error('Unknown fixture');
    if(game.players.size!==2)throw Error('Expected exactly two test peers');game.begin();game.endAt=game.time+.5;
    const p=[...game.players.values()].find(p=>p.team==='T');Object.assign(p,slopeStart(c));p.input={...p.input,yaw:p.yaw};
    process.send({type:'fixtureReady',round:game.round,name:c.name});
  }catch(error){process.send({type:'fixtureError',message:error.message});}
});
