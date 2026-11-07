import test from 'node:test';
import assert from 'node:assert/strict';
import {CS2UniformRandomStream,createCS2RecoilTable} from '../public/cs2-recoil-reference.js';
import {CS2_WEAPON_PROFILE} from '../public/cs2-weapon-profile.js';
const table=(id,mode=0)=>{const w=CS2_WEAPON_PROFILE.guns[id],s=w.source;return createCS2RecoilTable({seed:s.m_nRecoilSeed,angle:s.m_flRecoilAngle[mode],angleVariance:s.m_flRecoilAngleVariance[mode],magnitude:s.m_flRecoilMagnitude[mode],magnitudeVariance:s.m_flRecoilMagnitudeVariance[mode],automatic:w.automatic});};
const near=(a,b,e=1e-5)=>assert.ok(Math.abs(a-b)<=e,`${a} vs ${b}`);

test('AK first impulse matches independent native CS2 recording exactly',()=>{
 assert.deepEqual(table('ak47')[0].impulse,[-19.98842430114746,-10.330194473266602,0]);
});
test('continuous AK RNG, suppression and smoothing predict native later angular velocities',()=>{
 const samples=[[-19.98842430114746,-10.330194473266602],[-33.33890914916992,.03714895248413086],[-44.09569549560547,-2.2964131832122803],[-53.25947570800781,-2.182107448577881],[-60.7618408203125,6.060967922210693],[-67.38362121582031,8.53518295288086],[-71.06971740722656,14.599689483642578]],t=table('ak47');let velocity=[0,0];
 for(let i=0;i<samples.length;i++){velocity=velocity.map((v,k)=>v*Math.exp(-4.5*.1)+t[i].impulse[k]);for(let k=0;k<2;k++)near(velocity[k],samples[i][k],2e-5);}
});
test('silenced M4 first impulse uses its own native seed and coefficient mode',()=>{
 assert.deepEqual(table('m4a1',1)[0].impulse,[-15.436869621276855,3.124988555908203,0]);
 assert.notDeepEqual(table('m4a1',0)[0].impulse,table('m4a1',1)[0].impulse);
});
test('recoil tables are independent streams and do not depend on creation order',()=>{
 const first=table('ak47');table('awp',1);table('m4a1',1);assert.deepEqual(table('ak47'),first);assert.equal(first.length,64);
 const a=new CS2UniformRandomStream(223),b=new CS2UniformRandomStream(223);for(let i=0;i<100;i++)assert.equal(a.randomFloat(-70,70),b.randomFloat(-70,70));a.setSeed(223);assert.equal(a.randomFloat(-70,70),new CS2UniformRandomStream(223).randomFloat(-70,70));
});
test('seed/range validation and degenerate RNG bounds remain finite',()=>{
 assert.throws(()=>new CS2UniformRandomStream(NaN));assert.throws(()=>new CS2UniformRandomStream(1.2));for(const seed of [0,1,-1,2147483647,-2147483647]){const r=new CS2UniformRandomStream(seed);for(let i=0;i<20;i++){const x=r.randomFloat();assert.ok(Number.isFinite(x)&&x>=0&&x<1);}}
});
