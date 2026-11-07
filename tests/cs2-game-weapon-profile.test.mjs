import test from 'node:test';
import assert from 'node:assert/strict';
import {CS2_WEAPON_PROFILE,CS2_WEAPON_REFERENCE,getWeaponProfile} from '../public/cs2-weapon-profile.js';
import {createCS2WeaponBehavior} from '../public/cs2-weapon-behavior.js';
import {createWeaponRuntime} from '../public/cs2-weapon-runtime.js';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {createLagCompensation} from '../cs2-lag-compensation.mjs';
import {applyScopeAwareAction} from '../cs2-scope-actions.mjs';
import {fixtureWorld,fixtureGame,box} from './cs2-game-fixture.mjs';
import {createBallistics} from '../cs2-ballistics.mjs';
import {PITCH_LIMIT} from '../public/view-settings.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const world=()=>fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE});
const runtime=w=>createWeaponRuntime(w,{rules:w.movement.rules,guns:CS2_WEAPON_PROFILE.guns,weapons:CS2_WEAPON_PROFILE.weapons,behavior:createCS2WeaponBehavior()});
function player(id,w){return{id:'p',weapon:id,...w.resolveSpawn('T'),input:{fire:true},zoom:90,silenced:!!CS2_WEAPON_PROFILE.guns[id].defaultSilenced,ammo:CS2_WEAPON_PROFILE.guns[id].clip,reserve:CS2_WEAPON_PROFILE.guns[id].reserve,recoilYaw:0,recoilPitch:0,nextAttackAt:0,lastShot:-100};}

test('all 24 compatibility guns map explicitly to pinned CS2 facts and a reversible profile',()=>{
 const p=CS2_WEAPON_PROFILE;assert.equal(Object.keys(p.guns).length,24);assert.equal(Object.keys(CS2_WEAPON_REFERENCE).length,35);assert.equal(p.guns.m4a1.name,'M4A1-S');assert.equal(p.guns.m4a1.clip,20);assert.equal(p.guns.awp.clip,5);assert.equal(p.guns.ak47.price,2700);assert.equal(p.guns.ak47.interval,.1);assert.equal(p.guns.ak47.maxSpeed,215);assert.equal(p.guns.awp.maxSpeedScoped,100);
 for(const w of Object.values(p.guns)){const v=CS2_WEAPON_REFERENCE[w.sourceId];assert.ok(v);assert.equal(w.damage,v.m_nDamage);assert.equal(w.clip,v.m_iMaxClip1);assert.equal(w.head,v.m_flHeadshotMultiplier);assert.equal(w.range,v.m_flRange);assert.equal(Object.isFrozen(w.source),true);assert.ok(w.unverifiedFields.includes('recoilIntegration'));}
 assert.ok(p.approximateFields.some(s=>s.includes('recoil')));assert.equal(getWeaponProfile('legacy').guns.awp.clip,10);assert.equal(getWeaponProfile('cs2'),p);assert.throws(()=>getWeaponProfile('anything'));
});
for(const id of Object.keys(CS2_WEAPON_PROFILE.guns))test(`${id}: matching client/server runtime consumes one round and produces identical seeded recoil/spread`,()=>{
 const w=world(),r=runtime(w),a=player(id,w),b=structuredClone(a);r.resetWeapon(a);r.resetWeapon(b);const shotA=r.consumeGunShot(a,1,false,()=>.37),shotB=r.consumeGunShot(b,1,false,()=>.37);assert.deepEqual(shotA,shotB);assert.equal(a.ammo,CS2_WEAPON_PROFILE.guns[id].clip-1);assert.ok(Object.values(shotA.direction).every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...Object.values(shotA.direction))-1)<1e-10);assert.equal(r.consumeGunShot(a,1.001,false,()=>.37),null);
});
test('calibrated CS2 rays use the observed x2 aim-punch scale with separate inaccuracy and spread',()=>{
 const w=world(),r=runtime(w),p=player('ak47',w);r.resetWeapon(p);p.yaw=.3;p.pitch=.1;p.recoilYaw=.04;p.recoilPitch=.08;const shot=r.shotProfile(p,()=>0,1);near(shot.yaw,.38);near(shot.pitch,.26);near(p.recoilPitch,.08);near(p.recoilYaw,.04);assert.ok(shot.inaccuracy>0);assert.equal(shot.baseSpread,.0006);assert.equal(shot.spread,shot.inaccuracy+shot.baseSpread);
});
test('native recoil cannot flip an upward ray behind the clamped first-person camera',()=>{const w=world(),r=runtime(w),p=player('ak47',w);r.resetWeapon(p);p.yaw=0;p.pitch=PITCH_LIMIT-.01;p.recoilPitch=.2;const shot=r.shotProfile(p,()=>0,1);assert.equal(shot.pitch,PITCH_LIMIT);assert.ok(shot.direction.y>0);assert.ok(shot.direction.z<0);});
test('CS2 inaccuracy separates crouch, movement, jumping and fire recovery',()=>{
 const w=world(),r=runtime(w),p=player('ak47',w);r.resetWeapon(p);const stand=r.weaponSpread(p);p.crouch=true;near(r.weaponSpread(p),stand);r.updateWeapon(p,1/60,.5);assert.ok(r.weaponSpread(p)<stand);p.crouch=false;r.updateWeapon(p,1/60,.6);p.vx=5;assert.ok(r.weaponSpread(p)>stand);p.vx=0;p.vy=4;p.y=2;assert.ok(r.weaponSpread(p)>stand+.1);p.y=.0005;p.vy=0;
 r.shotProfile(p,()=>0,1);const firing=r.weaponSpread(p);r.updateWeapon(p,.1,1.1);assert.ok(r.weaponSpread(p)<firing);assert.ok(r.weaponSpread(p)>=stand);
});
test('fractional native recoil sample follows the same decay as fixed update without mutating player',()=>{
 const w=world(),r=runtime(w),p=player('ak47',w);r.resetWeapon(p);p.recoilPitch=.1;p.recoilYaw=.03;p.lastShot=0;r.updateWeapon(p,1/60,1);const before=structuredClone(p),sample=r.sampleViewRecoil(p,1/120),next=structuredClone(p);r.updateWeapon(next,1/120,1+1/120);near(sample.recoilPitch,next.recoilPitch);near(sample.recoilYaw,next.recoilYaw);assert.deepEqual(p,before);
});
test('CS2 authoritative AWP shot plus two Q barriers retains spent cartridge and manual scope',()=>{
 const {g,t}=fixtureGame({world:world(),weaponProfile:'cs2'});t.money=16000;g.buy(t.id,'awp');g.equip(t.id,'knife');g.equip(t.id,'awp');t.nextAttackAt=0;t.yaw=0;t.zoom=40;const ammo=t.ammo;
 const command={seq:1,round:g.round,input:{yaw:0,pitch:0,fire:true}};g.inputBatch(t.id,[command]);for(let n=1;n<=2;n++)applyScopeAwareAction(g,t.id,{type:'equip',weapon:'last',switchSeq:n,afterInputSeq:1,commands:[],round:g.round});g.step();assert.equal(t.weapon,'awp');assert.equal(t.ammo,ammo-1);assert.equal(t.ammo,4);assert.equal(t.zoom,90);assert.equal(t.resumeZoomAt,0);assert.equal(g.snapshot(t.id).weaponProfileId,CS2_WEAPON_PROFILE.id);
});
test('historical native rig identity retains team, character and death clock',()=>{
 const lag=createLagCompensation(),p={id:'t',team:'T',character:'terror',diedAt:-1,x:1,y:0,z:1,yaw:0,pitch:0,alive:true,playedRound:1};lag.record({time:0,round:1,players:[p]});lag.record({time:.1,round:1,players:[{...p,x:2}]});const pose=lag.pose('t',.05,1);assert.equal(pose.team,'T');assert.equal(pose.character,'terror');assert.equal(pose.diedAt,-1);assert.equal(pose.x,1.5);
});
test('penetration requires a certified contiguous convex volume and refuses over-budget or mesh walls',()=>{
 const d={x:0,y:0,z:-1},point={x:0,y:1,z:.0505};
 for(const thickness of [.05,1]){const w=fixtureWorld({walls:[box('wall',[-2,0,-thickness+.05],[2,3,.05])]}),b=createBallistics(w);assert.equal(!!b.penetrationExit(point,d,39,'concrete'),thickness<1);}
 const mesh={id:'sheet',type:'mesh',vertices:[-2,0,0,2,0,0,2,3,0,-2,3,0],indices:[0,1,2,0,2,3],channels:['bullet'],twoSided:true};const b=createBallistics(fixtureWorld({walls:[mesh]}));assert.equal(b.penetrationExit({x:0,y:1,z:.0005},d,39,'concrete'),null);
});
