import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {createViewFeedback,viewmodelMotion} from '../public/view-feedback.js';
import {createPresentationSettings,normalizePresentation,PRESENTATION_DEFAULTS} from '../public/presentation-settings.js';
import {createPointerInput,mouseCalibration} from '../public/pointer-input.js';
import {createActorScheduler} from '../public/actor-scheduler.js';
import {createWeaponCosmetics} from '../public/weapon-cosmetics.js';
import {createShotEffects} from '../public/shot-effects.js';
import {sampleViewRecoil} from '../public/weapon-feel.js';
import {GUNS} from '../public/arsenal.js';
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
test('presentation preferences preserve the old bob/raw defaults and handle storage failures',()=>{
 const s=createPresentationSettings({getItem(){throw Error('denied');},setItem(){throw Error('denied');}});assert.equal(s.values.bob,'current');assert.equal(s.values.rawMouse,false);s.set({landing:false,bob:'bad',bobStrength:3,dpi:-5});assert.equal(s.values.landing,false);assert.equal(s.values.bob,'current');assert.equal(s.values.bobStrength,1);assert.equal(s.values.dpi,0);s.reset();assert.deepEqual(s.values,PRESENTATION_DEFAULTS);assert.deepEqual(normalizePresentation(null),PRESENTATION_DEFAULTS);
});
test('ordinary jump/duck-jump landings never trigger feedback; hard landing is bounded and deduplicated',()=>{
 const f=createViewFeedback(),before={grounded:false},p={grounded:true,landedSpeed:268/40,recoilPitch:.12,ammo:30};for(const fall of [268,317,349]){p.landedSpeed=fall/40;assert.equal(f.observe(before,p,{seq:1,round:1,now:0}),false);}p.landedSpeed=500/40;const saved={...p};assert.equal(f.observe(before,p,{seq:2,round:1,now:0}),true);const peak=f.sample(25).roll;assert.ok(peak>0&&peak<=1.5*Math.PI/180);assert.deepEqual(p,saved);assert.equal(f.observe(before,p,{seq:2,round:1,now:100}),false);assert.equal(f.sample(221).roll,0);f.reset();assert.equal(f.sample(30).roll,0);
});
test('roll preserves the view ray even when landing during recoil, either hand, or scope',()=>{
 for(const yaw of [-2,0,1])for(const pitch of [-1.4,-.3,.4,1.4])for(const roll of [-.04,0,.04]){const a=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(pitch,yaw,0,'YXZ')),b=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(pitch,yaw,roll,'YXZ'));near(a.distanceTo(b),0);}
});
test('landing envelope is time-based and disabling removes residual feedback',()=>{
 const f=createViewFeedback();f.observe({grounded:false},{grounded:true,landedSpeed:600/40},{seq:1,round:1,now:0});const expected=f.sample(100).roll;for(const hz of [30,60,120,144]){for(let i=0;i<Math.floor(.1*hz);i++)f.sample(i/hz*1000);near(f.sample(100).roll,expected);}assert.equal(f.sample(110,false).roll,0);assert.equal(f.sample(120,true).roll,0);
});
test('reconciliation cannot replay the same landing pulse on a later prediction command',()=>{
 const f=createViewFeedback(),before={grounded:false},after={grounded:true,landedSpeed:500/40};assert.equal(f.observe(before,after,{seq:1,round:1,now:0}),true);const value=f.sample(80).roll;assert.equal(f.observe(before,after,{seq:2,round:1,now:80}),false);near(f.sample(80).roll,value);assert.equal(f.observe(before,after,{seq:3,round:1,now:500}),true);f.reset();assert.equal(f.observe(before,after,{seq:4,round:2,now:520}),true);
});
test('current viewmodel bob remains numerically exact; classic/off cannot change gameplay state',()=>{
 const p={vx:3,vz:4,yaw:.4,grounded:true,ammo:30},saved={...p},speed=5/6.25;for(const now of [0,16.7,500,1500]){const a=viewmodelMotion(p,now);near(a.y,Math.abs(Math.sin(now*.007))*speed*.006);near(a.side,Math.sin(now*.007)*speed*.006);assert.equal(a.cameraRoll,0);}assert.deepEqual(viewmodelMotion(p,100,{bob:'off'}),{y:0,side:0,roll:0,cameraRoll:0});assert.ok(Math.abs(viewmodelMotion(p,100,{bob:'classic'}).cameraRoll)<=Math.PI/180);assert.deepEqual(p,saved);
});
test('pointer input retries unsupported raw options but never changes relative counts or sensitivity',async()=>{
 const calls=[],p=createPointerInput({requestPointerLock(options){calls.push(options);if(options)return Promise.reject(Object.assign(Error('unsupported'),{name:'NotSupportedError'}));return Promise.resolve();}});assert.equal(await p.request(true),true);assert.equal(calls.length,2);assert.equal(p.diagnostics().mode,'adjusted-fallback');assert.equal(p.observe(40,-10),true);assert.equal(p.observe(Infinity,0),false);assert.equal(p.diagnostics().countsX,40);near(mouseCalibration(.001,800).countsPerTurn,Math.PI*2000);near(mouseCalibration(.001,800).cmPerTurn,Math.PI*2000/800*2.54);assert.equal(mouseCalibration(.001).cmPerTurn,null);
});
test('pointer request is single-flight and denied requests do not force a second capture',async()=>{
 let release,calls=0;const p=createPointerInput({requestPointerLock(){calls++;return new Promise(r=>release=r);}}),a=p.request(),b=p.request();assert.equal(a,b);assert.equal(calls,1);release();assert.equal(await a,true);
 const q=createPointerInput({requestPointerLock(){throw Object.assign(Error('denied'),{name:'NotAllowedError'});}});assert.equal(await q.request(true),false);assert.equal(q.diagnostics().failure,'NotAllowedError');
});
test('actor scheduling uses conservative bounds without touching authoritative positions',()=>{
 const c=new THREE.PerspectiveCamera(75,1.6,.06,450),s=createActorScheduler(THREE);c.position.set(0,1.3,0);s.begin(c);const front={x:0,y:0,z:-10},back={x:0,y:0,z:10},saved={...back};assert.equal(s.shouldPose(front),true);assert.equal(s.shouldPose(back),false);assert.equal(s.shouldPose({x:0,y:0,z:1}),true);assert.deepEqual(back,saved);assert.equal(s.diagnostics().deferred,1);
});
test('cosmetic shells are bounded, deduplicate pellets, settle once and clean up',()=>{
 const scene=new THREE.Scene();let contacts=0;const fx=createWeaponCosmetics(THREE,scene,{trace:(a,b)=>({fraction:.5,startSolid:false,normal:[0,1,0],end:{x:a.x,y:0,z:a.z}}),onContact:()=>contacts++});const event={id:'p',round:1,weapon:'ak47',shotOrdinal:1};const pose={weapon:'ak47',origin:new THREE.Vector3(0,1,0),muzzle:new THREE.Vector3(0,1,-.4),right:new THREE.Vector3(1,0,0),forward:new THREE.Vector3(0,0,-1),now:0};assert.equal(fx.enqueueLocal(event),true);assert.equal(fx.enqueueLocal({...event,shotId:'other-pellet'}),false);fx.flushLocal(pose);assert.equal(fx.info().shells,1);fx.update(.6,new THREE.Quaternion());fx.update(.7,new THREE.Quaternion());assert.equal(contacts,1);fx.update(2,new THREE.Quaternion());assert.equal(fx.info().shells,0);for(let n=0;n<200;n++)fx.enqueueLocal({...event,shotOrdinal:n+2});fx.flushLocal({...pose,now:3});assert.ok(fx.info().shells<=64);assert.ok(fx.info().dropped>0);fx.dispose();assert.equal(scene.children.length,0);
});
test('material recipes keep a fixed mesh/pool budget and never consume gameplay randomness',()=>{
 const scene=new THREE.Scene(),fx=createShotEffects(THREE,scene),random=Math.random;try{Math.random=()=>{throw Error('shared RNG');};for(const material of ['concrete','wood','metal','glass','dirt']){fx.clear();fx.add({shotId:material,impact:{position:{x:0,y:1,z:0},normal:{x:0,y:0,z:1},material}},0);const d=fx.info();assert.ok(d.debris+d.dust<=13);if(material==='metal')assert.equal(d.sparks,8);assert.equal(scene.children.length,6);fx.update(.9);} }finally{Math.random=random;fx.dispose();}
});
for(const weapon of Object.keys(GUNS))test(`${weapon}: displayed recoil analytically returns to zero with no soft tail or state writes`,()=>{
 const p={weapon,recoilPitch:.04,recoilYaw:.02,ammo:30},saved={...p};const a=sampleViewRecoil(p,0),b=sampleViewRecoil(p,1/60);assert.deepEqual(a,{recoilPitch:.04,recoilYaw:.02});assert.ok(Math.hypot(b.recoilPitch,b.recoilYaw)<Math.hypot(a.recoilPitch,a.recoilYaw));assert.deepEqual(p,saved);assert.deepEqual(sampleViewRecoil({weapon,recoilPitch:0,recoilYaw:0},1/60),{recoilPitch:0,recoilYaw:0});
});
