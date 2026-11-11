import test from 'node:test';
import assert from 'node:assert/strict';
import {GUNS} from '../public/arsenal.js';
import {killNotice} from '../public/cs2-kill-feed.js';
import {killWeaponInfo} from '../public/cs2-kill-icons.js';

const event=extra=>({type:'kill',attacker:'进攻方',victim:'防守方',attackerId:'t',victimId:'ct',attackerTeam:'T',victimTeam:'CT',weapon:'ak47',headshot:false,...extra});

test('fatal event weapon, teams and explicit headshot determine the notice',()=>{
 const n=killNotice(event({weapon:'m4a1',headshot:true}),'t');
 assert.equal(n.weapon.label,'M4A1-S');assert.equal(n.headshot,true);assert.equal(n.attackerTeam,'T');assert.equal(n.victimTeam,'CT');
 assert.equal(n.localKill,true);assert.equal(n.localDeath,false);assert.match(n.description,/M4A1-S 爆头/);
 const old=killNotice({type:'kill',attacker:'旧玩家',victim:'旧对手',team:'CT',weapon:'awp'});
 assert.equal(old.weapon.label,'AWP');assert.equal(old.attackerTeam,'CT');assert.equal(old.victimTeam,'');assert.equal(old.headshot,false);
 assert.equal(killNotice(event({attacker:'环境'})).environment,false,'a player may legitimately use the environment label as a nickname');
});

test('only stable ids highlight a local kill or death; duplicate names do not imply suicide',()=>{
 const n=killNotice(event({attacker:'同名',victim:'同名'}),'ct');
 assert.equal(n.suicide,false);assert.equal(n.localDeath,true);assert.equal(n.localKill,false);
 const noIds=killNotice(event({attackerId:null,victimId:null,attacker:'t',victim:'ct'}),'t');
 assert.equal(noIds.localKill,false);assert.equal(noIds.localDeath,false);
 assert.equal(killNotice(event(),'spectator').localKill,false);
});

test('knife, explosives, environment and malformed flags cannot display a false headshot',()=>{
 for(const weapon of ['knife','hegrenade','flashbang','smokegrenade','c4','fall','world','unknown','__proto__'])assert.equal(killNotice(event({weapon,headshot:true})).headshot,false,weapon);
 for(const flag of [undefined,null,0,1,'true',{},[]])assert.equal(killNotice(event({headshot:flag})).headshot,false);
 const suicide=killNotice(event({weapon:'ak47',victimId:'t',headshot:true}),'t');
 assert.equal(suicide.suicide,true);assert.equal(suicide.headshot,false);assert.equal(suicide.localDeath,true);assert.equal(suicide.localKill,false);
 const fall=killNotice(event({attacker:'环境',attackerId:null,attackerTeam:null,weapon:'fall',environment:true,headshot:true}));
 assert.equal(fall.environment,true);assert.equal(fall.weapon.label,'坠落');assert.match(fall.description,/环境死亡/);
});

test('unknown weapons stay unknown and legacy payloads never borrow a current gun',()=>{
 for(const id of ['new_weapon','__proto__','constructor',null,42,{},[]]){
  const n=killNotice(event({weapon:id}));assert.equal(n.weapon.kind,'unknown');assert.equal(n.weapon.label,'未知武器');assert.equal(n.weapon.id,'unknown');
 }
 const missing=killNotice({type:'kill',attacker:'离线玩家',victim:'受害者'});assert.equal(missing.weapon.id,'unknown');assert.equal(missing.attacker,'离线玩家');
});

test('all supported guns have distinct silhouettes and the actual CS2 names',()=>{
 const paths=new Set();for(const id of Object.keys(GUNS)){const info=killWeaponInfo(id);assert.equal(info.id,id);assert.equal(info.kind,'gun');assert.ok(Object.isFrozen(info));assert.ok(info.path.length>40);paths.add(info.path);}
 assert.equal(paths.size,Object.keys(GUNS).length);
 for(const [alias,canonical,label] of [['weapon_m4a1_silencer','m4a1','M4A1-S'],['weapon_usp_silencer','usp','USP-S'],['p250','p228','P250'],['mp9','tmp','MP9'],['mp5sd','mp5navy','MP5-SD'],['nova','m3','Nova'],['scar20','sg550','SCAR-20']]){
  const info=killWeaponInfo(alias);assert.equal(info.id,canonical);assert.equal(info.label,label);
 }
});

test('names are bounded plain strings and invalid teams cannot become CSS classes',()=>{
 const n=killNotice(event({attacker:'\u0000<img src=x onerror=alert(1)>',victim:'😀'.repeat(100),attackerTeam:'CT bad',victimTeam:{}}));
 assert.equal(n.attacker,'<img src=x onerror=alert(1)>');assert.equal(Array.from(n.victim).length,64);
 assert.equal(n.attackerTeam,'');assert.equal(n.victimTeam,'');
 assert.equal(killNotice(event({attacker:null,victim:'   '})).victim,'玩家');
});
