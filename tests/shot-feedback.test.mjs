import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.mjs';
import {GUNS} from '../public/arsenal.js';
import {createShotFeedback} from '../public/shot-feedback.js';
import {createMuzzlePulse} from '../public/muzzle-pulse.js';
import {recoilRandom} from '../public/shot-random.js';
import {blankInput,movePlayer,supportHeight} from '../public/shared.js';
import {resetWeapon} from '../public/weapons.js';
import {INPUT_DT} from '../public/input-protocol.js';
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-8,`${label}: ${a} != ${b}`);
const base=()=>({weapon:'ak47',ammo:30,reserve:90,ackInputSeq:0,shotsFired:0,recoilSeed:123456,alive:true,x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),vx:0,vy:0,vz:0,grounded:true,yaw:0,pitch:0,lastShot:-100,recoilYaw:0,recoilPitch:0,zoom:90});
const sample=(f,p,seq,fire=true,extra={})=>f.sample({player:p,input:{...blankInput(),fire},seq,round:1,time:10,stateTime:10,fixedStep:true,nowMs:seq*1000*INPUT_DT,allowed:true,...extra});

for(const id of Object.keys(GUNS))test(`${id}: delayed-ACK prediction matches authoritative recoil, ammo and cadence in changing poses`,()=>{
  const g=new Game({random:()=>.27}),p=g.add('p','Prediction',GUNS[id].teams[0]);g.begin();
  Object.assign(p,{...base(),weapon:id,ammo:100,reserve:0,burstMode:['famas','glock18'].includes(id)});resetWeapon(p);
  g.phase='live';g.time=10;g.endAt=100;const original=structuredClone(p),local=structuredClone(p),f=createShotFeedback();
  for(let seq=1;seq<=48;seq++){
    const input={...blankInput(),s:seq>=12&&seq<24?1:0,jump:seq===24,crouch:seq>=35,fire:seq<37&&(GUNS[id].automatic||p.burstMode||seq%12===1)};
    movePlayer(local,input,INPUT_DT,[local]);
    const feedback=sample(f,original,seq,input.fire,{input,pose:local});
    g.inputBatch(p.id,[{seq,round:g.round,...input}]);g.step();
    const v=f.view();
    for(const key of ['ammo','shotsFired','burstRemaining','burstCount','recoilPitch','recoilYaw','lastShot','nextShotAt'])near(v[key]||0,p[key]||0,`${id} tick ${seq} ${key}`);
    if(feedback){assert.equal(feedback.hit,undefined);assert.equal(feedback.impact,undefined);}
    g.events.length=0;
  }
  assert.equal(original.shotsFired,0);assert.equal(original.ammo,100);
});

test('recoil RNG is reproducible and independent of world bullet spread',()=>{
  const a=recoilRandom(123,8,'ak47'),b=recoilRandom(123,8,'ak47'),c=recoilRandom(124,8,'ak47');
  const values=Array.from({length:20},()=>a());assert.deepEqual(values,Array.from({length:20},()=>b()));
  assert.notDeepEqual(values,Array.from({length:20},()=>c()));assert.ok(values.every(x=>x>=0&&x<1));
  assert.equal(recoilRandom(null,1,'ak47',()=>.75)(),.75);
});
test('state-first and event-first confirmation preserve one stable model token and one feedback pulse',()=>{
  for(const stateFirst of [true,false]){
    const f=createShotFeedback(),p=base(),s=sample(f,p,1),token=f.presentation(p).weaponShotToken;
    const authority={...f.view(),ackInputSeq:1},event={weapon:p.weapon,round:1,inputSeq:1,shotOrdinal:1,shotId:'one',time:authority.lastShot};
    assert.ok(s);if(stateFirst)assert.equal(f.observe(authority,{round:1,stateTime:authority.lastShot,nowMs:60}),null);
    assert.equal(f.confirm(event,70),false);assert.equal(f.confirm(event,71),false);
    if(!stateFirst)assert.equal(f.observe(authority,{round:1,stateTime:authority.lastShot,nowMs:80}),null);
    assert.equal(f.presentation(p).weaponShotToken,token);assert.equal(f.diagnostics().suppressed,1);
    assert.equal(f.view().ammo,29);assert.equal(p.ammo,30);
  }
});
test('cancel and rejected predictions allow a new shot, without replaying late old confirmations',()=>{
  const f=createShotFeedback(),p=base();assert.ok(sample(f,p,1));f.cancel();
  assert.ok(sample(f,p,2));const token=f.presentation(p).weaponShotToken;
  assert.equal(f.confirm({weapon:'ak47',round:1,inputSeq:1,shotOrdinal:1,shotId:'canceled'},60),false);
  assert.equal(f.presentation(p).weaponShotToken,token);
  assert.equal(f.confirm({weapon:'ak47',round:1,inputSeq:2,shotOrdinal:1,shotId:'new'},70),false);
  const rejected={...p,ackInputSeq:2};f.observe(rejected,{round:1,stateTime:10,nowMs:80});
  // A separate server-rejected shot (no confirmation) cannot poison the ordinal.
  const r=createShotFeedback();sample(r,p,1);r.observe({...p,ackInputSeq:1},{round:1,stateTime:10,nowMs:70});assert.ok(sample(r,{...p,ackInputSeq:1},2));
});
test('weapon/round changes, death, empty magazines, cooldowns and reloads do not invent shots',()=>{
  for(const patch of [{alive:false},{ammo:0},{reloadAt:11},{nextAttackAt:11},{shieldRaised:true}])assert.equal(sample(createShotFeedback(),{...base(),...patch},1),null);
  const f=createShotFeedback(),p=base();sample(f,p,1);f.observe({...p,weapon:'knife'},{round:1,stateTime:10,nowMs:30});
  assert.equal(f.presentation({weapon:'knife'}).weaponShotToken,undefined);
  f.observe(p,{round:2,stateTime:0,nowMs:40});assert.equal(f.confirm({weapon:'ak47',round:1,inputSeq:1,shotOrdinal:1,shotId:'old-round'},50),false);
});
test('an authoritative-only shot is presented once, including a legacy state-before-event delivery',()=>{
  const f=createShotFeedback(),p={...base(),shotsFired:1,lastShot:10,recoilPitch:.01,ackInputSeq:3};
  f.observe(base(),{round:1,stateTime:9,nowMs:0});
  assert.ok(f.observe(p,{round:1,stateTime:10,nowMs:50}));const token=f.presentation(p).weaponShotToken;
  assert.equal(f.confirm({weapon:'ak47',round:1,inputSeq:3,shotId:'legacy',time:10},60),false);
  assert.equal(f.observe(p,{round:1,stateTime:10,nowMs:70}),null);assert.equal(f.presentation(p).weaponShotToken,token);
});
test('joining a state containing earlier shots does not replay them as fresh fire',()=>{
  const f=createShotFeedback(),p={...base(),shotsFired:12,lastShot:8,ackInputSeq:400};
  assert.equal(f.observe(p,{round:1,stateTime:10,nowMs:0}),null);
  assert.equal(f.presentation(p).weaponShotAt,-100);
  assert.equal(f.confirm({weapon:'ak47',round:1,inputSeq:400,shotOrdinal:12,shotId:'old-shot',time:8},10),false);
});
for(const hz of [30,60,144])test(`muzzle pulse is visible at ${hz}FPS, including shots arriving just before a slow frame`,()=>{
  const f=createMuzzlePulse();f.trigger(1);assert.equal(f.sample(1+1000/hz),true);
  assert.equal(f.sample(100),false);f.trigger(110);f.trigger(115);assert.equal(f.sample(116),true);assert.equal(f.sample(146),true);assert.equal(f.sample(148),false);
  f.trigger(200);f.reset();assert.equal(f.sample(201),false);
});
