import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createBonePose} from './public/bone-pose.js';
import {rayBox} from './public/math.js';
// One canonical original rig keeps cosmetic character/face selection out of combat rules.
let rig=null,error=null;
try{
  const data=JSON.parse(readFileSync(new URL('./public/assets/players/urban/model.json',import.meta.url),'utf8'));
  if(data.schema!=='goldsrc-player-v1'||data.bones.length>128||data.hitboxes.length>64)throw Error('Invalid collision rig');
  rig={bones:data.bones,controllers:data.controllers,sequences:data.sequences,hitboxes:data.hitboxes};
}catch(e){error=String(e.message);}
const evaluator=rig?createBonePose(THREE,rig):null;
const suffix=id=>({glock18:'onehanded',usp:'onehanded',p228:'onehanded',deagle:'onehanded',fiveseven:'onehanded',elite:'dualpistols',m4a1:'carbine',galil:'carbine',famas:'carbine',aug:'rifle',sg552:'rifle',scout:'rifle',awp:'rifle',g3sg1:'rifle',sg550:'rifle',mp5navy:'mp5',mac10:'mp5',tmp:'mp5',ump45:'mp5',p90:'mp5',m3:'shotgun',xm1014:'shotgun',hegrenade:'grenade',flashbang:'grenade',smokegrenade:'grenade'}[id]||id);
const groupName=g=>({1:'head',2:'chest',3:'stomach',4:'arms',5:'arms',6:'legs',7:'legs'}[g]||'chest');
const available=new Map(rig?.sequences.filter(s=>s.tracks||s.blendTracks).map(s=>[s.name,s])||[]);
const cache=new WeakMap(),animations=new WeakMap();
let poseEvaluations=0,animationSelections=0,animationCacheHits=0,poseCacheHits=0;
function animationState(p,time){
  if(!rig)return null;
  const key=[time,p.crouch,p.weapon,p.lastShot,p.reloadAt,p.reloadStartedAt,p.vx,p.vz,p.grounded,p.walk,p.alive,p.diedAt].join(':');
  const old=animations.get(p);if(old?.key===key){animationCacheHits++;return old.animation;}
  const prefix=p.crouch?'crouch':'ref',weapon=suffix(p.weapon),age=time-(p.lastShot??-100);
  let names,elapsed=time;
  if(p.alive===false){names=[p.crouch?'crouch_die':'death1','death1','head'];elapsed=Math.max(0,time-(p.diedAt??time));}
  else if(p.reloadAt){names=[`${prefix}_reload_${weapon}`,`reload_${weapon}`];elapsed=Math.max(0,time-(p.reloadStartedAt??time));}
  else if(age>=0&&age<.12){names=[`${prefix}_shoot_${weapon}`,`shoot_${weapon}`];elapsed=age;}
  else if(p.grounded===false)names=['jump'];
  else if(Math.hypot(p.vx||0,p.vz||0)>.12)names=[p.crouch?'crouch_walk':p.walk?'walk':'run'];
  else names=[`${prefix}_aim_${weapon}`,`aim_${weapon}`,p.crouch?'crouch_idle':'idle'];
  const sequence=names.map(n=>available.get(n)).find(Boolean)||available.get(`${prefix}_aim_ak47`)||available.get('idle')||[...available.values()][0];
  if(!sequence)return null;
  const frame=sequence.flags&1?(elapsed*sequence.fps)%Math.max(1,sequence.frames-1):Math.min(elapsed*sequence.fps,sequence.frames-1);
  const animation={sequence,frame};animations.set(p,{key,animation});animationSelections++;return animation;
}
export function playerHitboxes(p,time=0){
  if(!evaluator)return null;
  const animation=animationState(p,time);if(!animation)return null;const {sequence,frame}=animation;
  const key=[time,p.x,p.y,p.z,p.yaw,p.pitch,p.crouch,p.aimYaw,p.blendX,p.blendY,sequence.name,frame].join(':');
  const cached=cache.get(p);if(cached?.key===key){poseCacheHits++;return cached.boxes;}
  poseEvaluations++;
  evaluator.pose(sequence,frame,p);
  const root=new THREE.Matrix4().makeRotationY(p.yaw||0);root.setPosition(p.x,p.y,p.z);
  const source=new THREE.Matrix4().set(0,-1/40,0,0,0,0,1/40,p.crouch?.45:.9,-1/40,0,0,0,0,0,0,1);root.multiply(source);
  const boxes=rig.hitboxes.map(b=>({group:groupName(b.group),min:b.min,max:b.max,inverse:new THREE.Matrix4().multiplyMatrices(root,evaluator.matrices[b.bone]).invert().elements.slice()}));
  cache.set(p,{key,boxes,sequence:sequence.name,frame});return boxes;
}
export function hitboxAnimation(p,time){const a=animationState(p,time);return a?{playerSequence:a.sequence.name,playerFrame:a.frame}:{};}
export function rayPlayer(o,d,p,time=0,expand=0){
  const boxes=playerHitboxes(p,time);if(!boxes)return null;
  let closest={distance:Infinity,hitgroup:'chest'};
  for(const box of boxes){
    const m=new THREE.Matrix4().fromArray(box.inverse),origin=new THREE.Vector3(o.x,o.y,o.z).applyMatrix4(m);
    const delta=new THREE.Vector3(d.x,d.y,d.z).applyMatrix3(new THREE.Matrix3().setFromMatrix4(m));
    const bounds={};for(let i=0;i<3;i++){const k=['x','y','z'][i];bounds[k+'1']=box.min[i]-expand*40;bounds[k+'2']=box.max[i]+expand*40;}
    const distance=rayBox(origin,delta,bounds);if(distance<closest.distance)closest={distance,hitgroup:box.group};
  }
  return closest;
}
export const hitboxDiagnostics=()=>({source:rig?'original-canonical-bone-hitboxes':'fallback-body-boxes',boxes:rig?.hitboxes.length||0,error,poseEvaluations,animationSelections,animationCacheHits,poseCacheHits});
