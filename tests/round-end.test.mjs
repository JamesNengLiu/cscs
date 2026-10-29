import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.mjs';
import {GUNS} from '../public/arsenal.js';
import {RULES,supportHeight} from '../public/shared.js';

function match(weapon='ak47'){
  const g=new Game({random:()=>.5}),t=g.add('t','T','T'),ct=g.add('ct','CT','CT');g.begin();g.phase='live';g.endAt=1000;g.buyEndAt=1000;
  if(weapon!=='glock18')g.buy('t',weapon);
  Object.assign(t,{x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),yaw:0,pitch:-.5,vx:0,vy:0,vz:0,nextAttackAt:0});
  Object.assign(ct,{x:-18.4,z:16,y:supportHeight(-18.4,16,3.3),vx:0,vy:0,vz:0});return {g,t,ct};
}
function advance(g,seconds,inputs={}){
  for(let i=0;i<Math.ceil(seconds*RULES.tick);i++){for(const [id,input] of Object.entries(inputs))g.input(id,input);g.step();}
}

test('post-round: queued movement and automatic fire continue with per-command authoritative acknowledgements',()=>{
  const {g,t}=match();g.inputBatch('t',Array.from({length:15},(_,i)=>({f:1,fire:true,yaw:0,pitch:-.5,round:g.round,seq:i+1})));
  const start={...t};g.finish('CT','timeout','timeout');const deadline=g.endAt,score={...g.score};
  assert.equal(t.input.f,0);assert.equal(t.input.fire,false);advance(g,.25);
  assert.ok(Math.hypot(t.x-start.x,t.z-start.z)>.1);assert.ok(t.ammo<start.ammo);assert.equal(t.ackInputSeq,15);
  assert.ok(g.events.some(e=>e.type==='shot'&&e.id==='t'));assert.equal(g.phase,'ended');assert.equal(g.endAt,deadline);assert.deepEqual(g.score,score);
});
test('post-round: new movement, jumping and crouching inputs are simulated normally',()=>{
  const {g,t}=match();g.finish('T','win');const y=t.y;
  advance(g,.2,{t:{f:1,jump:true,yaw:0,pitch:-.5}});assert.ok(t.y>y+.2);assert.equal(t.grounded,false);
  advance(g,.8,{t:{f:1,crouch:true,yaw:0,pitch:-.5}});assert.equal(t.crouch,true);assert.equal(g.phase,'ended');
});
test('post-round: reload, switch, scope, knife attacks and weapon drops remain usable',()=>{
  const {g,t}=match('awp');t.ammo=2;t.reserve=5;g.finish('T','win');g.reload('t');assert.ok(t.reloadAt>g.time);
  advance(g,GUNS.awp.reload+.1);assert.equal(t.ammo,7);assert.equal(t.reserve,0);assert.equal(t.reloadAt,0);
  g.secondary('t');assert.equal(t.zoom,40);assert.equal(g.equip('t',3),true);advance(g,1.5);
  assert.equal(g.shoot(t),true);assert.ok(g.events.some(e=>e.type==='melee'));
  assert.equal(g.equip('t',1),true);advance(g,1.5);assert.equal(g.shoot(t),true);assert.equal(g.drop('t'),true);assert.equal(t.primary,null);
  assert.throws(()=>g.buy('t','ak47'),/购买时间/);
});
test('post-round: an in-progress three-shot burst finishes without a second trigger press',()=>{
  const {g,t}=match('glock18');t.burstMode=true;assert.equal(g.shoot(t),true);assert.equal(t.burstRemaining,2);
  g.finish('T','win');advance(g,.22);assert.equal(t.ammo,17);assert.equal(t.burstRemaining,0);
});
test('post-round: later kills cannot change the decided winner, round award or restart deadline',()=>{
  const {g,t,ct}=match();Object.assign(t,{pitch:0});Object.assign(ct,{x:t.x,y:t.y,z:t.z-3,hp:1});
  g.finish('CT','timeout','timeout');const score={...g.score},pending=[t.pendingMoney,ct.pendingMoney],deadline=g.endAt;
  assert.equal(g.shoot(t),true);assert.equal(ct.alive,false);advance(g,.3);
  assert.deepEqual(g.score,score);assert.deepEqual([t.pendingMoney,ct.pendingMoney],pending);assert.equal(g.endAt,deadline);assert.equal(g.finish('T','late kill'),false);
});
test('post-round: expired bomb timers and held use inputs cannot resume objective resolution',()=>{
  const {g,t,ct}=match();g.bomb={state:'planted',x:ct.x,y:ct.y,z:ct.z,endAt:g.time-.1,site:'A'};
  g.finish('T','win');g.use(ct,20);advance(g,.2,{ct:{use:true}});
  assert.equal(g.bomb.state,'planted');assert.equal(ct.progress,0);assert.equal(ct.action,'');assert.deepEqual(g.score,{T:1,CT:0});assert.equal(t.alive,true);
});
test('post-round: dead players and late joiners wait for the next round',()=>{
  const {g,t,ct}=match();g.damage(ct,1000,t);g.finish('T','elimination');const late=g.add('late','late','CT'),before={...ct};
  advance(g,.2,{ct:{f:1,fire:true,jump:true}});
  assert.equal(ct.alive,false);assert.equal(late.alive,false);assert.equal(ct.x,before.x);assert.equal(ct.y,before.y);assert.equal(ct.z,before.z);assert.equal(ct.ammo,before.ammo);
  assert.equal(g.shoot(ct),false);assert.equal(g.equip('ct',3),false);g.reload('ct');assert.equal(ct.reloadAt,0);
});
test('post-round: countdown expiry starts exactly one new round, resets inputs and refills surviving guns',()=>{
  const {g,t}=match();g.finish('CT','win');const deadline=g.endAt,money=t.money+t.pendingMoney;t.ammo=4;t.reserve=2;
  g.time=deadline-.02;g.input('t',{fire:true,yaw:Math.PI/2,pitch:-.5,seq:1,round:g.round});g.step();
  assert.equal(g.phase,'ended');assert.equal(g.round,1);assert.equal(t.ammo,3);g.step();
  assert.equal(g.phase,'countdown');assert.equal(g.round,2);assert.equal(t.ammo,30);assert.equal(t.reserve,90);assert.equal(t.money,money);assert.equal(t.ackInputSeq,0);assert.equal(t.input.fire,false);
  g.input('t',{f:1,fire:true,seq:999,round:1});g.step();assert.equal(g.round,2);assert.equal(t.lastInputSeq,0);assert.equal(t.input.fire,false);assert.deepEqual(g.score,{T:0,CT:1});
});
test('post-round: the input timeout still releases movement and fire',()=>{
  const {g,t}=match();g.input('t',{f:1,fire:true,yaw:0,pitch:-.5});g.finish('T','win');advance(g,1);
  assert.equal(t.input.f,0);assert.equal(t.input.fire,false);assert.ok(Math.hypot(t.vx,t.vz)<.01);
});
test('pre-round: waiting and preparation still block movement and firing',()=>{
  const {g,t}=match();g.phase='waiting';assert.equal(g.shoot(t),false);g.phase='countdown';g.endAt=g.time+6;const start={...t};
  advance(g,.2,{t:{f:1,fire:true,jump:true}});assert.equal(t.x,start.x);assert.equal(t.y,start.y);assert.equal(t.z,start.z);assert.equal(t.ammo,start.ammo);assert.equal(g.shoot(t),false);
});
