import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {CS2_WEAPON_PROFILE,CS2_WEAPON_PROFILE_V1} from '../public/cs2-weapon-profile.js';
import {createCS2WeaponBehavior} from '../public/cs2-weapon-behavior.js';
import {createWeaponRuntime} from '../public/cs2-weapon-runtime.js';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {createCS2Game} from '../cs2-game.mjs';
import {applyScopeAwareAction} from '../cs2-scope-actions.mjs';
import {GameConnection} from '../public/cs2-game-connection.js';
import {createAwpView,SCOPE_VIEW_PROTOCOL} from '../public/cs2-awp-view.js';
import {createWeaponSwitchView,WEAPON_SWITCH_VIEW_PROTOCOL} from '../public/cs2-weapon-switch-view.js';
import {INPUT_DT} from '../public/cs2-input-protocol.js';
import {fixtureWorld,testHitboxes,box} from './cs2-game-fixture.mjs';

// Before-source oracle provenance is recorded beside the goldens. The digest
// covers every tick's copied state, every consumed shot, fractional view sample
// and RNG count. It was generated from the independent pre-v2 behavior/runtime,
// not by calling the current implementation twice. No local asset is required.
const V1_ORACLE_GOLDENS=Object.freeze({
  "glock18": "5f80368c07981e06b71b5743f199d51b8ff6d861eb36ab79ac949bdd7fa4e2a9",
  "usp": "a624051c37d4355ab5dc4cccb7b18e44775004a2617a790b925b3e5a1aa9f458",
  "p228": "771055d55352291ea2d06394f9d79fc2fcac4311fe9180b985269cb6100b5363",
  "deagle": "0bc9337dee213d6bc7e44fa3a4ee1cb992affa8244679d1aea55591d250f9645",
  "elite": "98fd871d50f9767c2d05c01568ccfa9224c185ae1e6f91665da90bd0757d1fcb",
  "fiveseven": "c99c849eddc6793d6c119f13db4ab850d5d65e0f29ea457c87ceea8e0f4a322f",
  "m3": "3d0bcea02760d71e00ef54e8354b881e4d9afb78341360662063ed181f24b974",
  "xm1014": "3970624a7f8c2bd971a169e72f541e5e38c925d4655eb83686ed60ce46229260",
  "mac10": "babcf4137372a480c957df118cc0d1d032001a72ac08b23cef42e85b613bb9c0",
  "tmp": "b79edd331a33bc0b7b61401d60c49e2b13362fd9b7864e425d92950691b4c1a9",
  "mp5navy": "f5757aabb9a341de570165bd13691bd9510f43a4716b9906926a641a5ea0ecfc",
  "ump45": "2b2e88ef4f820ee6f3afd9578a11019ecdcae69947cc553bca42e33a7772fee1",
  "p90": "9538ab83a306b5eec75160e1055600082ac4a08e12d79c201433f34663a7a452",
  "galil": "b0488cdb58a5d7518edca6223ec9fae097e9442852b29d80bbc5ca8e9ab08e69",
  "famas": "523111cffcb3b8fb99c8518d06fe23f86b5b924332d7b00b2b42062c59abc3be",
  "ak47": "aa182f25e966fd1cb823ca0b9ceac8bc289fae46786743472bf2c00dbd87e9a4",
  "m4a1": "46e228467087ef878eb0c17b75944e8c2449eaa1cdbe49fd0fb37322171e9175",
  "aug": "29289ca8abe8ee45614c9496893952ed37e84e1b6261363534793bf089b65c20",
  "sg552": "ed7810cd83d2e73b0a09d8ec34d5c3fc5d03e15ff5f9ec2558d793232434861e",
  "scout": "d0f5673b4d4f7f8ecfd6493b16092000f120af4fe7a692d3b75a24750761eada",
  "awp": "27d17e81647295172ffca0b9f6104c03cd6e115aea92127cc5ebe055eb154151",
  "g3sg1": "cd7fbca02dfcb964962d0b7477927e1d68b8cb915e5b7d31d89a4a3d8dcdf4ed",
  "sg550": "9d5bc1f2919310d78f9fb50ecf0b2b9fb2469b9cbc96b2d8178eb70ffce305ab",
  "m249": "5869c93e5ba20175dc2d87a7464f224a206d029b36f05bbc5ae3b496e4c97b84"
});
const V1_ORACLE_SOURCE=Object.freeze({"behavior":"0ed743c004a30198505c96f5b5ef31b6a5f487f357b8bd142d341dd7435bc4ac","runtime":"a23eaee3b0bf0a2878e3c1d78a1d320c767e023f9d095114a14082afce63fffc"});

// BEGIN ORACLE DRIVER (shared only by the offline golden generator)
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
function driveV1(runtime,profile,id){
  const gun=profile.guns[id],p={id:'oracle',weapon:id,alive:true,x:0,y:0,z:0,yaw:.3,pitch:.1,vx:0,vy:0,vz:0,grounded:true,crouch:false,zoom:gun.zoom?.[0]??90,silenced:!!gun.defaultSilenced,burstMode:['famas','glock18'].includes(id),ammo:gun.clip,reserve:gun.reserve,input:{fire:false},recoilSeed:0x13579bdf,shotsFired:0,lastShot:-100,nextAttackAt:0,nextShotAt:0,fireHeld:false};
  runtime.resetWeapon(p);let seed=0x2468ace0,rngCalls=0;const random=()=>{rngCalls++;seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},rows=[];
  for(let tick=1;tick<=750;tick++){
    const now=10+tick/60,hold=tick<=90||tick>=151&&tick<=330||tick>=391,fire=hold&&(gun.automatic||p.burstMode||tick%12===1);
    p.grounded=tick%180<120;p.y=p.grounded?0:1;p.crouch=tick%120>=80;p.vx=tick%240>=30&&tick%240<90?4:0;p.vy=p.grounded?0:tick%180<150?2:-2;p.vz=tick%240>=150&&tick%240<210?-3:0;p.input={fire};
    runtime.updateWeapon(p,1/60,now);if(p.resumeZoomAt&&now>=p.resumeZoomAt){p.zoom=p.resumeZoom||90;p.resumeZoomAt=0;}runtime.updateReload(p,now);const shots=[];
    if(p.burstRemaining>0&&now+1e-8>=p.nextBurstAt){const shot=runtime.consumeGunShot(p,now,true,random);if(shot){p.burstRemaining--;shots.push(shot);}else p.burstRemaining=0;p.nextBurstAt=now+runtime.shotFollowupInterval(p);}
    if(fire&&(gun.automatic||p.burstMode||!p.fireHeld)){const shot=runtime.consumeGunShot(p,now,false,random);if(shot)shots.push(shot);}p.fireHeld=fire;
    rows.push({tick,state:structuredClone(p),shots,sample:runtime.sampleViewRecoil(p,1/120),rngCalls});
  }
  return canonical({rows,rngCalls,seed});
}
// END ORACLE DRIVER

const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-10,`${label}: ${a} != ${b}`);
const world=()=>fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE});
function runtime(profile,w=world()){return createWeaponRuntime(w,{rules:w.movement.rules,guns:profile.guns,weapons:profile.weapons,behavior:createCS2WeaponBehavior(profile)});}
for(const id of Object.keys(CS2_WEAPON_PROFILE_V1.guns))test(`v1 ${id}: 750-tick hold/release/stance trace exactly matches the independent before oracle`,()=>{
  assert.match(V1_ORACLE_SOURCE.behavior,/^[a-f0-9]{64}$/);assert.match(V1_ORACLE_SOURCE.runtime,/^[a-f0-9]{64}$/);
  const r=createWeaponRuntime({isGrounded:p=>p.grounded===true},{rules:CS2_MOVEMENT_PROFILE.rules,guns:CS2_WEAPON_PROFILE_V1.guns,weapons:CS2_WEAPON_PROFILE_V1.weapons,behavior:createCS2WeaponBehavior(CS2_WEAPON_PROFILE_V1)});
  const actual=createHash('sha256').update(JSON.stringify(driveV1(r,CS2_WEAPON_PROFILE_V1,id))).digest('hex');assert.equal(actual,V1_ORACLE_GOLDENS[id]);
});

// Redirect only world imports, preserving the real CS2 feedback source and
// real input protocol. This avoids a DOM/native-map or legacy-BSP dependency.
async function feedbackFor(profile,r){
  const source=await readFile(new URL('../public/cs2-shot-feedback.js',import.meta.url),'utf8'),registryKey=Symbol.for('cscs.feedback-preservation-fixture'),registry=globalThis[registryKey]||(globalThis[registryKey]=new Map()),id=randomUUID(),bindings={GUNS:profile.guns,WEAPONS:profile.weapons,WEAPON_PROFILE:profile,WEAPON_PROFILE_ID:profile.id,...r};registry.set(id,bindings);
  const data=body=>'data:text/javascript;base64,'+Buffer.from(body).toString('base64'),names=Object.keys(bindings);assert.ok(names.every(name=>/^[A-Za-z_$][\w$]*$/.test(name)));
  const stub=data(`const r=globalThis[Symbol.for('cscs.feedback-preservation-fixture')].get(${JSON.stringify(id)});export const {${names.join(',')}}=r;`);
  assert.ok(source.includes("'./cs2-client-world.js'"));assert.ok(source.includes("'./cs2-input-protocol.js'"));const rewritten=source.replaceAll("'./cs2-client-world.js'",JSON.stringify(stub)).replaceAll("'./cs2-input-protocol.js'",JSON.stringify(new URL('../public/cs2-input-protocol.js',import.meta.url).href));
  try{return(await import(data(rewritten))).createShotFeedback;}finally{registry.delete(id);}
}
const RECOIL=['recoilPitch','recoilYaw','cs2RecoilPitchVelocity','cs2RecoilYawVelocity','cs2PunchVersion'];
function gunFixture(profile=CS2_WEAPON_PROFILE,id='awp'){
  const w=world(),team=profile.guns[id].teams.includes('T')?'T':'CT',g=createCS2Game(w,{weaponProfile:profile,hitboxes:testHitboxes,random:()=>.5}),p=g.add('t','Main',team),q=g.add('ct','Target',team==='T'?'CT':'T');g.begin();g.phase='live';g.time=10;g.endAt=1000;g.buyEndAt=1000;q.hp=10000;p.money=16000;g.buy(p.id,id);g.equip(p.id,'knife');g.equip(p.id,id);p.nextAttackAt=0;p.nextShotAt=0;p.yaw=0;p.pitch=0;p.zoom=id==='awp'?40:90;return{w,g,p,q};
}
function command(f,seq,patch={}){return{seq,round:f.g.round,input:{f:0,s:0,yaw:0,pitch:0,fire:false,jump:false,crouch:false,walk:false,use:false,...patch}};}
function receiver(onmessage){return Object.assign(Object.create(GameConnection.prototype),{closed:false,readyState:1,deferStates:true,lastStateSeq:0,pendingState:null,pendingTimeline:[],counters:{staleStates:0,coalescedStates:0,droppedTimelineStates:0},onmessage:event=>onmessage(JSON.parse(event.data))});}

for(const [weapon,ackTicks]of [['ak47',3],['m4a1',12],['awp',12]])test(`v2 ${weapon}: full clip, delayed ACKs and auto reload preserve real feedback identity/state`,async()=>{
  const f=gunFixture(CS2_WEAPON_PROFILE,weapon);
  const r=runtime(CS2_WEAPON_PROFILE,f.w),createShotFeedback=await feedbackFor(CS2_WEAPON_PROFILE,r),feedback=createShotFeedback(),clip=CS2_WEAPON_PROFILE.guns[weapon].clip,tokens=new Set(),authorityShots=new Set();let base=f.g.snapshot(f.p.id).players.find(p=>p.id===f.p.id),stateTime=f.g.time,sawEmpty=false,sawReload=false,complete=false;
  feedback.observe(base,{round:f.g.round,stateTime,nowMs:0});
  for(let seq=1;seq<=900;seq++){
    const fire=!sawEmpty&&(weapon!=='awp'||seq%100===1),input={f:0,s:0,yaw:0,pitch:0,fire,jump:false,crouch:false,walk:false,use:false},nowMs=seq*1000*INPUT_DT,predicted=feedback.sample({player:base,pose:base,input,seq,round:f.g.round,stateTime,time:stateTime,fixedStep:true,nowMs,allowed:true});
    if(predicted){assert.equal(predicted.hit,undefined);assert.equal(predicted.impact,undefined);assert.equal(tokens.has(predicted.token),false);tokens.add(predicted.token);}
    f.g.inputBatch(f.p.id,[{seq,round:f.g.round,input}]);f.g.step();const view=feedback.view();assert.equal(view.ammo,f.p.ammo,weapon+' ammo at '+seq);assert.equal(view.shotsFired,f.p.shotsFired);
    for(const key of RECOIL){if(key==='cs2PunchVersion')assert.equal(view[key],f.p[key]);else near(view[key]||0,f.p[key]||0,weapon+' '+key+' at '+seq);}
    if(seq===1)assert.equal(f.p.cs2PunchVersion,2,'A v2 target gun must enter the new punch state, not the temporary v1 wrapper');
    for(const event of f.g.events.filter(event=>event.type==='shot'&&event.id===f.p.id)){authorityShots.add(event.shotId);assert.equal(feedback.confirm(event,nowMs+1),false,'Already predicted feedback must not replay on event delivery');assert.equal(feedback.confirm(event,nowMs+2),false);}
    f.g.events.length=0;if(f.p.ammo===0)sawEmpty=true;if(f.p.reloadAt)sawReload=true;
    if(seq%ackTicks===0||sawEmpty&&!sawReload){const state=f.g.snapshot(f.p.id);base=state.players.find(p=>p.id===f.p.id);stateTime=state.time;assert.equal(feedback.observe(base,{round:f.g.round,stateTime,nowMs:nowMs+3}),null,'ACK may not replay a known shot');}
    if(sawReload&&!f.p.reloadAt&&f.p.ammo===clip){complete=true;break;}
  }
  assert.ok(sawEmpty&&sawReload&&complete,'The real authority must empty and auto-reload the clip');assert.equal(authorityShots.size,clip);assert.equal(tokens.size,clip);const state=f.g.snapshot(f.p.id);feedback.observe(state.players.find(p=>p.id===f.p.id),{round:f.g.round,stateTime:state.time,nowMs:20000});assert.equal(feedback.view().ammo,clip);
});

for(const separateDelivery of [false,true])test(`v2 AWP shot then same-tick Q/Q retains cartridge, damage and global punch (${separateDelivery?'critical delayed behind action':'input before action'})`,()=>{
  const ordinary=gunFixture(),quick=gunFixture(),acks=[];
  ordinary.g.inputBatch(ordinary.p.id,[command(ordinary,1,{fire:true,f:1})]);ordinary.g.step();
  const fire=command(quick,1,{fire:true,f:1});if(!separateDelivery)quick.g.inputBatch(quick.p.id,[fire]);
  for(let seq=1;seq<=2;seq++)applyScopeAwareAction(quick.g,quick.p.id,{type:'equip',weapon:'last',round:quick.g.round,switchSeq:seq,scopeSeq:seq,afterInputSeq:1,commands:[]},{onAck:ack=>acks.push(ack)});
  if(separateDelivery)quick.g.inputBatch(quick.p.id,[fire]);quick.g.step();
  const shots=f=>f.g.events.filter(event=>event.type==='shot'&&event.id===f.p.id);
  assert.equal(shots(quick).length,shots(ordinary).length);assert.equal(new Set(shots(quick).map(event=>event.shotId)).size,1);assert.equal(quick.p.ammo,4);assert.equal(quick.p.inventory.awp.ammo,4);assert.equal(quick.p.weapon,'awp');assert.equal(quick.p.zoom,90);assert.equal(quick.p.resumeZoomAt,0);assert.equal(quick.q.hp,ordinary.q.hp);assert.equal(acks.length,2);
  for(const key of RECOIL)assert.equal(quick.p[key],ordinary.p[key],key+' must not rewind across a same-tick knife return');assert.equal(quick.p.cs2PunchVersion,2);for(const key of RECOIL.slice(0,4))assert.ok(Number.isFinite(quick.p[key]),key);
  assert.equal(quick.g.inputBatch(quick.p.id,[fire,fire]),0);quick.g.step();assert.equal(quick.p.ammo,4);assert.equal(new Set(shots(quick).map(event=>event.shotId)).size,1);
});

test('real reliable control queue preserves fire/Q/Q; reversed/duplicate ACKs and stale snapshots cannot rewind the client selection',async()=>{
  const f=gunFixture(),initial=structuredClone(f.p),switchView=createWeaponSwitchView({now:()=>1}),scope=createAwpView({guns:CS2_WEAPON_PROFILE.guns});switchView.observe(initial,{round:f.g.round,time:f.g.time,protocol:WEAPON_SWITCH_VIEW_PROTOCOL,phase:'live'});scope.observe(initial,{round:f.g.round,stateTime:f.g.time,protocol:SCOPE_VIEW_PROTOCOL,nowMs:0});
  const actions=[];for(let n=0;n<2;n++){let action=switchView.intent({type:'equip',weapon:'last'},initial,{round:f.g.round,phase:'live',bomb:f.g.bomb});action=scope.intent(action,initial,{round:f.g.round,stateTime:f.g.time,phase:'live',canSwitch:true,nowMs:1});action={...action,afterInputSeq:1,commands:[]};switchView.sent(action);actions.push(action);}
  const writes=[];let releaseFirst;const firstBlocked=new Promise(resolve=>{releaseFirst=resolve;}),wire=Object.assign(Object.create(GameConnection.prototype),{readyState:1,closed:false,transport:'webtransport',actionSequence:0,controlQueue:Promise.resolve(),bufferedAmount:0,control:{write:async bytes=>{const message=JSON.parse(new TextDecoder().decode(bytes));writes.push(message);if(writes.length===1)await firstBlocked;}}});
  wire.send({type:'inputCritical',round:f.g.round,commands:[command(f,1,{fire:true,f:1})]});for(const action of actions)wire.send(action);await Promise.resolve();assert.equal(writes.length,1,'Later reliable actions may not overtake the blocked critical write');releaseFirst();await wire.controlQueue;assert.deepEqual(writes.map(message=>message.type),['inputCritical','equip','equip']);assert.deepEqual(writes.map(message=>message.actionSeq),[1,2,3]);
  const acks=[];for(const message of writes)if(message.type==='inputCritical')f.g.inputBatch(f.p.id,message.commands);else applyScopeAwareAction(f.g,f.p.id,message,{onAck:ack=>acks.push(ack)});f.g.step();assert.equal(f.p.ammo,4);assert.equal(f.p.weapon,'awp');
  const delivered=[],c=receiver(message=>{delivered.push(message);if(message.type==='scopeAck'){switchView.confirm(message);scope.confirm(message);}if(message.type==='state'){const p=message.players.find(p=>p.id===f.p.id);switchView.observe(p,{round:message.round,time:message.time,protocol:WEAPON_SWITCH_VIEW_PROTOCOL,phase:'live'});scope.observe(p,{round:message.round,stateTime:message.time,protocol:SCOPE_VIEW_PROTOCOL,nowMs:20});}});
  c.deliver(acks[1]);c.deliver(acks[0]);c.deliver(acks[1]);const state=f.g.snapshot(f.p.id);c.deliver({...state,net:{seq:20}});c.deliver({...state,time:state.time-1,players:[{...initial}],net:{seq:19}});c.deliver({...state,net:{seq:20}});c.flushState();assert.equal(c.counters.staleStates,2);assert.equal(switchView.view(f.p,{bomb:f.g.bomb}).weapon,'awp');assert.equal(scope.zoom(f.p,{stateTime:20,nowMs:30}),90);assert.equal(switchView.diagnostics().confirmedSeq,2);assert.equal(scope.diagnostics().confirmedSeq,2);assert.equal(delivered.filter(message=>message.type==='state').length,1);
});

for(const item of ['ak47','awp','knife'])test(`real CS2 feedback copies complete scalar punch state without mutating authority (${item})`,async()=>{
  const w=world(),r=runtime(CS2_WEAPON_PROFILE,w),createShotFeedback=await feedbackFor(CS2_WEAPON_PROFILE,r),f=createShotFeedback(),player={id:'p',alive:true,weapon:item,x:0,y:.0005,z:4,yaw:0,pitch:0,vx:0,vy:0,vz:0,grounded:true,crouch:false,ammo:30,reserve:90,shotsFired:1,ackInputSeq:0,zoom:90,lastShot:10,nextShotAt:11,inventory:{ak47:{ammo:30}},input:{fire:false}};
  r.resetWeapon(player);Object.assign(player,{recoilPitch:.04,recoilYaw:-.01,cs2RecoilPitchVelocity:.2,cs2RecoilYawVelocity:-.1,cs2PunchVersion:2});const before=structuredClone(player),expected=structuredClone(player),input={f:0,s:0,yaw:0,pitch:0,fire:false,jump:false,crouch:false,walk:false,use:false};expected.input=input;r.updateWeapon(expected,INPUT_DT,10+INPUT_DT);f.observe(player,{round:1,stateTime:10,nowMs:0});f.sample({player,pose:player,input,seq:1,round:1,stateTime:10,time:10,fixedStep:true,nowMs:20,allowed:true});
  for(const key of RECOIL)assert.equal(f.view()[key],expected[key],item+' '+key+' must use the same copied recoil clock');assert.deepEqual(player,before,'Feedback must not mutate the own snapshot or nested inventory');
});

for(const weapon of ['ak47','m4a1','awp'])test(`${weapon}: v2 and preserved v1 commands have identical movement/jump/crouch/landing trajectory`,()=>{
  const fixtures=[CS2_WEAPON_PROFILE_V1,CS2_WEAPON_PROFILE].map(profile=>{const w=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE,walls:[box('step',[-2,0,-1],[2,.25,1],['player'])]}),g=createCS2Game(w,{weaponProfile:profile,hitboxes:testHitboxes,random:()=>.5}),p=g.add('t','T','T');g.begin();g.phase='live';g.endAt=1000;p.money=16000;if(weapon==='m4a1'){p.team='CT';g.spawn(p);}g.buy(p.id,weapon);g.equip(p.id,weapon);p.nextAttackAt=0;p.yaw=0;p.pitch=0;return{g,p};});
  const physical=['x','y','z','vx','vy','vz','grounded','groundPlayer','crouch','duckAmount','ducking','duckElapsed','jumpHeld','jumpFatigue','velocityModifier'];
  for(let seq=1;seq<=360;seq++){const input={f:seq<100?1:seq<180?0:-1,s:seq>=180&&seq<260?.6:0,yaw:seq<220?0:.5,pitch:0,fire:seq<80,jump:seq===35||seq===245,crouch:seq>=120&&seq<160,walk:seq>=280,use:false};for(const f of fixtures){f.g.inputBatch(f.p.id,[{seq,round:f.g.round,input}]);f.g.step();}for(const key of physical)assert.equal(fixtures[0].p[key],fixtures[1].p[key],weapon+' tick '+seq+' '+key);}
});
