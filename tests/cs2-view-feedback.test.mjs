import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createViewFeedback as createSharedViewFeedback,viewmodelMotion as sharedMotion} from '../public/view-feedback.js';
import {createCS2ViewFeedback,createViewFeedback,viewmodelMotion,CS2_LANDING_FEEDBACK} from '../public/cs2-view-feedback.js';

const near=(a,b,epsilon=1e-10)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} != ${b}`);
const degrees=value=>value*180/Math.PI;
const airborne=Object.freeze({grounded:false,vx:0,vy:-12,vz:0});
const landing=(fall=500)=>({grounded:true,landedSpeed:fall/40,alive:true});
const observation=(extra={})=>({seq:1,round:1,now:0,...extra});

test('legacy:true returns the unchanged shared API and identical event/sample behavior',()=>{
  const a=createSharedViewFeedback(),b=createCS2ViewFeedback({legacy:true});
  assert.deepEqual(Object.keys(b),Object.keys(a));
  for(const [fall,options] of [[268,observation()],[500,observation({seq:2})],[600,observation({seq:3,now:80})],[600,observation({seq:4,now:500,strength:.7})]]){
    assert.equal(b.observe(airborne,landing(fall),options),a.observe(airborne,landing(fall),options));
    for(const offset of [-1,0,12,25,45,100,159,160,219,220])assert.deepEqual(b.sample(options.now+offset),a.sample(options.now+offset));
    assert.deepEqual(b.diagnostics(),a.diagnostics());
  }
  a.reset();b.reset();assert.deepEqual(b.diagnostics(),a.diagnostics());assert.deepEqual(b.sample(NaN),a.sample(NaN));assert.deepEqual(b.sample(1,false),a.sample(1,false));
});

test('CS2 default reduces car-height landing roll and has exact 45ms/160ms boundaries',()=>{
  for(const [fall,expected] of [[450,.2925],[500,.325]]){
    const f=createCS2ViewFeedback();assert.equal(f.observe(airborne,landing(fall),observation()),true);
    assert.deepEqual(f.sample(0),{roll:0});near(degrees(f.sample(45).roll),expected);assert.ok(f.sample(100).roll>0);assert.equal(f.sample(160).roll,0);assert.equal(f.diagnostics().active,false);assert.equal(f.sample(300).roll,0);
  }
  assert.equal(CS2_LANDING_FEEDBACK.maxRollDegrees,.6);assert.equal(CS2_LANDING_FEEDBACK.durationMs,160);assert.equal(createViewFeedback,createCS2ViewFeedback);
});

test('the original 8.75m/s trigger is retained; ordinary jumps and grounded slopes do not tilt',()=>{
  for(const fall of [0,268,7.67*40,317,349.999]){
    const f=createCS2ViewFeedback();assert.equal(f.observe(airborne,landing(fall),observation()),false);assert.equal(f.sample(45).roll,0);
  }
  const f=createCS2ViewFeedback();assert.equal(f.observe(airborne,landing(350),observation()),true);
  for(const [before,after] of [[{grounded:true},landing(1000)],[airborne,{...landing(1000),grounded:false}],[airborne,{...landing(1000),alive:false}],[airborne,landing(Infinity)],[airborne,landing(NaN)]])assert.equal(createCS2ViewFeedback().observe(before,after,observation()),false);
});

test('strength is monotonic until the explicit small-roll cap and zero has no visual pulse',()=>{
  const values=[0,.1,.25,.5,1].map(strength=>{
    const f=createCS2ViewFeedback();assert.equal(f.observe(airborne,landing(),observation({strength})),true);const roll=degrees(f.sample(45).roll);if(strength===0)assert.equal(f.diagnostics().active,false);return roll;
  });
  assert.deepEqual(values.map(value=>Math.round(value*10000)),[0,1300,3250,6000,6000]);
  for(const strength of [NaN,Infinity,undefined]){const f=createCS2ViewFeedback();f.observe(airborne,landing(),observation({strength}));near(degrees(f.sample(45).roll),.325);}
  for(const strength of [-10,0]){const f=createCS2ViewFeedback();f.observe(airborne,landing(),observation({strength}));assert.equal(f.sample(45).roll,0);assert.equal(f.diagnostics().active,false);}
  for(const strength of [1,5])for(const fall of [350,500,10000]){const f=createCS2ViewFeedback();f.observe(airborne,landing(fall),observation({strength}));for(let ms=0;ms<=160;ms++)assert.ok(degrees(f.sample(ms).roll)<=.6+1e-10);}
});

test('event identities and the shared replay guard survive the shorter visual duration',()=>{
  const f=createCS2ViewFeedback();assert.equal(f.observe(airborne,landing(),observation()),true);
  const peak=f.sample(45).roll;
  assert.equal(f.observe(airborne,landing(),observation({seq:2,now:0})),false,'multiple physics ticks in one RAF cannot stack pulses');
  assert.equal(f.observe(airborne,landing(),observation({now:80})),false,'same event is never replayed');
  assert.equal(f.observe(airborne,landing(),observation({seq:3,now:80})),false,'reconciliation with a new sequence does not restart the pulse');
  near(f.sample(45).roll,peak);assert.equal(f.sample(160).roll,0);
  assert.equal(f.observe(airborne,landing(),observation({seq:4,now:180})),false,'visual expiry must not shorten the shared replay guard');
  assert.equal(f.observe(airborne,landing(),observation({seq:5,now:230})),true);
  assert.equal(f.observe(airborne,landing(),observation({seq:1,round:2,now:240})),true,'a new round is a new event namespace');
  f.reset();assert.equal(f.diagnostics().lastKey,null);assert.equal(f.sample(260).roll,0);assert.equal(f.observe(airborne,landing(),observation({now:270})),true);
});

test('disabling or resetting removes residual roll without reviving it on re-enable',()=>{
  const f=createCS2ViewFeedback();assert.equal(f.observe(airborne,landing(),observation({enabled:false})),false);assert.equal(f.sample(45).roll,0);
  f.observe(airborne,landing(),observation());assert.ok(f.sample(45).roll>0);assert.deepEqual(f.sample(50,false),{roll:0});assert.equal(f.sample(60,true).roll,0);
  f.reset();assert.equal(f.observe(airborne,landing(),observation({now:100})),true);f.reset();assert.equal(f.sample(145).roll,0);assert.equal(f.diagnostics().active,false);
});

test('missing or malformed event IDs are rejected rather than permanently deduplicated',()=>{
  const f=createCS2ViewFeedback();
  for(const options of [{now:0},{seq:1,now:0},{round:1,now:0},observation({seq:0}),observation({round:-1}),observation({seq:NaN}),observation({now:NaN})])assert.equal(f.observe(airborne,landing(),options),false);
  assert.equal(f.observe(airborne,landing(),observation()),true);assert.ok(f.sample(45).roll>0);
});

test('the pulse starts, peaks and finishes without endpoint slope discontinuities',()=>{
  const f=createCS2ViewFeedback();f.observe(airborne,landing(),observation());const epsilon=.01,peak=f.sample(45).roll;
  assert.ok(f.sample(epsilon).roll<1e-11);assert.ok(peak-f.sample(45-epsilon).roll<1e-11);assert.ok(peak-f.sample(45+epsilon).roll<1e-11);assert.ok(f.sample(160-epsilon).roll<1e-11);assert.equal(f.sample(160).roll,0);
});

test('sampling is based on event age, independent of frame rate, and the default total roll is much smaller',()=>{
  const reference=createCS2ViewFeedback();reference.observe(airborne,landing(),observation());const expected=reference.sample(100).roll;
  for(const hz of [30,60,75,120,144]){const f=createCS2ViewFeedback();f.observe(airborne,landing(),observation());for(let frame=0;frame<Math.floor(hz*.1);frame++)f.sample(frame*1000/hz);near(f.sample(100).roll,expected);}
  const legacy=createSharedViewFeedback(),cs2=createCS2ViewFeedback();legacy.observe(airborne,landing(),observation());cs2.observe(airborne,landing(),observation());let oldArea=0,newArea=0;
  for(let time=0;time<=220;time++){oldArea+=legacy.sample(time).roll;newArea+=cs2.sample(time).roll;}assert.ok(newArea<oldArea*.25);
});

test('feedback is pure roll and never mutates input, physical pose, recoil, inventory or aim',()=>{
  const before=Object.freeze({...airborne,yaw:.3,pitch:.2,input:Object.freeze({fire:true})});
  const after=Object.freeze({...landing(),x:2,y:3,z:4,recoilYaw:.04,recoilPitch:.12,ammo:30,hp:100,input:Object.freeze({fire:true})});
  const saved=JSON.stringify({before,after}),f=createCS2ViewFeedback();assert.equal(f.observe(before,after,observation()),true);
  for(const now of [-1,0,25,45,100,159,160,NaN])assert.deepEqual(Object.keys(f.sample(now)),['roll']);assert.equal(JSON.stringify({before,after}),saved);
  const g=createCS2ViewFeedback();g.observe(before,after,observation());const roll=g.sample(45).roll;
  for(const yaw of [-2,0,1])for(const pitch of [-1.4,-.3,.4,1.4]){const a=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(pitch+after.recoilPitch,yaw+after.recoilYaw,0,'YXZ')),b=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(pitch+after.recoilPitch,yaw+after.recoilYaw,roll,'YXZ'));near(a.distanceTo(b),0);}
});

test('shared viewmodel motion is the exact same export, including classic bob settings',()=>{
  assert.equal(viewmodelMotion,sharedMotion);const player=Object.freeze({vx:3,vz:4,yaw:.4,grounded:true});
  for(const bob of ['current','classic','off'])for(const now of [0,25,500,1500])assert.deepEqual(viewmodelMotion(player,now,{bob,bobStrength:.35}),sharedMotion(player,now,{bob,bobStrength:.35}));
});
