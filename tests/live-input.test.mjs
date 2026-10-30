import test from 'node:test';import assert from 'node:assert/strict';
import {createInputSampler} from '../public/controls.js';
import {blankInput} from '../public/shared.js';
const input=()=>({...blankInput(),round:1});
for(const rate of [10,30,90,144])test(`live input: ${rate}Hz wheel pulses never queue old aim, movement, fire or duck`,()=>{
 const s=createInputSampler(),p=input();let next=0,launches=0;
 for(let frame=1;frame<=120;frame++){
  while(next<=frame/60){s.wheel(p);next+=1/rate;}
  p.yaw=frame*.01;p.pitch=-frame*.005;p.f=frame<40?1:0;p.s=frame>=40?1:0;
  if(frame===45){p.fire=true;p.crouch=true;s.observe(p);}if(frame===47){p.fire=false;p.crouch=false;s.observe(p);}
  const command=s.sample(p);assert.equal(command.input.yaw,p.yaw);assert.equal(command.input.pitch,p.pitch);assert.equal(command.input.f,p.f);assert.equal(command.input.s,p.s);
  if(frame===45){assert.equal(command.input.fire,true);assert.equal(command.input.crouch,true);assert.equal(command.critical,true);}
  if(frame===47){assert.equal(command.input.fire,false);assert.equal(command.input.crouch,false);}
  launches+=command.input.jump;assert.ok(s.diagnostics().pendingPresses.length<=5);
 }
 assert.ok(launches>10&&launches<=60);
});
test('live input preserves a sub-tick click and emits its release on the following tick',()=>{
 const s=createInputSampler(),p=input();for(let i=0;i<100;i++)s.wheel(p);
 p.fire=true;s.observe(p);p.fire=false;s.observe(p);p.yaw=1;
 const down=s.sample(p),up=s.sample({...p,yaw:2});assert.equal(down.input.fire,true);assert.equal(up.input.fire,false);assert.equal(up.input.yaw,2);assert.equal(down.critical,true);assert.equal(up.critical,true);
 for(let i=0;i<10;i++)assert.equal(s.sample(p).input.fire,false);
});
test('fast re-press between samples still has a release edge, without accumulating an input backlog',()=>{
 const s=createInputSampler(),p=input();p.fire=true;s.observe(p);assert.equal(s.sample(p).input.fire,true);
 p.fire=false;s.observe(p);p.fire=true;s.observe(p);
 assert.equal(s.sample(p).input.fire,false);assert.equal(s.sample(p).input.fire,true);assert.equal(s.sample(p).input.fire,true);
 for(let i=0;i<2000;i++){p.fire=!p.fire;s.observe(p);}assert.ok(s.diagnostics().pendingPresses.length<=5);
 s.reset();assert.equal(s.sample(input()).input.fire,false);assert.deepEqual(s.diagnostics().pendingPresses,[]);
});
test('held Space does not become auto-bunny-hop from wheel input; clearing input discards old pulses',()=>{
 const s=createInputSampler(),p={...input(),jump:true};s.observe(p);
 for(let i=0;i<20;i++){assert.equal(s.wheel(p),false);assert.equal(s.sample(p).input.jump,true);}
 p.jump=false;s.observe(p);assert.equal(s.sample(p).input.jump,false);s.wheel(p);s.reset();assert.equal(s.sample(input()).input.jump,false);
});
