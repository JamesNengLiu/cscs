import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createFrameMetrics,createResolutionController,interpolateRemote} from '../public/performance.js';
import {createRigidSkinning} from '../public/rigid-skinning.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);

test('bounded frame telemetry keeps recent samples, rejects invalid input, resets and labels CPU scope',()=>{
  const m=createFrameMetrics(4);for(let i=1;i<=8;i++)m.add(i,i/2,i/4,i/8);
  m.add(NaN,1,1,1);const s=m.snapshot();assert.equal(s.samples,4);near(s.intervalMs.mean,6.5);assert.equal(s.intervalMs.median,6);
  assert.match(s.scope,/not GPU/);m.reset();assert.equal(m.snapshot().samples,0);assert.equal(m.snapshot().estimatedFps,0);
});
test('auto resolution requires sustained slow frames and is bounded, avoiding single-frame reactions',()=>{
  const c=createResolutionController(2);assert.equal(c.ratio,1.25);
  assert.equal(c.sample(200,0,20),false);for(let i=0;i<119;i++)c.sample(30,i*30,20);
  assert.equal(c.ratio,1);for(let i=120;i<1500;i++)c.sample(30,i*30,20);assert.equal(c.ratio,.7);
});
test('resolution recovery has long hysteresis; manual settings do not adapt and reject invalid modes',()=>{
  const c=createResolutionController(1.25);for(let i=0;i<120;i++)c.sample(30,i*30,20);assert.equal(c.ratio,1);
  for(let i=0;i<300;i++)c.sample(16,3600+i*16,8);assert.equal(c.ratio,1);
  for(let i=0;i<1600;i++)c.sample(16,8400+i*16,8);assert.equal(c.ratio,1.25);
  c.setQuality('performance');assert.equal(c.ratio,.85);for(let i=0;i<1000;i++)c.sample(40,i*40,20);assert.equal(c.ratio,.85);
  c.setQuality('sharp');assert.equal(c.ratio,1.25);assert.equal(c.setQuality('invalid'),false);assert.equal(c.quality,'sharp');
});
test('low-DPR resolution respects the device cap, never scales above the requested maximum',()=>{
  const c=createResolutionController(.6);assert.equal(c.ratio,.6);for(let i=0;i<500;i++)c.sample(40,i*40,20);assert.equal(c.ratio,.6);
  c.sample(Infinity,10);c.reset();assert.equal(c.ratio,.6);
});
test('remote smoothing is frame-rate invariant, wraps yaw the short way and never mutates authoritative state',()=>{
  const p={x:1,y:1,z:1,yaw:-Math.PI+.01,pitch:.5},source={...p};
  const a={x:0,y:0,z:0,yaw:Math.PI-.01,pitch:0},b={...a};
  for(let i=0;i<30;i++)interpolateRemote(a,p,1/30);for(let i=0;i<144;i++)interpolateRemote(b,p,1/144);
  for(const key of ['x','y','z','yaw','pitch'])near(a[key],b[key]);assert.ok(a.yaw>3);assert.deepEqual(p,source);
});
test('remote respawn/teleport snaps promptly instead of sliding through the map',()=>{
  const d={x:0,y:0,z:0,yaw:0},p={x:100,y:20,z:-50,yaw:2,pitch:1};interpolateRemote(d,p,1/60);
  assert.deepEqual(d,p);
});
function fixture(mode){
  const matrices=[new THREE.Matrix4().makeTranslation(2,3,4),new THREE.Matrix4().makeRotationZ(Math.PI/2)];
  const skin=createRigidSkinning(THREE,matrices,mode),g=new THREE.BufferGeometry();
  const spec={positions:[1,0,0,0,2,0,0,0,3],normals:[1,0,0,1,0,0,1,0,0],vertexBones:[0,1,0],normalBones:[1,0,1]};skin.geometry(g,spec);
  return {skin,g,spec,matrices};
}
test('GPU rigid skinning preserves source buffers, independent normal indices and column-major bone palette',()=>{
  const {skin,g,spec,matrices}=fixture('gpu');skin.update([{visible:true}]);
  assert.deepEqual([...g.attributes.position.array],spec.positions);assert.deepEqual([...g.attributes.goldsrcNormalBone.array],spec.normalBones);
  const version=g.attributes.position.version;matrices[0].makeTranslation(7,8,9);skin.update([{visible:true}]);assert.equal(g.attributes.position.version,version);
  const palette=skin.texture.image.data;const v=new THREE.Vector3().fromArray(spec.positions).applyMatrix4(new THREE.Matrix4().fromArray(palette,0));assert.deepEqual(v.toArray(),[8,8,9]);
  assert.equal(skin.texture.image.width,4);assert.equal(skin.texture.generateMipmaps,false);assert.equal(skin.texture.type,THREE.FloatType);
  let disposed=0;skin.texture.addEventListener('dispose',()=>disposed++);skin.dispose();skin.dispose();assert.equal(disposed,1);g.dispose();
});
test('GPU shader injection uses the same palette for every material, and separate position/normal bones',()=>{
  const {skin,g}=fixture('gpu'),a=new THREE.MeshBasicMaterial(),b=new THREE.MeshBasicMaterial();skin.material(a);skin.material(b);
  const shader=()=>({uniforms:{},vertexShader:'#include <beginnormal_vertex>\n#include <begin_vertex>'});
  const x=shader(),y=shader();a.onBeforeCompile(x);b.onBeforeCompile(y);
  assert.equal(x.uniforms.goldsrcBones.value,y.uniforms.goldsrcBones.value);assert.match(x.vertexShader,/goldsrcMatrix\(goldsrcVertexBone\)/);assert.match(x.vertexShader,/goldsrcMatrix\(goldsrcNormalBone\)/);
  assert.match(x.vertexShader,/texelFetch/);assert.equal(a.customProgramCacheKey(),b.customProgramCacheKey());skin.dispose();g.dispose();a.dispose();b.dispose();
});
test('CPU reference rigid skinning still deforms positions and independent normals correctly',()=>{
  const {skin,g}=fixture('cpu');skin.update([{visible:true}]);
  near(g.attributes.position.getX(0),3);near(g.attributes.position.getY(1),0);near(g.attributes.position.getX(1),-2);
  near(g.attributes.normal.getY(0),1);near(g.attributes.normal.getX(1),1);assert.equal(g.attributes.position.version,1);
  skin.dispose();g.dispose();
});
test('unsupported skinning modes fail explicitly instead of silently selecting another implementation',()=>{
  assert.throws(()=>createRigidSkinning(THREE,[new THREE.Matrix4()],'wasm'),/Unknown/);
});

test('frame telemetry exposes long frames and 1% lows instead of only a mean FPS',()=>{
 const m=createFrameMetrics(100);for(let i=0;i<99;i++)m.add(16,1,.2,.3);m.add(100,8,2,3);
 const r=m.snapshot();assert.equal(r.intervalMs.max,100);assert.equal(r.onePercentLowFps,10);assert.equal(r.cpuMs.max,8);assert.ok(r.estimatedFps>50);
 m.reset();assert.equal(m.snapshot().onePercentLowFps,0);
});
