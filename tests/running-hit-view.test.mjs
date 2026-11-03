// Independent CPU rendering pose sampled from interpolated actual Game snapshots,
// then fired through real authoritative historical hitboxes. No physical FPS claim.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import * as THREE from 'three';
import {createBonePose} from '../public/bone-pose.js';import {locomotionOrigin} from '../public/player-locomotion.js';import {createSnapshotBuffer} from '../public/snapshot-buffer.js';import {createLagCompensation} from '../lag-compensation.mjs';import {blankInput,eyeHeight} from '../public/shared.js';import {createDuel} from './fixtures/fairness-cases.mjs';
const rig=JSON.parse(readFileSync(new URL('../public/assets/players/urban/model.json',import.meta.url),'utf8'));
for(const snapshotHz of [30,60])test(`real strafe gait head at ${snapshotHz}Hz snapshots matches the shot view`,()=>{
 const {g,host:p,guest:q}=createDuel({hp:1000});g.time=9;g.equip(q.id,3);Object.assign(q,{x:-22,z:19,yaw:0,pitch:0,vx:0,vz:0,zoom:90});g.input(p.id,{...blankInput(),round:g.round});g.lagComp=createLagCompensation();
 const b=createSnapshotBuffer({snapshotHz,minDelayMs:130,maxDelayMs:130,initialDelayMs:130});
 for(let seq=1;seq<=60;seq++){g.inputBatch(q.id,[{seq,round:g.round,...blankInput(),s:1,yaw:0,pitch:0}]);g.step();g.lagComp.record({time:g.time,round:g.round,players:[p,q]});const arrival=g.time*1000+20;if(seq%(60/snapshotHz)===0&&arrival<=10000)b.push(g.snapshot(p.id),arrival);}
 const visible=b.sample(q.id,10000),viewTime=b.view().playbackTimeMs/1000;assert.equal(visible.playerGaitSequence,'run');
 const pose=createBonePose(THREE,rig),sequence=rig.sequences.find(s=>s.name===visible.playerSequence);pose.pose(sequence,visible.playerFrame,visible);
 const head=rig.hitboxes.find(b=>b.group===1),point=new THREE.Vector3(...head.min.map((v,i)=>(v+head.max[i])/2)).applyMatrix4(pose.matrices[head.bone]);
 const root=new THREE.Matrix4().makeRotationY(visible.gaitYaw??visible.yaw);root.setPosition(visible.x,visible.y,visible.z);root.multiply(new THREE.Matrix4().set(0,-1/40,0,0,0,0,1/40,locomotionOrigin(visible),-1/40,0,0,0,0,0,0,1));point.applyMatrix4(root);
 const eye=p.y+eyeHeight(p);p.yaw=Math.atan2(-(point.x-p.x),-(point.z-p.z));p.pitch=Math.atan2(point.y+.025-eye,Math.hypot(point.x-p.x,point.z-p.z));g.time=10.02;g.lagComp.timing(p.id,40);
 const accepted=[];g.inputBatch(p.id,[{seq:1,round:g.round,...blankInput(),fire:true,yaw:p.yaw,pitch:p.pitch,viewTime,interpDelayMs:130}],accepted);g.lagComp.view(p.id,accepted,{now:g.time,round:g.round});g.events=[];g.step();
 const shot=g.events.find(e=>e.type==='shot'&&e.id===p.id&&e.hitImpact?.targetId===q.id);assert.ok(shot,'rendered running head remained hittable');assert.equal(shot.hitImpact.hitgroup,'head');assert.equal(p.ammo,9);assert.ok(q.hp<1000);
});
