// CPU-only audit of the real knife mesh and native model loading policy.
// No HTTP, renderer, browser, GPU, or original resource mutation is used.
import fs from 'node:fs/promises';
import path from 'node:path';
import {webcrypto} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {createNativeActors} from '../public/cs2-native-actors.js';
import {verticalFov} from '../public/view-settings.js';
import {createViewmodelCamera,applyClassicViewmodelPose} from '../public/cs2-viewmodel-presentation.js';

const project=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(await fs.readFile(path.join(project,'public/assets/cs2-content/runtime.json'),'utf8'));
const cache=new Map(),loader=new GLTFLoader();
globalThis.ProgressEvent??=class ProgressEvent{constructor(type,properties={}){this.type=type;Object.assign(this,properties);}};
globalThis.crypto??=webcrypto;
globalThis.location={href:'https://cs2-offline.invalid/'};
async function localBytes(url){
  const pathname=new URL(String(url),location.href).pathname;
  return fs.readFile(path.join(project,'public',decodeURIComponent(pathname)));
}
const nativeFetch=globalThis.fetch;
globalThis.fetch=async url=>{
  const value=typeof url==='string'||url instanceof URL?String(url):url.url;
  if(value.startsWith('data:'))return nativeFetch(url);
  return new Response(await localBytes(value));
};
const parseAsync=loader.parseAsync.bind(loader);
GLTFLoader.prototype.loadAsync=async function(url){
  if(cache.has(url))return cache.get(url);
  const pending=(async()=>{
    const document=JSON.parse(await localBytes(url));
    for(const buffer of document.buffers||[])if(buffer.uri&&!buffer.uri.startsWith('data:')){
      const bytes=await localBytes(new URL(buffer.uri,new URL(String(url),location.href)));
      buffer.uri='data:application/octet-stream;base64,'+bytes.toString('base64');
    }
    delete document.materials;delete document.images;delete document.textures;delete document.samplers;
    for(const mesh of document.meshes||[])for(const primitive of mesh.primitives||[])delete primitive.material;
    return parseAsync(JSON.stringify(document),'');
  })();cache.set(url,pending);return pending;
};

const content=await createNativeActors(THREE,{manifest,renderer:{async compileAsync(){}},camera:new THREE.PerspectiveCamera(),scene:new THREE.Scene()});
const arms=await content.loadModel('arms'),knife=await content.loadModel('knife');
const sourceMeshes=[];knife.gltf.scene.traverse(mesh=>{if(mesh.isMesh)sourceMeshes.push({name:mesh.name,visible:mesh.visible,vertices:mesh.geometry.attributes.position.count});});
const worldCamera=new THREE.PerspectiveCamera(verticalFov(90,16/9),16/9,.06,450);
const presentation=createViewmodelCamera(THREE,worldCamera),camera=presentation.camera;
presentation.sync();
const point=new THREE.Vector3(),ndc=new THREE.Vector3();
function statistics(root){
  const bounds=new THREE.Box3(),projection=new THREE.Box3();let total=0,inFrontOfNearPlane=0,insideFrustum=0,visibleInsideFrustum=0;
  root.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    mesh.skeleton.update();let visible=true;for(let node=mesh;node;node=node.parent)visible&&=node.visible;
    for(let i=0;i<mesh.geometry.attributes.position.count;i++){
      mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld);bounds.expandByPoint(point);total++;
      ndc.copy(point).project(camera);projection.expandByPoint(ndc);
      if(point.z<=-camera.near)inFrontOfNearPlane++;
      if(point.z<=-camera.near&&Math.abs(ndc.x)<=1&&Math.abs(ndc.y)<=1&&Math.abs(ndc.z)<=1){insideFrustum++;if(visible)visibleInsideFrustum++;}
    }
  });
  return {total,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},ndc:{min:projection.min.toArray(),max:projection.max.toArray()},inFrontOfNearPlane,insideFrustum,visibleInsideFrustum};
}
const results=[];
for(const action of ['draw','idle','light','heavy']){
  const clipEntry=manifest.clips.find(entry=>entry.key===knife.entry.viewmodelActions[action]);
  const source=await loader.loadAsync(clipEntry.url),clip=(source.animations.find(clip=>clip.name===clipEntry.name)||source.animations[0]).clone();
  const outer=new THREE.Group(),container=new THREE.Group(),assembly=new THREE.Group(),arm=cloneSkeleton(arms.gltf.scene),weapon=cloneSkeleton(knife.gltf.scene);
  applyClassicViewmodelPose(outer);container.position.set(-.25,.24,.42);container.rotation.y=Math.PI;outer.add(container);container.add(assembly);assembly.add(arm);
  weapon.quaternion.set(.5,.5,.5,.5);arm.getObjectByName('wpn').add(weapon);
  const missing=clip.tracks.filter(track=>!assembly.getObjectByName(track.name.slice(0,track.name.lastIndexOf('.')))).map(track=>track.name);
  clip.tracks=clip.tracks.filter(track=>assembly.getObjectByName(track.name.slice(0,track.name.lastIndexOf('.'))));
  const mixer=new THREE.AnimationMixer(assembly),running=mixer.clipAction(clip);running.setLoop(THREE.LoopOnce,1);running.clampWhenFinished=true;running.play();
  const frames=[];
  for(const fraction of [0,.25,.5,.75,.99999]){
    mixer.setTime(clip.duration*fraction);outer.updateMatrixWorld(true);
    frames.push({fraction,time:clip.duration*fraction,...statistics(weapon)});
  }
  results.push({action,clip:clipEntry.key,secondarySkeletons:clipEntry.secondarySkeletons,missingTracks:missing,frames});
}
console.log(JSON.stringify({schema:'cscs.cs2.knife-visibility-audit.v1',camera:presentation.diagnostics(),modelSource:knife.entry.source,meshesAfterNativeLoader:sourceMeshes,assembly:'classic presentation -> Y rotation PI -> arms.wpn -> Qinv(.5,.5,.5,.5) -> knife',results},null,2));
