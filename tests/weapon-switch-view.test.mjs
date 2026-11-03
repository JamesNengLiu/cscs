import test from 'node:test';import assert from 'node:assert/strict';
import {createWeaponSwitchView,WEAPON_SWITCH_VIEW_PROTOCOL} from '../public/weapon-switch-view.js';
import {createShotFeedback} from '../public/shot-feedback.js';
import {Game} from '../game.mjs';import {applyScopeAwareAction} from '../scope-actions.mjs';import {blankInput} from '../public/shared.js';
const player=()=>({id:'p',alive:true,weapon:'awp',previousWeapon:'knife',primary:'awp',pistol:'glock18',ammo:10,reserve:30,zoom:40,x:1,y:2,z:3,yaw:.2,pitch:.1,vx:1,vy:0,vz:0,grounded:true,inventory:{awp:{ammo:10},glock18:{ammo:20},knife:{ammo:0}},grenades:{hegrenade:1,flashbang:0,smokegrenade:0},shotsFired:0,lastShot:-100,nextAttackAt:0,recoilSeed:1});
function fixture(){let at=0;const v=createWeaponSwitchView({now:()=>at}),p=player(),context={round:3,phase:'live'};v.observe(p,{...context,time:10,protocol:1});return {v,p,context,intent:(patch={})=>v.intent({type:'equip',weapon:'last',...patch},p,context),advance:n=>at+=n};}
const ack=(seq,patch={})=>({type:'scopeAck',weaponSwitchViewProtocol:1,switchSeq:seq,switchRound:3,round:3,time:10.1,weapon:'knife',previousWeapon:'awp',ok:true,...patch});
test('knife display changes before a command or server confirmation; source aim, ammo and movement stay intact',()=>{
 const f=fixture(),before=structuredClone(f.p),m=f.intent(),view=f.v.view(f.p);assert.equal(m.switchSeq,1);assert.equal(view.weapon,'knife');assert.equal(view.zoom,90);assert.equal(view.weaponShotAt,-100);assert.equal(view.weaponSwitchPredicted,true);assert.deepEqual(f.p,before);
 for(const key of ['x','y','z','yaw','pitch','vx','vy','vz'])assert.equal(view[key],before[key]);assert.equal(f.v.blocksShot(1),false);
 f.v.sent({...m,afterInputSeq:1});assert.equal(f.v.blocksShot(1),false);assert.equal(f.v.blocksShot(2),true);
});
test('old servers retain the original authoritative display path',()=>{const f=fixture();f.v.observe(f.p,{...f.context,time:11,protocol:0});assert.equal(f.intent().switchSeq,undefined);assert.equal(f.v.view(f.p),f.p);});
test('intermediate snapshot before ACK retires only reflected switches without reversing QQ',()=>{
 const f=fixture(),a=f.intent(),b=f.intent(),token=f.v.view(f.p).weaponDeployToken;assert.equal(f.v.view(f.p).weapon,'awp');
 const intermediate={...f.p,weapon:'knife',previousWeapon:'awp',weaponSwitchAckRound:3,weaponSwitchAckSeq:1};f.v.observe(intermediate,{...f.context,time:10.1,protocol:1});
 assert.equal(f.v.view(intermediate).weapon,'awp');assert.equal(f.v.view(intermediate).weaponDeployToken,token);assert.equal(f.v.confirm(ack(a.switchSeq)),false);
 assert.equal(f.v.confirm(ack(b.switchSeq,{weapon:'awp',previousWeapon:'knife',time:10.2})),true);assert.equal(f.v.view(intermediate).weapon,'awp');
 f.v.observe({...f.p,zoom:90,weaponSwitchAckRound:3,weaponSwitchAckSeq:2},{...f.context,time:10.2,protocol:1});assert.equal(f.v.diagnostics().pending,0);assert.equal(f.v.blocksShot(20),false);
});
test('ACK before snapshot anchors the displayed weapon across older authority',()=>{
 const f=fixture(),m=f.intent();f.v.sent({...m,afterInputSeq:1});assert.ok(f.v.confirm(ack(1)));f.v.observe(f.p,{...f.context,time:10.05,protocol:1});assert.equal(f.v.view(f.p).weapon,'knife');assert.equal(f.v.blocksShot(10),true);
 f.v.observe({...f.p,weapon:'knife',previousWeapon:'awp',weaponSwitchAckRound:3,weaponSwitchAckSeq:1},{...f.context,time:10.1,protocol:1});assert.equal(f.v.blocksShot(10),false);
});
test('a rejected switch restores the authoritative weapon and zoom without modifying ammunition',()=>{const f=fixture();f.intent();f.v.confirm(ack(1,{ok:false,weapon:'awp',previousWeapon:'knife',zoom:40}));assert.equal(f.v.view(f.p).weapon,'awp');assert.equal(f.v.view(f.p).zoom,40);assert.equal(f.p.ammo,10);assert.equal(f.v.diagnostics().rejected,1);});
test('death cancels visuals and late ACKs; a new round may safely reuse sequence one',()=>{const f=fixture();f.intent();f.v.observe({...f.p,alive:false},{...f.context,time:11,protocol:1});assert.equal(f.v.confirm(ack(1)),false);assert.equal(f.v.diagnostics().pending,0);f.v.observe(f.p,{round:4,phase:'live',time:12,protocol:1});const m=f.v.intent({type:'equip',weapon:3},f.p,{round:4,phase:'live'});assert.equal(m.switchSeq,1);assert.equal(f.v.confirm(ack(1)),false);});
test('cancel or timeout never resurrects pending selection from a delayed ACK',()=>{for(const kind of ['cancel','expire']){const f=fixture();f.intent();if(kind==='cancel')f.v.cancel();else f.advance(1501);assert.equal(f.v.view(f.p),f.p);assert.equal(f.v.confirm(ack(1)),false);}});
test('utilities preserve their existing authoritative selection and pin/release path',()=>{const f=fixture();assert.equal(f.intent({weapon:4}).switchSeq,undefined);assert.equal(f.v.view(f.p),f.p);f.intent();f.intent({weapon:4});assert.equal(f.v.view(f.p),f.p);});
test('invalid ownership, queue overflow, paused play and non-equip actions do not predict',()=>{
 const f=fixture();assert.equal(f.intent({weapon:'m249'}).switchSeq,undefined);assert.equal(f.v.intent({type:'reload'},f.p,f.context).switchSeq,undefined);assert.equal(f.v.intent({type:'equip',weapon:3},f.p,{...f.context,canQueue:false}).switchSeq,undefined);
 for(let i=0;i<16;i++)assert.ok(f.intent().switchSeq);assert.equal(f.intent().switchSeq,undefined);assert.equal(f.v.diagnostics().pending,16);
 f.v.observe(f.p,{...f.context,time:11,phase:'waiting',protocol:1});assert.equal(f.v.view(f.p),f.p);
});
test('single switch reflected by a snapshot is never replayed as another Q',()=>{const f=fixture();f.intent();const p={...f.p,weapon:'knife',previousWeapon:'awp',weaponSwitchAckRound:3,weaponSwitchAckSeq:1};f.v.observe(p,{...f.context,time:10.1,protocol:1});assert.equal(f.v.view(p),p);assert.equal(f.v.confirm(ack(1)),false);});
test('held trigger and FAMAS burst predictions stop at a transmitted switch fence, without losing the prior shot',()=>{
 for(const weapon of ['awp','famas','ak47']){const p={...player(),weapon,ammo:30,zoom:90,burstMode:weapon==='famas',ballisticsVersion:1},feedback=createShotFeedback();feedback.observe(p,{round:1,stateTime:10,nowMs:0});
  const initial=feedback.sample({player:p,input:{...blankInput(),fire:true},seq:1,round:1,time:10,stateTime:10,fixedStep:true,nowMs:1,allowed:true});assert.ok(initial,weapon);
  for(let seq=2;seq<=15;seq++)assert.equal(feedback.sample({player:p,input:{...blankInput(),fire:true},seq,round:1,time:10,stateTime:10,fixedStep:true,nowMs:seq*17,allowed:true,switchBlocked:true}),null);
  assert.equal(feedback.view().shotsFired,1);assert.equal(feedback.view().ammo,29);assert.equal(feedback.diagnostics().predicted,1);
 }
});
test('switch ACK and snapshot watermark are published only after the original firing barrier',()=>{
 const g=new Game({random:()=>.5}),p=g.add('p','P','T');g.begin();g.phase='live';g.time=10;g.endAt=100;g.buy('p','awp');p.nextAttackAt=0;
 const acks=[],m={type:'equip',weapon:3,switchSeq:1,round:g.round,afterInputSeq:1,commands:[{seq:1,round:g.round,...blankInput(),fire:true,yaw:p.yaw,pitch:p.pitch}]};
 assert.equal(applyScopeAwareAction(g,'p',m,{onAck:a=>acks.push(a)}),null);assert.equal(p.weaponSwitchAckSeq,undefined);g.step();
 assert.equal(p.inventory.awp.ammo,9);assert.equal(p.weapon,'knife');assert.equal(acks.length,1);assert.equal(acks[0].weaponSwitchViewProtocol,WEAPON_SWITCH_VIEW_PROTOCOL);assert.equal(acks[0].switchSeq,1);assert.equal(p.weaponSwitchAckRound,g.round);assert.equal(g.snapshot('p').players[0].weaponSwitchAckSeq,1);
});
