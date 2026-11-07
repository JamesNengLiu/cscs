import test from 'node:test';
import assert from 'node:assert/strict';
import {sourcePointToMeters,metersPointToSource,sourceAnglesToView,createWorldContract,assertWorldCompatible,SOURCE_UNIT_METRES,LEGACY_METER_RULES_VERSION} from '../public/experimental-world-contract.js';

const identity=()=>createWorldContract({sourceSHA1:'7dc529cd65d843a2b8a98c297e79b9923dd70a5d',collisionSHA256:'c'.repeat(64)});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);

test('Source geometry converts once to metre space with the same axis mapping as the accepted map',()=>{
 assert.equal(SOURCE_UNIT_METRES,.0254);
 assert.deepEqual(sourcePointToMeters([100,200,300]),{x:5.08,y:7.62,z:2.54});
 for(const point of [[-1200,500,128],[0,0,0],[.03125,-.5,2048.125]])metersPointToSource(sourcePointToMeters(point)).forEach((value,i)=>near(value,point[i]));
 assert.throws(()=>sourcePointToMeters([Infinity,0,0]),/finite/);assert.throws(()=>metersPointToSource({x:1,y:0}),/finite/);
});
test('spawn angles produce the same forward direction as Source axes, using the gameplay yaw convention',()=>{
 for(const [pitch,yaw] of [[0,0],[0,90],[0,-90],[25,43],[-45,180]]){
  const view=sourceAnglesToView([pitch,yaw,0]),p=pitch*Math.PI/180,y=yaw*Math.PI/180;
  const actual=[-Math.sin(view.yaw)*Math.cos(view.pitch),Math.sin(view.pitch),-Math.cos(view.yaw)*Math.cos(view.pitch)];
  const expected=[Math.sin(y)*Math.cos(p),-Math.sin(p),Math.cos(y)*Math.cos(p)];actual.forEach((value,i)=>near(value,expected[i]));
 }
});
test('experimental identity carries real map/collision and transitional rule versions without changing legacy defaults',()=>{
 const c=identity();assert.equal(c.rulesVersion,LEGACY_METER_RULES_VERSION);assert.ok(Object.isFrozen(c));assert.equal(assertWorldCompatible(c,JSON.parse(JSON.stringify(c))),true);
 for(const [key,value]of [['mapId','de_dust2-bsp30'],['sourceSHA1','d'.repeat(40)],['collisionSHA256','e'.repeat(64)],['collisionVersion',2],['rulesVersion','cs2-calibrated-v2'],['coordinateBasis','source-XZY'],['metresPerSourceUnit',.025],['protocol','lan-strike-wt-v1']]){
  assert.throws(()=>assertWorldCompatible(c,{...c,[key]:value}),new RegExp(key));
 }
});
test('missing, forged, or partial contracts cannot silently match an empty/default world',()=>{
 for(const candidate of [null,{},[],{...identity(),collisionSHA256:'bad'}])assert.throws(()=>assertWorldCompatible(identity(),candidate),/mismatch/);
 assert.throws(()=>assertWorldCompatible({},{}),/missing/);
 assert.throws(()=>createWorldContract({mapId:'../legacy',sourceSHA1:'a'.repeat(40),collisionSHA256:'b'.repeat(64)}),/map ID/);
});
