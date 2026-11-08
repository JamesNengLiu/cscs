import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectileBuffer,CS2_PROJECTILE_BUFFER_LIMIT} from '../public/cs2-projectile-buffer.js';
import {createProjectileBuffer as original} from '../public/projectile-buffer.js';
const p={id:'grenade',kind:'smokegrenade',x:0,y:2,z:0,bornAt:0};
test('CS2 interpolates actual fixed-physics timestamps instead of the containing player snapshots',()=>{
 const b=createProjectileBuffer();b.push([{...p,simulatedAt:1}],1.005,1);b.push([{...p,x:2,simulatedAt:1.03125}],1.0383333333333333,1);
 const target=1.015625,delay=1.0383333333333333-1.005,s=b.sample(target+delay)[0];assert.ok(Math.abs(s.x-1)<1e-10);assert.equal(s.y,2);
 const legacy=original();legacy.push([p],1.005,1);legacy.push([{...p,x:2}],1.0383333333333333,1);assert.ok(Math.abs(legacy.sample(target+delay)[0].x-1)>.1);
});
test('legacy-sized snapshots without sample times keep their interpolation and never extrapolate',()=>{
 const a=createProjectileBuffer(),b=original();for(const buffer of [a,b]){buffer.push([p],1,1);buffer.push([{...p,x:1,y:3}],1+1/30,1);}
 for(const at of [.9,1,1.02,1.04,1.1])assert.deepEqual(a.sample(at),b.sample(at));
});
test('the final resting point is interpolated once, then stays fixed without bouncing again',()=>{
 const b=createProjectileBuffer();b.push([p],1,1);b.push([{...p,x:1,y:1,resting:true}],1.04,1);
 const middle=b.sample(1.06)[0];assert.ok(Math.abs(middle.x-.5)<1e-10);assert.ok(Math.abs(middle.y-1.5)<1e-10);
 assert.equal(b.sample(2)[0].x,1);b.push([{...p,x:1,y:1,resting:true}],1.08,1);assert.equal(b.sample(2)[0].x,1);assert.equal(b.sample(2)[0],b.sample(3)[0],'unchanged resting samples reuse their representation');
});
test('round changes, long gaps, invalid times, teleports and explosion removals cannot revive stale positions',()=>{
 const b=createProjectileBuffer();b.push([p],1,1);b.push([{...p,x:2}],1.04,1);b.remove(p.id);assert.deepEqual(b.sample(1.05),[]);
 b.push([p],1.08,2);assert.equal(b.sample(1.1)[0].x,0);b.push([{...p,x:10}],1.12,2);assert.equal(b.sample(1.13)[0].x,10);
 b.push([{...p,x:2}],2,2);assert.equal(b.sample(2)[0].x,2);b.push([{...p,x:99}],NaN,2);assert.equal(b.sample(2)[0].x,2);b.clear();assert.deepEqual(b.sample(2),[]);
});
test('buffer work and storage stay bounded and malformed per-object times fall back to state time',()=>{
 const b=createProjectileBuffer(),items=Array.from({length:1000},(_,i)=>({...p,id:String(i)}));b.push(items,1,1);assert.equal(b.sample(1).length,CS2_PROJECTILE_BUFFER_LIMIT);
 for(const bad of [NaN,Infinity,0,2]){b.clear();b.push([{...p,simulatedAt:bad}],1,1);b.push([{...p,x:1,simulatedAt:bad}],1.04,1);assert.ok(Math.abs(b.sample(1.06)[0].x-.5)<1e-10);}
});
