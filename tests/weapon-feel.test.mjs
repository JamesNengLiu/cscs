import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.mjs';
import {GUNS} from '../public/arsenal.js';
import {shotProfile,resetWeapon,updateWeapon,weaponSpread} from '../public/weapons.js';
import {SPAWN_POINTS,supportHeight,movePlayer} from '../public/shared.js';
import {verticalFov} from '../public/view-settings.js';
const close=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} vs ${b}`);
function match(id='ak47'){
  const g=new Game({random:()=>.5}),p=g.add('p','Feel',GUNS[id].teams[0]);g.begin();if(p.weapon!==id)g.buy(p.id,id);g.time=Math.max(g.time,p.nextAttackAt);return {g,p};
}
function pose(weapon='ak47'){
  const s=SPAWN_POINTS.T[0],p={...s,y:supportHeight(s.x,s.z,s.y+.1),weapon,vx:0,vz:0,vy:0,yaw:0,pitch:0,lastShot:-100,zoom:90};resetWeapon(p);return p;
}
test('punch starts returning on the first tick after a shot, independently of accuracy recovery',()=>{
  const p=pose();shotProfile(p,()=>.5,1);p.lastShot=1;const before=p.recoilPitch;updateWeapon(p,1/60,1+1/60);
  assert.ok(p.recoilPitch>0&&p.recoilPitch<before);assert.equal(p.burstCount,1);
});
test('AK and M4 have different stance-specific recoil and preserve input aim',()=>{
  const ak=pose(),m4=pose('m4a1'),duck=pose();duck.crouch=true;
  for(const p of [ak,m4,duck])shotProfile(p,()=>.5,1);
  close(ak.recoilPitch,Math.PI/180);close(m4.recoilPitch,.65*Math.PI/180);close(duck.recoilPitch,.9*Math.PI/180);
  assert.equal(ak.pitch,0);assert.equal(ak.yaw,0);
});
for(const id of Object.keys(GUNS))test(`weapon accuracy ${id}: finite grounded/crouched/moving/airborne values`,()=>{
  const p=pose(id);for(const mode of [{},{crouch:true},{vx:6},{y:p.y+1,vy:1}]){Object.assign(p,mode);assert.ok(Number.isFinite(weaponSpread(p)));const s=shotProfile(p,()=>.5,1);close(Math.hypot(s.direction.x,s.direction.y,s.direction.z),1);}
});
for(const id of ['ak47','m4a1','mac10','p90'])test(`sustained ${id}: cumulative firing cadence stays within one server tick`,()=>{
  const {g,p}=match(id);p.ammo=200;
  for(let i=0;i<180;i++){g.input(p.id,{fire:true,yaw:p.yaw});g.step();}
  const times=g.events.filter(e=>e.type==='shot').map(e=>e.time);
  close(times.at(-1)-times[0],(times.length-1)*GUNS[id].interval,1/60+1e-6);
});
test('AWP switch cannot bypass its deployment or reset the previous shot cooldown; manual scope stays manual',()=>{
  const {g,p}=match('awp');g.secondary(p.id);assert.equal(p.zoom,40);assert.equal(g.shoot(p),true);const shotAt=g.time;
  g.equip(p.id,2);g.time+=.01;g.equip(p.id,1);assert.equal(p.zoom,90);assert.equal(p.resumeZoomAt,0);
  g.time=shotAt+.53;assert.equal(g.shoot(p),false);g.time=p.nextAttackAt+1e-6;assert.equal(g.shoot(p),true);assert.equal(p.zoom,90);
});
test('all pellets of one M3 shot use the same pre-shot basis',()=>{
  const {g,p}=match('m3');assert.equal(g.shoot(p),true);const events=g.events.filter(e=>e.type==='shot');assert.equal(events.length,9);
  for(const e of events)close(e.to.y,e.from.y);
});
test('scope firing interval changes only for AUG/SG552 zoom, not for AWP',()=>{
  const {g,p}=match('aug');p.zoom=55;g.shoot(p);close(p.nextShotAt-g.time,.135);
});
for(const id of ['glock18','famas'])test(`${id} burst mode repeats on a held trigger and finishes its last group after release`,()=>{
  const {g,p}=match(id);p.burstMode=true;const ammo=p.ammo;
  for(let i=0;i<49;i++){g.input(p.id,{fire:true,yaw:p.yaw});g.step();}
  assert.equal(p.ammo,ammo-6);for(let i=0;i<45;i++){g.input(p.id,{fire:false,yaw:p.yaw});g.step();}assert.equal(p.ammo,ammo-6);
});
for(const id of ['m4a1','usp'])test(`${id} suppressor animation lock survives switching away and back`,()=>{
  const {g,p}=match(id);g.time=Math.max(g.time,p.nextSecondaryAt)+.01;assert.equal(g.secondary(p.id),true);const deadline=p.modeLockAt;
  g.equip(p.id,3);g.time+=.01;g.equip(p.id,id);g.time+=.8;assert.equal(g.shoot(p),false);assert.equal(g.secondary(p.id),false);
  g.time=deadline+.01;assert.equal(g.shoot(p),true);
});
test('holding a weapon selects its original maximum movement speed',()=>{
  for(const id of ['ak47','m4a1','scout','awp']){const p=pose(id);for(let i=0;i<40;i++)movePlayer(p,{f:-1,yaw:0},1/60);close(Math.hypot(p.vx,p.vz)*40,GUNS[id].maxSpeed);}
});
test('airborne release and duck preserve horizontal momentum rather than braking toward zero',()=>{
  for(const crouch of [false,true]){const p=pose();p.vz=5;movePlayer(p,{jump:true},1/60);const speed=Math.hypot(p.vx,p.vz);for(let i=0;i<9;i++)movePlayer(p,{crouch},1/60);assert.equal(p.grounded,false);close(Math.hypot(p.vx,p.vz),speed);}
});
test('FOV converts the original 4:3 horizontal convention and expands widescreen horizontally',()=>{
  close(verticalFov(90,4/3),73.73979529168804);close(verticalFov(90,16/9),verticalFov(90,4/3));assert.ok(verticalFov(10,4/3)<verticalFov(40,4/3));
});
