import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCS2GrenadeLaunch} from '../cs2-grenade-launch.mjs';
import {createGrenadeRuntime} from '../cs2-grenades.mjs';
import {CS2_GRENADE_PROFILE,CS2_GRENADE_PROFILE_V1} from '../public/cs2-grenade-profile.js';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {fixtureWorld} from './cs2-game-fixture.mjs';
const world=()=>fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE});
const owner=w=>({id:'owner',alive:true,team:'T',...w.resolveSpawn('T'),yaw:0,pitch:0,vx:0,vy:0,vz:0});
const keys=['x','y','z','vx','vy','vz'],close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
const state=p=>Object.fromEntries(keys.map(key=>[key,p[key]]));

test('new full-strength launch matches the prior source initial state exactly',()=>{
 const w=world(),old=createGrenadeRuntime(w,{profile:CS2_GRENADE_PROFILE_V1});
 for(const kind of ['hegrenade','flashbang','smokegrenade'])for(const pitch of [-.8,0,.5])for(const patch of [{},{vx:3,vy:1,vz:-2},{crouch:true,duckAmount:1}]){
  const p={...owner(w),yaw:.7,pitch,recoilYaw:.01,recoilPitch:.02,...patch},a=old.createGrenade(p,kind,0),b=buildCS2GrenadeLaunch(w,CS2_GRENADE_PROFILE,p,kind,{strength:1});
  assert.ok(a);assert.ok(b);assert.deepEqual(state(a),state(b));
 }
});
test('underhand and middle throw origins descend while speed and inherited velocity stay independent',()=>{
 const w=world(),p=owner(w),strong=buildCS2GrenadeLaunch(w,CS2_GRENADE_PROFILE,p,'smokegrenade',{strength:1});
 for(const strength of [0,.5,1]){
  const base=buildCS2GrenadeLaunch(w,CS2_GRENADE_PROFILE,p,'smokegrenade',{strength}),moving=buildCS2GrenadeLaunch(w,CS2_GRENADE_PROFILE,{...p,vx:2,vy:3,vz:-1},'smokegrenade',{strength});
  close(strong.y-base.y,12*.0254*(1-strength));assert.equal(strong.x,base.x);assert.equal(strong.z,base.z);
  close(Math.hypot(base.vx,base.vy,base.vz),750*.9*.0254*(.3+.7*strength));
  close(moving.vx-base.vx,2.5);close(moving.vy-base.vy,3.75);close(moving.vz-base.vz,-1.25);
 }
});
test('weak launch uses a swept lower-eye safety check and never teleports through a sill',()=>{
 const w=world(),calls=[],p=owner(w),eye=p.y+w.movement.eyeHeight(p),floor=eye-.1;
 w.collision.trace=(a,b,unused,options)=>{calls.push({a:{x:a.x,y:a.y,z:a.z},b:{x:b.x,y:b.y,z:b.z},options});if(a.y<floor-1e-10)return{startSolid:true,fraction:0,end:a};if(b.y<floor){const fraction=(a.y-floor)/(a.y-b.y);return{startSolid:false,fraction,end:{x:a.x+(b.x-a.x)*fraction,y:floor,z:a.z+(b.z-a.z)*fraction}};}return{startSolid:false,fraction:1,end:{x:b.x,y:b.y,z:b.z}};};
 const actual=buildCS2GrenadeLaunch(w,CS2_GRENADE_PROFILE,p,'hegrenade',{strength:0});assert.ok(actual);assert.ok(actual.y>=floor);assert.equal(calls.length,3);assert.equal(calls[0].a.y,eye);assert.ok(calls[0].b.y<floor);
 assert.ok(calls.every(c=>c.options.radius===CS2_GRENADE_PROFILE.radius&&c.options.channel==='grenade'));
});
test('blocked launches and malformed pose/profile input fail without mutation',()=>{
 const w=world(),p=owner(w),copy=structuredClone(p),before=buildCS2GrenadeLaunch(w,CS2_GRENADE_PROFILE,p,'hegrenade');assert.ok(before);
 for(const patch of [{x:NaN},{pitch:Infinity},{vx:NaN},{recoilYaw:Infinity}])assert.equal(buildCS2GrenadeLaunch(w,CS2_GRENADE_PROFILE,{...p,...patch},'hegrenade'),null);
 for(const strength of [-1,NaN,1.1,'0'])assert.equal(buildCS2GrenadeLaunch(w,CS2_GRENADE_PROFILE,p,'hegrenade',{strength}),null);
 for(const patch of [{underhandDrop:Infinity},{radius:-1},{metresPerUnit:0},{throwClearance:NaN}])assert.equal(buildCS2GrenadeLaunch(w,{...CS2_GRENADE_PROFILE,...patch},p,'hegrenade'),null);
 assert.deepEqual(p,copy);
 for(const blockedAt of [0,1,2]){
  let n=0;w.collision.trace=(a,b)=>n++===blockedAt?{startSolid:true,fraction:0,end:a}:{startSolid:false,fraction:1,end:{x:b.x,y:b.y,z:b.z}};
  assert.equal(buildCS2GrenadeLaunch(w,CS2_GRENADE_PROFILE,p,'hegrenade',{strength:0}),null);
 }
});
