import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {Game} from '../game.mjs';import {applyScopeAwareAction} from '../scope-actions.mjs';import {playerHitboxes} from '../hitboxes.mjs';
import {blankInput,supportHeight,eyeHeight} from '../public/shared.js';import {INPUT_DT,MAX_INPUT_AGE_TICKS,INPUT_REORDER_TICKS} from '../public/input-protocol.js';
import {createShotFeedback} from '../public/shot-feedback.js';import {createInputSampler} from '../public/controls.js';
import {createWeaponActionOrder,WEAPON_ACTION_LIMIT} from '../public/weapon-action-order.js';
import {GUNS} from '../public/arsenal.js';

function fixture(weapon='awp'){
 const team=GUNS[weapon].teams[0],g=new Game({random:()=>.5,audioRandom:()=>.5}),p=g.add('p','P',team),q=g.add('q','Q',team==='T'?'CT':'T');g.begin();g.time=10;g.phase='live';g.endAt=1000;
 for(const item of [weapon,'hegrenade','flashbang','smokegrenade'])g.buy(p.id,item);
 for(const [a,z]of [[p,22],[q,19]])Object.assign(a,{x:-18.4,z,y:supportHeight(-18.4,z,3.3),vx:0,vy:0,vz:0,grounded:true,yaw:0,pitch:0,nextAttackAt:0,hp:1000});p.zoom=weapon==='awp'?40:90;
 const box=playerHitboxes(q,g.time).find(b=>b.group==='chest'),point=new THREE.Vector3(...box.min.map((v,i)=>(v+box.max[i])/2)).applyMatrix4(new THREE.Matrix4().fromArray(box.inverse).invert());
 p.yaw=Math.atan2(-(point.x-p.x),-(point.z-p.z));p.pitch=Math.atan2(point.y-p.y-eyeHeight(p),Math.hypot(point.x-p.x,point.z-p.z));g.events=[];
 const acks=[],errors=[],command=(seq,patch={})=>({seq,round:g.round,...blankInput(),yaw:p.yaw,pitch:p.pitch,fire:true,...patch});
 const action=(afterInputSeq=1,patch={})=>({type:'equip',weapon:3,round:g.round,scopeSeq:acks.length+1,afterInputSeq,commands:[command(afterInputSeq)],...patch});
 const dispatch=m=>{const ack=applyScopeAwareAction(g,p.id,m,{onAck:ack=>acks.push(ack),onError:e=>errors.push(e)});if(ack)acks.push(ack);};
 const shots=()=>new Set(g.events.filter(e=>e.type==='shot'&&e.id===p.id&&e.weapon===weapon).map(e=>e.shotId)).size;
 return {g,p,q,acks,errors,command,action,dispatch,shots};
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

for(const weapon of ['ak47','m4a1','aug','sg552','galil','famas','mp5navy','p90'])test(`${weapon} first shot also survives an immediate switch`,()=>{
 const f=fixture(weapon);f.dispatch(f.action(1,{scopeSeq:undefined}));f.g.step();assert.equal(f.shots(),1);assert.equal(f.p.inventory[weapon].ammo,GUNS[weapon].clip-1);assert.ok(f.q.hp<1000);assert.equal(f.p.weapon,'knife');
});
test('switching during FAMAS burst preserves the first shot and cancels only the pending follow-up shots',()=>{
 const f=fixture('famas');f.p.burstMode=true;f.dispatch(f.action(1,{scopeSeq:undefined}));for(let i=0;i<20;i++)f.g.step();assert.equal(f.shots(),1);assert.equal(f.p.inventory.famas.ammo,GUNS.famas.clip-1);assert.equal(f.p.burstRemaining,0);
});

for(const weapon of [2,3,'hegrenade','flashbang','smokegrenade'])test(`predicted AWP shot commits before same-tick switch to ${weapon}`,()=>{
 const f=fixture(),{g,p,q,command,action,dispatch}=f,feedback=createShotFeedback();feedback.observe(p,{round:g.round,stateTime:g.time,nowMs:0});
 assert.ok(feedback.sample({player:p,input:command(1),seq:1,round:g.round,time:g.time,stateTime:g.time,fixedStep:true,nowMs:1,allowed:true}));
 g.inputBatch(p.id,[command(1)]);dispatch(action(1,{weapon}));assert.equal(p.weapon,'awp');assert.equal(f.acks.length,0);g.step();
 assert.equal(p.inventory.awp.ammo,9);assert.equal(f.shots(),1);assert.ok(q.hp<1000);assert.equal(p.weapon,weapon===2?'glock18':weapon===3?'knife':weapon);
 assert.equal(f.acks.length,1);assert.equal(f.acks[0].ok,true);assert.equal(f.acks[0].weapon,p.weapon);assert.deepEqual(f.errors,[]);assert.equal(g.projectiles.length,0);
});
test('reliable action carries a lost fire datagram; late redundant copies never fire twice',()=>{
 const f=fixture();f.dispatch(f.action());f.g.step();assert.equal(f.shots(),1);assert.equal(f.p.inventory.awp.ammo,9);assert.equal(f.g.inputBatch(f.p.id,[f.command(1)]),0);f.g.step();assert.equal(f.shots(),1);
});
test('first accepted input remains immutable when the reliable action repeats different aim/fire data',()=>{
 const f=fixture();f.g.inputBatch(f.p.id,[f.command(1)]);f.dispatch(f.action(1,{commands:[f.command(1,{fire:false,yaw:2,pitch:1})]}));f.g.step();assert.equal(f.shots(),1);assert.ok(f.q.hp<1000);
});
test('fire/release/equip wait for their input barrier without fast-forwarding movement',()=>{
 const f=fixture(),{g,p,command,dispatch,action}=f,copy={...p},initial=g.time;
 const commands=[command(1,{f:1}),command(2,{f:1,fire:false})];g.inputBatch(p.id,commands);dispatch(action(2,{commands}));
 assert.equal(g.time,initial);assert.equal(p.x,copy.x);assert.equal(p.z,copy.z);g.step();assert.equal(p.ackInputSeq,1);assert.equal(p.weapon,'awp');assert.equal(f.shots(),1);
 g.step();assert.equal(p.ackInputSeq,2);assert.equal(p.appliedInputCommands,2);near(g.time,initial+2*INPUT_DT);assert.equal(p.weapon,'knife');assert.equal(p.inventory.awp.ammo,9);assert.equal(f.shots(),1);
});
test('a missing prefix retains bounded reorder waiting then commits the fire before switching',()=>{
 const f=fixture();f.dispatch(f.action(3));for(let i=0;i<INPUT_REORDER_TICKS;i++)f.g.step();assert.equal(f.p.weapon,'awp');assert.equal(f.shots(),0);f.g.step();
 assert.equal(f.p.weapon,'knife');assert.equal(f.p.ackInputSeq,3);assert.equal(f.p.appliedInputCommands,1);assert.equal(f.p.skippedInputCommands,2);assert.equal(f.shots(),1);
});
test('a control barrier skipped with a lost prefix still precedes the next newer input',()=>{
 const f=fixture();f.dispatch(f.action(1,{commands:[]}));f.g.inputBatch(f.p.id,[f.command(2)]);for(let i=0;i<=INPUT_REORDER_TICKS;i++)f.g.step();
 assert.equal(f.p.ackInputSeq,2);assert.equal(f.p.skippedInputCommands,1);assert.equal(f.p.appliedInputCommands,1);assert.equal(f.p.weapon,'knife');assert.equal(f.shots(),0);assert.equal(f.p.inventory.awp.ammo,10);
});
test('fire/cut/back preserves the spent bullet, sniper cooldown and manual scope requirement',()=>{
 const f=fixture();f.dispatch(f.action(1,{scopeSeq:1}));f.dispatch(f.action(1,{weapon:1,scopeSeq:2}));f.g.step();
 assert.equal(f.p.weapon,'awp');assert.equal(f.p.ammo,9);assert.equal(f.p.zoom,90);assert.equal(f.p.resumeZoomAt,0);assert.equal(f.shots(),1);assert.deepEqual(f.acks.map(a=>a.weapon),['knife','awp']);
 f.g.inputBatch(f.p.id,[f.command(2,{fire:false}),f.command(3)]);f.g.step();f.g.step();assert.equal(f.shots(),1);assert.equal(f.p.ammo,9);assert.ok(f.p.nextAttackAt>f.g.time);
});
test('ordered quick switching preserves the ordinary shot damage, ray, recoil and cooldown',()=>{
 const ordinary=fixture(),ordered=fixture();ordinary.g.inputBatch(ordinary.p.id,[ordinary.command(1)]);ordinary.g.step();ordered.dispatch(ordered.action());ordered.g.step();
 const shots=f=>f.g.events.filter(e=>e.type==='shot'&&e.weapon==='awp').map(({from,to,spread,recoilPitch,recoilYaw,burst})=>({from,to,spread,recoilPitch,recoilYaw,burst}));
 assert.deepEqual(shots(ordered),shots(ordinary));assert.equal(ordered.q.hp,ordinary.q.hp);assert.equal(ordered.p.inventory.awp.ammo,ordinary.p.ammo);assert.equal(ordered.p.inventory.awp.nextShotAt,ordinary.p.nextShotAt);
});
for(const type of ['reload','drop','secondary'])test(`${type} cannot overtake a queued legitimate AWP shot`,()=>{
 const f=fixture();f.dispatch(f.action(1,{type}));f.g.step();assert.equal(f.shots(),1);assert.ok(f.q.hp<1000);assert.equal(f.acks[0].kind,type);
 if(type==='drop')assert.equal(f.g.drops.find(d=>d.weapon==='awp').ammo,9);else assert.equal(f.p.ammo,9);
});
for(const patch of [{ammo:0},{nextAttackAt:11},{nextShotAt:11}])test(`ordered action never bypasses original weapon rejection: ${Object.keys(patch)[0]}`,()=>{
 const f=fixture();Object.assign(f.p,patch);f.dispatch(f.action());f.g.step();assert.equal(f.shots(),0);assert.equal(f.q.hp,1000);assert.equal(f.p.weapon,'knife');
});
test('neutral menu/blur cancellation rejects queued actions and their late fire copies',()=>{
 const f=fixture();f.dispatch(f.action());f.g.input(f.p.id,{...blankInput(),round:f.g.round,cancelThroughSeq:1});assert.equal(f.acks[0].ok,false);assert.equal(f.g.inputBatch(f.p.id,[f.command(1)]),0);f.g.step();assert.equal(f.p.weapon,'awp');assert.equal(f.p.ammo,10);assert.equal(f.shots(),0);
});
test('death rejects pending actions; a new round does not revive a prior round switch',()=>{
 const f=fixture();f.dispatch(f.action());f.g.damage(f.p,2000,f.q,{kind:'awp',hitgroup:'head'});assert.equal(f.p.alive,false);assert.equal(f.acks[0].ok,false);assert.equal(f.shots(),0);
 const r=fixture();r.dispatch(r.action());r.g.begin();r.g.phase='live';r.g.endAt=1000;r.g.step();assert.equal(r.p.weapon,'awp');assert.equal(r.p.ammo,10);assert.equal(r.acks.length,0);
});
test('action queue is bounded and absent input expires without executing a future switch',()=>{
 const f=fixture();for(let i=0;i<WEAPON_ACTION_LIMIT;i++)f.dispatch(f.action(1,{scopeSeq:i+1,commands:[]}));assert.throws(()=>f.dispatch(f.action(1,{commands:[]})),/queue full/);
 for(let i=0;i<=MAX_INPUT_AGE_TICKS;i++)f.g.step();assert.equal(f.acks.length,WEAPON_ACTION_LIMIT);assert.ok(f.acks.every(a=>!a.ok));assert.equal(f.p.weapon,'awp');f.dispatch(f.action(0,{commands:[]}));assert.equal(f.p.weapon,'awp');f.g.step();assert.equal(f.p.weapon,'knife');
});
test('malformed input fences/commands are rejected without changing a gun or applying a shot',()=>{
 const f=fixture();for(const afterInputSeq of [-1,1.1,NaN,2147483648,129])assert.throws(()=>f.dispatch(f.action(afterInputSeq,{commands:[]})),/barrier/);
 for(const patch of [{round:f.g.round-1},{commands:null},{commands:Array(33).fill(f.command(1))},{commands:[f.command(2)]}])assert.throws(()=>f.dispatch(f.action(1,patch)));
 f.g.step();assert.equal(f.shots(),0);assert.equal(f.p.weapon,'awp');
});
test('legacy unfenced scope actions retain synchronous acknowledgements',()=>{
 const f=fixture();const ack=applyScopeAwareAction(f.g,f.p.id,{type:'equip',weapon:3,scopeSeq:1,round:f.g.round});assert.equal(ack.ok,true);assert.equal(f.p.weapon,'knife');
});
test('an invalid deferred weapon cannot crash a tick or undo a valid preceding shot',()=>{
 const f=fixture();f.dispatch(f.action(1,{weapon:{toString:0}}));assert.doesNotThrow(()=>f.g.step());assert.equal(f.shots(),1);assert.equal(f.p.ammo,9);assert.equal(f.errors.length,1);assert.doesNotThrow(()=>f.g.step());
});

const context=(patch={})=>({supported:true,active:true,round:1,seq:0,ack:0,commands:[],firePending:true,...patch});
test('a same-frame click/release/switch waits for the real fixed sample and carries that fire',()=>{
 const order=createWeaponActionOrder(),sampler=createInputSampler(),input={...blankInput(),yaw:.7};sampler.observe({...input,fire:true});sampler.observe(input);
 assert.equal(order.prepare({type:'equip',weapon:3},context()),null);assert.equal(order.pending,1);
 const sample=sampler.sample(input);assert.equal(sample.input.fire,true);const actions=order.flush(context({seq:1,commands:[{seq:1,round:1,input:sample.input}],firePending:sampler.diagnostics().pendingPresses.includes('fire')}));
 assert.equal(actions.length,1);assert.equal(actions[0].afterInputSeq,1);assert.equal(actions[0].commands[0].fire,true);assert.equal(actions[0].commands[0].yaw,.7);assert.equal(order.pending,0);
});
test('client queue keeps ordered switches bounded, cancels on pause/round and preserves old-server messages',()=>{
 for(const cancel of ['pause','round','explicit']){const order=createWeaponActionOrder();order.prepare({type:'equip',weapon:3},context());if(cancel==='explicit')order.cancel();assert.deepEqual(order.flush(context({firePending:false,active:cancel!=='pause',round:cancel==='round'?2:1})),[]);}
 const order=createWeaponActionOrder(),message={type:'equip',weapon:3};assert.equal(order.prepare(message,context({supported:false})),message);
 for(let i=0;i<100;i++)order.prepare({type:'equip',weapon:i%2?1:3},context());assert.equal(order.pending,WEAPON_ACTION_LIMIT);assert.equal(order.flush(context()).length,0);
 const actions=order.flush(context({firePending:false}));assert.equal(actions.length,WEAPON_ACTION_LIMIT);assert.deepEqual(actions.slice(0,2).map(a=>a.weapon),[3,1]);
});
test('a second physical click waits through its sampled release before flushing a queued switch',()=>{
 const order=createWeaponActionOrder(),sampler=createInputSampler(),down={...blankInput(),fire:true};sampler.sample(down);sampler.observe({...down,fire:false});sampler.observe(down);order.prepare({type:'equip',weapon:3},context());
 const released=sampler.sample(down);assert.equal(released.input.fire,false);assert.deepEqual(order.flush(context({seq:2,firePending:sampler.diagnostics().pendingPresses.includes('fire')})),[]);
 const pressed=sampler.sample(down);assert.equal(pressed.input.fire,true);const result=order.flush(context({seq:3,firePending:sampler.diagnostics().pendingPresses.includes('fire'),commands:[{seq:3,round:1,input:pressed.input}]}));assert.equal(result.length,1);assert.equal(result[0].afterInputSeq,3);assert.equal(result[0].commands[0].fire,true);
});
