import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderSurface} from '../public/render-surface.js';
function fixture(ratio=1.25,width=1280,height=800){
 const canvas={width:300,height:150,style:{},dataset:{}},calls=[];let dpr=1,w=300,h=150;
 const renderer={setPixelRatio(v){calls.push(['allocateRatio',v]);dpr=v;this.setSize(w,h,false);},setSize(x,y){calls.push(['allocateSize',x,y]);w=x;h=y;canvas.width=Math.floor(w*dpr);canvas.height=Math.floor(h*dpr);},setViewport(...v){this.viewport=v;},setScissor(...v){this.scissor=v;},setScissorTest(v){this.scissorTest=v;}};
 const surface=createRenderSurface(renderer,canvas,{width,height,ratio});return {surface,renderer,canvas,calls,get dpr(){return dpr;}};
}
test('automatic scale changes reuse the same backbuffer without canvas allocations or new draw passes',()=>{
 const f=fixture(),count=f.calls.length,buffer=[f.canvas.width,f.canvas.height];for(const ratio of [1,.85,.7,.85,1,1.25])assert.equal(f.surface.setRatio(ratio),true);
 assert.equal(f.calls.length,count);assert.deepEqual([f.canvas.width,f.canvas.height],buffer);assert.equal(f.surface.capacityRatio,1.25);assert.equal(f.renderer.scissorTest,true);assert.deepEqual(f.renderer.scissor,f.renderer.viewport);
});
for(const capacity of [.6,1,1.25])test(`viewport corners and center map to the same CSS screen at capacity ${capacity}`,()=>{
 const f=fixture(capacity,1281,801);for(const ratio of [capacity,Math.min(capacity,.85),Math.min(capacity,.7)]){
  f.surface.setRatio(ratio);const rect=f.surface.diagnostics(),screenWidth=parseFloat(f.canvas.style.width)*rect.viewport.width/f.canvas.width,screenHeight=parseFloat(f.canvas.style.height)*rect.viewport.height/f.canvas.height;
  assert.ok(Math.abs(screenWidth-1281)<1e-9);assert.ok(Math.abs(screenHeight-801)<1e-9);assert.equal(f.canvas.style.bottom,'0px');assert.equal(f.canvas.style.top,'auto');assert.equal(f.canvas.dataset.renderRatio,String(ratio));assert.equal(Math.round(f.renderer.viewport[2]*capacity),rect.viewport.width);
 }
});
test('capacity grows only through an explicit manual change; automatic requests cannot allocate',()=>{
 const f=fixture(.85),count=f.calls.length;assert.equal(f.surface.setRatio(1.25),false);assert.equal(f.calls.length,count);assert.equal(f.surface.setRatio(1.25,{allowGrowth:true}),true);assert.equal(f.surface.capacityRatio,1.25);
 const grown=f.calls.length;f.surface.setRatio(.7);assert.equal(f.calls.length,grown);assert.equal(f.surface.capacityRatio,1.25);
});
test('window resize preserves the chosen active scale and updates CSS/viewport geometry',()=>{
 const f=fixture();f.surface.setRatio(.7);f.surface.resize(760,560);assert.equal(f.surface.ratio,.7);assert.deepEqual(f.surface.diagnostics().viewport,{width:532,height:392});assert.equal(f.canvas.width,950);assert.equal(f.canvas.height,700);
});
test('invalid or unchanged ratios do not allocate or alter the valid viewport',()=>{
 const f=fixture(),old=structuredClone(f.surface.diagnostics()),calls=f.calls.length;for(const value of [NaN,Infinity,0,-1,undefined])assert.equal(f.surface.setRatio(value),false);assert.equal(f.surface.setRatio(1.25),false);assert.equal(f.calls.length,calls);assert.deepEqual(f.surface.diagnostics(),old);
});
