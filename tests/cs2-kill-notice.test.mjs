import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtureGame,testHitboxes} from './cs2-game-fixture.mjs';
import {createGrenadeRuntime} from '../cs2-grenades.mjs';
import {encodeDatagrams,createReassembler,encodeReliable,readReliable} from '../public/cs2-net-wire.js';

const kills=g=>g.events.filter(event=>event.type==='kill');
const game=options=>fixtureGame({weaponProfile:'cs2',...options});

test('a lethal head bullet publishes stable identities, both teams and the fatal gun',()=>{
 const {g,t,ct}=game();t.name=ct.name='同名玩家';t.weapon='knife';
 const hp=ct.hp,money=t.money;
 g.damage(ct,200,t,{kind:'ak47',hitgroup:'head'});
 const [notice]=kills(g);
 assert.ok(notice);assert.equal(ct.hp,0);assert.equal(ct.deaths,1);assert.equal(t.kills,1);assert.ok(t.money>money);assert.ok(hp>0);
 assert.deepEqual({attacker:notice.attacker,victim:notice.victim,attackerId:notice.attackerId,victimId:notice.victimId,team:notice.team,attackerTeam:notice.attackerTeam,victimTeam:notice.victimTeam,weapon:notice.weapon,headshot:notice.headshot,suicide:notice.suicide,environment:notice.environment},
  {attacker:'同名玩家',victim:'同名玩家',attackerId:t.id,victimId:ct.id,team:'T',attackerTeam:'T',victimTeam:'CT',weapon:'ak47',headshot:true,suicide:false,environment:false});
});

test('a real authoritative AK head ray produces exactly one headshot notice and spends one round',()=>{
 const {g,t,ct}=game({hitboxes:{...testHitboxes,rayPlayer:(...args)=>({...testHitboxes.rayPlayer(...args),hitgroup:'head'})}});
 t.money=16000;g.buy(t.id,'ak47');t.nextAttackAt=0;t.yaw=0;t.pitch=0;ct.hp=1;
 const ammo=t.ammo;assert.equal(g.shoot(t),true);
 assert.equal(t.ammo,ammo-1);assert.equal(kills(g).length,1);assert.equal(kills(g)[0].weapon,'ak47');assert.equal(kills(g)[0].headshot,true);
});

test('all supported firearm ids can mark a fatal head hit in both weapon profiles',()=>{
 for(const weaponProfile of ['legacy','cs2']){
  const catalogue=fixtureGame({weaponProfile}).g.weaponProfile.guns;
  for(const weapon of Object.keys(catalogue)){
   const {g,t,ct}=fixtureGame({weaponProfile});
   g.damage(ct,1000,t,{kind:weapon,hitgroup:'head'});
   assert.equal(kills(g).length,1,weaponProfile+':'+weapon);
   assert.equal(kills(g)[0].weapon,weapon);assert.equal(kills(g)[0].headshot,true,weaponProfile+':'+weapon);
  }
 }
});

test('headshot status comes only from the fatal hit, including a helmeted fatal hit',()=>{
 const {g,t,ct}=game();g.damage(ct,1,t,{kind:'ak47',hitgroup:'head'});assert.equal(kills(g).length,0);
 g.damage(ct,200,t,{kind:'m4a1',hitgroup:'chest'});assert.equal(kills(g)[0].weapon,'m4a1');assert.equal(kills(g)[0].headshot,false);
 g.damage(ct,200,t,{kind:'ak47',hitgroup:'head'});assert.equal(kills(g).length,1,'further damage cannot duplicate a death');
 const armoured=game();armoured.ct.armour=100;armoured.ct.helmet=true;
 armoured.g.damage(armoured.ct,1000,armoured.t,{kind:'awp',hitgroup:'head',armourRatio:1.95});
 assert.equal(kills(armoured.g)[0].headshot,true);
});

test('knife, explosive, fall, unknown and blast damage never masquerade as a headshot bullet',()=>{
 for(const options of [{kind:'knife'},{kind:'hegrenade',blast:true},{kind:'c4',blast:true},{kind:'fall'},{kind:'unrecognised'},{kind:'ak47',blast:true}]){
  const {g,t,ct}=game();g.damage(ct,1000,t,{...options,hitgroup:'head'});
  assert.equal(kills(g)[0].weapon,options.kind);assert.equal(kills(g)[0].headshot,false,options.kind);
 }
});

test('a real delayed HE retains its cause when its owner switches gun or has already died',()=>{
 for(const ownerDead of [false,true]){
  const {g,t,ct,world}=game();const runtime=createGrenadeRuntime(world);
  const grenade=runtime.createGrenade({...t,yaw:0,pitch:0},'hegrenade',0);
  assert.ok(grenade);ct.hp=1;t.weapon='awp';t.alive=!ownerDead;
  g.projectiles=[{...grenade,x:ct.x,y:ct.y+.8,z:ct.z,vx:0,vy:0,vz:0,detonateAt:.01}];
  g.time=.02;runtime.stepGrenades(g,.02);
  const notice=kills(g).find(event=>event.victimId===ct.id);
  assert.ok(notice);assert.equal(notice.weapon,'hegrenade');assert.equal(notice.attackerId,t.id);assert.equal(notice.headshot,false);assert.equal(notice.environment,false);
 }
});

test('self-kills and environment deaths have explicit identities and never borrow the held gun',()=>{
 const self=game();self.g.damage(self.t,1000,self.t,{kind:'hegrenade',hitgroup:'head',blast:true});
 const suicide=kills(self.g)[0];assert.equal(suicide.suicide,true);assert.equal(suicide.environment,false);assert.equal(suicide.attackerId,suicide.victimId);assert.equal(suicide.weapon,'hegrenade');assert.equal(suicide.headshot,false);
 const fall=game();fall.g.damage(fall.t,1000,null,{kind:'fall',hitgroup:'legs'});
 const notice=kills(fall.g)[0];assert.equal(notice.attacker,'环境');assert.equal(notice.attackerId,null);assert.equal(notice.attackerTeam,null);assert.equal(notice.victimTeam,'T');assert.equal(notice.environment,true);assert.equal(notice.suicide,false);assert.equal(notice.weapon,'fall');assert.equal(notice.headshot,false);
 for(const killerPresent of [false,true]){
  const {g,t,ct}=game();t.weapon='awp';g.damage(ct,1000,killerPresent?t:null,{hitgroup:'head'});
  assert.equal(kills(g)[0].weapon,'world');assert.equal(kills(g)[0].headshot,false);
 }
});

test('team-kill and duplicate-name notices retain the actual victim team and ids',()=>{
 const {g,t}=game({friendlyFire:true});const ally=g.add('ally',t.name,'T');g.spawn(ally);
 g.damage(ally,1000,t,{kind:'ak47',hitgroup:'chest'});const notice=kills(g)[0];
 assert.equal(notice.attackerTeam,'T');assert.equal(notice.victimTeam,'T');assert.equal(notice.attackerId,t.id);assert.equal(notice.victimId,'ally');assert.equal(notice.suicide,false);assert.equal(t.kills,-1);
});

test('new kill metadata survives JSON, fragmented QUIC datagrams and reliable framing unchanged',async()=>{
 const a=game();a.g.damage(a.ct,1000,a.t,{kind:'ak47',hitgroup:'head'});
 const b=game();b.g.damage(b.t,1000,null,{kind:'fall',hitgroup:'legs'});
 const message=JSON.parse(JSON.stringify({type:'events',events:[...kills(a.g),...kills(b.g)]}));
 const packets=encodeDatagrams(message,{sequence:12,maxSize:256});assert.ok(packets.length>1);
 const reassembler=createReassembler();let result;
 for(const packet of packets.slice().reverse()){result=reassembler.push(packet)||result;reassembler.push(packet);}
 assert.deepEqual(result,message);
 const bytes=encodeReliable(message),messages=[];
 await readReliable(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=23)controller.enqueue(bytes.slice(i,i+23));controller.close();}}),decoded=>messages.push(decoded));
 assert.deepEqual(messages,[message]);
});
