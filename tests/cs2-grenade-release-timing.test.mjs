import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {grenadeEventTime} from '../public/cs2-grenade-controls.js';
import {GRENADE_PROTOCOL,GRENADE_KINDS,normalizeGrenadeIntent,createGrenadePrediction} from '../public/cs2-grenade-intent.js';
import {CS2_GRENADE_PROFILE,CS2_GRENADE_PROFILE_V2} from '../public/cs2-grenade-profile.js';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {buildCS2GrenadeLaunch,captureGrenadePose,recordGrenadeJump,finalizeGrenadeJumpPunch,selectGrenadeJumpPose,applyGrenadeReleaseView} from '../cs2-grenade-launch.mjs';
import {fixtureWorld,fixtureGame,box,ticks} from './cs2-game-fixture.mjs';
import {createGrenadeRuntime,GRENADE_LIMITS} from '../cs2-grenades.mjs';
import {applyScopeAwareAction} from '../cs2-scope-actions.mjs';
function predicted(){
 let time=100;const sent=[],prediction=createGrenadePrediction({now:()=>time,send:message=>sent.push(message)}),p={alive:true,weapon:'hegrenade',grenades:{hegrenade:1},grenadeProtocol:GRENADE_PROTOCOL,nextAttackAt:5},context={round:1,stateTime:5,phase:'live',yaw:0,pitch:0};prediction.observe(p,context);return{prediction,p,context,sent,time:value=>{time=value;}};
}
test('DOM edge timestamps use the monotonic document origin and reject foreign/future clocks',()=>{
 assert.equal(grenadeEventTime(99500,100),99.5);assert.equal(grenadeEventTime(100000.5,100),100);
 for(const stamp of [0,-1,NaN,Infinity,null,'99500',Date.now(),100002])assert.equal(grenadeEventTime(stamp,100),100);
 assert.equal(grenadeEventTime(1000,4000),4000);assert.equal(grenadeEventTime(99900,NaN),0);
});
for(const remaining of [1,2])test(`long-frame queued dual release preserves physical spacing with mask ${remaining} last`,()=>{
 const f=predicted();f.prediction.buttons(f.p,3,{...f.context,eventTimeStamp:100000});f.time(102);
 f.prediction.buttons(f.p,remaining,{...f.context,eventTimeStamp:100600});f.prediction.buttons(f.p,0,{...f.context,eventTimeStamp:100650});
 assert.ok(Math.abs(f.sent[1].elapsed-.6)<1e-10);assert.ok(Math.abs(f.sent[2].elapsed-.65)<1e-10);assert.equal(f.prediction.view(f.p).grenadeStrength,.5);
 assert.equal(f.prediction.view(f.p).grenadeThrownAt,102,'physical edge stamps must not backdate an animation or actual throw clock');
});
for(const [remaining,strength]of [[1,1],[2,0]])test(`long-frame deliberate single-button interval still changes to ${strength}`,()=>{
 const f=predicted();f.prediction.buttons(f.p,3,{...f.context,eventTimeStamp:100000});f.time(102);f.prediction.buttons(f.p,remaining,{...f.context,eventTimeStamp:100600});f.prediction.buttons(f.p,0,{...f.context,eventTimeStamp:100850});assert.equal(f.prediction.view(f.p).grenadeStrength,strength);
});
test('old DOM press does not skip pin preparation and out-of-order stamps do not rewind strength time',()=>{
 const f=predicted();f.prediction.buttons(f.p,3,{...f.context,eventTimeStamp:99500});assert.equal(f.prediction.view(f.p).grenadeStartedAt,100);f.prediction.buttons(f.p,2,{...f.context,eventTimeStamp:99600});f.prediction.buttons(f.p,0,{...f.context,eventTimeStamp:99550});
 assert.equal(f.prediction.view(f.p).grenadeThrownAt,100.5);assert.equal(f.prediction.view(f.p).grenadePhase,'pin');assert.ok(f.sent[2].elapsed>=f.sent[1].elapsed);
});
test('production grenade mouse handlers pass DOM timestamps without changing the primary fire state',async()=>{
 const source=await readFile(new URL('../public/cs2-client.js',import.meta.url),'utf8'),f=predicted(),handlers={},context={GRENADE_KINDS,grenadePrediction:f.prediction,grenadeButtons:0,mouseFire:false,locked:true,shop:{isOpen:false},$:()=>({hidden:true}),player:()=>f.p,lastRound:1,serverTime:()=>5,state:{phase:'live'},yaw:0,pitch:0,sceneDirty:false,queueInputEdge:()=>{},send:()=>{},document:{addEventListener:(name,fn)=>handlers[name]=fn}};
 vm.runInNewContext(source.slice(source.indexOf('function grenadeInputContext()'),source.indexOf("document.addEventListener('contextmenu'")),context);
 handlers.mousedown({button:0,timeStamp:100000,preventDefault(){}});handlers.mousedown({button:2,timeStamp:100000,preventDefault(){}});f.time(102);handlers.mouseup({button:0,timeStamp:100600});handlers.mouseup({button:2,timeStamp:100850});
 assert.equal(f.prediction.view(f.p).grenadeStrength,0);assert.equal(context.mouseFire,false);assert.equal(context.grenadeButtons,0);assert.ok(Math.abs(f.sent.at(-1).elapsed-.85)<1e-10);
});
test('release view watermark is optional, bounded and only valid on the reliable release',()=>{
 const base={round:1,seq:2,actionId:1,kind:'release',buttons:0,weapon:'hegrenade',yaw:1,pitch:.2};
 for(const afterInputSeq of [0,10,2147483647])assert.equal(normalizeGrenadeIntent({...base,afterInputSeq},1).afterInputSeq,afterInputSeq);
 for(const afterInputSeq of [-1,.5,NaN,Infinity,2147483648,null,'3'])assert.equal(normalizeGrenadeIntent({...base,afterInputSeq},1),null);
 assert.equal(Object.hasOwn(normalizeGrenadeIntent({...base,seq:1,kind:'press',buttons:1,afterInputSeq:999},1),'afterInputSeq'),false);
 const f=predicted();f.prediction.buttons(f.p,1,f.context);f.time(101);f.prediction.buttons(f.p,0,{...f.context,afterInputSeq:10});assert.equal(f.sent.at(-1).afterInputSeq,10);
});
test('release view fills only its valid history interval without mutating the owner',()=>{
 const owner={x:1,y:2,z:3,yaw:0,pitch:0,recoilPitch:.1},copy=structuredClone(owner),intent={releaseAt:10,releaseView:{yaw:1,pitch:.2,afterInputSeq:10}};
 const sampled=applyGrenadeReleaseView(owner,intent,10,10.1);assert.equal(sampled.yaw,1);assert.equal(sampled.pitch,.2);assert.equal(sampled.recoilPitch,.1);assert.deepEqual(owner,copy);
 assert.equal(applyGrenadeReleaseView(owner,intent,11,10.1),owner);assert.equal(applyGrenadeReleaseView(owner,intent,5,9.9),owner);assert.equal(applyGrenadeReleaseView(owner,{},5,10.1),owner);
});

function authority({profile=CS2_GRENADE_PROFILE,walls=[]}={}){
 const f=fixtureGame({world:fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE,walls}),weaponProfile:'cs2',grenadeProfile:profile});f.t.money=16000;f.g.buy(f.t.id,'hegrenade');f.g.equip(f.t.id,'hegrenade');f.g.enableGrenadeIntents(f.t.id);f.t.nextAttackAt=0;
 let seq=0,action=0,inputSeq=0;
 f.send=(kind,buttons,extra={})=>{const n=++seq;if(kind==='press')action=n;return f.g.grenadeIntent(f.t.id,{round:f.g.round,seq:n,actionId:action,kind,buttons,weapon:f.t.weapon,yaw:0,pitch:0,...extra});};
 f.input=(input={})=>f.g.inputBatch(f.t.id,[{round:f.g.round,seq:++inputSeq,yaw:0,pitch:0,...input}]);
 return f;
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`),launchKeys=['x','y','z','vx','vy','vz'];
test('V3 separates responsive throw animation, authoritative birth and follow-up recovery',()=>{
 const f=predicted(),context={...f.context,grenadeProfileId:CS2_GRENADE_PROFILE.id};f.prediction.observe(f.p,context);f.prediction.buttons(f.p,1,context);f.time(101);f.prediction.buttons(f.p,0,context);
 assert.equal(f.prediction.view(f.p).grenadePhase,'throw');assert.equal(f.prediction.view(f.p).grenadeThrownAt,101);close(f.prediction.view(f.p).grenadePredictedSpawnAt,101.1);
 f.prediction.buttons(f.p,2,context);close(f.prediction.view(f.p).grenadeStartedAt,101.6);f.time(101.59);assert.equal(f.prediction.view(f.p).grenadePhase,'');
});
test('V3 release delay never skips preparation, consumes early or restarts on duplicate release',()=>{
 const {g,t,send}=authority();send('press',1);send('release',0);ticks(g,35);assert.equal(g.projectiles.length,0);assert.equal(t.grenades.hegrenade,1);assert.equal(t.grenadePhase,'hold');
 ticks(g,1);assert.equal(g.projectiles.length,1);assert.equal(t.grenades.hegrenade,0);close(g.projectiles[0].bornAt,.6);close(g.projectiles[0].detonateAt,2.1);
 assert.equal(g.events.filter(e=>e.type==='throw').length,1);assert.equal(send('release',0).status,'thrown');ticks(g,1);assert.equal(g.events.filter(e=>e.type==='throw').length,1);
});
test('V3 builds from one live pose, retaining V2 release-aim compatibility',()=>{
 for(const profile of [CS2_GRENADE_PROFILE,CS2_GRENADE_PROFILE_V2]){
  const {g,t,world,send,input}=authority({profile});send('press',1);ticks(g,36);send('release',0,{yaw:-1,pitch:-.4});input({yaw:1.1,pitch:.3,f:1});g.step();
  if(profile.trajectoryVersion===1){assert.equal(g.projectiles.length,0);ticks(g,5);}
  assert.equal(g.projectiles.length,1);const owner=profile.trajectoryVersion===1?t:{...t,yaw:-1,pitch:-.4},expected=buildCS2GrenadeLaunch(world,profile,owner,'hegrenade',{strength:1});assert.ok(expected);
  for(const key of launchKeys)close(g.projectiles[0][key],expected[key]);
  if(profile.trajectoryVersion===1)assert.equal(g.events.find(e=>e.type==='throw').launchSource,'live');
 }
});
test('reliable V3 release aim survives a complete movement-datagram outage without adding a fence',()=>{
 const {g,t,world,send}=authority();g.inputBatch(t.id,[{round:g.round,seq:1,input:{yaw:0,pitch:0}}]);g.step();send('press',1);ticks(g,36);const releasedAt=g.time,ammo=t.ammo;send('release',0,{yaw:Math.PI/2,pitch:.3,afterInputSeq:10});ticks(g,6);assert.equal(g.projectiles.length,1);close(g.projectiles[0].bornAt,releasedAt+.1);
 const expected=buildCS2GrenadeLaunch(world,CS2_GRENADE_PROFILE,{...t,yaw:Math.PI/2,pitch:.3},'hegrenade',{strength:1});for(const key of launchKeys)close(g.projectiles[0][key],expected[key]);assert.equal(t.yaw,0);assert.equal(t.pitch,0);assert.equal(t.ammo,ammo);
});
for(const detached of [false,true])for(const [sequence,yaw,expectedYaw]of [[10,.4,Math.PI/2],[11,1.2,1.2]])test(`release watermark ${detached?'pending Q':'live'}: input ${sequence} selects ${expectedYaw}`,()=>{
 const {g,t,world,send}=authority();send('press',1);ticks(g,36);const releasedAt=g.time;send('release',0,{yaw:Math.PI/2,pitch:.3,afterInputSeq:10});if(detached)g.equip(t.id,'knife');g.inputBatch(t.id,[{round:g.round,seq:sequence,input:{yaw,pitch:.1}}]);ticks(g,6);assert.equal(g.projectiles.length,1);close(g.projectiles[0].bornAt,releasedAt+.1);assert.equal(t.lastAppliedInputSeq,sequence);assert.equal(t.yaw,yaw);
 const expected=buildCS2GrenadeLaunch(world,CS2_GRENADE_PROFILE,{...t,yaw:expectedYaw,pitch:sequence>10?.1:.3},'hegrenade',{strength:1});for(const key of launchKeys)close(g.projectiles[0][key],expected[key]);if(detached)assert.equal(t.weapon,'knife');
});
test('release without a watermark preserves V3 internal live-pose behavior',()=>{
 const {g,t,world,send}=authority();send('press',1);ticks(g,36);send('release',0,{yaw:Math.PI/2,pitch:.3});ticks(g,6);const expected=buildCS2GrenadeLaunch(world,CS2_GRENADE_PROFILE,t,'hegrenade',{strength:1});for(const key of launchKeys)close(g.projectiles[0][key],expected[key]);
});
test('jump cache view sequence comes from the applied command in its sampling movement step',()=>{
 const p={x:0,y:0,z:0,vx:0,vy:7,vz:0,yaw:0,pitch:0,recoilPitch:0,recoilYaw:0,duckAmount:0,grounded:true,lastAppliedInputSeq:5};const before=captureGrenadePose(p,1.6),after=captureGrenadePose({...p,y:1,vy:3,grounded:false},1.6,11);let state=recordGrenadeJump(null,CS2_GRENADE_PROFILE,before,after,10,10.2,true);state=finalizeGrenadeJumpPunch(state,p,10.2);assert.equal(selectGrenadeJumpPose(state,CS2_GRENADE_PROFILE,10.2).sampleInputSeq,11);assert.equal(p.lastAppliedInputSeq,5);
});
for(const mode of ['release-before-cache','new-input-before-cache','release-after-cache'])test(`jump release view watermark respects history: ${mode}`,()=>{
 const {g,t,world,send,input}=authority();send('press',1);ticks(g,36);input({jump:true});g.step();const samples=[];
 if(mode!=='release-after-cache')send('release',0,{yaw:Math.PI/2,pitch:.3,afterInputSeq:10});
 if(mode==='new-input-before-cache')g.inputBatch(t.id,[{round:g.round,seq:11,input:{yaw:1.1,pitch:.1}}]);
 for(let n=0;n<6;n++){g.step();samples.push({time:g.time,pose:captureGrenadePose(t,world.movement.eyeHeight(t))});}
 if(mode==='release-after-cache')send('release',0,{yaw:Math.PI/2,pitch:.3,afterInputSeq:20});
 for(let n=0;n<8&&!g.projectiles.length;n++)g.step();assert.equal(g.projectiles.length,1);const event=g.events.find(e=>e.type==='throw');assert.equal(event.launchSource,'jump-latch');const sample=samples.find(s=>Math.abs(s.time-event.sampledAt)<1e-8);assert.ok(sample);
 const patch=mode==='release-before-cache'?{yaw:Math.PI/2,pitch:.3}:{};const expected=buildCS2GrenadeLaunch(world,CS2_GRENADE_PROFILE,{...t,...sample.pose,...patch},'hegrenade',{strength:1});for(const key of launchKeys)close(g.projectiles[0][key],expected[key]);
});
test('V3 delayed throw still cancels on explicit menu cancellation or death without losing inventory',()=>{
 for(const cancel of ['menu','death']){
  const {g,t,send}=authority();send('press',1);ticks(g,36);send('release',0);ticks(g,3);assert.equal(g.projectiles.length,0);
  if(cancel==='menu')send('cancel',0);else g.damage(t,1000,null,{kind:'fall',hitgroup:'legs'});
  ticks(g,8);assert.equal(g.projectiles.length,0);assert.equal(t.grenades.hegrenade,1);assert.equal(g.events.filter(e=>e.type==='throw').length,0);
 }
});
test('equip cancels only unreleased/pin-stage prediction; a V3 released windup is visual-only cancellation',()=>{
 for(const when of ['held','early','released','v2']){
  const f=predicted(),ctx={...f.context,grenadeProfileId:when==='v2'?CS2_GRENADE_PROFILE_V2.id:CS2_GRENADE_PROFILE.id};f.prediction.observe(f.p,ctx);f.prediction.buttons(f.p,1,ctx);
  if(when!=='held'){if(when!=='early')f.time(101);f.prediction.buttons(f.p,0,ctx);}
  const before=f.sent.length;f.prediction.cancel({preserveReleased:true});assert.equal(f.prediction.view(f.p).grenadePhase,'');assert.equal(f.sent.length,before+(when==='released'?0:1));
 }
});
test('released V3 grenade survives Q once without changing the immediately equipped knife',()=>{
 const {g,t,send}=authority();g.equip(t.id,'knife');g.equip(t.id,'hegrenade');t.nextAttackAt=0;send('press',1);ticks(g,36);send('release',0);assert.equal(g.equip(t.id,'last'),true);assert.equal(t.weapon,'knife');
 const gun={weapon:t.weapon,lastShot:t.lastShot,nextAttackAt:t.nextAttackAt,reloadAt:t.reloadAt,zoom:t.zoom,ammo:t.ammo};assert.equal(g.snapshot(t.id).players.find(p=>p.id===t.id).pendingGrenadeActionId,1);
 ticks(g,6);assert.equal(g.projectiles.length,1);assert.equal(t.grenades.hegrenade,0);assert.deepEqual({weapon:t.weapon,lastShot:t.lastShot,nextAttackAt:t.nextAttackAt,reloadAt:t.reloadAt,zoom:t.zoom,ammo:t.ammo},gun);assert.equal(g.events.find(e=>e.type==='throw').switchedBeforeLaunch,true);
 send('release',0);ticks(g,2);assert.equal(g.events.filter(e=>e.type==='throw').length,1);
});
test('early pin-stage release then Q cancels; a reserved last grenade cannot be armed twice',()=>{
 const first=authority();first.send('press',1);first.send('release',0);first.g.equip(first.t.id,'last');ticks(first.g,40);assert.equal(first.g.projectiles.length,0);assert.equal(first.t.grenades.hegrenade,1);
 const {g,t,send}=authority();send('press',1);ticks(g,36);send('release',0);g.equip(t.id,'knife');g.equip(t.id,'hegrenade');t.nextAttackAt=0;assert.equal(send('press',1).status,'rejected');ticks(g,6);assert.equal(g.projectiles.length,1);assert.equal(t.grenades.hegrenade,0);
});
test('detached pending throw respects real cancellation, death and new round barriers',()=>{
 for(const why of ['cancel','menu-input','death','round']){
  const {g,t,send}=authority();send('press',1);ticks(g,36);send('release',0);g.equip(t.id,'knife');
  if(why==='cancel')send('cancel',0);else if(why==='menu-input')g.input(t.id,{round:g.round,input:{},cancelThroughSeq:1});else if(why==='death')g.damage(t,1000,null,{kind:'fall',hitgroup:'legs'});else g.begin();
  ticks(g,8);assert.equal(g.projectiles.length,0);assert.equal(g.events.filter(e=>e.type==='throw').length,0);
 }
});
test('pending grenade leaves an AWP shot and QQ within its launch window unchanged',()=>{
 const {g,t,send}=authority();g.buy(t.id,'awp');g.equip(t.id,'hegrenade');t.nextAttackAt=0;send('press',1);ticks(g,36);send('release',0);g.equip(t.id,'knife');g.equip(t.id,'awp');Object.assign(t,{nextAttackAt:0,nextShotAt:g.time,zoom:40});
 const ammo=t.ammo,command={seq:1,round:g.round,input:{fire:true,yaw:.2,pitch:0}},acks=[];g.inputBatch(t.id,[command]);for(let n=1;n<=2;n++)applyScopeAwareAction(g,t.id,{type:'equip',weapon:'last',scopeSeq:n,afterInputSeq:1,commands:[command],round:g.round},{onAck:a=>acks.push(a)});g.step();assert.equal(t.weapon,'awp');assert.equal(t.ammo,ammo-1);assert.equal(t.zoom,90);assert.equal(t.resumeZoomAt,0);assert.deepEqual(acks.map(a=>a.weapon),['knife','awp']);assert.equal(g.events.filter(e=>e.type==='shot').length,1);
 const guard={weapon:t.weapon,lastShot:t.lastShot,nextAttackAt:t.nextAttackAt,reloadAt:t.reloadAt,zoom:t.zoom,ammo:t.ammo,nextShotAt:t.nextShotAt};ticks(g,5);assert.equal(g.events.filter(e=>e.type==='throw').length,1);assert.equal(t.grenades.hegrenade,0);assert.deepEqual({weapon:t.weapon,lastShot:t.lastShot,nextAttackAt:t.nextAttackAt,reloadAt:t.reloadAt,zoom:t.zoom,ammo:t.ammo,nextShotAt:t.nextShotAt},guard);
});
test('capacity is checked at physical creation, and detached capacity failure does not consume inventory',()=>{
 for(const detached of [false,true])for(const freeBeforeDeadline of [false,true]){
  const {g,t,world,send}=authority();send('press',1);ticks(g,36);send('release',0);if(detached)g.equip(t.id,'knife');
  const runtime=createGrenadeRuntime(world,{profile:CS2_GRENADE_PROFILE}),base=runtime.createGrenade(t,'smokegrenade',g.time);assert.ok(base);g.projectiles=Array.from({length:GRENADE_LIMITS.active},(_,i)=>({...base,id:'capacity-'+i,y:.051,vx:0,vy:0,vz:0,grounded:true,resting:true,detonateAt:g.time+100}));ticks(g,3);assert.equal(t.grenades.hegrenade,1);if(freeBeforeDeadline)g.projectiles=[];ticks(g,3);assert.equal(t.grenades.hegrenade,freeBeforeDeadline?0:1);assert.equal(g.events.filter(e=>e.type==='throw').length,freeBeforeDeadline?1:0);
 }
});
test('pending transfer keeps a late jump latch alive after Q and defers at most once',()=>{
 const {g,t,send,input}=authority();send('press',1);ticks(g,36);send('release',0);g.equip(t.id,'knife');ticks(g,4);input({jump:true});g.step();g.step();
 assert.equal(t.weapon,'knife');assert.equal(g.projectiles.length,0);close(g.snapshot(t.id).players.find(p=>p.id===t.id).pendingGrenadeLaunchAt,.8);ticks(g,6);assert.equal(g.projectiles.length,1);close(g.projectiles[0].bornAt,.8);const event=g.events.find(e=>e.type==='throw');assert.equal(event.launchSource,'jump-latch');assert.equal(event.switchedBeforeLaunch,true);assert.equal(t.weapon,'knife');
});
test('a reserved flash and a new held flash remain independent actions with exactly two deductions',()=>{
 const {g,t,send}=authority();g.buy(t.id,'flashbang');g.buy(t.id,'flashbang');g.equip(t.id,'flashbang');t.nextAttackAt=0;send('press',1);ticks(g,36);send('release',0);g.equip(t.id,'knife');g.equip(t.id,'flashbang');t.nextAttackAt=0;assert.equal(send('press',2).status,'active');const started=t.grenadeStartedAt;
 ticks(g,6);assert.equal(t.grenades.flashbang,1);assert.equal(t.grenadePhase,'pin');assert.equal(t.grenadeStartedAt,started);ticks(g,30);send('release',0);ticks(g,6);assert.equal(t.grenades.flashbang,0);assert.deepEqual(g.events.filter(e=>e.type==='throw').map(e=>e.actionId),[1,3]);
});
test('reservation rejection consumes its sequence without blocking a later newly purchased grenade',()=>{
 const {g,t,send}=authority();send('press',1);ticks(g,36);send('release',0);g.equip(t.id,'knife');g.equip(t.id,'hegrenade');t.nextAttackAt=0;assert.equal(send('press',1).status,'rejected');ticks(g,6);assert.equal(t.grenades.hegrenade,0);assert.ok(g.buy(t.id,'hegrenade'));t.nextAttackAt=0;assert.equal(send('press',2).status,'active');send('release',0);ticks(g,36);assert.equal(t.grenades.hegrenade,0);assert.equal(g.events.filter(e=>e.type==='throw').length,2);
});
test('jump pose interpolation preserves actual solver velocity, eye height and wrapped yaw',()=>{
 const before={x:0,y:0,z:0,vx:2,vy:7,vz:-1,yaw:Math.PI-.1,pitch:.2,recoilYaw:0,recoilPitch:0,duckAmount:0,grounded:true,crouch:false,grenadeEyeHeight:1.6},after={...before,x:2,y:1,z:-1,vy:3,yaw:-Math.PI+.1,duckAmount:1,grounded:false,crouch:true,grenadeEyeHeight:.9};
 let state=recordGrenadeJump(null,CS2_GRENADE_PROFILE,before,after,10,10.2,true);assert.ok(state.pose);close(state.cachedAt,10.1);close(state.pose.vy,5);close(state.pose.y,.5);close(state.pose.grenadeEyeHeight,1.25);close(state.pose.yaw,Math.PI);state=finalizeGrenadeJumpPunch(state,after,10.2);
 assert.equal(selectGrenadeJumpPose(state,CS2_GRENADE_PROFILE,10.25).source,'jump-latch');assert.equal(selectGrenadeJumpPose(state,CS2_GRENADE_PROFILE,10.31).source,'live');assert.equal(recordGrenadeJump(state,CS2_GRENADE_PROFILE,after,{...after,grounded:true},10.2,10.3,false),null);
 assert.equal(recordGrenadeJump(null,CS2_GRENADE_PROFILE,before,after,10,10.2,false),null,'falling off a ledge is not a jump latch');
 const missing=recordGrenadeJump(null,CS2_GRENADE_PROFILE,before,{...after,grenadeEyeHeight:NaN},10,10.2,true);assert.equal(missing,null,'invalid samples cannot be repaired by a retail constant');
});
test('new cache finalizes punch on its own weapon-update tick once without mutating the player',()=>{
 const before={x:0,y:0,z:0,vx:2,vy:7,vz:-1,yaw:.2,pitch:.1,recoilYaw:-.2,recoilPitch:.4,duckAmount:0,grounded:true,crouch:false,grenadeEyeHeight:1.6},after={...before,y:1,vy:3,grounded:false},player={recoilPitch:.2,recoilYaw:-.1},copy=structuredClone(player),state=recordGrenadeJump(null,CS2_GRENADE_PROFILE,before,after,10,10.2,true);
 assert.equal(selectGrenadeJumpPose(state,CS2_GRENADE_PROFILE,10.2).source,'live','unfinished punch sample cannot be selected');
 const complete=finalizeGrenadeJumpPunch(state,player,10.2);close(complete.pose.recoilPitch,.3);close(complete.pose.recoilYaw,-.15);assert.deepEqual(player,copy);assert.equal(complete.pose.y,state.pose.y);assert.equal(complete.pose.vy,state.pose.vy);assert.equal(complete.punchPending,false);assert.equal(selectGrenadeJumpPose(complete,CS2_GRENADE_PROFILE,10.2).source,'jump-latch');
 const futureHit={recoilPitch:4,recoilYaw:3};assert.equal(finalizeGrenadeJumpPunch(complete,futureHit,10.3),complete,'a later hit cannot rewrite existing cached aim');assert.equal(finalizeGrenadeJumpPunch(state,futureHit,10.3),state,'a missing same-tick update cannot be repaired from future punch');assert.equal(finalizeGrenadeJumpPunch(state,{recoilPitch:NaN,recoilYaw:0},10.2),null);
});
test('nonzero punch cache uses post-update decay for held and detached throws without changing player trajectory',()=>{
 for(const detached of [false,true]){
  const active=authority(),control=authority({profile:{...CS2_GRENADE_PROFILE,jumpLatchEnabled:false}});
  for(const f of [active,control]){f.send('press',1);ticks(f.g,36);Object.assign(f.t,{recoilPitch:.4,recoilYaw:-.14,cs2PunchVersion:0});f.input({jump:true,yaw:.5,pitch:.1});f.g.step();f.send('release',0);if(detached)f.g.equip(f.t.id,'knife');}
  const samples=[];for(let n=0;n<8&&!active.g.projectiles.length;n++){
   active.g.step();control.g.step();samples.push({time:active.g.time,pose:captureGrenadePose(active.t,active.world.movement.eyeHeight(active.t))});
   for(const key of ['x','y','z','vx','vy','vz','recoilPitch','recoilYaw','cs2RecoilPitchVelocity','cs2RecoilYawVelocity','cs2PunchVersion'])assert.equal(active.t[key],control.t[key],`latch is read-only for player ${key}`);
  }
  const event=active.g.events.find(e=>e.type==='throw');assert.equal(event.launchSource,'jump-latch');const sample=samples.find(s=>Math.abs(s.time-event.sampledAt)<1e-8);assert.ok(sample);assert.ok(Math.abs(sample.pose.recoilPitch)>1e-5);const expected=buildCS2GrenadeLaunch(active.world,CS2_GRENADE_PROFILE,{...active.t,...sample.pose},'hegrenade',{strength:1});
  for(const key of launchKeys)close(active.g.projectiles[0][key],expected[key]);
 }
});
test('live release sampling includes current decayed nonzero punch rather than stale release angles',()=>{
 const {g,t,world,send}=authority();send('press',1);ticks(g,36);Object.assign(t,{recoilPitch:.4,recoilYaw:-.1,cs2PunchVersion:0});send('release',0,{yaw:-1,pitch:-.5});ticks(g,6);assert.equal(g.projectiles.length,1);assert.equal(g.events.find(e=>e.type==='throw').launchSource,'live');assert.ok(t.recoilPitch>0);const expected=buildCS2GrenadeLaunch(world,CS2_GRENADE_PROFILE,t,'hegrenade',{strength:1});for(const key of launchKeys)close(g.projectiles[0][key],expected[key]);
});
test('pending jump waits at most once and missing history uses live state',()=>{
 const before={grounded:true},after={grounded:false,vy:2};let state=recordGrenadeJump(null,CS2_GRENADE_PROFILE,before,after,1,1.01,true);assert.equal(state.pose,null);assert.equal(selectGrenadeJumpPose(state,CS2_GRENADE_PROFILE,1.05).defer,true);assert.equal(selectGrenadeJumpPose(state,CS2_GRENADE_PROFILE,1.05,{canDefer:false}).source,'live');
 state=recordGrenadeJump(state,CS2_GRENADE_PROFILE,after,after,1.2,1.3,false);assert.equal(state,null);
});
test('actual jump latch uses the unchanged movement trajectory with no injected launch speed',()=>{
 const {g,t,world,send,input}=authority();send('press',1);ticks(g,36);input({jump:true,yaw:.6,pitch:.2,f:1});g.step();send('release',0);const samples=[];
 for(let n=0;n<8&&!g.projectiles.length;n++){g.step();samples.push({time:g.time,pose:captureGrenadePose(t,world.movement.eyeHeight(t))});}
 assert.equal(g.projectiles.length,1);const event=g.events.find(e=>e.type==='throw');assert.equal(event.launchSource,'jump-latch');const sample=samples.find(s=>Math.abs(s.time-event.sampledAt)<1e-8);assert.ok(sample);const expected=buildCS2GrenadeLaunch(world,CS2_GRENADE_PROFILE,{...t,...sample.pose},'hegrenade',{strength:1});
 for(const key of launchKeys)close(g.projectiles[0][key],expected[key]);assert.ok(event.sampledAt<g.projectiles[0].bornAt);
});
test('late jump defers one launch window while keeping inventory until actual creation',()=>{
 const {g,t,send,input}=authority();send('press',1);ticks(g,36);send('release',0);ticks(g,4);input({jump:true});g.step();g.step();assert.equal(g.projectiles.length,0);assert.equal(t.grenades.hegrenade,1);
 const held=g.snapshot(t.id).players.find(p=>p.id===t.id);assert.equal(held.grenadeLaunchDeferred,true);close(held.grenadeLaunchAt,.8);ticks(g,5);assert.equal(g.projectiles.length,0);g.step();assert.equal(g.projectiles.length,1);close(g.projectiles[0].bornAt,.8);assert.equal(g.events.find(e=>e.type==='throw').launchSource,'jump-latch');
});
test('unprepared and stale jumps cannot leave a reusable grenade pose across actions',()=>{
 for(const when of ['unprepared','stale','switch']){
  const {g,t,send,input}=authority();if(when!=='unprepared'){send('press',1);ticks(g,36);}input({jump:true});g.step();ticks(g,10);
  if(when==='unprepared'){send('press',1);ticks(g,36);}else if(when==='stale')ticks(g,20);else{g.equip(t.id,'knife');g.equip(t.id,'hegrenade');t.nextAttackAt=0;send('press',1);ticks(g,36);}
  send('release',0);ticks(g,7);assert.equal(g.projectiles.length,1);assert.equal(g.events.find(e=>e.type==='throw').launchSource,'live');
 }
});
test('low ceiling latch retains collision-limited velocity and clears after landing',()=>{
 const {g,t,send,input}=authority({walls:[box('ceiling',[-2,1.95,2],[2,2.2,6])]});send('press',1);ticks(g,36);input({jump:true});g.step();send('release',0);ticks(g,6);
 assert.equal(g.projectiles.length,1);const event=g.events.find(e=>e.type==='throw');assert.ok(['live','jump-latch'].includes(event.launchSource));assert.ok(g.projectiles[0].vy<8,'ceiling collision must not be replaced with a hard-coded retail upward speed');
});
test('only V3 projectile snapshots carry bounded physical sample time, idle players gain no launch fields',()=>{
 for(const profile of [CS2_GRENADE_PROFILE,CS2_GRENADE_PROFILE_V2]){
  const {g,t,ct,send}=authority({profile});send('press',1);ticks(g,36);send('release',0);ticks(g,7);const s=g.snapshot(t.id),projectile=s.projectiles[0];assert.ok(projectile);
  if(profile.trajectoryVersion===1){assert.ok(Number.isFinite(projectile.simulatedAt));assert.ok(projectile.simulatedAt<=s.time);assert.ok(projectile.simulatedAt>=projectile.bornAt);}else assert.equal(Object.hasOwn(projectile,'simulatedAt'),false);
  const idle=s.players.find(p=>p.id===ct.id);for(const key of ['grenadeLaunchAt','grenadeLaunchDeferred','grenadeVisualThrowAt'])assert.equal(Object.hasOwn(idle,key),false);
 }
});
