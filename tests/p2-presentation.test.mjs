import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {createMuzzleFlash,muzzleFlashProfile} from '../public/muzzle-flash.js';
import {createMuzzlePulse} from '../public/muzzle-pulse.js';
import {hitFeedbackProfile} from '../public/hit-feedback-profile.js';
import {createPlayerHitEffects,PLAYER_HIT_LIMITS} from '../public/player-hit-effects.js';
import {createPresentationWarmup} from '../public/presentation-warmup.js';
const event=(weapon='ak47',effect='blood',hitgroup='chest',id='one')=>({type:'shot',weapon,shotId:id,hitImpact:{effect,hitgroup,targetId:'target',position:{x:1,y:1.5,z:-4},direction:{x:0,y:0,z:-1},offset:{x:0,y:1.5,z:0}}});
test('muzzle art distinguishes main guns and suppressors without touching model visibility or shot state',()=>{
 const flash=createMuzzleFlash(THREE),mesh=flash.mesh,state={weapon:'ak47',weaponShotToken:'first',weaponShotAt:1},saved={...state};
 assert.equal(mesh.isMesh,true);assert.equal(mesh.material.depthTest,true);assert.equal(mesh.material.depthWrite,false);assert.equal(mesh.material.forceSinglePass,true);
 flash.update(state,1);assert.equal(mesh.visible,false);const rotation=mesh.rotation.z;flash.update(state,1.01);assert.equal(mesh.rotation.z,rotation);assert.deepEqual(state,saved);
 const rifle=muzzleFlashProfile(state),smg=muzzleFlashProfile({weapon:'mp5navy'}),awp=muzzleFlashProfile({weapon:'awp'}),supp=muzzleFlashProfile({weapon:'m4a1',silenced:true});
 assert.ok(awp.width>rifle.width&&rifle.width>smg.width);assert.ok(supp.width<smg.width&&supp.opacity<smg.opacity);
 const {data,width,height}=mesh.material.map.image;assert.equal(width,256);assert.equal(height,64);const shapes=new Set();for(let tile=0;tile<4;tile++){const alpha=[];for(let y=0;y<height;y++)for(let x=0;x<64;x++)alpha.push(data[(y*width+tile*64+x)*4+3]);shapes.add(alpha.join(','));}assert.equal(shapes.size,4);
 mesh.visible=true;flash.update({...state,weapon:'m4a1',silenced:true},1);assert.equal(mesh.visible,true);assert.equal(flash.info().kind,'suppressed');
 flash.dispose();
});
for(const fps of [30,60,144])test(`all muzzle profiles retain a presentation frame at ${fps} FPS`,()=>{
 for(const p of [{weapon:'ak47'},{weapon:'mp5navy'},{weapon:'awp'},{weapon:'m4a1',silenced:true}]){const pulse=createMuzzlePulse(),profile=muzzleFlashProfile(p);pulse.trigger(1,profile.durationMs);assert.equal(pulse.sample(1+1000/fps),true);assert.equal(pulse.sample(200),false);}
});
test('confirmed hit layers distinguish weapon weight, head and body without predicting damage',()=>{
 const scene=new THREE.Scene(),fx=createPlayerHitEffects(THREE,scene,{random:()=>.5});fx.prepare();assert.equal(fx.info().accepted,0);assert.equal(fx.info().active,0);assert.equal(scene.children[0].visible,false);
 for(const [weapon,expected]of [['mp5navy',8],['ak47',12],['awp',18]]){fx.clear();const e=event(weapon),original=structuredClone(e);fx.add(e,1);assert.equal(fx.info().blood,expected);assert.deepEqual(e,original);assert.equal(fx.add(e,1),null);assert.equal(fx.info().batches,1);}
 fx.clear();fx.add(event('ak47','blood','head'),1);assert.equal(fx.info().blood,16);
 fx.clear();fx.add(event('ak47','helmet','head'),1);assert.equal(fx.info().helmet,14);assert.equal(fx.info().blood,0);
 fx.clear();fx.add(event('ak47','armour'),1);assert.equal(fx.info().armour,8);assert.equal(fx.info().blood,0);
 fx.clear();assert.equal(fx.add({type:'shot',weapon:'awp'},1),null);assert.equal(fx.info().active,0);
 for(let i=0;i<1000;i++)fx.add(event('awp','blood','head',String(i)),1);assert.ok(fx.info().active<=PLAYER_HIT_LIMITS.particles+PLAYER_HIT_LIMITS.marks);assert.equal(scene.children.length,1);fx.update(2);assert.equal(fx.info().active,0);fx.dispose();assert.equal(scene.children.length,0);
});
test('lower-priority guns and shield retain the compact generic hit profile',()=>{
 for(const weapon of ['glock18','usp','m3','xm1014','scout','g3sg1','sg550','m249'])assert.equal(hitFeedbackProfile(event(weapon)).count,10);
 assert.equal(hitFeedbackProfile(event('awp','shield')).count,12);
});
test('warmup pauses for gameplay, does not reparent real objects, resumes and deduplicates',async()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),mesh=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial()),texture=new THREE.Texture();scene.add(mesh);
 let allowed=false;const callbacks=[],calls=[],renderer={initTexture(t){calls.push(t);},async compileAsync(root){assert.notEqual(root.children[0],mesh);assert.equal(root.children[0].geometry,mesh.geometry);calls.push('compile');allowed=false;}};
 const warm=createPresentationWarmup(THREE,renderer,scene,camera,{canRun:()=>allowed,schedule:fn=>(callbacks.push(fn),callbacks.length),cancel(){}});
 warm.enqueue({objects:[mesh],textures:[texture]});assert.equal(callbacks.length,0);allowed=true;warm.resume();await callbacks.shift()({timeRemaining:()=>100});assert.deepEqual(calls,['compile']);assert.equal(mesh.parent,scene);assert.equal(camera.layers.mask,1);
 allowed=true;warm.resume();await callbacks.shift()({timeRemaining:()=>100});assert.equal(calls.length,2);warm.enqueue({objects:[mesh],textures:[texture]});assert.equal(warm.diagnostics().queued,0);assert.equal(warm.diagnostics().errors,0);warm.dispose();mesh.geometry.dispose();mesh.material.dispose();texture.dispose();
});
test('failed/stale/overflowed warmup work cannot block gameplay or grow without bound',async()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),callbacks=[];let valid=true;
 const warm=createPresentationWarmup(THREE,{initTexture(){throw Error('test upload failure');},async compileAsync(){throw Error('test compile failure');}},scene,camera,{canRun:()=>true,capacity:4,schedule:fn=>(callbacks.push(fn),callbacks.length),cancel(){}});
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial());warm.enqueue({objects:[mesh],valid:()=>valid});valid=false;const textures=Array.from({length:20},()=>new THREE.Texture());warm.enqueue({objects:[mesh.clone(false)],textures});assert.ok(warm.diagnostics().queued<=4);while(callbacks.length)await callbacks.shift()({timeRemaining:()=>100});assert.ok(warm.diagnostics().errors>0);assert.ok(warm.diagnostics().skipped>0);assert.equal(warm.diagnostics().running,false);warm.dispose();for(const t of textures)t.dispose();mesh.geometry.dispose();mesh.material.dispose();
});
