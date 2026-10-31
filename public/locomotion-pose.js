import {validLocomotion} from './player-locomotion.js';
// A fixed, bounded set of local-bone layers. Rendering and hitboxes use this
// compositor; no render-only pose history or per-bone network payload is kept.
export function createLocomotionPose(THREE,data,matrices,upper,makeSampler){
 const byName=new Map(data.sequences.map(s=>[s.name,s])),lower=upper.map(v=>!v),samplers=new Map();
 const oldP=new THREE.Vector3(),gaitP=new THREE.Vector3(),oldQ=new THREE.Quaternion(),gaitQ=new THREE.Quaternion();
 const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),next=new THREE.Quaternion(),unit=new THREE.Vector3(1,1,1);
 function sample(key,sequence,frame,p,mask){
  if(!sequence)return null;
  let sampler=samplers.get(key);if(!sampler){sampler=makeSampler(mask);samplers.set(key,sampler);}
  sampler.pose(sequence,frame,{...p,playerGaitSequence:null,playerGaitFrame:null});return sampler.locals;
 }
 const gaitFrame=(s,p)=>{const span=Math.max(1,s.frames-1),stride=Math.hypot(...(s.linearMovement||[]));return stride>0?((p.gaitDistance*40/stride*span)%span+span)%span:0;};
 function stance(key,sequence,frame,p,duck,mask,time=null){
  const stand=byName.get(sequence.name.replace(/^crouch_/,'ref_'))||sequence,crouch=byName.get(sequence.name.replace(/^ref_/,'crouch_'))||sequence;
  const at=s=>Number.isFinite(time)?(s.flags&1?(Math.max(0,time)*s.fps)%Math.max(1,s.frames-1):Math.min(Math.max(0,time)*s.fps,s.frames-1)):frame;
  return {a:duck<1?sample(key+'s',stand,at(stand),p,mask):null,b:duck>0?sample(key+'c',crouch,at(crouch),p,mask):null,weight:duck};
 }
 function read(pair,i){
  const a=pair.a?.[i]||pair.b?.[i],b=pair.b?.[i];position.copy(a.position);rotation.copy(a.rotation);
  if(pair.a&&b&&pair.weight>0){position.lerp(b.position,pair.weight);rotation.slerp(b.rotation,pair.weight);}
 }
 function mix(locals,i,weight){if(!locals||weight<=0)return;position.lerp(locals[i].position,weight);rotation.slerp(locals[i].rotation,weight);}
 return {pose(sequence,frame,p,description){
  const l=p.playerLocomotion,aim=byName.get(p.playerGroundSequence);
  if(p.alive===false||!validLocomotion(l)||!sequence||!aim||!byName.has('run')||!byName.has('crouchrun')||!byName.has('jump'))return false;
  const jump=byName.get('jump'),airFrame=Math.min(l.airTime*jump.fps,jump.frames-1),jumpUpper=l.air>0&&(sequence.name==='jump'||sequence.name.includes('_aim_'));
  const main=sequence.name==='jump'?aim:sequence,mainFrame=sequence.name==='jump'?0:frame;
  const allAir=l.air===1,top=!(jumpUpper&&allAir)?stance('top',main,mainFrame,p,l.duck,upper,sequence.name==='jump'?p.playerGroundTime:p.playerAnimationTime):null,idle=!allAir&&l.move<1?stance('idle',aim,0,p,l.duck,lower):null;
  const previous=byName.get(p.playerPoseFromSequence),blend=Number.isFinite(p.playerPoseBlend)?Math.max(0,Math.min(1,p.playerPoseBlend)):1;
  const old=top&&previous&&blend<1?stance('old',previous,p.playerPoseFromFrame||0,p,l.duck,upper,p.playerPoseFromTime):null;
  const run=byName.get('run'),walk=byName.get('walk')||run,crouchRun=byName.get('crouchrun');
  const r=!allAir&&l.move>0&&l.duck<1&&l.walk<1?sample('run',run,gaitFrame(run,p),p,lower):null;
  const w=!allAir&&l.move>0&&l.duck<1&&l.walk>0?sample('walk',walk,gaitFrame(walk,p),p,lower):null;
  const c=!allAir&&l.move>0&&l.duck>0?sample('crouchRun',crouchRun,gaitFrame(crouchRun,p),p,lower):null;
  const j=l.air>0?sample('jump',jump,airFrame,p,null):null;
  // Blend in local space, then rebuild the hierarchy once. Matrix element
  // interpolation would shear/scale bones and corrupt attached weapons.
  for(let i=0;i<data.bones.length;i++){
   if(upper[i]){
    if(jumpUpper&&allAir){position.copy(j[i].position);rotation.copy(j[i].rotation);}
    else if(old){read(old,i);oldP.copy(position);oldQ.copy(rotation);read(top,i);position.lerpVectors(oldP,position,blend);next.copy(rotation);rotation.copy(oldQ).slerp(next,blend);}else read(top,i);
    if(jumpUpper)mix(j,i,l.air);
   }else{
    // Build the gait first, then blend it with planted idle legs.
    const base=r||w||c;
    if(allAir){position.copy(j[i].position);rotation.copy(j[i].rotation);}
    else if(base){position.copy(base[i].position);rotation.copy(base[i].rotation);if(r&&w)mix(w,i,l.walk);if((r||w)&&c)mix(c,i,l.duck);
     if(l.move<1){gaitP.copy(position);gaitQ.copy(rotation);read(idle,i);position.lerp(gaitP,l.move);rotation.slerp(gaitQ,l.move);}
    }else read(idle,i);
    mix(j,i,l.air);
   }
   matrices[i].compose(position,rotation,unit);const parent=data.bones[i].parent;if(parent>=0)matrices[i].premultiply(matrices[parent]);
  }
  const gait=l.air>.5?jump:l.duck>.5?crouchRun:l.walk>.5?walk:run;
  description.sequence=l.air>0||l.move>0?gait.name:null;description.frame=gait===jump?airFrame:gaitFrame(gait,p);return true;
 },samplers:()=>samplers.size};
}
