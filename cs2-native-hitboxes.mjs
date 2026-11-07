import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {createNativePose,rayCapsule} from './public/cs2-native-pose.js';
import {advanceNativeAnimationPhase,NATIVE_GAIT_PHASE_VERSION} from './public/cs2-animation-phase.js';
export async function loadNativeHitboxes(entries,{root=new URL('./public',import.meta.url).pathname}={}){
 const rigs={};for(const [team,entry]of Object.entries(entries)){
  const file=path.resolve(root,'.'+entry.rig);if(!file.startsWith(path.resolve(root)+path.sep))throw Error('Native rig outside public assets');
  const rigBytes=await readFile(file);if(entry.rigSHA256&&createHash('sha256').update(rigBytes).digest('hex')!==entry.rigSHA256)throw Error('Native rig JSON integrity mismatch');const rig=JSON.parse(rigBytes.toString()),bytes=await readFile(path.join(path.dirname(file),rig.buffer));if(bytes.length!==rig.bufferBytes||createHash('sha256').update(bytes).digest('hex')!==rig.bufferSHA256)throw Error('Native rig binary integrity mismatch');
  rigs[team]=createNativePose(THREE,rig,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 }
 if(!rigs.T||!rigs.CT)throw Error('Both native team rigs are required');
 const rootMatrix=new THREE.Matrix4(),a=new THREE.Vector3(),b=new THREE.Vector3(),matrix=new THREE.Matrix4(),phases=new WeakMap();let queries=0,phaseAdvances=0;
 const evaluator=p=>{if(!rigs[p.team])throw Error('Historical native pose missing team');return rigs[p.team];};
 const reactionSeconds=Math.max(.22,...Object.values(rigs).flatMap(e=>[e.rig.actions.hit,e.rig.actions.hitHead].map(key=>e.clips.get(key)?.duration||0)));
 return{HIT_REACTION:{duration:reactionSeconds,playbackRate:1},
  advanceAnimation(p){const e=evaluator(p),next=advanceNativeAnimationPhase(p,e.rig,phases.get(p));if(next){phases.set(p,next);phaseAdvances++;}},
  rayPlayer(o,d,p,time=0,expand=0){queries++;const e=evaluator(p);e.pose(p,time);rootMatrix.makeRotationY((p.yaw||0)+(e.rig.yawOffset||0));rootMatrix.setPosition(p.x,p.y,p.z);let closest={distance:Infinity,hitgroup:'chest'};for(const h of e.rig.hitboxes){matrix.multiplyMatrices(rootMatrix,e.bones[h.bone].world);a.fromArray(h.a).applyMatrix4(matrix);b.fromArray(h.b).applyMatrix4(matrix);const t=rayCapsule(o,d,a,b,h.radius+expand);if(t<closest.distance)closest={distance:t,hitgroup:({1:'head',2:'chest',3:'stomach',4:'arms',5:'arms',6:'legs',7:'legs',8:'chest'})[h.group]||'chest'};}return closest;},
  hitboxAnimation(p,time){const e=evaluator(p),s=e.select(p,time);return{playerRig:'source2-native',playerSequence:s.key,playerAction:s.action,playerAnimationTime:s.time,playerFrame:s.time*30,playerFrameSpan:s.duration*30,playerLooping:s.loop,playerPoseFromSequence:p.poseFromSequence||null,playerPoseFromTime:p.poseFromTime||0,playerPoseBlend:Math.max(0,Math.min(1,(time-(p.poseChangedAt??-100))/.15)),playerAnimationClock:time};},
  hitboxDiagnostics:()=>({source:'source2-native-authored-capsules',queries,phaseAdvances,gaitPhase:NATIVE_GAIT_PHASE_VERSION,teams:Object.fromEntries(Object.entries(rigs).map(([t,r])=>[t,r.diagnostics()])),limitations:['Shared imported clips replace the unavailable retail animation graph.','Continuous gait uses per-clip contact-derived stride candidates and explicit family/direction fallbacks.']})};
}
