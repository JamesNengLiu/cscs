import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createSmokeRenderer} from '../public/cs2-smoke-renderer.js';
import {createSmokeVolume} from '../public/cs2-smoke-field.js';

const cloud=patch=>createSmokeVolume({id:'smoke',x:0,y:0,z:0,radius:3.8,height:3.2,bornAt:0,endAt:18,...patch});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
function fixture(){
 const viewport=new THREE.Vector4(0,0,800,600),scissor=new THREE.Vector4(2,3,700,500),draws=[],targets=[];
 let target=null,scissorTest=true,failComposite=false;
 const renderer={autoClear:false,extensions:{has:()=>false},info:{programs:[]},
  getDrawingBufferSize:v=>v.set(800,600),getCurrentViewport:v=>v.copy(viewport),getViewport:v=>v.copy(viewport),getScissor:v=>v.copy(scissor),
  getScissorTest:()=>scissorTest,getRenderTarget:()=>target,setRenderTarget:value=>{target=value;},
  setViewport:value=>viewport.copy(value),setScissor:value=>scissor.copy(value),setScissorTest:value=>{scissorTest=value;},
  initRenderTarget:value=>targets.push(value),compile(){},
  render(scene){
   const uniforms=scene.children[0]?.material?.uniforms;
   if(failComposite&&uniforms?.uVolumes){failComposite=false;throw Error('fixture composite failed');}
   const values=uniforms?Object.fromEntries(Object.entries(uniforms).filter(([,u])=>!u.value?.isTexture).map(([key,u])=>[key,
    Array.isArray(u.value)?u.value.map(v=>v?.toArray?v.toArray():v):u.value?.toArray?u.value.toArray():ArrayBuffer.isView(u.value)?Array.from(u.value):u.value])):null;
   draws.push({scene,target,uniforms:values});
  }
 };
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,4/3,.1,100);camera.position.set(0,1.5,10);camera.lookAt(0,1.5,0);camera.updateMatrixWorld();
 const smoke=createSmokeRenderer(THREE,{renderer,scene,camera});
 return{renderer,scene,camera,smoke,draws,targets,viewport,scissor,failComposite(){failComposite=true;},uploaded:()=>draws.findLast(d=>d.uniforms?.uVolumes)?.uniforms};
}

test('simple smoke has no samples or particle detail and does no work without visible fog',()=>{
 const f=fixture();
 for(const [volumes,time]of [[[],1],[[cloud()],0],[[cloud()],18],[[cloud({z:100})],1]]){
  f.smoke.sync({smokes:volumes});assert.equal(f.smoke.render(time),false);assert.equal(f.draws.length,0);assert.equal(f.targets.length,0);
 }
 const d=f.smoke.diagnostics();assert.equal(d.mode,'simple-depth-fog');assert.equal(d.samples,0);assert.equal(d.detailedVolumes,0);assert.equal(d.maxDetailedVolumes,0);assert.equal(d.maxConservativeVolumes,32);assert.equal(d.extraDraws,0);assert.equal(d.bulletHoles,false);assert.equal(d.explosionClearing,false);
 f.smoke.dispose();assert.equal(f.smoke.render(1),false);
});

test('uniform fog retains authored footprint, vertical shape, growth and fade clocks',()=>{
 const f=fixture(),v=cloud(),before=structuredClone(v);f.smoke.sync({smokes:[v]});
 for(const [time,opacity,scale]of [[.325,.5,.6],[1,1,1],[17,.5,.6]]){
  assert.equal(f.smoke.render(time),true);const u=f.uploaded();assert.equal(u.uCount,1);
  near(u.uVolumes[0][0],0);near(u.uVolumes[0][1],1.44);near(u.uVolumes[0][2],0);near(u.uVolumes[0][3],3.8*scale);
  near(u.uShape[0][0],1.76*scale);near(u.uShape[0][1],opacity);
 }
 assert.deepEqual(v,before);assert.equal(f.smoke.render(18),false);assert.equal(f.smoke.diagnostics().targetAllocations,1);f.smoke.dispose();
});

test('crowded fog is bounded to 32 simple volumes and one composite regardless of count',()=>{
 const f=fixture(),volumes=Array.from({length:100},(_,i)=>cloud({id:'s'+i,x:i*.01}));f.smoke.sync({smokes:volumes});
 assert.equal(f.smoke.render(1),true);assert.equal(f.draws.length,2);const u=f.uploaded(),d=f.smoke.diagnostics();
 assert.equal(u.uCount,32);assert.equal(d.volumes,32);assert.equal(d.visibleVolumes,32);assert.equal(d.simpleVolumes,32);assert.equal(d.detailedVolumes,0);assert.equal(d.degradedVolumes,0);assert.equal(d.droppedVolumes,0);assert.equal(d.extraDraws,1);
 for(let i=0;i<32;i++){near(u.uVolumes[i][3],3.8);near(u.uShape[i][0],1.76);assert.equal(u.uShape[i][1],1);}
 assert.equal(f.smoke.render(2),true);assert.equal(f.draws.length,4);assert.equal(f.smoke.diagnostics().targetAllocations,1);f.smoke.dispose();
});

test('legacy holes and HE disturbance metadata cannot change the uploaded uniform fog',()=>{
 const f=fixture(),v=cloud(),dirty={...structuredClone(v),holes:[{id:'hole',from:{x:0,y:1.44,z:-6},to:{x:0,y:1.44,z:6},bornAt:1,endAt:2,radius:.2}],clears:[{id:'clear',position:{x:0,y:1.44,z:0},bornAt:1,endAt:2,radius:4.2}]};
 f.smoke.sync({smokes:[v]});f.smoke.render(1.5);const plain=f.uploaded();f.smoke.sync({smokes:[dirty]});
 f.smoke.shot({shotId:'confirmed-shot',from:{x:0,y:1.44,z:-6},to:{x:0,y:1.44,z:6},time:1.5});f.smoke.explode({kind:'hegrenade',id:'confirmed-he',x:0,y:1.44,z:0,time:1.5},1.5);
 assert.equal(f.smoke.render(1.5),true);assert.deepEqual(f.uploaded(),plain);assert.equal(dirty.holes.length,1);assert.equal(dirty.clears.length,1);assert.equal(v.endAt,18);f.smoke.dispose();
});

test('a composite failure restores the previous surface and all externally owned draw state',()=>{
 const f=fixture(),previous=new THREE.WebGLRenderTarget(16,16);f.renderer.setRenderTarget(previous);const beforeViewport=f.viewport.toArray(),beforeScissor=f.scissor.toArray();f.smoke.sync({smokes:[cloud()]});f.failComposite();
 assert.throws(()=>f.smoke.render(1),/composite failed/);assert.equal(f.renderer.getRenderTarget(),previous);assert.equal(f.renderer.autoClear,false);assert.equal(f.renderer.getScissorTest(),true);assert.deepEqual(f.viewport.toArray(),beforeViewport);assert.deepEqual(f.scissor.toArray(),beforeScissor);
 f.smoke.dispose();previous.dispose();
});

test('simple fog reuses its target, replaces it only on resize and disposes resources once',()=>{
 const f=fixture();f.smoke.prewarm();const first=f.smoke.target;let firstDisposals=0,lastDisposals=0;first.addEventListener('dispose',()=>firstDisposals++);f.smoke.sync({smokes:[cloud()]});
 for(let i=0;i<5;i++)assert.equal(f.smoke.render(1+i*.1),true);assert.equal(f.smoke.target,first);assert.equal(f.smoke.diagnostics().targetAllocations,1);assert.equal(f.smoke.resize(800,600),false);
 assert.equal(f.smoke.resize(640,400),true);assert.equal(firstDisposals,1);const last=f.smoke.target;last.addEventListener('dispose',()=>lastDisposals++);assert.notEqual(last,first);assert.equal(f.smoke.diagnostics().targetAllocations,2);
 f.smoke.dispose();f.smoke.dispose();assert.equal(lastDisposals,1);assert.equal(f.smoke.resize(800,600),false);assert.equal(f.smoke.render(2),false);
});
