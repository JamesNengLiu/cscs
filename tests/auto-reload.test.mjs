import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.mjs';
import {GUNS} from '../public/arsenal.js';
import {RULES} from '../public/shared.js';

function match(weapon='ak47'){
  const g=new Game({random:()=>.5});
  const p=g.add('p','自动换弹',GUNS[weapon].teams[0]);
  g.step();
  if(p.weapon!==weapon)g.buy(p.id,weapon);
  g.time+=.6;
  return {g,p,w:GUNS[weapon]};
}
function advance(g,seconds,input={fire:false}){
  for(let i=0;i<Math.ceil(seconds*RULES.tick);i++){
    g.input('p',input);
    g.step();
  }
}
function fireLastRound(g,p){
  p.ammo=1;
  g.input(p.id,{fire:true});
  g.step();
  assert.equal(p.ammo,0);
}

for(const [id,w] of Object.entries(GUNS))test(`auto reload: ${id} starts after the last shot and completes with the trigger released`,()=>{
  const {g,p}=match(id);
  p.reserve=w.clip+2;
  fireLastRound(g,p);
  assert.ok(p.reloadAt>g.time);
  assert.equal(g.snapshot(p.id).players[0].reloadAt,p.reloadAt);
  assert.equal(p.reserve,w.clip+2);
  const duration=w.reloadStyle==='per-shell'?w.reloadStart+(w.clip-1)*w.reload:w.reload;
  advance(g,duration+.1);
  assert.equal(p.ammo,w.clip);
  assert.equal(p.reserve,2);
  assert.equal(p.reloadAt,0);
  assert.equal(p.inventory[id].ammo,w.clip);
  assert.equal(p.ammoPool[w.ammoType],2);
});

test('auto reload: held automatic fire cannot restart the reload timer and resumes when ready',()=>{
  const {g,p,w}=match();
  fireLastRound(g,p);
  const deadline=p.reloadAt,reserve=p.reserve;
  assert.ok(deadline>g.time);
  advance(g,w.reload-.1,{fire:true});
  assert.equal(p.ammo,0);
  assert.equal(p.reloadAt,deadline);
  assert.equal(p.reserve,reserve);
  assert.equal(g.events.filter(e=>e.type==='shot').length,1);
  advance(g,.2,{fire:true});
  assert.ok(p.ammo>0&&p.ammo<w.clip);
  assert.equal(p.reserve,reserve-w.clip);
  assert.equal(p.reloadAt,0);
});

for(const weapon of ['glock18','famas'])test(`auto reload: ${weapon} finishes the last burst without leaving pending shots`,()=>{
  const {g,p,w}=match(weapon);
  p.burstMode=true;p.ammo=3;p.reserve=2;
  g.input(p.id,{fire:true});g.step();
  advance(g,.25);
  assert.equal(p.ammo,0);
  assert.equal(p.burstRemaining,0);
  assert.equal(g.events.filter(e=>e.type==='shot').length,3);
  assert.ok(p.reloadAt>g.time);
  advance(g,w.reload+.1);
  assert.equal(p.ammo,2);
  assert.equal(p.reserve,0);
  assert.equal(p.reloadAt,0);
  assert.equal(g.events.filter(e=>e.type==='shot').length,3);
});

for(const weapon of ['m3','xm1014'])test(`auto reload: ${weapon} loads one shell at a time and can fire then reload again`,()=>{
  const {g,p,w}=match(weapon);
  fireLastRound(g,p);
  assert.ok(p.reloadAt>g.time);
  advance(g,w.reloadStart+.01);
  assert.equal(p.ammo,1);
  assert.ok(p.reloadAt>g.time);
  assert.equal(p.reserve,w.reserve-1);
  if(g.time-p.lastShot<w.interval){
    const deadline=p.reloadAt;
    assert.equal(g.shoot(p),false);
    assert.equal(p.reloadAt,deadline);
  }
  advance(g,w.interval+.1,{fire:true});
  assert.ok(g.events.filter(e=>e.type==='shot').length>w.pellets);
  assert.ok(p.reloadAt>g.time);
  advance(g,w.reloadStart+w.clip*w.reload+.1);
  assert.equal(p.ammo,w.clip);
  assert.equal(p.reloadAt,0);
});

test('auto reload: no reserve means no reload, partial reserve loads only available rounds',()=>{
  const {g,p,w}=match();p.reserve=0;
  fireLastRound(g,p);
  advance(g,w.reload+.1,{fire:true});
  assert.equal(p.ammo,0);assert.equal(p.reserve,0);assert.equal(p.reloadAt,0);
  p.reserve=3;g.step();assert.ok(p.reloadAt>g.time);
  advance(g,w.reload+.1);
  assert.equal(p.ammo,3);assert.equal(p.reserve,0);assert.equal(p.reloadAt,0);
});

test('auto reload: switching cancels loading, inactive guns stay empty and re-equipping restarts it',()=>{
  const {g,p,w}=match();fireLastRound(g,p);
  assert.ok(p.reloadAt>g.time);
  const reserve=p.reserve;
  g.equip(p.id,3);advance(g,w.reload+.1);
  assert.equal(p.reloadAt,0);assert.equal(p.inventory.ak47.ammo,0);
  assert.equal(p.ammoPool[w.ammoType],reserve);
  g.equip(p.id,1);g.step();assert.ok(p.reloadAt>g.time);
  advance(g,w.reload+.1);
  assert.equal(p.ammo,w.clip);assert.equal(p.reserve,reserve-w.clip);
});

for(const weapon of ['awp','scout'])test(`auto reload: ${weapon} stays unscoped while loading its empty magazine`,()=>{
  const {g,p,w}=match(weapon);g.secondary(p.id);assert.notEqual(p.zoom,90);
  fireLastRound(g,p);assert.ok(p.reloadAt>g.time);
  assert.equal(p.zoom,90);assert.equal(p.resumeZoomAt,0);
  advance(g,w.interval+.1);assert.equal(p.zoom,90);assert.ok(p.reloadAt>g.time);
});

test('auto reload: nonempty magazines, preparation and dead players do not start loading',()=>{
  const {g,p}=match();p.ammo=1;g.step();assert.equal(p.reloadAt,0);
  p.ammo=0;g.phase='countdown';g.endAt=g.time+6;g.step();assert.equal(p.reloadAt,0);
  g.phase='live';p.alive=false;g.step();assert.equal(p.reloadAt,0);
});

test('auto reload: surviving players can reload automatically during the post-round countdown',()=>{
  const {g,p,w}=match();g.finish('T','win');const score={...g.score};
  fireLastRound(g,p);assert.ok(p.reloadAt>g.time);
  advance(g,w.reload+.1);
  assert.equal(p.ammo,w.clip);assert.equal(p.reloadAt,0);
  assert.equal(g.phase,'ended');assert.deepEqual(g.score,score);
});
