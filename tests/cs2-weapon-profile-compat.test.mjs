import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CS2_WEAPON_PROFILE,CS2_WEAPON_PROFILE_V1,LEGACY_WEAPON_PROFILE,getWeaponProfile,isCS2WeaponProfile} from '../public/cs2-weapon-profile.js';
import {CS2_MOVEMENT_PROFILE} from '../public/cs2-movement-profile.js';
import {CS2_GRENADE_PROFILE} from '../public/cs2-grenade-profile.js';
import {createCS2Game} from '../cs2-game.mjs';
import {createExperimentalServer} from '../cs2-server.mjs';
import {fixtureWorld,testHitboxes} from './cs2-game-fixture.mjs';

test('v1 profile is byte-equivalent JSON to the pre-calibration compatibility oracle',()=>{
  const digest=createHash('sha256').update(JSON.stringify(CS2_WEAPON_PROFILE_V1)).digest('hex');
  assert.equal(digest,'7f55a87e58c34280a2a683c0fa54573c328c773b279da3476d0e09774f564822');
  assert.equal(CS2_WEAPON_PROFILE_V1.id,'cs2-vdata-experimental-v1');
  assert.equal(CS2_WEAPON_PROFILE_V1.recoilModel,'vdata-seeded-browser-approximation-v1');
});

test('default CS2 selects v2 and explicit old ID selects the independently frozen v1',()=>{
  assert.equal(CS2_WEAPON_PROFILE.id,'cs2-vdata-ballistics-v2');
  assert.equal(CS2_WEAPON_PROFILE.recoilModel,'cs2-reference-recoil-v2');
  assert.equal(getWeaponProfile('cs2'),CS2_WEAPON_PROFILE);
  assert.equal(getWeaponProfile(CS2_WEAPON_PROFILE.id),CS2_WEAPON_PROFILE);
  assert.equal(getWeaponProfile(CS2_WEAPON_PROFILE_V1.id),CS2_WEAPON_PROFILE_V1);
  assert.equal(getWeaponProfile('legacy'),LEGACY_WEAPON_PROFILE);
  assert.equal(getWeaponProfile(),LEGACY_WEAPON_PROFILE);
  assert.notEqual(CS2_WEAPON_PROFILE,CS2_WEAPON_PROFILE_V1);
  assert.notEqual(CS2_WEAPON_PROFILE.guns,CS2_WEAPON_PROFILE_V1.guns);
  assert.ok(Object.isFrozen(CS2_WEAPON_PROFILE));
  assert.ok(Object.isFrozen(CS2_WEAPON_PROFILE.guns));
  assert.ok(Object.isFrozen(CS2_WEAPON_PROFILE.weapons));
});

test('v2 changes version metadata only; every gun fact and weapon reference remains coherent',()=>{
  assert.deepEqual(Object.keys(CS2_WEAPON_PROFILE.guns),Object.keys(CS2_WEAPON_PROFILE_V1.guns));
  for(const id of Object.keys(CS2_WEAPON_PROFILE.guns)){
    const old=CS2_WEAPON_PROFILE_V1.guns[id],current=CS2_WEAPON_PROFILE.guns[id];
    const {profileId:oldId,...oldFacts}=old,{profileId:newId,...currentFacts}=current;
    assert.equal(oldId,CS2_WEAPON_PROFILE_V1.id);assert.equal(newId,CS2_WEAPON_PROFILE.id);
    assert.deepEqual(currentFacts,oldFacts,id+' factual coefficients changed');
    assert.equal(CS2_WEAPON_PROFILE.weapons[id],current,id+' weapon table must not point to a v1 gun');
    assert.ok(Object.isFrozen(current));assert.ok(Object.isFrozen(current.source));
  }
  for(const id of Object.keys(CS2_WEAPON_PROFILE_V1.weapons))if(!Object.hasOwn(CS2_WEAPON_PROFILE.guns,id))assert.equal(CS2_WEAPON_PROFILE.weapons[id],CS2_WEAPON_PROFILE_V1.weapons[id]);
  assert.equal(CS2_WEAPON_PROFILE.metresPerUnit,CS2_WEAPON_PROFILE_V1.metresPerUnit);
  assert.deepEqual(CS2_WEAPON_PROFILE.verifiedFields,CS2_WEAPON_PROFILE_V1.verifiedFields);
  assert.deepEqual(CS2_WEAPON_PROFILE.approximateFields,CS2_WEAPON_PROFILE_V1.approximateFields);
});

test('profile family check supports aliases, canonical IDs and objects without accepting an unknown version',()=>{
  for(const value of ['cs2',CS2_WEAPON_PROFILE.id,CS2_WEAPON_PROFILE_V1.id,CS2_WEAPON_PROFILE,CS2_WEAPON_PROFILE_V1])assert.equal(isCS2WeaponProfile(value),true);
  for(const value of ['legacy',LEGACY_WEAPON_PROFILE,null,undefined,{},'cs2-vdata-ballistics-v3',{id:'unknown'}])assert.equal(isCS2WeaponProfile(value),false);
  for(const id of ['unknown','cs2-vdata-ballistics-v3',null,{},1])assert.throws(()=>getWeaponProfile(id),/Unknown authoritative weapon profile/);
});

for(const [name,requested,expected]of [
  ['v1 full ID',CS2_WEAPON_PROFILE_V1.id,CS2_WEAPON_PROFILE_V1],
  ['v2 full ID',CS2_WEAPON_PROFILE.id,CS2_WEAPON_PROFILE],
  ['v1 object',CS2_WEAPON_PROFILE_V1,CS2_WEAPON_PROFILE_V1],
  ['v2 object',CS2_WEAPON_PROFILE,CS2_WEAPON_PROFILE],
  ['current alias','cs2',CS2_WEAPON_PROFILE]
])test(`${name}: authority retains the selected profile and the CS2 grenade/movement family`,()=>{
  // This intentionally uses the real behavior factory. A missing v1 factory
  // dispatch must fail here rather than silently skip compatibility coverage.
  const world=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE}),g=createCS2Game(world,{weaponProfile:requested,hitboxes:testHitboxes,random:()=>.5});
  const p=g.add('t','Compatibility','T');g.begin();
  const snapshot=g.snapshot(p.id);assert.equal(g.weaponProfile,expected);assert.equal(snapshot.weaponProfileId,expected.id);
  assert.equal(snapshot.movementProfileId,CS2_MOVEMENT_PROFILE.id);
  assert.equal(snapshot.grenadeProfileId,CS2_GRENADE_PROFILE.id);
  assert.equal(snapshot.players[0].weapon,'glock18');
});

for(const profile of [CS2_WEAPON_PROFILE_V1,CS2_WEAPON_PROFILE])for(const requested of [profile.id,profile])test(`${profile.id} ${typeof requested}: server validates CS2 world before any listen`,async()=>{
  // A legacy fixture world is deliberately incompatible. Correct full-string
  // resolution rejects before telemetry, listeners, native assets or sockets.
  let unexpectedServer;
  try{await assert.rejects(async()=>{unexpectedServer=await createExperimentalServer({world:fixtureWorld(),autoTick:false,gameOptions:{weaponProfile:requested,hitboxes:testHitboxes}});},/CS2 weapon and movement profile must share the same world contract/);}
  finally{await unexpectedServer?.close();}
});

test('unknown explicit profile IDs fail closed in game and server constructors',async()=>{
  const world=fixtureWorld({movementProfile:CS2_MOVEMENT_PROFILE});
  for(const requested of ['unknown',{id:'unknown'}]){
    assert.throws(()=>createCS2Game(world,{weaponProfile:requested,hitboxes:testHitboxes}),/Unknown authoritative weapon profile/);
    let unexpectedServer;
    try{await assert.rejects(async()=>{unexpectedServer=await createExperimentalServer({world,autoTick:false,gameOptions:{weaponProfile:requested,hitboxes:testHitboxes}});},/Unknown authoritative weapon profile/);}
    finally{await unexpectedServer?.close();}
  }
});
