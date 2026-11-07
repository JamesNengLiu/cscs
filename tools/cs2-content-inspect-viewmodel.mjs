// Offline coordinate audit: strips rendering materials only in memory, embeds
// verified local buffers, and never changes the actual Source2-derived assets.
import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';

globalThis.ProgressEvent??=class ProgressEvent{constructor(type,properties={}){this.type=type;Object.assign(this,properties);}};
const root=path.resolve(import.meta.dirname,'..'),assets=path.join(root,'public/assets/cs2-content');
const manifest=JSON.parse(await fs.readFile(path.join(assets,'manifest.json'),'utf8'));
const models=new Map(manifest.models.map(row=>[row.key,row])),clips=new Map(manifest.clips.map(row=>[row.key,row]));
const loader=new GLTFLoader(),cache=new Map();
async function load(url){
  if(cache.has(url))return cache.get(url);
  const promise=(async()=>{
    const filename=path.join(root,'public',url),gltf=JSON.parse(await fs.readFile(filename,'utf8'));
    for(const buffer of gltf.buffers||[])if(buffer.uri&&!buffer.uri.startsWith('data:')){
      const data=await fs.readFile(path.join(path.dirname(filename),buffer.uri));
      buffer.uri='data:application/octet-stream;base64,'+data.toString('base64');
    }
    delete gltf.materials;delete gltf.images;delete gltf.textures;delete gltf.samplers;
    for(const mesh of gltf.meshes||[])for(const primitive of mesh.primitives||[])delete primitive.material;
    return loader.parseAsync(JSON.stringify(gltf),'');
  })();cache.set(url,promise);return promise;
}
const vector=node=>node?node.getWorldPosition(new THREE.Vector3()).toArray():null;
function attachment(root,entry){
  if(!entry||entry.m_nInfluences!==1)return null;
  const bone=root.getObjectByName(entry.m_influenceNames[0]);if(!bone)return null;
  const offset=new THREE.Vector3().fromArray(entry.m_vInfluenceOffsets[0]).multiplyScalar(.0254).applyMatrix4(bone.matrixWorld);
  const rotation=bone.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().fromArray(entry.m_vInfluenceRotations[0]));
  return {position:offset.toArray(),direction:new THREE.Vector3(1,0,0).applyQuaternion(rotation).normalize().toArray()};
}
function skinnedBounds(root){
  const bounds=new THREE.Box3(),vertex=new THREE.Vector3();let vertices=0,behindCamera=0;
  root.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    mesh.skeleton.update();
    for(let i=0;i<mesh.geometry.attributes.position.count;i++){
      mesh.getVertexPosition(i,vertex).applyMatrix4(mesh.matrixWorld);bounds.expandByPoint(vertex);vertices++;
      if(vertex.z>=-.03)behindCamera++;
    }
  });
  return {min:bounds.min.toArray(),max:bounds.max.toArray(),vertices,behindNearPlaneFraction:behindCamera/vertices};
}
function handContact(arm,weapon){
  const hand=[],gun=[],point=new THREE.Vector3();
  arm.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;mesh.skeleton.update();
    const joints=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
    if(!joints||!weights)return;
    for(let i=0;i<joints.count;i++){
      let weight=0;
      for(let c=0;c<4;c++){
        const bone=mesh.skeleton.bones[joints.getComponent(i,c)]?.name||'';
        if(bone==='hand_R'||bone.startsWith('finger_')&&bone.endsWith('_R'))weight+=weights.getComponent(i,c);
      }
      if(weight>=.5){mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld);hand.push(point.clone());}
    }
  });
  if(!hand.length)return null;
  const box=new THREE.Box3().setFromPoints(hand).expandByScalar(.1);
  weapon.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;mesh.skeleton.update();
    for(let i=0;i<mesh.geometry.attributes.position.count;i++){
      mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld);if(box.containsPoint(point))gun.push(point.clone());
    }
  });
  if(!gun.length)return {handVertices:hand.length,nearbyGunVertices:0};
  const nearest=[];
  for(let i=0;i<hand.length;i+=Math.max(1,Math.floor(hand.length/250))){
    let closest=Infinity;for(const target of gun)closest=Math.min(closest,hand[i].distanceToSquared(target));nearest.push(Math.sqrt(closest));
  }
  nearest.sort((a,b)=>a-b);
  return {handVertices:hand.length,nearbyGunVertices:gun.length,minSurfaceGap:nearest[0],
    quartileSurfaceGap:nearest[Math.floor(nearest.length*.25)],medianSurfaceGap:nearest[Math.floor(nearest.length*.5)]};
}
const armsEntry=models.get('arms'),arms=await load(armsEntry.url),results=[];
const arguments_=process.argv.slice(2),outputOption=arguments_.find(value=>value.startsWith('--output='));
const outputName=outputOption?outputOption.slice(9):'viewmodel-coordinate-report.json';
if(!/^[a-zA-Z0-9_.-]+\.json$/.test(outputName))throw Error('Audit output must be a local JSON basename');
const keys=arguments_.filter(value=>!value.startsWith('--output='));if(!keys.length)keys.push('ak47','awp','usp_silencer');
for(const key of keys){
  const entry=models.get(key),source=await load(entry.url),metadata=JSON.parse(await fs.readFile(path.join(root,'public',entry.metadata),'utf8'));
  for(const action of ['idle','draw','fire','reload','zoomIdle','zoomFire']){
    const clipEntry=clips.get(entry.viewmodelActions?.[action]);if(!clipEntry)continue;
    const clipSource=await load(clipEntry.url),sourceClip=clipSource.animations.find(row=>row.name===clipEntry.name)||clipSource.animations[0];
    const container=new THREE.Group(),assembly=new THREE.Group(),arm=cloneSkeleton(arms.scene),weapon=cloneSkeleton(source.scene);
    container.rotation.y=Math.PI;container.add(assembly);assembly.add(arm);
    const socket=arm.getObjectByName('wpn');weapon.quaternion.set(.5,.5,.5,.5);socket.add(weapon);
    const imported=sourceClip.clone(),unbound=imported.tracks.filter(track=>!assembly.getObjectByName(track.name.slice(0,track.name.lastIndexOf('.')))).map(track=>track.name);
    imported.tracks=imported.tracks.filter(track=>assembly.getObjectByName(track.name.slice(0,track.name.lastIndexOf('.'))));
    const weaponNames=new Set(metadata.skeleton.m_boneName),weaponTracks=imported.tracks.filter(track=>weaponNames.has(track.name.slice(0,track.name.lastIndexOf('.'))));
    const rawSecondaryBones=clipEntry.bones.filter(name=>weaponNames.has(name));
    const mixer=new THREE.AnimationMixer(assembly),running=mixer.clipAction(imported);running.setLoop(THREE.LoopOnce,1);running.clampWhenFinished=true;running.play();
    const frames=[];
    for(const ratio of [0,.25,.5,.75,.99999]){
      mixer.setTime(sourceClip.duration*ratio);container.updateMatrixWorld(true);
      const grip=weapon.getObjectByName('ag1_hand_r'),hand=arm.getObjectByName('hand_R'),target=arm.getObjectByName('wpnHand_R');
      const gripPosition=grip?.getWorldPosition(new THREE.Vector3());
      frames.push({ratio,wpn:vector(socket),hand:vector(hand),grip:vector(grip),
        gripToHand:gripPosition&&hand?gripPosition.distanceTo(hand.getWorldPosition(new THREE.Vector3())):null,
        gripToTarget:gripPosition&&target?gripPosition.distanceTo(target.getWorldPosition(new THREE.Vector3())):null,
        gripToHandBones:gripPosition?Object.fromEntries(['attachHand_R','finger_middle_meta_R','finger_index_meta_R','finger_pinky_meta_R','finger_thumb_0_R'].map(name=>{
          const node=arm.getObjectByName(name);return [name,node?gripPosition.distanceTo(node.getWorldPosition(new THREE.Vector3())):null];
        })):null,
        muzzle:attachment(weapon,metadata.attachments.muzzle_flash),armWpnTip:vector(arm.getObjectByName('wpnTip')),
        silencedMuzzle:attachment(weapon,metadata.attachments.muzzle_flash2),
        weaponBounds:skinnedBounds(weapon),armBounds:skinnedBounds(arm),
        handContact:ratio===.5?handContact(arm,weapon):null});
    }
    results.push({key,action,clip:clipEntry.key,skeleton:clipEntry.skeleton,source:entry.source,
      tracks:sourceClip.tracks.length,boundTracks:imported.tracks.length,unbound,weaponTracks:weaponTracks.length,
      secondaryBonesPresent:rawSecondaryBones,frames});
  }
}
const report={schema:'cscs.cs2.viewmodel-coordinate-audit.v1',assembly:'primary arms.wpn -> Qinv(.5,.5,.5,.5) -> secondary weapon glTF',
  sourceToCamera:'Y rotation PI after exporter Source->glTF baked conversion',results};
await fs.writeFile(path.join(root,'.local/cs2/content',outputName),JSON.stringify(report,null,2)+'\n');
for(const row of results){
  const idle=row.frames.find(frame=>frame.ratio===.5);
  console.log(JSON.stringify({key:row.key,action:row.action,clip:row.clip,weaponTracks:row.weaponTracks,unbound:row.unbound.length,
    gripToHand:idle.gripToHand,gripToTarget:idle.gripToTarget,muzzle:idle.muzzle,bounds:idle.weaponBounds}));
}
