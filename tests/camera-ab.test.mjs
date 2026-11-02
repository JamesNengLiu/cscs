import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cameraCases,cameraTrace} from './fixtures/camera-ab-cases.mjs';
import {createPlayerCamera} from '../public/player-camera.js';
import {createCameraSettings,bindCameraSettings} from '../public/camera-settings.js';
import {createFrameMetrics} from '../public/performance.js';
import {eyeHeight,movePlayer,trace} from '../public/shared.js';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/camera-ab-baseline.json',import.meta.url)));
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
for(const hz of [60,120,144,240])for(const spec of cameraCases)test(`camera A/B: ${spec.name}, ${hz}Hz keeps physics and stable rollback exact`,()=>{
 const a=cameraTrace(spec,hz,'baseline'),b=cameraTrace(spec,hz,'responsive'),old=baseline.rows.find(r=>r.name===spec.name&&r.hz===hz);
 assert.equal(a.physicsHash,old.physicsHash);assert.equal(b.physicsHash,old.physicsHash);assert.equal(a.renderHash,old.renderHash,'A must remain a literal rollback');
 assert.equal(a.solids,0);assert.equal(b.solids,0);assert.ok(b.maxUp<10.000001,`${b.maxUp} camera rise`);assert.ok(b.maxHorizontal<8,`${b.maxHorizontal} camera horizontal speed`);
 if(spec.name==='flat-start-stop-reverse'){near(a.lagMs,1000/60);assert.ok(Math.abs(b.lagMs)<1);assert.ok(b.firstMotion<=a.firstMotion);}
});
test('render forecasts cannot mutate the player, neighbors, input, ammunition or cooldowns',()=>{
 const p=structuredClone(cameraCases[0].start),neighbor={...p,id:'other',x:p.x+3};Object.assign(p,{ammo:30,nextAttackAt:99,inventory:{ak47:{ammo:30}},grenades:{flashbang:2}});
 const input={f:1,yaw:p.yaw,fire:true,jump:true,crouch:true,use:true},c=createPlayerCamera({mode:'responsive'});c.reset(p);c.push(p,input,[p,neighbor]);const saved=structuredClone({p,neighbor,input});
 for(let i=1;i<20;i++)c.update(p,{fractionSeconds:(i%3+1)/240,dt:1/144,players:[p,neighbor]});
 assert.deepEqual({p,neighbor,input},saved);near(c.position.y,p.y+eyeHeight(p));assert.equal(c.diagnostics().previews,1,'one forecast is reused across renders');
});
test('reset, rebase, explicit rollback and invalid selections retain safe camera state',()=>{
 const p=structuredClone(cameraCases[0].start),c=createPlayerCamera({mode:'responsive'});c.reset(p);movePlayer(p,{f:1,yaw:p.yaw},1/60);c.push(p,{f:1,yaw:p.yaw});c.update(p,{fractionSeconds:1/120,dt:1/120});
 const old={...c.position},next={...p,x:p.x+.03,y:p.y+.01};c.rebase(p,next);c.update(next,{dt:0,correction:{x:-.03,y:-.01,z:0}});for(const k of ['x','y','z'])near(c.position[k],old[k]);
 const far={...next,x:next.x+5};c.rebase(next,far);c.update(far);near(c.position.x,far.x);assert.equal(c.setMode('unknown'),false);assert.equal(c.mode,'responsive');assert.equal(c.setMode('baseline'),true);c.reset(far);near(c.update(far),far.y+eyeHeight(far));assert.throws(()=>createPlayerCamera({mode:'invalid'}));
});
test('the preview never synthesizes a fresh jump after an acknowledged/canceled input',()=>{
 const p=structuredClone(cameraCases[0].start),c=createPlayerCamera({mode:'responsive'});p.jumpHeld=false;c.reset(p);c.push(p,{jump:true,crouch:true});for(let i=0;i<20;i++)c.update(p,{fractionSeconds:1/120,dt:1/144});near(c.position.y,p.y+eyeHeight(p));assert.equal(p.jumpHeld,false);assert.equal(p.crouch,false);
});
test('no new preview work is performed while paused or dead, and horizon is one fixed tick',()=>{
 const p=structuredClone(cameraCases[0].start),c=createPlayerCamera({mode:'responsive'});c.reset(p);c.push(p,{f:1,yaw:p.yaw});c.update(p,{fractionSeconds:1,dt:1/60,enabled:false});assert.equal(c.diagnostics().previews,0);c.update({...p,alive:false},{fractionSeconds:1,dt:1/60});assert.equal(c.diagnostics().previews,0);
 c.update(p,{fractionSeconds:1,dt:1/60});assert.equal(c.diagnostics().previews,1);assert.equal(trace(c.position,c.position).startSolid,false);
});
test('camera preferences default to A, honor an explicit tab override and fail safely without storage',()=>{
 const store=new Map(),storage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)};const a=createCameraSettings(storage);assert.equal(a.mode,'baseline');assert.equal(a.setMode('bad'),false);assert.equal(a.setMode('responsive'),true);assert.equal(createCameraSettings(storage).mode,'responsive');
 const override=createCameraSettings(storage,new URLSearchParams('camera=baseline'));assert.equal(override.mode,'baseline');assert.equal(override.source,'query');assert.equal(createCameraSettings(storage).mode,'responsive','query must not overwrite a saved choice');assert.equal(createCameraSettings(null).mode,'baseline');
 const blocked=createCameraSettings({getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}});assert.equal(blocked.mode,'baseline');blocked.setMode('responsive');assert.equal(blocked.mode,'responsive');assert.equal(blocked.saved,false);
});
test('menu control provides a reversible local A/B selection',()=>{
 const select={value:'',addEventListener:(name,fn)=>select.change=fn},status={textContent:''},root={getElementById:id=>id==='cameraMode'?select:status},settings=createCameraSettings(null),calls=[];
 bindCameraSettings(root,settings,mode=>calls.push(mode));assert.equal(select.value,'baseline');select.value='responsive';select.change();assert.equal(settings.mode,'responsive');select.value='baseline';select.change();assert.deepEqual(calls,['responsive','baseline']);assert.match(status.textContent,/A/);
});
for(const hz of [60,120,144])test(`refresh budget ${hz}Hz is measured separately from physics and GPU time`,()=>{
 const m=createFrameMetrics();for(let i=0;i<180;i++)m.add(1000/hz,2,.5,.4,.08);const r=m.snapshot(),budget=r.frameBudgets[hz];near(budget.budgetMs,1000/hz);assert.equal(budget.overBudgetFrames,0);assert.equal(budget.cadenceP99WithinBudget,true);assert.equal(budget.cpuP99WithinBudget,true);near(r.cameraMs.mean,.08,1e-6);assert.match(r.cadenceScope,/not a display/);
 const before=r.samples;m.add(NaN,1,1,1,1);assert.equal(m.snapshot().samples,before);m.add(100,10,1,1,.2);assert.ok(m.snapshot().frameBudgets[hz].overBudgetFrames>0);assert.equal(m.snapshot().intervalMs.max,100);
});
