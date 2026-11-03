import test from 'node:test';import assert from 'node:assert/strict';
import {Game} from '../game.mjs';import {applyScopeAwareAction} from '../scope-actions.mjs';import {blankInput} from '../public/shared.js';
function held(weapon='hegrenade'){
 const g=new Game({random:()=>.5,audioRandom:()=>.5}),p=g.add('p','P','T');g.begin();g.phase='live';g.time=10;g.endAt=1000;g.buy(p.id,weapon);g.equip(p.id,weapon);g.enableGrenadeIntents(p.id);g.time=p.nextAttackAt+.01;
 const acks=[],errors=[],intent=(kind,seq=kind==='press'?1:2,actionId=1)=>({round:g.round,seq,actionId,kind,weapon,yaw:p.yaw,pitch:p.pitch});
 assert.equal(g.grenadeIntent(p.id,intent('press')).status,'active');for(let i=0;i<80;i++)g.step();assert.equal(p.grenadePhase,'hold');
 const command={seq:1,round:g.round,...blankInput(),fire:true,yaw:p.yaw,pitch:p.pitch};
 const cut=(fence=1)=>applyScopeAwareAction(g,p.id,{type:'equip',weapon:3,round:g.round,afterInputSeq:fence,commands:fence?[command]:[]});
 const release=()=>g.grenadeIntent(p.id,intent('release'),{onAck:ack=>acks.push(ack),onError:e=>errors.push(e)});
 return {g,p,acks,errors,intent,command,cut,release,weapon};
}
for(const weapon of ['hegrenade','flashbang','smokegrenade'])for(const fence of [0,1])test(`${weapon} equip fence ${fence}: cut before release cancels without throwing`,()=>{
 const f=held(weapon);f.cut(fence);assert.equal(f.release(),null);f.g.step();assert.equal(f.p.weapon,'knife');assert.equal(f.p.grenades[weapon],1);assert.equal(f.g.projectiles.length,0);assert.equal(f.p.grenadeAckSeq,2);assert.equal(f.acks.length,1);assert.ok(['cancelled','rejected'].includes(f.acks[0].status));assert.deepEqual(f.errors,[]);
 for(let i=0;i<80;i++)f.g.step();assert.equal(f.g.projectiles.length,0);assert.equal(f.p.grenades[weapon],1);
});
test('a ready release before an input-fenced cut commits exactly one grenade',()=>{
 const f=held();assert.equal(f.release().status,'released');f.cut(1);f.g.step();assert.equal(f.p.weapon,'knife');assert.equal(f.g.projectiles.length,1);assert.equal(f.p.grenades.hegrenade,0);
});
test('switching after a grenade has actually spawned never retracts the projectile',()=>{
 const f=held();f.release();f.g.step();assert.equal(f.g.projectiles.length,1);const id=f.g.projectiles[0].id;f.cut(0);f.g.step();assert.equal(f.p.weapon,'knife');assert.equal(f.g.projectiles[0].id,id);assert.equal(f.p.grenades.hegrenade,0);
});
test('menu cancellation retires queued releases and allows the next valid grenade action',()=>{
 const f=held();f.cut();f.release();f.g.input(f.p.id,{...blankInput(),round:f.g.round,cancelThroughSeq:1});f.g.step();assert.equal(f.g.projectiles.length,0);assert.equal(f.p.grenades.hegrenade,1);assert.equal(f.p.grenadeAckSeq,2);assert.equal(f.p.weapon,'hegrenade');
 assert.equal(f.g.grenadeIntent(f.p.id,f.intent('press',3,3)).status,'active');f.g.grenadeIntent(f.p.id,f.intent('release',4,3));for(let i=0;i<80;i++)f.g.step();assert.equal(f.g.projectiles.length,1);assert.equal(f.g.projectiles[0].actionId,3);
});
test('death and a new round do not revive a queued throw',()=>{
 const f=held();f.cut();f.release();f.g.damage(f.p,2000,null,{kind:'fall'});assert.equal(f.p.alive,false);assert.equal(f.p.grenadeAckSeq,2);f.g.begin();f.g.phase='live';for(let i=0;i<80;i++)f.g.step();assert.equal(f.g.projectiles.length,0);
 const r=held();r.cut();r.release();r.g.begin();r.g.phase='live';for(let i=0;i<80;i++)r.g.step();assert.equal(r.g.projectiles.length,0);assert.equal(r.p.grenadeAckSeq,0);
});
test('duplicates of a queued release do not throw or consume the grenade twice',()=>{
 const f=held();f.cut();f.release();f.release();f.g.step();assert.equal(f.acks.length,1);assert.equal(f.p.grenadeAckSeq,2);assert.equal(f.g.projectiles.length,0);assert.equal(f.p.grenades.hegrenade,1);
});
test('an explicit cancel alone preempts a pending cut/release without needing the following neutral packet',()=>{
 const f=held();f.cut();f.release();const ack=f.g.grenadeIntent(f.p.id,f.intent('cancel',3));assert.equal(ack.status,'cancelled');assert.equal(f.p.grenadeAckSeq,3);assert.equal(f.p.weapon,'hegrenade');for(let i=0;i<80;i++)f.g.step();assert.equal(f.g.projectiles.length,0);assert.equal(f.p.grenades.hegrenade,1);
});
test('a stale cancel cannot cancel the currently held different action',()=>{
 const f=held();const ack=f.g.grenadeIntent(f.p.id,f.intent('cancel',2,999));assert.equal(ack.status,'rejected');assert.equal(f.p.grenadePhase,'hold');assert.equal(f.p.grenadeAckSeq,2);const valid=f.g.grenadeIntent(f.p.id,f.intent('cancel',3));assert.equal(valid.status,'cancelled');
});
test('a release on a full control queue fails closed by cancelling, without leaving a held grenade',()=>{
 const f=held();for(let i=0;i<16;i++)f.cut();const ack=f.release();assert.equal(ack.status,'cancelled');assert.equal(f.p.grenadeAckSeq,2);for(let i=0;i<80;i++)f.g.step();assert.equal(f.g.projectiles.length,0);assert.equal(f.p.grenades.hegrenade,1);
});
