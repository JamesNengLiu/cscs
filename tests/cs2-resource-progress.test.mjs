import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {fetchInflatedResource} from '../public/cs2-resource-format.js';

test('resource decoding reports monotonic decoded progress and still returns exact bytes',async()=>{
 const payload=Uint8Array.from({length:300000},(_,i)=>(i*31+7)%251),compressed=gzipSync(payload),chunks=[];
 for(let offset=0;offset<compressed.length;offset+=4096)chunks.push(compressed.subarray(offset,offset+4096));
 const body=new ReadableStream({pull(controller){const chunk=chunks.shift();if(chunk)controller.enqueue(chunk);else controller.close();}});
 const progress=[],result=await fetchInflatedResource({url:'/assets/cs2-optimized/progress.bin.gz',bytes:payload.length},{fetchResource:async()=>({ok:true,body}),onProgress:received=>progress.push(received)});
 assert.deepEqual(new Uint8Array(result.buffer),payload);assert.ok(progress.length>1);assert.equal(progress.at(-1),payload.length);
 assert.ok(progress.every((value,index)=>Number.isSafeInteger(value)&&value>0&&(index===0||value>progress[index-1])));
 // Progress reporting is optional.
 const again=await fetchInflatedResource({url:'/assets/cs2-optimized/progress.bin.gz',bytes:payload.length},{fetchResource:async()=>({ok:true,body:new Blob([compressed]).stream()})});
 assert.equal(again.buffer.byteLength,payload.length);
});
