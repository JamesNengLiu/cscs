import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrenadeRuntime,GRENADE_LIMITS} from '../cs2-grenades.mjs';
// Preserve the shipped v2 control/physics contract as an explicit rollback target.
// Active v3 launch/latch and flight have separate end-to-end regression suites.
import {CS2_GRENADE_PROFILE_V2 as CS2_GRENADE_PROFILE,CS2_GRENADE_PROFILE_V1} from '../public/cs2-grenade-profile.js';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {applyScopeAwareAction} from '../cs2-scope-actions.mjs';
import {fixtureWorld,fixtureGame,ticks} from './cs2-game-fixture.mjs';

const kinds=['hegrenade','flashbang','smokegrenade'];
const modes=['underhand','medium','overhand'];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
function setup(kind='hegrenade'){
 const f=fixtureGame({world:fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),weaponProfile:'cs2',grenadeProfile:CS2_GRENADE_PROFILE});
 f.t.money=16000;f.g.buy(f.t.id,kind);f.g.equip(f.t.id,kind);f.g.enableGrenadeIntents(f.t.id);f.t.nextAttackAt=0;
 let seq=0,actionId=0;
 f.send=(kind,buttons,{yaw=0,pitch=0,...extra}={})=>{const n=++seq;if(kind==='press')actionId=n;const message={round:f.g.round,seq:n,actionId,kind,weapon:f.t.weapon,buttons,yaw,pitch,...extra};return {message,ack:f.g.grenadeIntent(f.t.id,message)};};
 return f;
}
function owner(world){return{id:'owner',team:'T',alive:true,...world.resolveSpawn('T'),vx:0,vy:0,vz:0,yaw:0,pitch:0};}
function state(g){return Object.fromEntries(Object.entries(g).filter(([key])=>key!=='id'));}

for(const kind of kinds)for(const strength of [0,.5,1])test(`${kind} ${strength}: candidate speed and inherited motion have independent effects`,()=>{
 const w=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),r=createGrenadeRuntime(w,{profile:CS2_GRENADE_PROFILE}),p=owner(w);
 const grenade=r.createGrenade(p,kind,1,{strength}),moving=r.createGrenade({...p,vx:2,vy:3,vz:-1},kind,1,{strength});
 assert.ok(grenade);assert.equal(grenade.strength,strength);assert.equal(grenade.mode,modes[strength*2]);
 close(Math.hypot(grenade.vx,grenade.vy,grenade.vz),750*.9*.0254*(.3+.7*strength));
 close(moving.vx-grenade.vx,2.5);close(moving.vy-grenade.vy,3.75);close(moving.vz-grenade.vz,-1.25);
 assert.deepEqual([moving.x,moving.y,moving.z],[grenade.x,grenade.y,grenade.z]);assert.equal(grenade.detonateAt,2.5);
});

test('full throws retain all pre-change initial state and flight contacts exactly',()=>{
 const world=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),old=createGrenadeRuntime(world,{profile:CS2_GRENADE_PROFILE_V1}),next=createGrenadeRuntime(world,{profile:CS2_GRENADE_PROFILE});
 for(const kind of kinds)for(const pitch of [-.6,0,.5])for(const vx of [0,3]){
  const p={...owner(world),yaw:.7,pitch,vx,vy:1,vz:-2},a=old.createGrenade(p,kind,0),b=next.createGrenade(p,kind,0,{strength:1});assert.deepEqual(state(a),state(b));
  const game=q=>({time:0,players:new Map([[p.id,p]]),projectiles:[q],smokes:[],events:[],emit(e){this.events.push(e);},damage(){throw Error('Flight preservation must not reach damage');}}),ga=game(a),gb=game(b);
  for(let tick=1;tick<=80;tick++){ga.time=gb.time=tick/60;old.stepGrenades(ga,1/60);next.stepGrenades(gb,1/60);assert.equal(ga.projectiles.length,gb.projectiles.length);assert.deepEqual(state(ga.projectiles[0]),state(gb.projectiles[0]));}
 }
});

test('invalid strengths cannot enter authority; legacy secondary booleans preserve full throws',()=>{
 const world=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),r=createGrenadeRuntime(world,{profile:CS2_GRENADE_PROFILE}),p=owner(world);
 for(const strength of [-1,1.001,NaN,Infinity,'0',null,undefined])assert.equal(r.createGrenade(p,'hegrenade',0,{strength}),null);
 const a=r.createGrenade(p,'hegrenade',0),b=r.createGrenade(p,'hegrenade',0,false),c=r.createGrenade(p,'hegrenade',0,true);assert.deepEqual(state(a),state(b));assert.deepEqual(state(a),state(c));
});

for(const kind of kinds)for(const [buttons,strength] of [[1,1],[2,0],[3,.5]])test(`${kind} buttons=${buttons}: one reliable release creates and consumes exactly one`,()=>{
 const {g,t,send}=setup(kind);assert.equal(send('press',buttons).ack.status,'active');ticks(g,36);assert.equal(t.grenadePhase,'hold');assert.equal(t.grenadeButtons,buttons);
 const {message,ack}=send('release',0,{strength:999,velocity:{x:999,y:999,z:999}});assert.equal(ack.status,'released');g.step();
 assert.equal(t.grenades[kind],0);assert.equal(g.projectiles.length,1);const projectile=g.projectiles[0];assert.equal(projectile.strength,strength);assert.equal(projectile.mode,modes[strength*2]);
 const event=g.events.find(e=>e.type==='throw');assert.equal(event.strength,strength);assert.equal(event.mode,projectile.mode);assert.equal(g.snapshot(t.id).players.find(p=>p.id===t.id).grenadeStrength,strength);
 assert.equal(g.grenadeIntent(t.id,message),null);ticks(g,4);assert.equal(g.events.filter(e=>e.type==='throw').length,1);
});

for(const remaining of [1,2])test(`settled dual release retains medium when button ${remaining} remains briefly`,()=>{
 const {g,t,send}=setup();send('press',3);ticks(g,36);send('buttons',remaining);ticks(g,3);assert.equal(t.grenadePhase,'hold');assert.equal(t.grenadeStrength,.5);assert.equal(g.projectiles.length,0);send('release',0);g.step();assert.equal(g.projectiles[0].strength,.5);
});
for(const [remaining,strength] of [[1,1],[2,0]])test(`settled dual release switches to ${strength} after deliberate single-button hold`,()=>{
 const {g,send}=setup();send('press',3);ticks(g,36);send('buttons',remaining);ticks(g,8);send('release',0);g.step();assert.equal(g.projectiles[0].strength,strength);
});
for(const remaining of [1,2])test(`batched input edges retain dual release tolerance with button ${remaining} last`,()=>{
 const {g,t,send}=setup();const at=g.time;send('press',3,{elapsed:0});send('buttons',remaining,{elapsed:.6});send('release',0,{elapsed:.65});
 assert.equal(t.grenadeStrength,.5);assert.equal(g.time,at);assert.equal(t.grenadePhase,'pin');assert.equal(g.projectiles.length,0);
 ticks(g,32);assert.equal(g.projectiles[0].strength,.5);assert.ok(g.projectiles[0].bornAt+1e-8>=at+.5);assert.equal(g.projectiles[0].detonateAt,g.projectiles[0].bornAt+1.5);
});
test('batched intentional single-button hold uses elapsed edges without advancing any simulation clock',()=>{
 for(const [remaining,strength] of [[1,1],[2,0]]){
  const {g,t,send}=setup();const before={time:g.time,shot:t.nextShotAt,attack:t.nextAttackAt,x:t.x,y:t.y,z:t.z};send('press',3,{elapsed:0});send('buttons',remaining,{elapsed:.6});send('release',0,{elapsed:1});
  assert.deepEqual({time:g.time,shot:t.nextShotAt,attack:t.nextAttackAt,x:t.x,y:t.y,z:t.z},before);assert.equal(g.projectiles.length,0);ticks(g,32);assert.equal(g.projectiles[0].strength,strength);
 }
});
test('held strength progresses from accepted edge time while the server simulation clock is earlier',()=>{
 const {g,t,send}=setup();send('press',3,{elapsed:0});send('buttons',2,{elapsed:.6});ticks(g,3);assert.equal(t.grenadeStrength,.5);ticks(g,5);assert.equal(t.grenadeStrength,0);
 // A delayed final edge describes the physical .05s release gap and must not
 // use the longer receive gap as the final throw-strength clock.
 send('release',0,{elapsed:.65});ticks(g,25);assert.equal(g.projectiles[0].strength,.5);
});
test('input-fenced batched edges retain their physical ordering and preparation delay',()=>{
 const {g,t,send}=setup();g.queueInputAction(t.id,{round:g.round,seq:1},()=>{});
 assert.equal(send('press',3,{elapsed:0}).ack,null);assert.equal(send('buttons',2,{elapsed:.6}).ack,null);assert.equal(send('release',0,{elapsed:.65}).ack,null);assert.equal(g.projectiles.length,0);
 g.inputBatch(t.id,[{round:g.round,seq:1,input:{yaw:0,pitch:0,fire:false}}]);g.step();const started=t.grenadeStartedAt;assert.equal(t.grenadePhase,'pin');assert.equal(t.grenadeStrength,.5);assert.equal(g.projectiles.length,0);
 ticks(g,32);assert.equal(g.projectiles[0].strength,.5);assert.ok(g.projectiles[0].bornAt+1e-8>=started+.5);
});
test('backward edge clocks cancel safely and leave the sequence available for a new action',()=>{
 const {g,t,send}=setup();send('press',3,{elapsed:0});ticks(g,32);send('buttons',1,{elapsed:.6});const failed=send('release',0,{elapsed:.5});
 assert.equal(failed.ack.status,'rejected');assert.equal(failed.ack.reason,'invalid-clock');assert.equal(t.grenadePhase,'');assert.equal(t.grenades.hegrenade,1);assert.equal(g.projectiles.length,0);
 assert.equal(send('press',2,{elapsed:0}).ack.status,'active');send('release',0,{elapsed:.2});ticks(g,32);assert.equal(g.projectiles.length,1);assert.equal(g.projectiles[0].strength,0);assert.equal(t.grenades.hegrenade,0);
});
test('an action cannot switch clock sources; later sequences and committed throws remain valid',()=>{
 for(const clientClock of [true,false]){
  const {g,t,send}=setup();send('press',3,clientClock?{elapsed:0}:{});ticks(g,32);const result=send('buttons',1,clientClock?{}:{elapsed:.6});assert.equal(result.ack.reason,'invalid-clock');assert.equal(t.grenadePhase,'');
  send('press',1,{elapsed:0});send('release',0,{elapsed:3600});ticks(g,32);assert.equal(g.events.filter(e=>e.type==='throw').length,1);assert.equal(g.projectiles[0].strength,1);
 }
});
test('single-button throw mode changes and rapid dual taps use current final buttons',()=>{
 for(const [start,next,strength] of [[1,2,0],[2,1,1],[1,3,.5],[2,3,.5]]){const {g,send}=setup();send('press',start);ticks(g,36);send('buttons',next);send('release',0);g.step();assert.equal(g.projectiles[0].strength,strength);}
 for(const remaining of [1,2]){const {g,send}=setup();send('press',3);send('buttons',remaining);send('release',0);ticks(g,32);assert.equal(g.projectiles[0].strength,remaining===1?1:0);}
});

test('cancel, weapon changes and rejected early taps cannot revive an old action',()=>{
 for(const cancel of ['intent','weapon','blur','death']){
  const {g,t,send}=setup();send('press',2);ticks(g,32);
  if(cancel==='intent')send('cancel',0);else if(cancel==='weapon')g.equip(t.id,'knife');else if(cancel==='blur')g.input(t.id,{input:{},cancelThroughSeq:1,round:g.round});else {t.alive=false;g.step();}
  send('release',0);ticks(g,5);assert.equal(t.grenades.hegrenade,1);assert.equal(g.projectiles.length,0);assert.equal(g.events.filter(e=>e.type==='throw').length,0);
 }
 const {g,t,send}=setup();t.nextAttackAt=g.time+1;assert.equal(send('press',2).ack.status,'pending');assert.equal(send('release',0).ack.status,'cancelled');ticks(g,65);assert.equal(g.projectiles.length,0);assert.equal(t.grenades.hegrenade,1);
});

test('capacity rejection leaves the grenade in inventory and clears its mode',()=>{
 const {g,t,send}=setup();send('press',2);ticks(g,36);send('release',0);g.projectiles=Array.from({length:GRENADE_LIMITS.active},(_,i)=>({id:'pressure-'+i}));g.step();assert.equal(t.grenades.hegrenade,1);assert.equal(t.grenadePhase,'');assert.equal(t.grenadeButtons,0);assert.equal(g.events.filter(e=>e.type==='throw').length,0);
});

test('blocked creation never consumes inventory; inactive players add no grenade mode snapshot fields',()=>{
 const base=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),world={...base,collision:{...base.collision,trace:(a,b,height,options)=>options?.channel==='grenade'?{fraction:0,startSolid:true,end:a,normal:[0,1,0]}:base.collision.trace(a,b,height,options)}};
 const {g,t}=fixtureGame({world,weaponProfile:'cs2',grenadeProfile:CS2_GRENADE_PROFILE});assert.equal(Object.hasOwn(g.snapshot(t.id).players.find(p=>p.id===t.id),'grenadeMode'),false);
 t.money=16000;g.buy(t.id,'hegrenade');g.equip(t.id,'hegrenade');g.enableGrenadeIntents(t.id);t.nextAttackAt=0;
 g.grenadeIntent(t.id,{round:g.round,seq:1,actionId:1,kind:'press',weapon:'hegrenade',buttons:2});ticks(g,36);
 g.grenadeIntent(t.id,{round:g.round,seq:2,actionId:1,kind:'release',weapon:'hegrenade',buttons:0,yaw:0,pitch:0});g.step();
 assert.equal(t.grenades.hegrenade,1);assert.equal(t.grenadePhase,'');assert.equal(g.projectiles.length,0);assert.equal(g.events.filter(e=>e.type==='throw').length,0);
});

test('two flash throws retain the early next-grenade hold with independent strengths',()=>{
 const {g,t,send}=setup('flashbang');g.buy(t.id,'flashbang');send('press',2);ticks(g,36);send('release',0);g.step();assert.equal(t.grenades.flashbang,1);
 assert.equal(send('press',3).ack.status,'pending');ticks(g,34);assert.equal(t.weapon,'flashbang');assert.equal(t.grenadePhase,'pin');send('release',0);ticks(g,31);
 assert.equal(t.grenades.flashbang,0);assert.deepEqual(g.events.filter(e=>e.type==='throw').map(e=>e.strength),[0,.5]);assert.equal(g.projectiles.length,2);
});

test('pending input fence applies equip before later grenade mode/release',()=>{
 const {g,t,send}=setup();send('press',2);ticks(g,36);g.inputBatch(t.id,[{round:g.round,seq:1,input:{yaw:0,pitch:0,fire:false}}]);
 g.queueInputAction(t.id,{round:g.round,seq:1},allowed=>{if(allowed)g.equip(t.id,'knife');});const a=send('buttons',3),b=send('release',0);assert.equal(a.ack,null);assert.equal(b.ack,null);g.step();assert.equal(t.weapon,'knife');assert.equal(t.grenades.hegrenade,1);assert.equal(g.projectiles.length,0);
});

test('AWP shot plus continuous QQ still consumes one round and returns unscoped',()=>{
 const {g,t}=setup();g.equip(t.id,'usp');t.money=16000;g.buy(t.id,'awp');g.equip(t.id,'knife');g.equip(t.id,'awp');t.nextAttackAt=0;t.zoom=40;
 const ammo=t.ammo,command={round:g.round,seq:1,input:{fire:true,yaw:.5,pitch:0}},acks=[];g.inputBatch(t.id,[command]);
 for(let n=1;n<=2;n++)applyScopeAwareAction(g,t.id,{type:'equip',weapon:'last',scopeSeq:n,afterInputSeq:1,commands:[command],round:g.round},{onAck:a=>acks.push(a)});
 g.step();assert.equal(t.weapon,'awp');assert.equal(t.ammo,ammo-1);assert.equal(t.zoom,90);assert.equal(t.resumeZoomAt,0);assert.deepEqual(acks.map(a=>a.weapon),['knife','awp']);assert.equal(g.events.filter(e=>e.type==='shot').length,1);
});
