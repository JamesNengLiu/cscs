import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:'0'},stdio:['ignore','pipe','pipe']});
let base,output='';const report={temporaryServer:true,bind:'127.0.0.1'};
try{
  base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout')),10000);
    server.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/http:\/\/localhost:(\d+)/);if(m){clearTimeout(timer);resolve(`http://127.0.0.1:${m[1]}`);}});
    server.stderr.on('data',chunk=>process.stderr.write(chunk));server.once('exit',code=>{clearTimeout(timer);reject(Error(`Server exited before ready: ${code}`));});});
  assert.equal((await (await fetch(base+'/health')).json()).version,'0.4.0');report.base=base;
  const child=spawn(process.execPath,['tests/browser.mjs'],{stdio:'inherit',env:{...process.env,TEST_URL:base,LOCAL_ONLY:'1'}});
  const [code]=await once(child,'exit');report.browserExitCode=code;assert.equal(code,0,'Browser checks failed');
}finally{
  const before=performance.now(),exit=once(server,'exit');server.kill('SIGTERM');
  const result=await Promise.race([exit.then(args=>({args})),new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),3000))]);
  if(result.timeout){server.kill('SIGKILL');await exit;report.shutdown='forced';}else report.shutdown='graceful';
  report.shutdownMilliseconds=Math.round(performance.now()-before);
  let stillReachable=false;try{await fetch(base+'/health',{signal:AbortSignal.timeout(1000)});stillReachable=true;}catch{}
  report.portClosed=!stillReachable;await mkdir('artifacts',{recursive:true});await writeFile('artifacts/server-lifecycle.json',JSON.stringify(report,null,2));
  assert.equal(report.shutdown,'graceful');assert.equal(report.portClosed,true);console.log('PASS temporary server shut down and port closed',report.shutdownMilliseconds+'ms');
}
