import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {consumeGunShot} from '../public/gun-state.js';import {resetWeapon} from '../public/weapons.js';
import {sampleViewRecoil} from '../public/weapon-feel.js';import {supportHeight} from '../public/shared.js';
const reference=JSON.parse(readFileSync(new URL('./fixtures/ak-ray-reference.json',import.meta.url))),rad=Math.PI/180;
const near=(a,b,t=3e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
for(const [index,c] of reference.cases.entries())test(`AK ray ${index}: engine movement angle and weapon addition match independent C++`,()=>{
 const p={weapon:'ak47',alive:true,ammo:30,reserve:0,x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),grounded:true,vx:0,vy:0,vz:0,yaw:c.yaw,pitch:c.pitch,lastShot:-100,nextAttackAt:0,recoilSeed:123,input:{fire:true}};resetWeapon(p);
 Object.assign(p,{accuracy:c.accuracy,recoilYaw:c.expected.recoilYawAfterMove,recoilPitch:c.expected.recoilPitchAfterMove});const before={...p},draws=[c.seed/0x100000000,.5,.5,.5];let at=0;
 const shot=consumeGunShot(p,10,false,()=>draws[at++]);assert.ok(shot);for(const key of ['x','y','z'])near(shot.direction[key],c.expected.direction[key]);
 near(shot.pitch,c.pitch+2*before.recoilPitch,1e-12);near(Math.sin(shot.yaw),Math.sin(c.expected.rayYaw));assert.equal(p.pitch,before.pitch);assert.equal(p.yaw,before.yaw);assert.equal(at,4);assert.equal(p.ammo,29);
 // The same shot still applies only the existing standing camera kick.
 near(p.recoilPitch,Math.min(5.75*rad,before.recoilPitch+rad),1e-12);assert.equal(shot.recoilPitch,p.recoilPitch);near(sampleViewRecoil(p,0).recoilPitch,p.recoilPitch,1e-12);
});
