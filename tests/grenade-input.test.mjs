import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.mjs';
import {GRENADE_IDS} from '../inventory.mjs';
import {GRENADE_TIMING} from '../public/grenade-state.js';
import {GRENADE_LIMITS} from '../grenades.mjs';
import {RULES} from '../public/shared.js';

function match(kind='hegrenade'){
  const g=new Game({random:()=>.5}),p=g.add('p','Grenade input','T');g.begin();g.buy(p.id,kind);g.equip(p.id,kind);
  advance(g,Math.max(0,p.nextAttackAt-g.time)+.01);return {g,p};
}
function advance(g,seconds,fire=false){
  for(let i=0;i<Math.ceil(seconds*RULES.tick);i++){g.input('p',{fire,yaw:0,pitch:0});g.step();}
}
function throws(g){return g.events.filter(e=>e.type==='throw');}

for(const kind of GRENADE_IDS){
  test(`grenade input: ${kind} holds its pin pose without consuming or cooking, releases once then switches`,()=>{
    const {g,p}=match(kind);advance(g,2.5,true);
    assert.equal(p.grenadePhase,'hold');assert.equal(p.grenades[kind],1);
    assert.equal(g.projectiles.length,0);assert.equal(throws(g).length,0);
    assert.equal(g.snapshot(p.id).players[0].grenadePhase,'hold');
    advance(g,1/RULES.tick);
    assert.equal(p.grenadePhase,'throw');assert.equal(p.weapon,kind);assert.equal(p.grenades[kind],0);
    assert.equal(g.projectiles.length,1);assert.equal(throws(g).length,1);
    const projectile=g.projectiles[0];assert.ok(Math.abs(projectile.detonateAt-projectile.bornAt-1.5)<1e-8);
    const visible=g.snapshot(p.id).projectiles[0];assert.equal(visible.bornAt,projectile.bornAt);assert.equal(visible.resting,false);
    assert.ok(Math.abs(projectile.bornAt-g.time)<1e-8);
    advance(g,GRENADE_TIMING.recoverSeconds+.02);
    assert.equal(p.weapon,'glock18');assert.equal(p.grenadePhase,'');assert.equal(throws(g).length,1);
  });
  test(`grenade input: ${kind} quick click waits for pin preparation`,()=>{
    const {g,p}=match(kind);advance(g,1/RULES.tick,true);const started=p.grenadeStartedAt;
    advance(g,.25);
    assert.equal(p.grenadePhase,'pin');assert.equal(p.grenadeReleased,true);
    assert.equal(g.projectiles.length,0);assert.equal(p.grenades[kind],1);
    advance(g,.3);
    assert.equal(throws(g).length,1);assert.equal(p.grenades[kind],0);
    assert.ok(g.projectiles[0].bornAt+1e-8>=started+GRENADE_TIMING.pinSeconds);
  });
  test(`grenade input: ${kind} switching cancels preparation without a late throw`,()=>{
    const {g,p}=match(kind);advance(g,.2,true);g.equip(p.id,2);advance(g,.8);
    assert.equal(p.grenadePhase,'');assert.equal(p.grenades[kind],1);assert.equal(throws(g).length,0);
    g.equip(p.id,kind);advance(g,.8);assert.equal(throws(g).length,0);
  });
}

test('grenade input: missing sequenced commands do not release; a real release edge does',()=>{
  const {g,p}=match();
  g.input(p.id,{seq:1,round:g.round,fire:true,yaw:0});g.step();
  for(let i=0;i<5;i++)g.step();
  assert.equal(p.grenadeReleased,false);assert.equal(throws(g).length,0);
  for(let seq=2;seq<=35;seq++){g.input(p.id,{seq,round:g.round,fire:false,yaw:0});g.step();}
  assert.equal(throws(g).length,1);assert.equal(p.grenades.hegrenade,0);
});

test('grenade input: holding fire while drawing starts pin preparation when the weapon is ready',()=>{
  const g=new Game(),p=g.add('p','Draw held','T');g.begin();g.buy(p.id,'hegrenade');g.equip(p.id,'hegrenade');
  const ready=p.nextAttackAt;advance(g,.85,true);
  assert.equal(p.grenadePhase,'pin');assert.ok(p.grenadeStartedAt+1e-8>=ready);assert.equal(throws(g).length,0);
  advance(g,.5,true);assert.equal(p.grenadePhase,'hold');advance(g,1/RULES.tick);assert.equal(throws(g).length,1);
});

test('grenade input: menu cancellation and prolonged input silence never become a throw',()=>{
  for(const cancel of [true,false]){
    const {g,p}=match();g.input(p.id,{seq:1,round:g.round,fire:true});g.step();
    if(cancel)g.input(p.id,{round:g.round,fire:false,cancelThroughSeq:1});
    for(let i=0;i<60;i++)g.step();
    assert.equal(p.grenadePhase,'');assert.equal(p.grenades.hegrenade,1);assert.equal(throws(g).length,0);
  }
});

test('grenade input: death or a fresh round clears an armed grenade',()=>{
  for(const death of [true,false]){
    const {g,p}=match();advance(g,.2,true);
    if(death)g.damage(p,1000);else g.begin();
    advance(g,1);
    assert.equal(p.grenadePhase,'');assert.equal(throws(g).length,0);
  }
});

test('grenade input: failed projectile admission does not consume inventory',()=>{
  const {g,p}=match();advance(g,.6,true);g.projectiles=Array(GRENADE_LIMITS.active).fill(null);
  advance(g,1/RULES.tick);
  assert.equal(p.grenades.hegrenade,1);assert.equal(throws(g).length,0);assert.equal(p.grenadePhase,'');
});

test('grenade input: release uses current aim and holding longer does not increase throw power',()=>{
  const velocities=[];
  for(const seconds of [.6,3]){
    const {g,p}=match();advance(g,seconds,true);
    g.input(p.id,{fire:false,yaw:Math.PI/2,pitch:0});g.step();const q=g.projectiles[0];
    assert.ok(q.vx<0);assert.ok(Math.abs(q.vz)<1e-8);velocities.push([q.vx,q.vy,q.vz]);
  }
  assert.deepEqual(velocities[0],velocities[1]);
});
