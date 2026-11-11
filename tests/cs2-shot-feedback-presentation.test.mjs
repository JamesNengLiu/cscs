import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fixtureWorld,testHitboxes} from './cs2-game-fixture.mjs';
import {createCS2Game} from '../cs2-game.mjs';
import {createWeaponRuntime} from '../public/cs2-weapon-runtime.js';
import {createCS2WeaponBehavior} from '../public/cs2-weapon-behavior.js';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {CS2_WEAPON_PROFILE} from '../public/cs2-weapon-profile.js';
import {createCS2RecoilTable} from '../public/cs2-recoil-reference.js';
import {createRecoilPresentationClock} from '../public/cs2-recoil-presentation.js';
import {INPUT_DT} from '../public/cs2-input-protocol.js';

// Rebind only the actual feedback module's browser-world imports to a real
// CPU fixture/runtime. No local capture, git revision, DOM or native map loads.
async function feedbackFor(runtime){
 const source=await readFile(new URL('../public/cs2-shot-feedback.js',import.meta.url),'utf8'),key=Symbol.for('cscs.feedback-presentation-fixture'),registry=globalThis[key]||(globalThis[key]=new Map()),id=randomUUID();
 const bindings={GUNS:CS2_WEAPON_PROFILE.guns,WEAPONS:CS2_WEAPON_PROFILE.weapons,...runtime};registry.set(id,bindings);
 const data=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64'),names=Object.keys(bindings),stub=data(`const bindings=globalThis[Symbol.for('cscs.feedback-presentation-fixture')].get(${JSON.stringify(id)});export const {${names.join(',')}}=bindings;`);
 assert.ok(source.includes("'./cs2-client-world.js'"));assert.ok(source.includes("'./cs2-input-protocol.js'"));
 const rebound=source.replaceAll("'./cs2-client-world.js'",JSON.stringify(stub)).replaceAll("'./cs2-input-protocol.js'",JSON.stringify(new URL('../public/cs2-input-protocol.js',import.meta.url).href));
 try{return(await import(data(rebound))).createShotFeedback;}finally{registry.delete(id);}
}
async function setup(){
 const world=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),runtime=createWeaponRuntime(world,{rules:world.movement.rules,guns:CS2_WEAPON_PROFILE.guns,weapons:CS2_WEAPON_PROFILE.weapons,behavior:createCS2WeaponBehavior(CS2_WEAPON_PROFILE)}),game=createCS2Game(world,{weaponProfile:CS2_WEAPON_PROFILE,hitboxes:testHitboxes,random:()=>.5,audioRandom:()=>.5}),player=game.add('t','fixture','T');
 game.begin();game.phase='live';game.time=10;game.endAt=game.buyEndAt=1000;player.money=16000;game.buy(player.id,'ak47');player.nextAttackAt=player.nextShotAt=0;player.yaw=player.pitch=0;
 const createFeedback=await feedbackFor(runtime),feedback=createFeedback(),snapshot=()=>game.snapshot(player.id).players.find(p=>p.id===player.id);
 return{world,runtime,game,player,feedback,snapshot};
}
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-12,`${label}: ${a} versus ${b}`);
const input=fire=>({f:0,s:0,yaw:0,pitch:0,fire,jump:false,crouch:false,walk:false,use:false});
const sample=(f,base,seq,fire,nowMs,stateTime=10)=>f.feedback.sample({player:base,pose:base,input:input(fire),seq,round:f.game.round,stateTime,time:stateTime,fixedStep:true,nowMs,allowed:true});
const recoil=p=>Object.fromEntries(['recoilPitch','recoilYaw','cs2RecoilPitchVelocity','cs2RecoilYawVelocity'].map(k=>[k,p[k]]));

test('real AK feedback markers preserve the native-table impulse at the same consume time, including a shot with residual velocity',async()=>{
 const f=await setup(),base=f.snapshot(),unchanged=structuredClone(base),expected=structuredClone(base),s=CS2_WEAPON_PROFILE.guns.ak47.source,table=createCS2RecoilTable({seed:s.m_nRecoilSeed,angle:s.m_flRecoilAngle[0],angleVariance:s.m_flRecoilAngleVariance[0],magnitude:s.m_flRecoilMagnitude[0],magnitudeVariance:s.m_flRecoilMagnitudeVariance[0],automatic:true});
 f.feedback.observe(base,{round:f.game.round,stateTime:10,nowMs:0});let shots=0,secondHadResidual=false;
 for(let seq=1;seq<=12&&shots<2;seq++){
  const at=10+seq*INPUT_DT;expected.input=input(true);f.runtime.updateWeapon(expected,INPUT_DT,at);const before={...expected},profile=f.runtime.consumeGunShot(expected,at,false,()=>.5),fresh=sample(f,base,seq,true,seq*INPUT_DT*1000);expected.fireHeld=true;
  assert.equal(Boolean(fresh),Boolean(profile),'fresh feedback must correspond to an actual successful runtime consume');
  if(!fresh)continue;const marker=f.feedback.recoilPresentation(),impulse=table[shots].impulse;
  assert.equal(marker.token,fresh.token);assert.equal(marker.seq,seq);assert.equal(marker.ordinal,shots+1);assert.equal(marker.impulse.at,at);near(marker.impulse.deltaPitch,0,'velocity impulse does not add a second pitch angle');near(marker.impulse.deltaYaw,0,'velocity impulse does not add a second yaw angle');near(marker.impulse.deltaPitchVelocity,-impulse[0]*Math.PI/180,'native pitch velocity impulse');near(marker.impulse.deltaYawVelocity,impulse[1]*Math.PI/180,'native yaw velocity impulse');
  if(shots===1)secondHadResidual=Math.hypot(before.cs2RecoilPitchVelocity,before.cs2RecoilYawVelocity)>.01;
  assert.equal(f.feedback.view().ammo,base.ammo-shots-1);for(const k of Object.keys(recoil(expected)))near(f.feedback.view()[k],expected[k],'weapon replay '+k);shots++;
 }
 assert.equal(shots,2);assert.equal(secondHadResidual,true,'second marker must be measured after decay at its own consume time');assert.deepEqual(base,unchanged,'metadata observation must not modify the authority snapshot');
});

test('recoil metadata getters are detached from both weapon state and later replay updates',async()=>{
 const f=await setup(),base=f.snapshot();f.feedback.observe(base,{round:f.game.round,stateTime:10,nowMs:0});assert.ok(sample(f,base,1,true,20));const saved=f.feedback.recoilPresentation(),expected=structuredClone(saved),viewBefore=structuredClone(f.feedback.view()),mutable=f.feedback.recoilPresentation();
 mutable.token='caller-mutation';mutable.impulse.deltaPitchVelocity=999;mutable.impulse.at=-100;
 assert.deepEqual(f.feedback.recoilPresentation(),expected);assert.deepEqual(f.feedback.view(),viewBefore,'getter copy cannot alter ammo, weapon clocks or recoil');
 assert.equal(f.feedback.observe(base,{round:f.game.round,stateTime:10+INPUT_DT,nowMs:30}),null,'rebuilding an already played prediction is not a new presentation');
 assert.deepEqual(saved,expected,'previously returned marker cannot be rewritten by a later consume replay');assert.ok(f.feedback.recoilPresentation().impulse.at>saved.impulse.at,'control must actually exercise a new replay timestamp');assert.equal(f.feedback.recoilPresentation().token,saved.token);assert.equal(f.feedback.view().ammo,base.ammo-1);
});

test('played ordinals produce one presenter note across rebuild, ACK and duplicate authoritative events',async()=>{
 const f=await setup(),base=f.snapshot(),clock=createRecoilPresentationClock({sampleRecoil:f.runtime.sampleViewRecoil});let notes=0;const route=fresh=>{if(!fresh)return;notes++;assert.equal(clock.noteShot(f.feedback.recoilPresentation()),true);};
 f.feedback.observe(base,{round:f.game.round,stateTime:10,nowMs:0});route(sample(f,base,1,true,20));clock.sample(f.feedback.view(),{round:f.game.round,nowMs:20,authority:base});const token=f.feedback.recoilPresentation().token;
 route(f.feedback.observe(base,{round:f.game.round,stateTime:10+INPUT_DT,nowMs:25}));f.game.inputBatch(f.player.id,[{seq:1,round:f.game.round,input:input(true)}]);f.game.step();const event=f.game.events.find(e=>e.type==='shot'&&e.id===f.player.id);assert.ok(event);assert.equal(f.player.ammo,29);
 const acknowledged=f.snapshot();route(f.feedback.observe(acknowledged,{round:f.game.round,stateTime:f.game.time,nowMs:30}));assert.equal(f.feedback.confirm(event,31),false,'predicted muzzle/audio must not replay');assert.equal(f.feedback.confirm({...event},32),false,'same authority shot cannot replay a second event segment');route(f.feedback.observe(acknowledged,{round:f.game.round,stateTime:f.game.time,nowMs:33}));route(sample(f,acknowledged,2,false,40,f.game.time));
 assert.equal(notes,1);assert.equal(clock.diagnostics().presentedShots,1);assert.equal(f.feedback.recoilPresentation().token,token);assert.equal(f.feedback.diagnostics().predicted,1);assert.equal(f.feedback.diagnostics().suppressed,1);assert.equal(f.feedback.view().ammo,29);
});

test('an authority-only shot exposes no invented impulse and legitimately reanchors a corrected presenter',async()=>{
 const f=await setup();assert.equal(f.game.shoot(f.player),true);const initial=f.snapshot();f.feedback.observe(initial,{round:f.game.round,stateTime:f.game.time,nowMs:0});const at=time=>{const p=structuredClone(initial);f.runtime.updateWeapon(p,Math.max(0,time-f.game.time),time);return p;},clock=createRecoilPresentationClock({sampleRecoil:f.runtime.sampleViewRecoil});
 clock.sample(at(10.05),{round:f.game.round,nowMs:1000});clock.sample(at(10.05+2*INPUT_DT),{round:f.game.round,nowMs:1000+INPUT_DT*1000});assert.equal(clock.diagnostics().mode,'wall-clock');
 f.game.time=10.05+4*INPUT_DT;assert.equal(f.game.shoot(f.player),true);const authority=f.snapshot(),fresh=f.feedback.observe(authority,{round:f.game.round,stateTime:f.game.time,nowMs:40});assert.ok(fresh);assert.equal(f.feedback.recoilPresentation().token,fresh.token);assert.equal(f.feedback.recoilPresentation().impulse,null,'unknown pre-shot state must not be guessed from the authority angle');clock.noteShot(f.feedback.recoilPresentation());
 const source=f.feedback.view(),expected=f.runtime.sampleViewRecoil(source,0),out=clock.sample(source,{round:f.game.round,nowMs:1000+2*INPUT_DT*1000,authority});assert.deepEqual(recoil(out),recoil(expected));assert.equal(clock.diagnostics().mode,'source');assert.equal(clock.diagnostics().reason,'untracked-shot');assert.equal(clock.diagnostics().unknown,1);assert.equal(f.player.ammo,28);
});
