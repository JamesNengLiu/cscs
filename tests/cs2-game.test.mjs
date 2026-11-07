import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCS2Game} from '../cs2-game.mjs';
import {createGrenadeRuntime} from '../cs2-grenades.mjs';
import {createBallistics} from '../cs2-ballistics.mjs';
import {createLagCompensation} from '../lag-compensation.mjs';
import {applyScopeAwareAction} from '../cs2-scope-actions.mjs';
import {GUNS} from '../public/arsenal.js';
import {fixtureWorld,fixtureGame,box,ticks} from './cs2-game-fixture.mjs';

test('experiment imports no BSP-bound shared, inventory, gun-state, weapons or map module',async()=>{
 for(const file of ['cs2-game.mjs','cs2-grenades.mjs','cs2-ballistics.mjs','cs2-inventory.mjs','cs2-server.mjs']){
  const text=await readFile(new URL('../'+file,import.meta.url),'utf8');
  assert.doesNotMatch(text,/from ['"](?:\.\/public\/)?(?:shared|map|movement|weapons|gun-state)\.js['"]/);
  assert.doesNotMatch(text,/from ['"]\.\/(?:game|server|inventory|grenades|ballistics)\.mjs['"]/);
 }
});
test('ten players spawn at authored positions; team limits and world contract survive snapshots',()=>{
 const w=fixtureWorld(),g=createCS2Game(w,{random:()=>.5});
 for(const team of ['T','CT'])for(let i=0;i<5;i++){const p=g.add(team+i,team+i,team);assert.equal(p.x,i*2);assert.equal(p.z,team==='T'?4:-4);assert.ok(Math.abs(p.y-.0005)<1e-6);}
 assert.throws(()=>g.add('extra','extra','T'),/已满/);const s=g.snapshot('T0');assert.equal(s.experimental,true);assert.deepEqual(s.worldContract,w.contract);assert.equal(s.players.length,10);
 assert.equal(s.players.find(p=>p.id==='CT0').inventory,undefined);assert.ok(s.players.find(p=>p.id==='T0').inventory);
});
test('first opposing arrival resets solo position, equipment, HP and starts a shared round',()=>{
 const g=createCS2Game(fixtureWorld());const t=g.add('t','T','T');g.step();t.money=10000;g.buy('t','ak47');t.x=20;t.hp=12;
 const ct=g.add('ct','CT','CT');assert.equal(g.phase,'countdown');assert.equal(t.x,0);assert.equal(t.hp,100);assert.equal(ct.hp,100);assert.equal(t.alive,true);assert.equal(ct.alive,true);assert.equal(g.round,2);
});
test('authoritative bullets consume ammo, hit matching poses and emit layered effects',()=>{
 const {g,t,ct}=fixtureGame();t.yaw=0;t.pitch=0;t.nextAttackAt=0;const hp=ct.hp,ammo=t.ammo;
 assert.equal(g.shoot(t),true);assert.equal(t.ammo,ammo-1);assert.ok(ct.hp<hp);const shot=g.events.find(e=>e.type==='shot');assert.equal(shot.hit,true);assert.equal(shot.hitImpact.effect,'blood');assert.ok(shot.shotId);
});
test('real collision blocks bullets while player-only clip does not',()=>{
 for(const channels of [['player','bullet','grenade','audio'],['player']]){
  const world=fixtureWorld({walls:[box('wall',[-2,0,-.1],[2,4,.1],channels)]}),{g,t,ct}=fixtureGame({world});t.yaw=0;t.nextAttackAt=0;g.shoot(t);
  assert.equal(ct.hp===100,channels.includes('bullet'));const shot=g.events.find(e=>e.type==='shot');assert.equal(!!shot.impact,channels.includes('bullet'));
 }
});
test('ammo exhaustion starts and completes automatic reload; inventory switching preserves spent AWP round',()=>{
 const {g,t}=fixtureGame();t.money=16000;g.buy(t.id,'awp');t.nextAttackAt=0;t.yaw=0;t.zoom=40;const ammo=t.ammo;assert.equal(g.shoot(t),true);g.equip(t.id,'knife');g.equip(t.id,'awp');assert.equal(t.ammo,ammo-1);assert.equal(t.zoom,90);assert.equal(t.resumeZoomAt,0);
 t.ammo=0;t.nextAttackAt=0;t.input.fire=false;g.step();assert.ok(t.reloadAt>g.time);ticks(g,Math.ceil(GUNS.awp.reload*60)+2);assert.equal(t.ammo,GUNS.awp.clip);assert.equal(t.reloadAt,0);
});
test('sequenced shot then two reliable Q actions preserve shot and ordered return to AWP',()=>{
 const {g,t}=fixtureGame();t.money=16000;g.buy(t.id,'awp');g.equip(t.id,'knife');g.equip(t.id,'awp');t.nextAttackAt=0;t.yaw=0;t.pitch=0;t.zoom=40;const ammo=t.ammo;
 g.inputBatch(t.id,[{seq:1,round:g.round,input:{yaw:0,pitch:0,fire:true}}]);
 const acks=[];for(let n=1;n<=2;n++)applyScopeAwareAction(g,t.id,{type:'equip',weapon:'last',actionId:n,actionSeq:n,switchSeq:n,round:g.round,afterInputSeq:1,commands:[]},{onAck:a=>acks.push(a)});
 g.step();assert.equal(t.weapon,'awp');assert.equal(t.ammo,ammo-1);assert.equal(new Set(g.events.filter(e=>e.type==='shot').map(e=>e.shotId)).size,1);assert.equal(t.ackInputSeq,1);assert.deepEqual(acks.map(a=>a.weapon),['knife','awp']);
});
test('movement, jump fatigue and hit slowdown retain verified legacy controls in the injected world',()=>{
 const {g,t}=fixtureGame();const start=t.z;g.input(t.id,{f:1,yaw:0});ticks(g,20);assert.ok(t.z<start);assert.ok(Math.hypot(t.vx,t.vz)<=6.25+1e-8);
 g.input(t.id,{f:1,yaw:0,jump:true});g.step();assert.equal(t.grounded,false);assert.ok(t.vy>0);assert.ok(t.jumpFatigue>0);
 t.velocityModifier=.65;const before=t.velocityModifier;t.input.jump=false;g.step();assert.ok(t.velocityModifier>=before);
});
test('grenades use new CPU channels, fuse, bounce and private flash consequences',()=>{
 const world=fixtureWorld(),runtime=createGrenadeRuntime(world),{g,t,ct}=fixtureGame({world});const grenade=runtime.createGrenade({...t,yaw:0,pitch:0},'hegrenade',0);assert.ok(grenade);assert.ok(grenade.vz<0);
 g.projectiles=[{...grenade,x:ct.x,y:ct.y+.8,z:ct.z,vx:0,vy:0,vz:0,detonateAt:.01}];g.time=.02;runtime.stepGrenades(g,.02);assert.ok(g.events.some(e=>e.type==='explosion'));assert.ok(ct.hp<100);assert.equal(g.projectiles.length,0);ct.alive=true;ct.hp=100;
 const flash=runtime.createGrenade({...t,yaw:0},'flashbang',g.time);g.projectiles=[{...flash,x:ct.x,y:ct.y+1,z:ct.z-1,vx:0,vy:0,vz:0,detonateAt:.03}];g.time=.05;runtime.stepGrenades(g,.03);assert.ok(g.events.some(e=>e.type==='flash'&&e.private&&e.id===ct.id));
});
test('bomb planting and defusing use authored triggers, line of sight and authoritative timers',()=>{
 const {g,t,ct}=fixtureGame();g.bomb={state:'carried',holder:t.id};t.input.use=true;t.moving=false;for(let i=0;i<181;i++)g.use(t,1/60);assert.equal(g.bomb.state,'planted');assert.equal(g.bomb.site,'A');
 ct.x=t.x+.8;ct.z=t.z;ct.input.use=true;ct.moving=false;ct.defuseKit=true;for(let i=0;i<301;i++)g.use(ct,1/60);assert.equal(g.bomb.state,'defused');assert.equal(g.phase,'ended');assert.equal(g.score.CT,1);
});
test('lag compensation rewinds moving targets and does not accept client hit claims',()=>{
 const {g,t,ct}=fixtureGame();g.lagComp=createLagCompensation();g.lagComp.record({time:0,round:g.round,players:[t,ct]});g.time=.1;ct.x=5;g.lagComp.record({time:g.time,round:g.round,players:[t,ct]});const d={x:0,y:0,z:-1};
 assert.equal(g.targetRay(t,d,20).target,null);assert.equal(g.targetRay(t,d,20,0,0).target,ct);g.input(t.id,{fire:false,hit:ct.id,damage:10000});assert.equal(ct.hp,100);
});
test('unknown surfaces remain labelled and open meshes never invent penetration volume',()=>{
 const world=fixtureWorld(),b=createBallistics(world),ray={x:0,y:1,z:0};assert.equal(b.penetrationExit(ray,{x:1,y:0,z:0},39,'concrete'),null);
 const descriptor=b.soundMaterialAt(ray,[1,0,0]);assert.equal(descriptor.known,false);assert.equal(descriptor.sourceSurface,null);
});
