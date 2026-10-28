import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Game} from '../game.mjs';
import {CHARACTER_PRESETS,CHARACTER_BY_ID,DEFAULT_CHARACTER,selectCharacter} from '../public/characters-config.js';
const asset=path.resolve('public/assets/players');
const hash=data=>createHash('sha256').update(data).digest('hex');
test('characters: eight originals plus four custom T presets, no CT appearance spoofing',()=>{
  assert.equal(CHARACTER_PRESETS.length,12);assert.equal(new Set(CHARACTER_PRESETS.map(p=>p.id)).size,12);
  assert.equal(CHARACTER_PRESETS.filter(p=>p.face==='original').length,8);
  assert.equal(CHARACTER_PRESETS.filter(p=>p.face==='trump').length,4);
  for(const p of CHARACTER_PRESETS){assert.equal(selectCharacter(p.team,p.id),p.id);assert.equal(selectCharacter(p.team==='T'?'CT':'T',p.id),DEFAULT_CHARACTER[p.team==='T'?'CT':'T']);}
  for(const id of ['__proto__','constructor',null,{},123,'../../assets','terror_trump<script>'])assert.equal(selectCharacter('T',id),'terror_trump');
});
test('characters: server validates join intent, replicates cosmetic to opponents and preserves it on respawn',()=>{
  const g=new Game(),t=g.add('t','T','T','leet_trump'),ct=g.add('ct','CT','CT','terror_trump');g.begin();assert.equal(ct.character,'urban');assert.equal(t.character,'leet_trump');
  assert.equal(g.snapshot('ct').players.find(p=>p.id==='t').character,'leet_trump');g.input('t',{character:'urban',money:1e9});assert.equal(t.character,'leet_trump');assert.equal(t.money,10000);
  g.spawn(t);assert.equal(t.character,'leet_trump');
});
test('characters: original and custom cosmetics do not change authoritative movement, cash, HP or hitboxes',()=>{
  const games=['terror','terror_trump'].map(id=>{const g=new Game();g.add('t','T','T',id);g.add('ct','CT','CT','urban');g.begin();g.phase='live';g.endAt=1000;return g;});
  for(let i=0;i<90;i++)for(const g of games){g.input('t',{f:1,yaw:.4,pitch:0});g.step();}
  const fields=['x','y','z','vx','vy','vz','hp','armour','money','weapon','alive'];const states=games.map(g=>Object.fromEntries(fields.map(k=>[k,g.players.get('t')[k]])));assert.deepEqual(states[0],states[1]);
});
for(const base of ['terror','leet','arctic','guerilla'])test(`custom face ${base}: real base hashes, unchanged body/animation/hitboxes, actual 3D head`,{skip:!fs.existsSync(asset+'/manifest.json')},()=>{
  const manifest=JSON.parse(fs.readFileSync(asset+'/manifest.json')),a=manifest.models[base],b=manifest.models[base+'_trump'];assert.ok(b);const originalBytes=fs.readFileSync(path.join(asset,a.file)),customBytes=fs.readFileSync(path.join(asset,b.file));assert.equal(hash(originalBytes),a.convertedSHA256);assert.equal(hash(customBytes),b.convertedSHA256);
  const original=JSON.parse(originalBytes),custom=JSON.parse(customBytes);assert.equal(custom.metadata.source,'custom-trump-face');assert.equal(custom.metadata.baseSourceSHA256,a.sourceSHA256);assert.equal(custom.metadata.baseConvertedSHA256,a.convertedSHA256);assert.equal(custom.metadata.customFace.fictionalCosmetic,true);assert.equal(custom.metadata.customFace.bodyUnmodified,true);
  assert.deepEqual(custom.bones,original.bones);assert.deepEqual(custom.hitboxes,original.hitboxes);assert.deepEqual(custom.sequences,original.sequences);
  const head=new Set(custom.metadata.customFace.headBones);let bodyTriangles=0;
  for(let i=0;i<original.meshes.length;i++){
    const source=original.meshes[i],expected=[];
    for(let j=0;j<source.indices.length;j+=3){const tri=source.indices.slice(j,j+3);if(!tri.every(v=>head.has(source.vertexBones[v])))expected.push(...tri);}
    const actual=custom.meshes.find(m=>m.baseMeshIndex===i);
    if(expected.length){assert.ok(actual);for(const key of ['positions','normals','vertexBones','normalBones','uvPixels','skinref'])assert.deepEqual(actual[key],source[key]);assert.deepEqual(actual.indices,expected);bodyTriangles+=expected.length/3;}else assert.equal(actual,undefined);
  }
  assert.ok(bodyTriangles>400);const added=custom.meshes.filter(m=>m.customHead);assert.equal(added.length,2);assert.equal(added.reduce((n,m)=>n+m.indices.length/3,0),custom.metadata.customFace.headTriangles);assert.ok(custom.metadata.customFace.headTriangles>1000);assert.equal(custom.metadata.customFace.hasEarGeometry,true);for(const mesh of added){assert.ok(mesh.indices.length>=3);assert.ok(mesh.vertexBones.every(bone=>head.has(bone)));for(let axis=0;axis<3;axis++){const coords=mesh.positions.filter((_,i)=>i%3===axis);assert.ok(Math.max(...coords)-Math.min(...coords)>1);}}
  for(let i=0;i<original.textures.length;i++){assert.equal(hash(fs.readFileSync(path.join(asset,base,original.textures[i].file))),hash(fs.readFileSync(path.join(asset,base+'_trump',custom.textures[i].file))));}
  assert.equal(custom.textures.length,original.textures.length+2);assert.equal(CHARACTER_BY_ID[base+'_trump'].team,'T');
});
