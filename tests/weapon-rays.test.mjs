import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {Game} from '../game.mjs';import {GUNS} from '../public/arsenal.js';
import {consumeGunShot} from '../public/gun-state.js';import {resetWeapon,spreadDirection} from '../public/weapons.js';
import {decayPunch,sampleViewRecoil} from '../public/weapon-feel.js';import {supportHeight} from '../public/shared.js';
const reference=JSON.parse(readFileSync(new URL('./fixtures/weapon-ray-reference.json',import.meta.url)));
const near=(a,b,t=3e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const pose=weapon=>({weapon,alive:true,ammo:1000,reserve:0,x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),grounded:true,vx:0,vy:0,vz:0,yaw:0,pitch:0,zoom:90,lastShot:9.7,nextShotAt:1,nextAttackAt:0,recoilSeed:123456,input:{fire:true}});

test('independent ray fixtures cover every purchasable gun and both burst followups',()=>{
 assert.deepEqual([...new Set(reference.cases.map(c=>c.weapon))].sort(),Object.keys(GUNS).sort());
 for(const weapon of ['glock18','famas'])for(const name of ['burst-followup-1','burst-followup-2'])assert.ok(reference.cases.some(c=>c.weapon===weapon&&c.name===name));
 for(const weapon of ['m3','xm1014'])assert.ok(reference.cases.some(c=>c.weapon===weapon&&c.expected.draws>4));
});
for(const c of reference.cases)test(`${c.weapon} / ${c.name}: actual firing direction matches independent PMove and bullet reference`,()=>{
 const p=pose(c.weapon);resetWeapon(p);Object.assign(p,{yaw:c.yaw,pitch:c.pitch,recoilPitch:c.initialRecoilPitch,recoilYaw:c.initialRecoilYaw,accuracy:c.accuracy,burstCount:c.burstCount,crouch:c.crouch,vx:c.vx,zoom:c.zoom,silenced:c.silenced,burstMode:c.burstMode,burstSpread:c.burstSpread});
 if(c.air){p.y+=2;p.grounded=false;p.vy=2;}decayPunch(p,c.dt);
 near(p.recoilPitch,c.expected.recoilPitch);near(p.recoilYaw,c.expected.recoilYaw);
 const before={...p};let draws=0;const shot=consumeGunShot(p,10,c.follow,()=>{assert.ok(draws<c.draws.length,'unexpected random draw');return c.draws[draws++];});assert.ok(shot);
 for(const key of ['x','y','z'])near(shot.direction[key],c.expected.direction[key]);
 near(shot.pitch,c.expected.rayPitch);near(Math.sin(shot.yaw),Math.sin(c.expected.rayYaw));near(shot.spread,c.spread,1e-12);
 assert.equal(draws,c.expected.draws);assert.equal(p.ammo,before.ammo-1);assert.equal(p.shotsFired,1);assert.equal(p.yaw,before.yaw);assert.equal(p.pitch,before.pitch);
 assert.deepEqual(sampleViewRecoil(p),{recoilPitch:p.recoilPitch,recoilYaw:p.recoilYaw});
 if(c.follow){assert.equal(p.recoilPitch,before.recoilPitch);assert.equal(p.recoilYaw,before.recoilYaw);assert.equal(p.burstCount,before.burstCount);}
});

for(const weapon of ['m3','xm1014'])test(`${weapon}: all actual Game pellets reject corners and share the pre-shot basis`,()=>{
 const c=reference.cases.find(c=>c.weapon===weapon&&c.name==='warm'),g=new Game({audioRandom:()=>.5}),p=g.add('p','Buckshot','T');g.begin();g.buy(p.id,weapon);g.phase='live';g.time=10;g.endAt=1000;
 Object.assign(p,{...pose(weapon),id:p.id,ammo:GUNS[weapon].clip,yaw:c.yaw,pitch:c.pitch,recoilPitch:c.expected.recoilPitch,recoilYaw:c.expected.recoilYaw});
 const rays=[],target=g.targetRay.bind(g);g.targetRay=(p,d,...rest)=>{rays.push({...d});return target(p,d,...rest);};
 let draws=0;g.random=()=>c.draws[draws++%c.draws.length];const ammo=p.ammo;assert.equal(g.shoot(p),true);
 assert.equal(rays.length,GUNS[weapon].pellets);assert.equal(draws,c.expected.draws*GUNS[weapon].pellets);assert.equal(p.ammo,ammo-1);assert.equal(p.shotsFired,1);
 for(const ray of rays)for(const key of ['x','y','z'])near(ray[key],c.expected.direction[key]);
});

test('buckshot accepts the circular boundary and resamples an outside corner',()=>{
 for(const [values,expected,calls]of [[[1,1,.5,.5],{x:1,y:0},4],[[1,1,1,1,.2,.6,.8,.1],{x:-.2,y:-.1},8]]){
  let at=0;const d=spreadDirection({yaw:0,pitch:0,spread:.1},()=>values[at++],'buckshot');near(d.x/-d.z,expected.x*.1,1e-12);near(d.y/-d.z,expected.y*.1,1e-12);assert.equal(at,calls);
 }
});
test('a degenerate buckshot RNG cannot hang the simulation or emit outside the cone',()=>{
 let calls=0;const d=spreadDirection({yaw:0,pitch:0,spread:.0675},()=>{calls++;return 1;},'buckshot');assert.equal(calls,128);assert.deepEqual(d,{x:0,y:0,z:-1});
});
test('rejected shots do not consume spread randomness or ammunition for any gun',()=>{
 for(const weapon of Object.keys(GUNS)){const p=pose(weapon);p.nextAttackAt=11;const before={...p};assert.equal(consumeGunShot(p,10,false,()=>assert.fail('rejected shot sampled')),null);assert.deepEqual(p,before);}
});
