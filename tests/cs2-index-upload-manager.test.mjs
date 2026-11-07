import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapIndexUploadManager} from '../public/cs2-index-upload.js';

function fixture(){
 const calls=[],stores=new Map(),bindings=new Map(),canvas=new EventTarget();
 const gl={canvas,ELEMENT_ARRAY_BUFFER:0x8893,ARRAY_BUFFER:0x8892,DYNAMIC_DRAW:0x88e8,STATIC_DRAW:0x88e4,
  bindBuffer(target,buffer){assert.equal(this,gl);bindings.set(target,buffer);},
  bufferData(...args){assert.equal(this,gl);const [target,size,usage]=args,buffer=bindings.get(target);calls.push({kind:'data',args,buffer});stores.set(buffer,new Uint8Array(size));},
  bufferSubData(...args){assert.equal(this,gl);const [target,offset,source,sourceOffset=0,count=source?.length-sourceOffset]=args,buffer=bindings.get(target);calls.push({kind:'sub',args,buffer});
   // Invalid API arguments are deliberately left for the original method. The
   // mock records their exact identity instead of inventing browser GL errors.
   const used=count===0?source?.length-sourceOffset:count;
   if(ArrayBuffer.isView(source)&&Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(sourceOffset)&&sourceOffset>=0&&Number.isSafeInteger(used)&&used>=0&&sourceOffset+used<=source.length){const bytes=new Uint8Array(source.buffer,source.byteOffset+sourceOffset*source.BYTES_PER_ELEMENT,used*source.BYTES_PER_ELEMENT),storage=stores.get(buffer);if(storage&&offset+bytes.byteLength<=storage.length)storage.set(bytes,offset);}
   return 'original-result';}
 };
 const buffer={name:'current-map-buffer'};gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);stores.set(buffer,new Uint8Array(64).fill(77));
 return{gl,buffer,calls,stores,bindings,canvas};
}

test('orphaning retains the bound buffer, capacity, usage and exact drawn index prefix',()=>{
 const f=fixture(),{gl}=f,indices=new Uint32Array([2,1,0,0,1,3,999,999]),before=indices.slice(),drawRange={start:0,count:6};
 const manager=createMapIndexUploadManager({gl});assert.equal(manager.register(indices),true);
 assert.equal(gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER,0,indices,0,drawRange.count),'original-result');
 assert.deepEqual(f.calls.map(c=>c.kind),['data','sub']);assert.deepEqual(f.calls[0].args,[gl.ELEMENT_ARRAY_BUFFER,indices.byteLength,gl.DYNAMIC_DRAW]);
 assert.ok(f.calls.every(c=>c.buffer===f.buffer));assert.equal(f.bindings.get(gl.ELEMENT_ARRAY_BUFFER),f.buffer);assert.equal(f.stores.get(f.buffer).byteLength,indices.byteLength);
 assert.deepEqual([...new Uint32Array(f.stores.get(f.buffer).buffer).subarray(0,drawRange.count)],[2,1,0,0,1,3]);
 assert.deepEqual(indices,before);assert.equal(drawRange.count,6);manager.close();
});

test('Uint16 storage and unusual call receivers retain the native bound-this protocol',()=>{
 const f=fixture(),indices=new Uint16Array([0,1,2,99,99]),manager=createMapIndexUploadManager({gl:f.gl});manager.register(indices);
 assert.equal(f.gl.bufferSubData.call({wrongReceiver:true},f.gl.ELEMENT_ARRAY_BUFFER,0,indices,0,3),'original-result');
 assert.equal(f.calls[0].args[1],10);assert.equal(f.calls[1].args[4],3);assert.deepEqual([...new Uint16Array(f.stores.get(f.buffer).buffer).subarray(0,3)],[0,1,2]);manager.close();
});

test('unregistered, other-target, partial, invalid and other-usage updates pass through unchanged',()=>{
 const f=fixture(),{gl}=f,indices=new Uint32Array(8),foreign=new Uint32Array(8),staticIndices=new Uint32Array(8),manager=createMapIndexUploadManager({gl});manager.register(indices);manager.register(staticIndices,{usage:gl.STATIC_DRAW});
 const cases=[
  [gl.ARRAY_BUFFER,0,indices,0,3],[gl.ELEMENT_ARRAY_BUFFER,0,foreign,0,3],[gl.ELEMENT_ARRAY_BUFFER,0,staticIndices,0,3],
  [gl.ELEMENT_ARRAY_BUFFER,0,indices],[gl.ELEMENT_ARRAY_BUFFER,4,indices,0,3],[gl.ELEMENT_ARRAY_BUFFER,0,indices,1,3],
  ...[0,-1,1.5,NaN,Infinity,9,'3'].map(count=>[gl.ELEMENT_ARRAY_BUFFER,0,indices,0,count]),
  [gl.ELEMENT_ARRAY_BUFFER,0,indices,0,3,'extra'],[gl.ELEMENT_ARRAY_BUFFER,0,null,0,3]
 ];
 for(const args of cases){f.calls.length=0;assert.equal(gl.bufferSubData(...args),'original-result');assert.equal(f.calls.length,1);assert.equal(f.calls[0].kind,'sub');assert.deepEqual(f.calls[0].args,args);}
 assert.throws(()=>manager.register(new Float32Array(4)),TypeError);manager.close();
});

test('a detached registered array with changed byteLength/length is never orphaned',()=>{
 const f=fixture(),indices=new Uint32Array(8),manager=createMapIndexUploadManager({gl:f.gl});manager.register(indices);
 structuredClone(indices.buffer,{transfer:[indices.buffer]});assert.equal(indices.byteLength,0);assert.equal(indices.length,0);
 f.gl.bufferSubData(f.gl.ELEMENT_ARRAY_BUFFER,0,indices,0,3);assert.deepEqual(f.calls.map(c=>c.kind),['sub']);assert.equal(f.calls[0].args[2],indices);manager.close();
});

test('close is idempotent, restores the exact method and disables retained wrappers',()=>{
 const f=fixture(),original=f.gl.bufferSubData,manager=createMapIndexUploadManager({gl:f.gl}),retained=f.gl.bufferSubData,indices=new Uint32Array(3);manager.register(indices);
 assert.equal(manager.close(),true);assert.equal(manager.close(),false);assert.equal(f.gl.bufferSubData,original);assert.equal(manager.register(indices),false);
 retained(f.gl.ELEMENT_ARRAY_BUFFER,0,indices,0,3);assert.deepEqual(f.calls.map(c=>c.kind),['sub']);
});

test('close preserves a later external wrapper while making the inner wrapper a pass-through',()=>{
 const f=fixture(),manager=createMapIndexUploadManager({gl:f.gl}),inner=f.gl.bufferSubData,indices=new Uint32Array(3);let externalCalls=0;manager.register(indices);
 const external=function(...args){externalCalls++;return inner.apply(this,args);};f.gl.bufferSubData=external;manager.close();
 assert.equal(f.gl.bufferSubData,external);f.gl.bufferSubData(f.gl.ELEMENT_ARRAY_BUFFER,0,indices,0,3);assert.equal(externalCalls,1);assert.deepEqual(f.calls.map(c=>c.kind),['sub']);
});

test('context loss and abort close the instance; already-aborted signals install nothing',()=>{
 for(const event of ['contextlost','abort']){
  const f=fixture(),controller=new AbortController(),original=f.gl.bufferSubData,manager=createMapIndexUploadManager({gl:f.gl,signal:controller.signal}),indices=new Uint32Array(3);manager.register(indices);
  if(event==='contextlost')f.canvas.dispatchEvent(new Event('webglcontextlost'));else controller.abort();
  assert.equal(f.gl.bufferSubData,original);assert.equal(manager.close(),false);assert.equal(manager.register(indices),false);
 }
 const f=fixture(),controller=new AbortController(),original=f.gl.bufferSubData;controller.abort();const manager=createMapIndexUploadManager({gl:f.gl,signal:controller.signal});
 assert.equal(f.gl.bufferSubData,original);assert.equal(manager.close(),false);assert.equal(manager.register(new Uint32Array(3)),false);
});

test('only the owned GL instance changes and inherited methods restore without an own property',()=>{
 const f=fixture(),other=fixture(),otherOriginal=other.gl.bufferSubData,original=f.gl.bufferSubData,prototype={bufferSubData:original};
 delete f.gl.bufferSubData;Object.setPrototypeOf(f.gl,prototype);assert.equal(Object.hasOwn(f.gl,'bufferSubData'),false);
 const manager=createMapIndexUploadManager({gl:f.gl});assert.equal(other.gl.bufferSubData,otherOriginal);assert.equal(prototype.bufferSubData,original);
 manager.close();assert.equal(Object.hasOwn(f.gl,'bufferSubData'),false);assert.equal(f.gl.bufferSubData,original);
});
