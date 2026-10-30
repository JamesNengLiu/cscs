import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.mjs';
import {GUNS} from '../public/arsenal.js';
import {RULES as gameRules} from '../public/config.js';
import {blankInput} from '../public/shared.js';
import {eventVisibleTo} from '../event-visibility.mjs';
import {ALL_SOUNDS} from '../public/sound-catalog.js';
import {parseSoundMaterials,normalizeTextureName,textureSoundMaterial,createGroundSoundSampler} from '../public/audio-surfaces.js';
import {createMovementSoundState,movementSoundStep} from '../public/movement-audio.js';
import {createWorldAudio} from '../public/world-audio.js';
import {gunAudioProfile} from '../public/weapon-audio.js';
const registry=new Set(ALL_SOUNDS),v={x:0,y:0,z:0,vx:6.25,vy:0,vz:0,grounded:true};
const sample=(tracker,patch={},extra={})=>movementSoundStep(tracker,{before:{...v},after:{...v,...patch},dt:1/60,random:()=>0,...extra});
function match(options={}){const g=new Game({random:()=>.5,audioRandom:()=>0,...options}),p=g.add('t','Audio T','T'),ct=g.add('ct','Audio CT','CT');g.begin();g.time=10;g.phase='live';g.events=[];return {g,p,ct};}
const sounds=g=>g.events.filter(e=>e.type==='sound');

test('material lookup strips original prefixes, compares 16 chars, defaults unknown and never guesses English',()=>{
  const table=parseSoundMaterials('// note\nM +0{long_texture_1234\nD sand\nW crate\nN snow\nX grass\nbad row');
  assert.equal(normalizeTextureName('+0{LONG_TEXTURE_1234'),'long_texture_123');
  assert.equal(textureSoundMaterial('+9{long_texture_1234',table),'metal');assert.equal(textureSoundMaterial('steel_wood_crate',table),'concrete');
  assert.equal(textureSoundMaterial('crate',table),'wood');assert.equal(textureSoundMaterial('grass',table),'grass');
});
test('BSP floor sampler rejects bounding-box-only hits, non-solids and wrong floors',()=>{
  const polygon=(texture,y,model=0)=>({model,texture,normal:[0,1,0],vertices:[[0,y,0],[0,y,2],[2,y,0]]});
  const data={textures:[{name:'sand'},{name:'grille'}],polygons:[polygon(0,0),polygon(1,2,1)]};
  const sampler=createGroundSoundSampler(data,parseSoundMaterials('D sand\nG grille'));
  assert.equal(sampler({x:.2,y:.01,z:.2}).material,'dirt');assert.equal(sampler({x:1.8,y:.01,z:1.8}).texture,'');
  assert.equal(sampler({x:.2,y:2.01,z:.2}).texture,'');
  assert.equal(createGroundSoundSampler(data,parseSoundMaterials('G grille'),new Set([0,1]))({x:.2,y:2.01,z:.2}).material,'grate');
  assert.equal(sampler({x:NaN,y:0,z:0}).texture,'');
});
test('CS running cadence is 300ms and alternates left 2/4 versus right 1/3',()=>{
  const tracker=createMovementSoundState(),out=[];for(let i=0;i<60;i++)for(const e of sample(tracker))out.push({tick:i,e});
  assert.equal(out.length,4);assert.deepEqual(out.map(p=>p.tick),[0,18,36,54]);assert.deepEqual(out.map(p=>p.e.variant),[2,1,2,1]);
  assert.ok(out.every(p=>p.e.volume===.5&&registry.has(p.e.sound)));
});
test('ordinary <=150 source-unit movement is silent, including walk/crouch, and blocked/air movement makes no fake steps',()=>{
  for(const speed of [0,100,150]){const tracker=createMovementSoundState();for(let i=0;i<60;i++)assert.equal(sample(tracker,{vx:speed/40,walk:true,crouch:true}).length,0);}
  assert.equal(sample(createMovementSoundState(),{grounded:false}).length,0);
  assert.equal(sample(createMovementSoundState(),{vx:0,vz:0},{input:{f:1}}).length,0);
  assert.equal(sample(createMovementSoundState(),{vx:151/40}).length,1);
});
test('material volumes, duck reduction, ladder/full 3D speed and wade skip use explicit rules',()=>{
  assert.equal(sample(createMovementSoundState(),{}, {surface:{material:'dirt'}})[0].volume,.55);
  assert.equal(sample(createMovementSoundState(),{}, {surface:{material:'vent'}})[0].volume,.7);
  assert.equal(sample(createMovementSoundState(),{crouch:true,duckElapsed:.1})[0].volume,.5*.35);
  assert.match(sample(createMovementSoundState(),{}, {surface:{material:'wood'}})[0].sound,/pl_step/);
  const ladder=createMovementSoundState();assert.match(sample(ladder,{vx:0,vy:4,onLadder:true,grounded:false})[0].sound,/pl_ladder/);assert.ok(Math.abs(ladder.remaining-.45)<1e-9);
  const wade=createMovementSoundState();assert.equal(sample(wade,{waterLevel:2}).length,0);wade.remaining=0;assert.match(sample(wade,{waterLevel:2})[0].sound,/pl_wade/);
  assert.equal(sample(createMovementSoundState(),{waterLevel:2}).length,0,'skip counter is per player, not shared');
});
test('stationary jump has no invented voice; running jump uses the current ground step; landing is not always pain',()=>{
  assert.equal(sample(createMovementSoundState(),{grounded:false,vy:6.7,vx:0},{before:{...v,vx:0},input:{jump:true}}).length,0);
  const jump=sample(createMovementSoundState(),{grounded:false,vy:6.7},{input:{jump:true},surface:{material:'metal'}})[0];assert.match(jump.sound,/pl_metal/);assert.equal(jump.type,'jump');assert.equal(jump.volume,1);
  assert.equal(sample(createMovementSoundState(),{landedSpeed:270/40}).length,0);
  assert.equal(sample(createMovementSoundState(),{landedSpeed:300/40})[0].volume,.85);
  const fall=sample(createMovementSoundState(),{landedSpeed:600/40})[0];assert.equal(fall.type,'landing');assert.match(fall.sound,/pl_step/);assert.equal(fall.volume,1);
});
test('gun profiles cover all 24 ids, mode-specific Glock/USP/M4, variants and bounded original-style pitch',()=>{
  for(const weapon of Object.keys(GUNS))for(const silenced of [false,true])for(const random of [()=>0,()=>.999]){const p=gunAudioProfile({weapon,silenced},random);assert.ok(registry.has(p.name));assert.equal(p.attenuation,.8);assert.ok(p.pitch>=94&&p.pitch<=109);}
  assert.match(gunAudioProfile({weapon:'glock18',burstMode:true},()=>0).name,/glock18-1/);assert.match(gunAudioProfile({weapon:'glock18'},()=>0).name,/glock18-2/);
  assert.match(gunAudioProfile({weapon:'m4a1',silenced:true},()=>.999).name,/m4a1-1/);assert.match(gunAudioProfile({weapon:'usp',silenced:false},()=>0).name,/usp_unsil/);
  assert.equal(gunAudioProfile({weapon:'constructor'}),null);
});
test('private purchase/equip/zoom/NVG sounds do not broadcast to an enemy; invalid equips are silent',()=>{
  const {g,p,ct}=match();assert.equal(g.equip(p.id,'knife'),true);assert.equal(g.equip(p.id,'knife'),false);assert.equal(g.equip(p.id,'nonexistent'),false);
  const deploy=sounds(g).filter(e=>e.name==='weapons/knife_deploy1.wav');assert.equal(deploy.length,1);assert.equal(eventVisibleTo(deploy[0],p),true);assert.equal(eventVisibleTo(deploy[0],ct),false);
  g.buy(ct.id,'nightvision');g.toggleNightvision(ct.id);g.toggleNightvision(ct.id);assert.deepEqual(sounds(g).filter(e=>/nvg_(on|off)/.test(e.name)).map(e=>e.name),['items/nvg_on.wav','items/nvg_off.wav']);
});
test('reload is once per valid start, remote-only and has the original 512-unit range; dryfire does not consume ammunition',()=>{
  const {g,p}=match();p.ammo=1;g.reload(p.id);g.reload(p.id);const events=sounds(g).filter(e=>e.name==='weapons/generic_reload.wav');assert.equal(events.length,1);assert.equal(events[0].exceptId,p.id);assert.equal(events[0].attenuation,1000/512);
  p.reloadAt=0;p.ammo=0;p.reserve=0;p.nextAttackAt=0;g.events=[];assert.equal(g.shoot(p),false);g.shoot(p);assert.equal(sounds(g).length,1);assert.match(sounds(g)[0].name,/dryfire_pistol/);assert.equal(p.ammo,0);g.time+=.21;g.shoot(p);assert.equal(sounds(g).length,2);
});
test('radio validates menu/slot/alive/cooldown/round budget and is team-only without hiding kill feeds',()=>{
  const {g,p,ct}=match();for(const [m,s] of [[3,0],[0,6],[-1,0],[0,'0'],[NaN,0]])assert.equal(g.radio(p.id,m,s),false);
  assert.equal(g.radio(p.id,0,0),true);const e=sounds(g)[0];assert.equal(eventVisibleTo(e,p),true);assert.equal(eventVisibleTo(e,ct),false);assert.equal(eventVisibleTo(e,null),false);
  assert.equal(g.radio(p.id,0,0),false);g.time+=1.5;assert.equal(g.radio(p.id,2,0),true);p.radioCount=60;g.time+=2;assert.equal(g.radio(p.id,1,0),false);
  assert.equal(eventVisibleTo({type:'kill',team:'T'},ct),true);p.alive=false;assert.equal(g.radio(p.id,0,0),false);
});
test('public pain/death sounds expose no damage values, copy positions and distinguish head/helmet/kevlar/flesh',()=>{
  const {g,p,ct}=match();p.armour=100;p.helmet=true;g.damage(p,10,ct,{kind:'ak47',hitgroup:'head'});assert.equal(sounds(g).at(-1).name,'player/bhit_helmet-1.wav');
  p.helmet=false;g.damage(p,10,ct,{kind:'ak47',hitgroup:'head'});assert.match(sounds(g).at(-1).name,/headshot/);
  g.damage(p,10,ct,{kind:'ak47',hitgroup:'chest'});assert.equal(sounds(g).at(-1).name,'player/bhit_kevlar-1.wav');
  g.damage(p,10,ct,{kind:'ak47',hitgroup:'legs'});assert.match(sounds(g).at(-1).name,/bhit_flesh/);
  const e=sounds(g).at(-1),x=e.from.x;p.x+=10;assert.equal(e.from.x,x);assert.equal(eventVisibleTo(e,ct),true);assert.equal('amount' in e,false);assert.equal('hp' in e,false);
  g.damage(p,10000,ct);assert.equal(sounds(g).at(-1).name,'player/die1.wav');assert.equal(p.alive,false);
});
test('audio variation consumes no gameplay RNG and cannot alter bullet spread',()=>{
  let calls=0;const {g,p}=match({random:()=>{calls++;return .5;},audioRandom:()=>.9});g.events=[];g.sound(p,'player/pl_step1.wav');g.radio(p.id,0,0);g.damage(p,1,null,{hitgroup:'legs'});assert.equal(calls,0);p.nextAttackAt=0;g.shoot(p);assert.ok(calls>0);
});
test('C4 beep stage/rate/attenuation is authoritative and not replayed each snapshot or random sample',()=>{
  const {g,p}=match();g.bomb={state:'planted',x:p.x,y:p.y,z:p.z,endAt:g.time+gameRules.bombSeconds};g.updateBombSound();g.time+=.5;g.updateBombSound();g.updateBombSound();assert.equal(sounds(g).length,1);assert.equal(sounds(g)[0].name,'weapons/c4_beep1.wav');assert.equal(sounds(g)[0].attenuation,1.5);
  g.time+=1.4;g.updateBombSound();assert.equal(sounds(g).length,2);
  g.time+=Math.floor(gameRules.bombSeconds/4);g.updateBombSound();assert.equal(sounds(g).at(-1).name,'weapons/c4_beep2.wav');assert.equal(sounds(g).at(-1).attenuation,1);
  g.bomb.state='defused';g.time+=2;const n=sounds(g).length;g.updateBombSound();assert.equal(sounds(g).length,n);
});
test('C4 defuse start is once per attempt and completed defuse emits stop, objective and win sounds',()=>{
  const {g,p,ct}=match();g.bomb={state:'planted',x:ct.x,y:ct.y,z:ct.z,endAt:g.time+35};ct.input={...blankInput(),use:true};ct.moving=false;
  g.use(ct,1/60);g.use(ct,1/60);assert.equal(sounds(g).filter(e=>e.name==='weapons/c4_disarm.wav').length,1);
  ct.progress=gameRules.defuseSeconds;g.use(ct,1/60);assert.equal(g.bomb.state,'defused');assert.ok(g.events.some(e=>e.type==='soundStop'));
  assert.ok(['weapons/c4_disarmed.wav','radio/bombdef.wav','radio/ctwin.wav'].every(name=>sounds(g).some(e=>e.name===name)));
});
function router(){const plays=[],stops=[],audio={play:(name,options)=>{plays.push({name,...options});return Promise.resolve(true);},stopChannel:(...args)=>stops.push(args)},world=createWorldAudio(()=>audio,{random:()=>0});return {world,plays,stops,context:{myId:'me',team:'T',round:1}};}
test('remote unseen footstep is directional, own prediction suppresses its ACK and repeated events are deduplicated',()=>{
  const {world,plays,context}=router(),e={type:'footstep',id:'enemy',eventId:1,round:1,sound:'player/pl_metal1.wav',from:{x:4,y:0,z:0},volume:.5,visible:false};world.handle(e,context);world.handle(e,context);assert.equal(plays.length,1);assert.deepEqual(plays[0].position,e.from);
  world.handle({...e,eventId:2,id:'me'},context);assert.equal(plays.length,1);world.localMovement([e]);assert.equal(plays.length,2);assert.equal(plays[1].position,undefined);
  world.handle({...e,eventId:3,round:0},context);assert.equal(plays.length,2);
});
test('world route separates HE/flash/smoke, HE/other bounces, knife miss/body/stab/wall and protects audiences',()=>{
  const {world,plays,context}=router();for(const kind of ['hegrenade','flashbang','smokegrenade'])world.handle({type:'explosion',kind,x:2,y:0,z:0},context);
  assert.ok(plays.some(e=>/hegrenade/.test(e.name)));assert.ok(plays.some(e=>/flashbang/.test(e.name)));assert.ok(plays.some(e=>/sg_explode/.test(e.name)));
  for(const kind of ['hegrenade','flashbang'])world.handle({type:'bounce',kind,from:{x:1,y:0,z:0}},context);assert.ok(plays.some(e=>/he_bounce/.test(e.name)));assert.ok(plays.some(e=>/grenade_hit/.test(e.name)));
  for(const flags of [{},{hit:true},{hit:true,secondary:true},{wall:true}])world.handle({type:'melee',id:'enemy',from:{x:1,y:0,z:0},...flags},context);
  assert.ok(['weapons/knife_slash1.wav','weapons/knife_hit1.wav','weapons/knife_stab.wav','weapons/knife_hitwall1.wav'].every(name=>plays.some(e=>e.name===name)));
  const n=plays.length;world.handle({type:'sound',id:'enemy',private:true,name:'items/nvg_on.wav'},context);world.handle({type:'sound',id:'enemy',team:'CT',name:'radio/ct_coverme.wav'},context);assert.equal(plays.length,n);
});
test('world bullet impact uses actual material and hit point, skips sky and deduplicates repeated pellet/body impacts',()=>{
  const {world,plays,context}=router();const e={type:'shot',id:'enemy',shotId:'one',impact:{position:{x:1,y:2,z:3},material:'concrete',soundSurface:{material:'wood',texture:'crate'}}};world.handle(e,context);assert.equal(plays[0].name,'debris/wood1.wav');assert.deepEqual(plays[0].position,e.impact.position);const n=plays.length;world.handle(e,context);assert.equal(plays.length,n);
  world.handle({...e,shotId:'sky',impact:{...e.impact,soundSurface:{texture:'sky'}}},context);assert.equal(plays.length,n);
  const hit={type:'shot',id:'enemy',shotId:'body',hitImpact:{targetId:'me',effect:'blood',position:{x:1,y:2,z:3}}};world.handle(hit,context);world.handle(hit,context);assert.equal(plays.at(-1).name,'weapons/bullet_hit1.wav');assert.equal(plays.length,n+1);
  for(let i=0;i<600;i++)world.handle({type:'shot',eventId:1000+i,shotId:'bounded'+i},context);assert.ok(world.diagnostics().rememberedShots<=256);assert.ok(world.diagnostics().rememberedEvents<=512);
});
