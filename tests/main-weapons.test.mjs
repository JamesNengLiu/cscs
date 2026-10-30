import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from '../game.mjs';
import {GUNS} from '../public/arsenal.js';
import {baseAccuracy,usesMainAutoRules,usesMainWeaponRules,sampleViewRecoil,MAIN_BALLISTICS_VERSION} from '../public/weapon-feel.js';
import {consumeGunShot} from '../public/gun-state.js';
import {resetWeapon,updateWeapon} from '../public/weapons.js';
import {supportHeight} from '../public/shared.js';
const reference=JSON.parse(readFileSync(new URL('./fixtures/main-weapon-reference.json',import.meta.url)));
const excluded=JSON.parse(readFileSync(new URL('./fixtures/excluded-weapon-baseline.json',import.meta.url)));
const main=['ak47','m4a1','aug','sg552','galil','famas','mac10','mp5navy','tmp','ump45','p90'];
const rad=Math.PI/180;
const near=(a,b,label,tolerance=2e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${label}: ${a} vs ${b}`);
const pose=(weapon,patch={})=>({weapon,alive:true,ammo:1000,reserve:0,x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),grounded:true,vx:0,vy:0,vz:0,pitch:0,yaw:0,lastShot:-100,shotsFired:0,recoilSeed:null,zoom:90,input:{fire:false},...patch});

for(const weapon of [...main,'awp'])test(`${weapon}: matches compiled FIXES reference for spread, stance recoil and scope`,()=>{
  for(const c of reference.cases.filter(c=>c.weapon===weapon)){
    const p=pose(weapon,{ballisticsVersion:1,y:supportHeight(-18.4,22,3.3)+(c.grounded?0:1),grounded:c.grounded,crouch:c.crouch,vx:c.speed/40,zoom:c.zoom,silenced:!!c.mode,burstMode:!!c.mode,accuracy:c.accuracy,burstCount:c.count,lastShot:c.last,nextShotAt:1,recoilPitch:c.pitch*rad,recoilYaw:c.yaw*rad,recoilDirection:c.direction});
    const shot=consumeGunShot(p,10,false,()=>.5);assert.ok(shot);
    for(const [key,value] of Object.entries({spread:shot.spread,pitch:shot.recoilPitch/rad,yaw:shot.recoilYaw/rad,accuracy:p.accuracy,interval:p.nextShotAt-10}))near(value,c.expected[key],`${weapon} ${key} ${JSON.stringify(c)}`);
  }
});

for(const weapon of main)test(`${weapon}: trigger-release recovery follows the independent C++ timer trace`,()=>{
  const p=pose(weapon,{burstCount:reference.recovery.initialCount,accuracy:1,delayFire:true,lastShot:10,fireHeld:true});
  for(const row of reference.recovery.rows){
    updateWeapon(p,1/60,row.time);
    assert.equal(p.burstCount,row.count,`${weapon} tick ${row.tick}`);near(p.recoveryAt,row.deadline,`${weapon} deadline`);
    near(p.accuracy,row.count?1:reference.recovery.baseAccuracyByWeapon[weapon],`${weapon} recovery accuracy`);
  }
  const shot=consumeGunShot(p,12,false,()=>.5),cold=reference.cases.find(c=>c.weapon===weapon&&c.count===0);
  near(shot.spread,cold.expected.spread,`${weapon} first shot after complete recovery`);
});

for(const weapon of main)test(`${weapon}: real simulation caps a stopped long burst and preserves the next firing edge`,()=>{
  const g=new Game({random:()=>.5,audioRandom:()=>.5}),p=g.add('p','Recovery',GUNS[weapon].teams[0]);g.begin();p.money=16000;g.buy(p.id,weapon);g.time=10;g.endAt=1000;
  while(p.shotsFired<24){g.input(p.id,{fire:true,yaw:p.yaw});g.step();}
  assert.equal(p.burstCount,24);const ammo=p.ammo;assert.ok(ammo>0);
  g.input(p.id,{fire:false,yaw:p.yaw});g.step();assert.equal(p.burstCount,15);assert.equal(p.delayFire,false);
  for(let i=0;i<10;i++)g.step();assert.equal(p.burstCount,15);
  g.input(p.id,{fire:true,yaw:p.yaw});g.step();assert.equal(p.ammo,ammo-1);
  if(ammo===1){assert.ok(p.reloadAt>g.time);assert.equal(p.burstCount,0);assert.equal(p.delayFire,false);}
  else{assert.equal(p.burstCount,16);assert.equal(p.delayFire,true);}
});

test('input gaps do not masquerade as trigger releases; explicit cancellation still recovers',()=>{
  const g=new Game({random:()=>.5,audioRandom:()=>.5}),p=g.add('p','Gap','T');g.begin();g.buy(p.id,'ak47');g.time=10;g.endAt=1000;
  g.inputBatch(p.id,[{seq:1,round:g.round,fire:true,yaw:p.yaw}]);g.step();const ammo=p.ammo;
  for(let i=0;i<80;i++)g.step();assert.equal(p.ammo,ammo);assert.equal(p.burstCount,1);assert.equal(p.delayFire,true);
  g.input(p.id,{fire:false,round:g.round,cancelThroughSeq:1});g.step();assert.equal(p.delayFire,false);
  for(let i=0;i<40;i++)g.step();assert.equal(p.burstCount,0);near(p.accuracy,baseAccuracy('ak47'),'cancelled recovery');
});

test('rollout is limited to eleven automatics and AWP, with old-server compatibility',()=>{
  for(const weapon of Object.keys(GUNS)){
    assert.equal(usesMainAutoRules({weapon}),main.includes(weapon),weapon);
    assert.equal(usesMainWeaponRules({weapon}),main.includes(weapon)||weapon==='awp',weapon);
    assert.equal(usesMainWeaponRules({weapon,ballisticsVersion:0}),false);
  }
  assert.equal(new Game().snapshot().ballisticsVersion,MAIN_BALLISTICS_VERSION);
  const old=pose('m4a1',{ballisticsVersion:0,burstCount:24,delayFire:true,lastShot:10,recoveryAt:10.4,accuracy:1});
  updateWeapon(old,1/60,10.02);assert.equal(old.burstCount,24);
  const legacy=pose('m4a1',{ballisticsVersion:0,burstCount:10,accuracy:1,nextShotAt:1,recoilYaw:-3.5*rad,recoilDirection:1,crouch:true});
  consumeGunShot(legacy,10,false,()=>.5);near(legacy.recoilYaw/rad,-2,'legacy lateral clamp');
});

test('AWP and main-gun camera punch has no low-pass tail and supports fractional frames without mutating simulation',()=>{
  const p={recoilPitch:2*rad,recoilYaw:0},before={...p};near(sampleViewRecoil(p,1/120).recoilPitch/rad,2-11/120,'half-tick return');assert.deepEqual(p,before);
  for(const fps of [30,60,144]){
    let remaining=0,sim=pose('awp',{recoilPitch:2*rad,recoilYaw:0});
    for(let frame=0;frame<Math.ceil(fps*.5);frame++){
      remaining+=1/fps;while(remaining>=1/60){updateWeapon(sim,1/60,frame/fps);remaining-=1/60;}
      const displayed=sampleViewRecoil(sim,remaining);assert.ok(displayed.recoilPitch<=sim.recoilPitch+1e-12);if(!sim.recoilPitch)assert.equal(displayed.recoilPitch,0);
    }
    assert.equal(sim.recoilPitch,0);
  }
});

// Pre-change production numeric trajectories, including warm accuracy, sustained
// firing and release. These protect the deliberately excluded gun families.
function compare(actual,expected,label){
  if(typeof expected==='number')near(actual,expected,label,2e-10);
  else if(expected&&typeof expected==='object'){assert.deepEqual(Object.keys(actual),Object.keys(expected),label);for(const key of Object.keys(expected))compare(actual[key],expected[key],`${label}.${key}`);}
  else assert.equal(actual,expected,label);
}
for(const weapon of new Set(excluded.scenarios.map(c=>c.weapon)))test(`${weapon}: excluded weapon trajectory and recovery remain unchanged`,()=>{
  for(const c of excluded.scenarios.filter(c=>c.weapon===weapon)){
    const p=pose(weapon,{y:supportHeight(-18.4,22,3.3)+(c.air?1:0),grounded:!c.air,crouch:c.mode,vx:c.mode?2:0,yaw:.1,pitch:-.05,silenced:c.mode,burstMode:weapon==='glock18'&&c.mode,zoom:c.mode?40:90});resetWeapon(p);const rows=[];
    for(let tick=0;tick<240;tick++){const now=10+tick/60;p.input.fire=tick<80?tick%10<7:tick>=140&&tick<160;updateWeapon(p,1/60,now);let shot=null;
      if(p.input.fire){const q=consumeGunShot(p,now,false,()=>.5);if(q)shot={spread:q.spread,direction:q.direction};}p.fireHeld=p.input.fire;
      if(shot||[80,104,125,139,180,239].includes(tick))rows.push({tick,shot,ammo:p.ammo,accuracy:p.accuracy,burstCount:p.burstCount,recoilPitch:p.recoilPitch,recoilYaw:p.recoilYaw,recoilDirection:p.recoilDirection,lastShot:p.lastShot,nextShotAt:p.nextShotAt,recoveryAt:p.recoveryAt});
    }
    const packed=rows.map(r=>[r.tick,r.shot?.spread??null,...(r.shot?[r.shot.direction.x,r.shot.direction.y,r.shot.direction.z]:[null,null,null]),r.ammo,r.accuracy,r.burstCount,r.recoilPitch,r.recoilYaw,r.recoilDirection,r.lastShot,r.nextShotAt,r.recoveryAt]);
    compare(packed,c.rows,`${weapon} mode=${c.mode} air=${c.air}`);
  }
});
