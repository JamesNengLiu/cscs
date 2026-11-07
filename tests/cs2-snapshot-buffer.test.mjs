import test from 'node:test';
import assert from 'node:assert/strict';
import {createSnapshotBuffer} from '../public/cs2-snapshot-buffer.js';
import {createSnapshotBuffer as legacyBuffer} from '../public/snapshot-buffer.js';
const pose=(extra={})=>({id:'p',x:0,y:0,z:0,yaw:0,pitch:0,alive:true,team:'T',...extra});
const snap=(time,p,round=1)=>({time,round,players:[p]});
const options={minDelayMs:0,maxDelayMs:0,clockSlewMsPerSecond:0};
test('native gait interpolates continuously across a whole cycle and standing/crouching clip changes',()=>{
 const b=createSnapshotBuffer(options);b.push(snap(0,pose({nativeGaitPhase:.99,playerSequence:'run_n',gaitDistance:100})),1000);b.push(snap(.1,pose({nativeGaitPhase:1.03,playerSequence:'crouch_n',gaitDistance:100.2})),1100);const p=b.sample('p',1050);assert.ok(Math.abs(p.nativeGaitPhase-1.01)<1e-10);assert.equal(p.playerSequence,'run_n');let phase=p.nativeGaitPhase;for(let now=1051;now<=1100;now++){const next=b.sample('p',now);assert.ok(next.nativeGaitPhase>=phase);phase=next.nativeGaitPhase;}assert.equal(phase,1.03);
});
test('new round and life boundaries never interpolate phase backwards across a respawn',()=>{
 const b=createSnapshotBuffer(options);b.push(snap(2,pose({nativeGaitPhase:100})),3000);b.push(snap(2.1,pose({alive:false,nativeGaitPhase:100})),3100);b.push(snap(2.2,pose({alive:true,nativeGaitPhase:0,spawnSeq:2})),3200);assert.equal(b.sample('p',3200).nativeGaitPhase,0);b.push(snap(.1,pose({nativeGaitPhase:.1}),2),3300);assert.equal(b.sample('p',3300).nativeGaitPhase,.1);
});
test('isolated phase buffer preserves legacy trajectories, gaps, clocks and membership when phase is absent',()=>{
 const a=createSnapshotBuffer(options),b=legacyBuffer(options);for(let i=0;i<40;i++){const time=i*.05,p=pose({x:i*.1,vx:2,vy:0,vz:0,gaitDistance:i*.1,playerSequence:i<20?'run':'walk'}),s=snap(time,p,i<30?1:2);assert.equal(a.push(s,1000+i*50),b.push(s,1000+i*50));for(const now of [1000+i*50,1011+i*50])assert.deepEqual(a.sample('p',now),b.sample('p',now));assert.deepEqual(a.diagnostics(),b.diagnostics());}
});
