import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {CS2_WEAPON_PROFILE,CS2_PER_SHELL_RELOAD,getWeaponProfile} from '../public/cs2-weapon-profile.js';import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';import {createCS2WeaponBehavior} from '../public/cs2-weapon-behavior.js';import {createWeaponRuntime} from '../public/cs2-weapon-runtime.js';import {fixtureWorld,fixtureGame} from './cs2-game-fixture.mjs';
function fixture(id,missing=1){const world=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),{g,t}=fixtureGame({world,weaponProfile:'cs2'}),w=CS2_WEAPON_PROFILE.guns[id];t.money=16000;g.buy(t.id,id);t.nextAttackAt=0;t.nextShotAt=0;t.ammo=w.clip-missing;t.inventory[id].ammo=t.ammo;t.reserve=64;t.ammoPool[w.ammoType]=64;g.time=1;const runtime=createWeaponRuntime(world,{rules:world.movement.rules,guns:CS2_WEAPON_PROFILE.guns,weapons:CS2_WEAPON_PROFILE.weapons,behavior:createCS2WeaponBehavior()});g.reload(t.id);return{g,t,w,runtime};}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('per-shell timing provenance matches original AddAmmo/LOOP/OUTRO events without inventing Nova events',async t=>{
 let m;try{m=JSON.parse(await readFile(new URL('../public/assets/cs2-content/runtime.json',import.meta.url),'utf8'));}catch(error){if(error.code==='ENOENT'){t.skip('Original local CS2 animation assets not prepared');return;}throw error;}
 for(const id of ['m3','xm1014']){const v=CS2_PER_SHELL_RELOAD[id],clip=m.clips.find(c=>c.key===v.source.clip);assert.ok(clip);assert.equal(clip.source.sha256,v.source.sha256);assert.equal(clip.source.path,v.source.path);close(clip.duration,v.source.duration);const add=clip.events.filter(e=>e.m_ID==='WPN_RELOAD_ADD_AMMO').map(e=>e.m_flStartTime.m_flValue*clip.duration);assert.equal(add.length,v.addTimes.length);add.forEach((at,i)=>close(at,v.addTimes[i]));close(v.firstAdd,add[0]);close(v.end,clip.duration-add.at(-1));assert.ok(v.insertTimes[0]<v.firstAdd);
  if(add.length>1){for(let i=1;i<add.length;i++)assert.ok(Math.abs((add[i]-add[i-1])-v.interval)<.000005);}else{assert.equal(id,'m3');const marker=name=>clip.events.find(e=>e.m_ID===name).m_flStartTime.m_flValue*clip.duration;close(v.interval,marker('WPN_RELOAD_OUTRO')-marker('WPN_RELOAD_LOOP'));assert.equal(v.intervalMethod,'authored-LOOP-to-OUTRO-markers');}
 }
 assert.equal(getWeaponProfile('legacy').guns.m3.reloadStart,.55);assert.equal(getWeaponProfile('legacy').guns.xm1014.reload,.3);
});
for(const id of ['m3','xm1014'])for(const missing of [1,3,CS2_WEAPON_PROFILE.guns[id].clip])test(`${id} missing ${missing}: first AddAmmo, repeated shells and outro agree in client and authority`,()=>{
 const {g,t,w,runtime}=fixture(id,missing),copy=structuredClone(t),start=g.time,initial=t.ammo,observed=[];let previous=initial;const duration=w.reloadStart+(missing-1)*w.reload+w.reloadEnd;
 for(let i=0;i<Math.ceil((duration+.1)*60);i++){runtime.updateReload(copy,g.time+1/60);g.step();for(const key of ['ammo','reserve','reloadAt','reloadEndAt','reloadStage','reloadShellsAdded'])assert.equal(copy[key],t[key],key);
  if(t.ammo!==previous){assert.equal(t.ammo,previous+1);observed.push(g.time-start);previous=t.ammo;}
  if(g.time-start<w.reloadStart-1e-8)assert.equal(t.ammo,initial);
 }
 assert.equal(observed.length,missing);observed.forEach((at,i)=>{const expected=w.reloadStart+i*w.reload;assert.ok(at+1e-8>=expected&&at-expected<=1/60+1e-8);});assert.equal(t.ammo,w.clip);assert.equal(t.reserve,64-missing);assert.equal(t.reloadAt,0);assert.equal(t.reloadEndAt,0);assert.equal(t.reloadStage,'');assert.equal(t.reloadShellsAdded,missing);
});
for(const id of ['m3','xm1014'])for(const stage of ['loop','outro'])test(`${id} loaded fire interrupts ${stage} without bypassing existing gun cooldown or creating a new tail lock`,()=>{
 const {g,t,w}=fixture(id,stage==='loop'?3:1);while(t.ammo===w.clip-(stage==='loop'?3:1))g.step();assert.equal(t.reloadStage,stage);if(stage==='outro')assert.ok(t.reloadEndAt>g.time);
 t.nextAttackAt=g.time+.2;const before=t.reloadAt;assert.equal(g.shoot(t),false);assert.equal(t.reloadAt,before);t.nextAttackAt=0;t.nextShotAt=g.time+.2;assert.equal(g.shoot(t),false);assert.equal(t.reloadAt,before);t.nextShotAt=0;const ammo=t.ammo;assert.equal(g.shoot(t),true);assert.equal(t.ammo,ammo-1);assert.equal(t.reloadAt,0);assert.equal(t.reloadEndAt,0);assert.equal(t.reloadStage,'');assert.equal(t.reloadCancelledAt,g.time);
});
for(const id of ['m3','xm1014'])test(`${id} empty gun cannot fire before a shell exists and switching retires pending inserts`,()=>{
 const {g,t,w}=fixture(id,CS2_WEAPON_PROFILE.guns[id].clip);assert.equal(g.shoot(t),false);while(t.ammo===0)g.step();assert.equal(t.ammo,1);g.equip(t.id,'knife');assert.equal(t.reloadAt,0);assert.equal(t.reloadEndAt,0);for(let i=0;i<Math.ceil(w.reload*120);i++)g.step();assert.equal(t.inventory[id].ammo,1);assert.equal(t.weapon,'knife');
});
