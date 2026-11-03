import test from 'node:test';import assert from 'node:assert/strict';
import {parseModelJSON,consumeCooperatively,decodeModelUTF8} from '../public/cooperative-json.js';
import {validatePlayerModel,validatePlayerModelSteps} from '../public/player-asset-validation.js';
import {packPlayerAsset,packPlayerAssetSteps} from '../public/player-asset-format.js';
import {playerAssetFixture,FIXTURE_PLAYER_SHA} from './fixtures/player-asset-model.mjs';
const options={yieldTask:()=>Promise.resolve(),budgetMs:3};
for(const text of ['null','true','false','-0','1e400','-12.25e-3','"测试\\n\\uD83D\\uDE00"','[]','[1,-0,true,null,false,1e400]','{}','{"a":[1,null,true,{"x":"}:[,"}],"a":2}','{"__proto__":{"polluted":true},"constructor":3}'])test('cooperative JSON matches native: '+text.slice(0,40),async()=>{
 const result=await parseModelJSON(text,options);assert.deepEqual(result.value,JSON.parse(text));assert.equal(Object.prototype.polluted,undefined);
});
for(const text of ['', '[1,]','{"x":1,}','[1 2]','{"x" 1}','{"x":}','true false','[}','01','1.','+1','NaN','"bad\nline"','{"x":"\\q"}','falsex','[1e]'])test('cooperative JSON rejects malformed grammar: '+JSON.stringify(text),async()=>{await assert.rejects(parseModelJSON(text,options),SyntaxError);});
test('cooperative parsing yields and cancellation releases unpublished work',async()=>{
 const text=JSON.stringify(Array.from({length:20000},(_,i)=>i-10000));let yields=0;const result=await parseModelJSON(text,{budgetMs:.00001,yieldTask:async()=>{yields++;}});assert.ok(yields>10);assert.equal(result.value.length,20000);let cancelled=false;await assert.rejects(parseModelJSON(text,{budgetMs:.00001,yieldTask:async()=>{cancelled=true;},cancelled:()=>cancelled}),/cancelled/);
});
test('model parser enforces token/depth budgets and streaming fatal UTF-8 decoding',async()=>{
 await assert.rejects(parseModelJSON('"'+'x'.repeat(65537)+'"',options),/token budget/);await assert.rejects(parseModelJSON('['.repeat(129)+'0'+']'.repeat(129),options),/nesting/);
 const text='{"unicode":"测试😀"}',bytes=new TextEncoder().encode(text);assert.equal((await consumeCooperatively(decodeModelUTF8(bytes),options)).value,text);await assert.rejects(consumeCooperatively(decodeModelUTF8(new Uint8Array([0xff])),options),/encoded|valid|UTF/i);
});
test('native fast paths stay bounded while large nested sample documents remain exact',async()=>{
 const value={channels:Array.from({length:1200},(_,i)=>({values:Array.from({length:240},(_,j)=>(i*317+j*97)%65536-32768)}))},text=JSON.stringify(value),native=JSON.parse,calls=[];let result;
 try{JSON.parse=(source,...args)=>{calls.push(source.length);return native(source,...args);};result=await parseModelJSON(text,options);}finally{JSON.parse=native;}
 assert.ok(text.length>1000000);assert.ok(calls.length>1200);assert.ok(calls.every(n=>n<=65536));assert.deepEqual(result.value,value);
});
test('cooperative validator and packer preserve exact buffers and reject the same bad models',async()=>{
 const entry={source:'original-mdl',sourceSHA256:FIXTURE_PLAYER_SHA},raw=playerAssetFixture();validatePlayerModel(raw,'terror',entry,false);await consumeCooperatively(validatePlayerModelSteps(raw,'terror',entry,false),options);const native=packPlayerAsset(raw),other=(await consumeCooperatively(packPlayerAssetSteps(raw),options)).value;assert.deepEqual(other,native);
 for(const mutate of [x=>x.meshes[0].positions[0]=NaN,x=>x.meshes[0].vertexBones[0]=999,x=>x.sequences[0].tracks[0][0].values[0]=40000,x=>x.metadata.source='fake',x=>x.meshes[0].indices[0]=9999]){const bad=structuredClone(raw);mutate(bad);assert.throws(()=>validatePlayerModel(bad,'terror',entry,false));await assert.rejects(consumeCooperatively(validatePlayerModelSteps(bad,'terror',entry,false),options));}
});
