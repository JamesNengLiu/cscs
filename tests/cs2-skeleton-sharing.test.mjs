import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {shareSkeletonPalettes} from '../public/cs2-skeleton-sharing.js';
import {disposeOwnedSkeletons} from '../public/cs2-resource-lifecycle.js';

function fixture(){
 const root=new THREE.Group(),hip=new THREE.Bone(),hand=new THREE.Bone();hip.add(hand);root.add(hip);hand.position.y=1;root.updateMatrixWorld(true);
 const inverse=[hip.matrixWorld.clone().invert(),hand.matrixWorld.clone().invert()];
 function mesh({bones=[hip,hand],inverses=inverse.map(m=>m.clone()),skeleton=null,bindX=0}={}){
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,1,0,1,1,0,0,0,0],3));geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute([0,1,0,0,1,0,0,0,0,1,0,0],4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute([.4,.6,0,0,.25,.75,0,0,1,0,0,0],4));
  const object=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial());object.bind(skeleton||new THREE.Skeleton(bones,inverses),new THREE.Matrix4().makeTranslation(bindX,0,0));root.add(object);return object;
 }
 return{root,hip,hand,inverse,mesh};
}

test('identical owned palettes share while per-mesh bind transforms and weighted deformation stay exact',()=>{
 const f=fixture(),a=f.mesh(),b=f.mesh({bindX:.25}),before=[a,b].map(m=>({bind:m.bindMatrix.clone()}));
 const expected=[];for(let frame=0;frame<20;frame++){f.hand.rotation.z=frame*.07;f.hip.position.x=frame*.01;f.root.updateMatrixWorld(true);expected.push([a,b].map(m=>{m.skeleton.update();return{inverse:m.bindMatrixInverse.toArray(),palette:[...m.skeleton.boneMatrices],vertices:Array.from({length:3},(_,i)=>m.applyBoneTransform(i,new THREE.Vector3().fromBufferAttribute(m.geometry.attributes.position,i)).toArray())};}));}
 let released=0;const old=b.skeleton;old.addEventListener?.('dispose',()=>released++);const dispose=old.dispose.bind(old);old.dispose=()=>{released++;dispose();};
 assert.deepEqual(shareSkeletonPalettes(f.root),{meshes:2,palettes:1,merged:1});assert.equal(a.skeleton,b.skeleton);assert.equal(released,1);
 for(let frame=0;frame<20;frame++){f.hand.rotation.z=frame*.07;f.hip.position.x=frame*.01;f.root.updateMatrixWorld(true);for(const [i,m]of [a,b].entries()){m.skeleton.update();assert.deepEqual([...m.skeleton.boneMatrices],expected[frame][i].palette);for(let v=0;v<3;v++)assert.deepEqual(m.applyBoneTransform(v,new THREE.Vector3().fromBufferAttribute(m.geometry.attributes.position,v)).toArray(),expected[frame][i].vertices[v]);assert.ok(m.bindMatrix.equals(before[i].bind));assert.deepEqual(m.bindMatrixInverse.toArray(),expected[frame][i].inverse);}}
});

test('different bone identity, bone order or inverse binds never merge',()=>{
 const f=fixture(),a=f.mesh(),separateHip=new THREE.Bone(),separateHand=new THREE.Bone();separateHip.add(separateHand);f.root.add(separateHip);
 const inverse=f.inverse.map(m=>m.clone());inverse[1].elements[12]+=.000001;
 const others=[f.mesh({bones:[separateHip,separateHand]}),f.mesh({bones:[f.hand,f.hip]}),f.mesh({inverses:inverse})];
 assert.deepEqual(shareSkeletonPalettes(f.root),{meshes:4,palettes:4,merged:0});for(const mesh of others)assert.notEqual(mesh.skeleton,a.skeleton);
});

test('separate actor clones and weapon bones stay independently animated and disposed',()=>{
 const a=fixture(),b=fixture(),ma=a.mesh(),mb=b.mesh();a.mesh();b.mesh();
 shareSkeletonPalettes(a.root);shareSkeletonPalettes(b.root);assert.notEqual(ma.skeleton,mb.skeleton);
 a.hand.rotation.x=.4;a.root.updateMatrixWorld(true);b.root.updateMatrixWorld(true);ma.skeleton.update();mb.skeleton.update();assert.notDeepEqual([...ma.skeleton.boneMatrices],[...mb.skeleton.boneMatrices]);
 let disposed=0;const original=ma.skeleton.dispose.bind(ma.skeleton);ma.skeleton.dispose=()=>{disposed++;original();};disposeOwnedSkeletons(a.root);assert.equal(disposed,1);assert.equal(mb.skeleton.bones[1],b.hand);
});

test('already shared meshes are idempotent and each discarded palette is released once',()=>{
 const f=fixture(),a=f.mesh(),b=f.mesh(),c=f.mesh({skeleton:b.skeleton});let disposed=0;const original=b.skeleton.dispose.bind(b.skeleton);b.skeleton.dispose=()=>{disposed++;original();};
 assert.deepEqual(shareSkeletonPalettes(f.root),{meshes:3,palettes:1,merged:1});assert.equal(disposed,1);assert.equal(a.skeleton,b.skeleton);assert.equal(b.skeleton,c.skeleton);assert.deepEqual(shareSkeletonPalettes(f.root),{meshes:3,palettes:1,merged:0});assert.equal(disposed,1);
});
