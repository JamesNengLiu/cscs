import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.mjs';
import {GUNS,EQUIPMENT} from '../public/arsenal.js';
import {ECONOMY} from '../public/economy.js';
import {RULES,SPAWN_POINTS,SITES,supportHeight,buyZoneAt} from '../public/shared.js';
function match(){const g=new Game({random:()=>.5}),t=g.add('t','T','T'),ct=g.add('ct','CT','CT');g.begin();g.phase='live';g.endAt=1000;g.buyEndAt=1000;return {g,t,ct};}
function tick(g,seconds,inputs={}){for(let i=0;i<Math.ceil(seconds*RULES.tick);i++){for(const [id,raw] of Object.entries(inputs))g.input(id,raw);g.step();}}
function place(p,x=-18.4,z=22){Object.assign(p,{x,y:3.2,z,vx:0,vz:0,vy:0,yaw:0,pitch:-.15,grounded:true});p.y=supportHeight(x,z,3.3);}
for(const [id,w] of Object.entries(GUNS))test(`arsenal integration: buy, equip and fire ${id}`,()=>{
  const {g,t,ct}=match(),p=w.teams[0]==='T'?t:ct,q=p===t?ct:t;
  if(p.inventory[id])g.drop(p.id);const before=p.money;g.buy(p.id,id);assert.equal(p.money,before-w.price);assert.equal(p.weapon,id);assert.equal(p.ammo,w.clip);assert.ok(p.inventory[id]);
  assert.equal(g.equip(p.id,3),true);assert.equal(p.weapon,'knife');g.equip(p.id,id);place(p);place(q,-18.4,19);q.hp=1000;g.time+=.6;
  assert.equal(g.shoot(p),true);assert.equal(p.ammo,w.clip-1);assert.ok(q.hp<1000);const ammo=p.ammo;g.shoot(p);assert.equal(p.ammo,ammo);
});
test('economy: first join gets 10000, no free primary and no per-round cash reset',()=>{const {g,t,ct}=match();assert.equal(t.money,10000);assert.equal(ct.money,10000);assert.equal(t.primary,null);assert.equal(t.weapon,'glock18');assert.equal(ct.weapon,'usp');assert.equal(t.ammo,20);assert.equal(t.reserve,40);assert.equal(ct.ammo,12);assert.equal(ct.reserve,24);assert.equal(g.equip('t','awp'),false);g.buy('t','ak47');g.begin();assert.equal(t.money,7500);assert.equal(t.weapon,'ak47');});
test('buying: source BSP team buy zones and time, dead players, and phase checked server-side',()=>{
  const {g,t,ct}=match();assert.ok(buyZoneAt(t));assert.ok(buyZoneAt(ct));const initial=t.money;const saved={x:t.x,y:t.y,z:t.z};Object.assign(t,{x:ct.x,y:ct.y,z:ct.z});assert.equal(buyZoneAt(t),false);assert.throws(()=>g.buy('t','ak47'));Object.assign(t,saved);g.time=g.buyEndAt+.01;assert.throws(()=>g.buy('t','ak47'));g.time=0;t.alive=false;assert.throws(()=>g.buy('t','ak47'));t.alive=true;g.phase='ended';assert.throws(()=>g.buy('t','ak47'));assert.equal(t.money,initial);
});
test('buying: team restrictions, insufficient cash, inherited ids and duplicates are atomic',()=>{
  const {g,t}=match();for(const id of ['m4a1','fiveseven','tmp','defusekit','shield','constructor','__proto__',{},null]){const money=t.money;assert.throws(()=>g.buy('t',id));assert.equal(t.money,money);}t.money=100;assert.throws(()=>g.buy('t','ak47'));assert.equal(t.money,100);t.money=10000;g.buy('t','ak47');assert.throws(()=>g.buy('t','ak47'));assert.equal(t.money,7500);
});
test('ammo: purchases are paid packs, capped and shared between weapons of same calibre',()=>{
  const {g,t}=match();g.buy('t','mp5navy');assert.equal(t.reserve,40);const before=t.money;g.buy('t','primaryammo');assert.equal(t.money,before-GUNS.mp5navy.ammoCost);assert.equal(t.reserve,70);g.equip('t',2);assert.equal(t.reserve,70);g.buy('t','secondaryammo');assert.equal(t.reserve,100);g.buy('t','secondaryammo');assert.equal(t.reserve,120);const money=t.money;assert.throws(()=>g.buy('t','secondaryammo'));assert.equal(t.money,money);
});
test('replacement: buying drops the old gun without refund, E/touch pickup observes empty slots',()=>{
  const {g,t,ct}=match();g.buy('t','ak47');t.ammo=17;g.buy('t','galil');assert.equal(t.primary,'galil');assert.equal(t.money,5500);assert.ok(g.drops.some(d=>d.weapon==='ak47'&&d.ammo===17));place(t);const d=g.drops.find(d=>d.weapon==='ak47');place(ct,d.x,d.z);ct.y=d.y;g.time+=.6;g.pickup(ct);assert.equal(ct.primary,'ak47');assert.equal(ct.ammo,17);
});
test('equipment: armour/helmet upgrades have source conditional prices and duplicates do not debit',()=>{
  const {g,t}=match();g.buy('t','kevlar');assert.equal(t.money,9350);assert.equal(t.armour,100);assert.equal(t.helmet,false);g.buy('t','assaultsuit');assert.equal(t.money,9000);assert.equal(t.helmet,true);assert.throws(()=>g.buy('t','assaultsuit'));t.armour=50;g.buy('t','assaultsuit');assert.equal(t.money,8350);assert.equal(t.armour,100);
});
test('equipment: HE1 flash2 smoke1, no extra grenades or arbitrary quantity',()=>{
  const {g,t}=match();g.buy('t','hegrenade');g.buy('t','flashbang');g.buy('t','flashbang');g.buy('t','smokegrenade');assert.deepEqual(t.grenades,{hegrenade:1,flashbang:2,smokegrenade:1});const money=t.money;for(const id of ['hegrenade','flashbang','smokegrenade'])assert.throws(()=>g.buy('t',id));assert.equal(t.money,money);
});
test('equipment: shield is CT only, drops primary, cannot coexist with dual pistols and blocks frontal bullets',()=>{
  const {g,t,ct}=match();g.buy('ct','m4a1');g.buy('ct','shield');assert.equal(ct.primary,null);assert.ok(ct.shield);assert.ok(g.drops.some(d=>d.weapon==='m4a1'));g.buy('t','ak47');place(t);place(ct,-18.4,19);ct.yaw=Math.PI;ct.shieldRaised=true;g.time+=1;const before=ct.hp;g.shoot(t);assert.equal(ct.hp,before);ct.shieldRaised=false;g.time+=1;g.shoot(t);assert.ok(ct.hp<before);
});
test('equipment: nightvision ownership, toggle and duplicate purchase',()=>{const {g,t}=match();g.toggleNightvision('t');assert.equal(t.nightvisionOn,false);g.buy('t','nightvision');g.toggleNightvision('t');assert.equal(t.nightvisionOn,true);assert.throws(()=>g.buy('t','nightvision'));});
test('armour integration: no helmet leaves head unprotected, legs bypass armour, body depletes armour',()=>{
  for(const [group,helmet,hp,armour] of [['chest',false,50,75],['head',false,0,100],['head',true,50,75],['legs',true,0,100]]){const {g,t,ct}=match();t.armour=100;t.helmet=helmet;g.damage(t,100,ct,{hitgroup:group});assert.equal(t.hp,hp);assert.equal(t.armour,armour);}
});
test('money: all firearm and knife kills use CS1.6 300, not later-game weapon-specific bonuses',()=>{
  for(const weapon of ['ak47','awp','knife']){const {g,t,ct}=match();t.weapon=weapon;const before=t.money;g.damage(ct,1000,t,{kind:weapon});assert.equal(t.money,before+300);assert.equal(t.kills,1);g.damage(ct,1000,t);assert.equal(t.money,before+300);}
});
test('money: friendly fire disabled by default; enabled teamkill deducts3300; cap16000',()=>{
  const {g,t,ct}=match();const ally=g.add('a','ally','T');g.spawn(ally);g.damage(ally,1000,t);assert.equal(ally.hp,100);g.friendlyFire=true;g.damage(ally,1000,t);assert.equal(t.money,6700);t.money=15900;g.damage(ct,1000,t);assert.equal(t.money,16000);
});
test('round money: winning3250 and losing1400 are paid at the next round, not every spawn',()=>{
  const {g,t,ct}=match();t.money=ct.money=0;g.finish('CT','elimination');assert.equal(t.money,0);assert.equal(ct.money,0);assert.equal(g.finish('CT','duplicate'),false);g.begin();assert.equal(ct.money,3250);assert.equal(t.money,1400);
});
test('round money: source shared loser progression and reset after breaking a multi-loss streak',()=>{
  const {g,t,ct}=match(),losses=[];for(let i=0;i<6;i++){g.phase='live';t.money=ct.money=0;g.finish('CT','elimination');g.begin();losses.push(t.money);}assert.deepEqual(losses,[1400,1900,2400,2900,3400,3400]);g.phase='live';t.money=ct.money=0;g.finish('T','break streak');g.begin();assert.equal(ct.money,1500);g.phase='live';t.money=ct.money=0;g.finish('CT','again');g.begin();assert.equal(t.money,1500);
});
test('round money: T timeout survivors receive no round money, dead teammates still get loss reward',()=>{
  const {g,t,ct}=match(),dead=g.add('dead','dead T','T');g.spawn(dead);g.damage(dead,1000);t.money=ct.money=dead.money=0;g.finish('CT','timeout','timeout');g.begin();assert.equal(t.money,0);assert.equal(dead.money,1400);assert.equal(ct.money,3250);
});
test('round money: bomb objective win3500 and defused-T extra800; no invented planter or defuser cash',()=>{
  {const {g,t,ct}=match();t.money=ct.money=0;g.finish('T','bomb','bomb');g.begin();assert.equal(t.money,3500);assert.equal(ct.money,1400);}
  {const {g,t,ct}=match();t.money=ct.money=0;g.finish('CT','defuse','defuse');g.begin();assert.equal(t.money,2200);assert.equal(ct.money,3250);assert.equal(ECONOMY.plantReward,0);assert.equal(ECONOMY.defuseReward,0);}
});
test('carryover: survivors keep ammo, armour, equipment, grenades; death resets gear but not account',()=>{
  const {g,t,ct}=match();g.buy('t','ak47');g.buy('t','assaultsuit');g.buy('t','hegrenade');t.ammo=4;t.reserve=7;t.armour=45;const before=t.money;g.begin();assert.equal(t.ammo,4);assert.equal(t.reserve,7);assert.equal(t.armour,45);assert.equal(t.grenades.hegrenade,1);assert.equal(t.money,before);g.phase='live';g.damage(t,1000,ct);g.begin();assert.equal(t.primary,null);assert.equal(t.weapon,'glock18');assert.equal(t.armour,0);assert.equal(t.helmet,false);assert.equal(t.grenades.hegrenade,0);assert.equal(t.money,before);
});
test('knife: equip anytime owned, primary and backstab hit, no ammo or free sniper',()=>{
  const {g,t,ct}=match();g.equip('t',3);g.time+=1;place(t);place(ct,-18.4,21.3);t.pitch=-.4;ct.hp=1000;const hp=ct.hp;g.shoot(t);assert.ok(ct.hp<hp);assert.equal(t.ammo,0);g.time+=2;ct.yaw=0;const before=ct.hp;g.secondary('t');assert.ok(before-ct.hp>65);assert.equal(g.equip('t','awp'),false);
});
test('grenade integration: server consumes exactly one grenade, creates live projectile and switches back',()=>{
  const {g,t}=match();g.buy('t','hegrenade');g.equip('t',4);g.time+=1;assert.equal(t.weapon,'hegrenade');assert.equal(g.shoot(t),true);assert.equal(t.grenades.hegrenade,0);assert.equal(g.projectiles.length,1);assert.equal(t.weapon,'glock18');
});
test('gun modes: silencer, burst, zoom, reload and equipment ownership are authoritative',()=>{
  {const {g,ct}=match();g.buy('ct','m4a1');g.time+=1;g.secondary('ct');assert.equal(ct.silenced,true);assert.equal(g.shoot(ct),false);}
  {const {g,t}=match();g.time+=1;g.secondary('t');assert.equal(t.burstMode,true);g.time+=1;g.input('t',{fire:true,yaw:t.yaw,pitch:-.5});tick(g,.4,{t:{fire:true,yaw:t.yaw,pitch:-.5}});assert.equal(t.ammo,17);}
  {const {g,t}=match();g.buy('t','awp');g.time+=1;g.secondary('t');assert.equal(t.zoom,40);g.time+=.31;g.secondary('t');assert.equal(t.zoom,10);}
});
test('reload: per-shell shotgun can be interrupted, magazines use paid reserve and switching does not refill',()=>{
  const {g,t}=match();g.buy('t','m3');g.buy('t','primaryammo');t.ammo=0;g.reload('t');tick(g,.6);assert.equal(t.ammo,1);assert.ok(t.reloadAt>0);g.time+=1;g.shoot(t);assert.equal(t.reloadAt,0);const reserve=t.reserve;g.equip('t',2);g.equip('t',1);assert.equal(t.reserve,reserve);assert.equal(t.ammo,0);
});
test('defuse: kit halves the source10 seconds to5, dropping input interrupts',()=>{
  for(const kit of [false,true]){const {g,t,ct}=match();const site=SITES[0];Object.assign(ct,{x:site.x+.5,y:supportHeight(site.x+.5,site.z,site.y+1),z:site.z,defuseKit:kit,vx:0,vz:0,vy:0});g.bomb={state:'planted',x:ct.x,y:ct.y,z:ct.z,endAt:g.time+45,site:'A'};tick(g,4.5,{ct:{use:true}});assert.equal(g.bomb.state,'planted');tick(g,kit?.6:5.6,{ct:{use:true}});assert.equal(g.bomb.state,'defused');}
});
test('death drops: only best firearm, and a CT kit can be recovered without purchasing',()=>{
  const {g,t,ct}=match();g.buy('ct','m4a1');g.buy('ct','defusekit');const ally=g.add('ally','CT ally','CT');g.spawn(ally);g.damage(ct,1000,t);assert.deepEqual(g.drops.filter(d=>d.kind==='weapon').map(d=>d.weapon),['m4a1']);const kit=g.drops.find(d=>d.kind==='defusekit');assert.ok(kit);Object.assign(ally,{x:kit.x,y:kit.y,z:kit.z});g.time+=.6;g.pickup(ally);assert.equal(ally.defuseKit,true);assert.equal(ally.primary,'m4a1');
});
test('privacy: opponent snapshots omit cash, ammunition inventory and flash state',()=>{
  const {g,t}=match();const self=g.snapshot('t').players.find(p=>p.id==='t'),other=g.snapshot('ct').players.find(p=>p.id==='t');assert.equal(self.money,10000);assert.equal(other.money,undefined);assert.equal(other.inventory,undefined);assert.equal(other.ammoPool,undefined);assert.equal(other.flashUntil,undefined);self.inventory.knife.ammo=99;assert.equal(t.inventory.knife.ammo,0);
});
