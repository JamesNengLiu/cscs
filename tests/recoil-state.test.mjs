import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.mjs';
import {RULES} from '../public/shared.js';
test('sustained fire: authoritative burst survives tick updates and recovers on release',()=>{
  const g=new Game({random:()=>.5}),t=g.add('t','T','T');g.add('ct','CT','CT');g.step();g.buy('t','ak47');for(let i=0;i<Math.ceil((RULES.freezeSeconds+.1)*RULES.tick);i++)g.step();assert.equal(g.phase,'live');
  Object.assign(t,{vx:0,vz:0,vy:0,pitch:-.5});
  for(let i=0;i<90;i++){g.input('t',{fire:true,yaw:0,pitch:-.5});g.step();}
  assert.ok(t.burstCount>=10);assert.ok(t.recoilPitch>.08);assert.ok(t.ammo<20);assert.equal(g.phase,'live');
  for(let i=0;i<60;i++){g.input('t',{fire:false,yaw:0,pitch:-.5});g.step();}assert.equal(t.burstCount,0);assert.equal(t.recoilPitch,0);
});
test('weapon selection: rejects inherited, invalid and unowned keys; cannot get a free gun',()=>{
  const g=new Game(),p=g.add('t','T','T');for(const key of ['toString','constructor','__proto__',{},null]){g.equip('t',key);assert.equal(p.weapon,'glock18');assert.equal(p.ammo,20);}
  g.equip('t','awp');assert.equal(p.weapon,'glock18');assert.equal(p.ammo,20);
});
test('shooting: no firing while dead or outside the live phase',()=>{
  const g=new Game(),p=g.add('t','T','T');p.alive=true;g.shoot(p);assert.equal(p.ammo,20);g.phase='live';p.alive=false;g.shoot(p);assert.equal(p.ammo,20);
});
