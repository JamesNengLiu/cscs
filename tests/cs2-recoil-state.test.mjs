import test from 'node:test';import assert from 'node:assert/strict';
import {addReferenceImpulse,advanceReferencePunch,sampleReferencePunch,resetReferencePunch} from '../public/cs2-recoil-state.js';
import {referenceRecoilImpulse} from '../public/cs2-weapon-behavior-v2.js';
import {CS2_WEAPON_PROFILE} from '../public/cs2-weapon-profile.js';
import {createCS2WeaponBehavior} from '../public/cs2-weapon-behavior.js';
import {createWeaponRuntime} from '../public/cs2-weapon-runtime.js';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
const punch=()=>({recoilPitch:0,recoilYaw:0});
const impulse=[-19.98842430114746,-10.330194473266602,0];
const near=(a,b,tol=1e-12)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);
function runtime(){return createWeaponRuntime({isGrounded:()=>true},{rules:CS2_MOVEMENT_PROFILE.rules,guns:CS2_WEAPON_PROFILE.guns,weapons:CS2_WEAPON_PROFILE.weapons,behavior:createCS2WeaponBehavior()});}

test('sampling is pure and a repeated frame cannot add another shot impulse',()=>{
 const p=punch();addReferenceImpulse(p,impulse,10);advanceReferencePunch(p,1/60,10+1/60);const before=structuredClone(p),a=sampleReferencePunch(p,1/240);for(let i=0;i<20;i++)assert.deepEqual(sampleReferencePunch(p,1/240),a);assert.deepEqual(p,before);assert.ok(a.recoilPitch>p.recoilPitch);
});
test('absolute punch evaluation does not depend on simulation subdivisions',()=>{
 const a=punch(),b=punch(),c=punch();for(const p of [a,b,c])addReferenceImpulse(p,impulse,10);
 advanceReferencePunch(a,.1,10.1);for(let i=1;i<=6;i++)advanceReferencePunch(b,1/60,10+i/60);for(let i=1;i<=12;i++)advanceReferencePunch(c,1/120,10+i/120);
 for(const key of ['recoilPitch','recoilYaw','cs2RecoilPitchVelocity','cs2RecoilYawVelocity']){assert.equal(a[key],b[key]);assert.equal(a[key],c[key]);}
});
test('60/75/120/144/240Hz render sampling cannot change authoritative recoil state',()=>{
 const states=[];for(const hz of [60,75,120,144,240]){const p=punch();addReferenceImpulse(p,impulse,0);for(let tick=1;tick<=120;tick++){const at=tick/60;advanceReferencePunch(p,1/60,at);for(let t=at;t<(tick+1)/60-1e-12;t+=1/hz)sampleReferencePunch(p,t-at);}states.push(p);}for(const p of states.slice(1))assert.deepEqual(p,states[0]);
});
test('knife and pistol retain the same global residual as holding the target gun',()=>{
 const r=runtime(),states=['awp','knife','glock18'].map(weapon=>({weapon,input:{fire:false},zoom:90,silenced:false,lastShot:10,...punch()}));for(const p of states)addReferenceImpulse(p,impulse,10);
 for(let i=1;i<=120;i++){for(const p of states)r.updateWeapon(p,1/60,10+i/60);for(const p of states.slice(1))for(const key of ['recoilPitch','recoilYaw','cs2RecoilPitchVelocity','cs2RecoilYawVelocity'])assert.equal(p[key],states[0][key]);}
});
test('keepPunch resets gun precision while preserving global angle, velocity and time',()=>{
 const r=runtime(),p={weapon:'awp',zoom:40,crouch:false,input:{fire:false},lastShot:10,...punch()};r.resetWeapon(p);addReferenceImpulse(p,impulse,10);r.updateWeapon(p,1/60,10+1/60);const before=structuredClone(p);p.weapon='knife';r.resetWeapon(p,{keepPunch:true});for(const key of ['recoilPitch','recoilYaw','cs2RecoilPitchVelocity','cs2RecoilYawVelocity','cs2PunchTime','cs2PunchBaseAt'])assert.equal(p[key],before[key]);assert.equal(p.cs2PunchVersion,2);resetReferencePunch(p);assert.equal(p.cs2PunchVersion,0);assert.equal(p.cs2RecoilPitchVelocity,0);
});
test('external angle assignment rebases the residual without erasing or duplicating velocity',()=>{
 const p=punch();addReferenceImpulse(p,impulse,10);advanceReferencePunch(p,1/60,10+1/60);const velocity=p.cs2RecoilPitchVelocity;p.recoilPitch=.12;advanceReferencePunch(p,1/60,10+2/60);assert.equal(p.recoilPitch,.12);near(p.cs2RecoilPitchVelocity,velocity*Math.exp(-4.5/60));const first=structuredClone(p);advanceReferencePunch(p,0,10+2/60);assert.deepEqual(p,first);
});
test('AWP one-stage and two-stage scopes use independently observed impulse amplitudes',()=>{
 const gun=CS2_WEAPON_PROFILE.guns.awp,index28=()=>28.5/64,hip=referenceRecoilImpulse(gun,{zoom:90},index28),one=referenceRecoilImpulse(gun,{zoom:40},index28),two=referenceRecoilImpulse(gun,{zoom:10},index28);
 near(one[0],-42.49444580078125,5e-6);near(one[1],-7.809223175048828,5e-6);for(let i=0;i<2;i++)near(one[i],(hip[i]+two[i])/2,5e-6);assert.ok(Math.hypot(...hip)>Math.hypot(...one));assert.ok(Math.hypot(...one)>Math.hypot(...two));
});
test('stale or nonfinite clocks cannot rewind residual velocity or add another impulse',()=>{
 const p=punch();addReferenceImpulse(p,impulse,10);advanceReferencePunch(p,1/60,10.1);const before=structuredClone(p);for(const at of [9,NaN,Infinity,-Infinity]){advanceReferencePunch(p,1/60,at);addReferenceImpulse(p,impulse,at);assert.deepEqual(p,before);}addReferenceImpulse(p,[NaN,1,0],10.2);assert.deepEqual(p,before);
});
test('floating-point endpoint jitter still applies the shot impulse without rewinding the clock',()=>{
 const p=punch();addReferenceImpulse(p,impulse,10);advanceReferencePunch(p,.1,10.1);const before=structuredClone(p),at=10.1-1e-12;addReferenceImpulse(p,impulse,at);assert.equal(p.cs2PunchTime,10.1);near(p.cs2RecoilPitchVelocity,before.cs2RecoilPitchVelocity-impulse[0]*Math.PI/180);near(p.cs2RecoilYawVelocity,before.cs2RecoilYawVelocity+impulse[1]*Math.PI/180);
});
