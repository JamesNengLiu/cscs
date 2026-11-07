// Shared deterministic glTF skeletal sampling. The same evaluator feeds visible
// weighted bones and authoritative capsules; no camera/PVS enters hit decisions.
import {validLocomotion} from './player-locomotion.js';
import {nativeGaitPhaseOf,nativeMotionDirection} from './cs2-animation-phase.js';
export const NATIVE_AIM_PROFILE=Object.freeze({id:'model-space-spine-pitch-v1',limit:Math.PI/3,weights:Object.freeze([['spine_0',.2],['spine_1',.25],['spine_2',.3],['spine_3',.25]])});
const verifiedClips=new WeakMap();
const finite=a=>Array.isArray(a)&&a.every(Number.isFinite);
export function createNativePose(THREE,rig,buffer){
 if(rig?.schema!=='cscs.cs2.rig.v1'||!Array.isArray(rig.bones)||rig.bones.length<10||rig.bones.length>256||!(buffer instanceof ArrayBuffer))throw Error('Invalid native rig');
 const data=new Float32Array(buffer),names=new Map(),bones=rig.bones.map((b,i)=>{
  if(typeof b.name!=='string'||names.has(b.name)||!Number.isInteger(b.parent)||b.parent>=i||b.parent< -1||!finite(b.position)||b.position.length!==3||!finite(b.rotation)||b.rotation.length!==4)throw Error('Invalid native bone');
  names.set(b.name,i);return{p:new THREE.Vector3(),q:new THREE.Quaternion(),s:new THREE.Vector3(),local:new THREE.Matrix4(),world:new THREE.Matrix4()};
 });
 let variants=verifiedClips.get(buffer);if(!variants){variants=new WeakMap();verifiedClips.set(buffer,variants);}const cached=variants.get(rig),clips=cached||new Map();
 if(!cached)for(const [key,c]of Object.entries(rig.clips)){
  if(!Number.isFinite(c.duration)||c.duration<=0||c.duration>60||!Array.isArray(c.tracks))throw Error('Invalid native clip');
  const tracks=c.tracks.map(t=>{const width=t.path==='rotation'?4:3;if(!['translation','rotation','scale'].includes(t.path)||!Number.isInteger(t.bone)||t.bone<0||t.bone>=bones.length||!Number.isInteger(t.count)||t.count<1||t.interpolation&&!['LINEAR','STEP'].includes(t.interpolation))throw Error('Invalid native track');for(const [offset,count]of [[t.times,t.count],[t.values,t.count*width]])if(!Number.isInteger(offset)||offset<0||offset+count>data.length)throw Error('Native track outside buffer');const times=data.subarray(t.times,t.times+t.count),values=data.subarray(t.values,t.values+t.count*width);for(let i=0;i<times.length;i++)if(!Number.isFinite(times[i])||times[i]<0||i&&times[i]<times[i-1])throw Error('Invalid native key times');if(!values.every(Number.isFinite))throw Error('Nonfinite native keys');return{...t,width,times,values};});clips.set(key,{...c,tracks});
 }
 if(!cached)variants.set(rig,clips);
 const aimAxis=new THREE.Vector3(),aimParentQ=new THREE.Quaternion(),aimQ=new THREE.Quaternion(),aimPosition=new THREE.Vector3(),aimScale=new THREE.Vector3();
 const aimBones=NATIVE_AIM_PROFILE.weights.map(([name,weight])=>({bone:names.get(name),weight})).filter(e=>e.bone!==undefined);
 const scratchQ=new THREE.Quaternion(),scratchP=new THREE.Vector3(),deltaQ=new THREE.Quaternion(),base=[],idlePose=[],runPose=[],standPose=[],locomotionPose=[],referencePose=[];
 const upperRoot=names.get('spine_0'),attachmentRoot=names.get('wpnPivot'),upper=bones.map((_,i)=>{let at=i;while(at>=0){if(at===upperRoot)return true;at=rig.bones[at].parent;}return false;});
 const attachment=bones.map((_,i)=>{let at=i;while(at>=0){if(at===attachmentRoot)return true;at=rig.bones[at].parent;}return false;});
 const attachmentRelative=new THREE.Matrix4(),attachmentWorld=new THREE.Matrix4(),parentInverse=new THREE.Matrix4();let evaluations=0,layeredEvaluations=0;
 const restore=()=>{for(let i=0;i<bones.length;i++){const b=bones[i],r=rig.bones[i];b.p.fromArray(r.position);b.q.fromArray(r.rotation).normalize();b.s.fromArray(r.scale||[1,1,1]);}};
 function trackAt(t,time){let lo=0,hi=t.count-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(t.times[mid]<=time)lo=mid;else hi=mid-1;}const next=Math.min(t.count-1,lo+1),a=t.times[lo],b=t.times[next],f=t.interpolation==='STEP'||a===b?0:Math.max(0,Math.min(1,(time-a)/(b-a))),bone=bones[t.bone];if(t.path==='rotation'){bone.q.fromArray(t.values,lo*4).normalize();scratchQ.fromArray(t.values,next*4).normalize();bone.q.slerp(scratchQ,f);}else{const v=t.path==='translation'?bone.p:bone.s;v.fromArray(t.values,lo*3);scratchP.fromArray(t.values,next*3);v.lerp(scratchP,f);}}
 function sample(key,time,loop){restore();const clip=clips.get(key);if(!clip)throw Error('Missing native clip '+key);const at=loop?((time%clip.duration)+clip.duration)%clip.duration:Math.max(0,Math.min(clip.duration,time));for(const t of clip.tracks)trackAt(t,at);
  // Keep authored pose and vertical motion; server movement owns displacement.
  const root=bones[names.get(rig.rootMotion||'root_motion')];if(root){const rest=rig.bones[names.get(rig.rootMotion||'root_motion')];root.p.x=rest.position[0];root.p.z=rest.position[2];}
 }
 function capture(saved){for(let i=0;i<bones.length;i++){const b=bones[i];saved[i]||={p:new THREE.Vector3(),q:new THREE.Quaternion(),s:new THREE.Vector3()};saved[i].p.copy(b.p);saved[i].q.copy(b.q);saved[i].s.copy(b.s);}}
 function blendSaved(saved,weight,mask=null){if(weight<=0)return;for(let i=0;i<bones.length;i++){if(mask&&!mask[i])continue;const b=bones[i],s=saved[i];if(weight>=1){b.p.copy(s.p);b.q.copy(s.q);b.s.copy(s.s);}else{b.p.lerp(s.p,weight);b.q.slerp(s.q,weight);b.s.lerp(s.s,weight);}}}
 function matrices(){for(let i=0;i<bones.length;i++){const b=bones[i];b.local.compose(b.p,b.q,b.s);if(rig.bones[i].parent<0)b.world.copy(b.local);else b.world.multiplyMatrices(bones[rig.bones[i].parent].world,b.local);}}
 const direction=nativeMotionDirection;
 function locomotion(p,time){
  const map=rig.actionsByWeapon?.[p.weapon]||rig.actions,l=p.playerLocomotion,dir=direction(p),phase=nativeGaitPhaseOf(p,rig),key=(action,fallback)=>map[action+'_'+dir]||map[action]||fallback;
  const moving=(action,fallback)=>{const k=key(action,fallback);sample(k,phase*clips.get(k).duration,true);};
  // Every weight comes from authority/history. No browser dt, previous local
  // pose or inferred IK may affect either visible bones or hit capsules.
  sample(map.idle,time,true);capture(idlePose);
  if(l.move>0){moving('run',map.idle);if(l.walk>0&&map.walk){capture(runPose);moving('walk',map.run||map.idle);blendSaved(runPose,1-l.walk);}blendSaved(idlePose,1-l.move);}
  capture(standPose);sample(map.crouch||map.idle,time,true);capture(idlePose);
  if(l.move>0&&map.crouchMove){moving('crouchMove',map.crouch||map.idle);blendSaved(idlePose,1-l.move);}
  blendSaved(standPose,1-l.duck);
  if(l.air>0&&map.jump){capture(standPose);const k=l.airTime>clips.get(map.jump).duration&&map.inair?map.inair:map.jump;sample(k,l.airTime,k===map.inair);blendSaved(standPose,1-l.air);}
 }
 function upperOverlay(a,p,referenceMap=rig.actionsByWeapon?.[p.weapon]||rig.actions){
  capture(locomotionPose);sample(referenceMap.idle,0,true);capture(referencePose);sample(a.key,a.time,a.loop);
  // wpnPivot is an authored root sibling of pelvis, not a spine child. Keep
  // its original relation to the action's spine while the mixed body crouches.
  // This changes hierarchy frames only; it does not solve or invent hand IK.
  const hasAttachment=upperRoot!==undefined&&attachmentRoot!==undefined;
  if(hasAttachment){matrices();attachmentRelative.copy(bones[upperRoot].world).invert().multiply(bones[attachmentRoot].world);}
  for(let i=0;i<bones.length;i++){const b=bones[i],s=locomotionPose[i],ref=referencePose[i];if(upper[i]){
    // Authored non-additive clips include standing offsets. Apply only their
    // delta from the same family's original idle; replacing spine translation
    // outright would raise a crouching chest/head toward standing height.
    b.p.sub(ref.p).add(s.p);deltaQ.copy(ref.q).invert().multiply(b.q);b.q.copy(s.q).multiply(deltaQ).normalize();
    b.s.set(Math.abs(ref.s.x)>1e-9?s.s.x*b.s.x/ref.s.x:s.s.x,Math.abs(ref.s.y)>1e-9?s.s.y*b.s.y/ref.s.y:s.s.y,Math.abs(ref.s.z)>1e-9?s.s.z*b.s.z/ref.s.z:s.s.z);
   }else if(!attachment[i]){b.p.copy(s.p);b.q.copy(s.q);b.s.copy(s.s);}}
  if(hasAttachment){matrices();attachmentWorld.multiplyMatrices(bones[upperRoot].world,attachmentRelative);const parent=rig.bones[attachmentRoot].parent;if(parent>=0)attachmentWorld.premultiply(parentInverse.copy(bones[parent].world).invert());attachmentWorld.decompose(bones[attachmentRoot].p,bones[attachmentRoot].q,bones[attachmentRoot].s);}
 }
 function aimPitch(p){
  if(rig.aimPitch===false||p.alive===false||!validLocomotion(p.playerLocomotion)||!Number.isFinite(p.pitch)||p.pitch===0||!aimBones.length)return;
  const pitch=Math.max(-NATIVE_AIM_PROFILE.limit,Math.min(NATIVE_AIM_PROFILE.limit,p.pitch));
  matrices();const anchor=aimBones.at(-1).bone,hasAttachment=attachmentRoot!==undefined;
  if(hasAttachment)attachmentRelative.copy(bones[anchor].world).invert().multiply(bones[attachmentRoot].world);
  // A Source bone local X need not be model X. Conjugate the model-right
  // axis into each parent frame; distribute the signed angle over the spine.
  for(const {bone,weight}of aimBones){const parent=rig.bones[bone].parent;aimAxis.set(1,0,0);if(parent>=0){bones[parent].world.decompose(aimPosition,aimParentQ,aimScale);aimAxis.applyQuaternion(aimParentQ.invert()).normalize();}aimQ.setFromAxisAngle(aimAxis,-pitch*weight);bones[bone].q.premultiply(aimQ).normalize();matrices();}
  if(hasAttachment){attachmentWorld.multiplyMatrices(bones[anchor].world,attachmentRelative);const parent=rig.bones[attachmentRoot].parent;if(parent>=0)attachmentWorld.premultiply(parentInverse.copy(bones[parent].world).invert());attachmentWorld.decompose(bones[attachmentRoot].p,bones[attachmentRoot].q,bones[attachmentRoot].s);matrices();}
 }
 function select(p,time){
  const map=rig.actionsByWeapon?.[p.weapon]||rig.actions,age=time-(p.lastShot??-100),hit=time-(p.flinchAt??-100),speed=Math.hypot(p.vx||0,p.vz||0);let action='idle',elapsed=time,loop=true;
  if(p.alive===false){action='death';elapsed=Math.max(0,time-(p.diedAt??time));loop=false;}
  else if(hit>=0&&map[p.flinchHead?'hitHead':'hit']&&hit<clips.get(map[p.flinchHead?'hitHead':'hit']).duration){action=p.flinchHead?'hitHead':'hit';elapsed=hit;loop=false;}
  else if(p.reloadAt&&map.reload){action='reload';elapsed=Math.max(0,time-(p.reloadStartedAt??time));loop=false;}
  else if(age>=0&&age<.12&&map.fire){action='fire';elapsed=age;loop=false;}
  else if(p.grounded===false&&map.jump){action='jump';elapsed=p.airTime||0;loop=false;}
  else if(p.crouch){action=speed>.12&&map.crouchMove?'crouchMove':'crouch';elapsed=speed>.12?nativeGaitPhaseOf(p,rig):time;}
  else if(speed>.12){action=p.walk&&map.walk?'walk':'run';elapsed=nativeGaitPhaseOf(p,rig);}
  const dir=direction(p);
  const key=map[action+'_'+dir]||map[action]||map.idle;if(!clips.has(key))throw Error('Native action has no imported clip: '+action);
  if(['run','walk','crouchMove'].includes(action))elapsed*=clips.get(key).duration;
  return{key,action,time:elapsed,loop,duration:clips.get(key).duration};
 }
 function pose(p,time,{explicit=false}={}){evaluations++;let a=explicit&&clips.has(p.playerSequence)?{key:p.playerSequence,time:p.playerAnimationTime||0,loop:p.playerLooping!==false,duration:clips.get(p.playerSequence).duration,action:p.playerAction||'authoritative'}:select(p,time);
  const layered=p.alive!==false&&upperRoot!==undefined&&validLocomotion(p.playerLocomotion);
  if(layered){layeredEvaluations++;locomotion(p,time);if(['fire','reload','hit','hitHead'].includes(a.action))upperOverlay(a,p);}else sample(a.key,a.time,a.loop);
  const before=p.playerPoseFromSequence??p.poseFromSequence,blend=p.playerPoseBlend??Math.max(0,Math.min(1,(time-(p.poseChangedAt??-100))/.15));
  if(blend<1&&before&&clips.has(before)){
   capture(base);
   if(layered){locomotion(p,time);const referenceMap=[rig.actions,...Object.values(rig.actionsByWeapon||{})].find(map=>Object.values(map).includes(before))||rig.actions;upperOverlay({key:before,time:p.playerPoseFromTime??p.poseFromTime??0,loop:true},p,referenceMap);blendSaved(base,blend);}
   else{sample(before,p.playerPoseFromTime??p.poseFromTime??0,true);for(let i=0;i<bones.length;i++){const b=bones[i];b.p.lerp(base[i].p,blend);b.q.slerp(base[i].q,blend);b.s.lerp(base[i].s,blend);}}
  }
  aimPitch(p);matrices();
  return a;
 }
 return{rig,bones,names,clips,pose,select,diagnostics:()=>({source:'native-gltf-shared-pose',bones:bones.length,clips:clips.size,evaluations,layeredEvaluations,locomotionLayer:'authoritative-weights-imported-clips-v1',limitations:[...(rig.limitations||[]),'Shared locomotion/upper-body blending is an approximation of the unavailable retail animation graph; no IK.']})};
}

export function rayCapsule(origin,direction,a,b,radius){
 const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z}),dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z,ba=sub(b,a),oa=sub(origin,a),baba=dot(ba,ba),bard=dot(ba,direction),baoa=dot(ba,oa),rdoa=dot(direction,oa),oaoa=dot(oa,oa),dodo=dot(direction,direction);
 if(!(radius>=0)||dodo<1e-20)return Infinity;
 const u=baba>1e-20?Math.max(0,Math.min(1,baoa/baba)):0,dx=oa.x-ba.x*u,dy=oa.y-ba.y*u,dz=oa.z-ba.z*u;if(dx*dx+dy*dy+dz*dz<=radius*radius)return 0;
 let result=Infinity;const sphere=center=>{const oc=sub(origin,center),c=dot(oc,oc)-radius*radius,h=dot(oc,direction)**2-dodo*c;if(h>=0){const t=(-dot(oc,direction)-Math.sqrt(h))/dodo;if(t>=0)result=Math.min(result,t);}};
 const A=baba*dodo-bard*bard,B=baba*rdoa-baoa*bard,C=baba*oaoa-baoa*baoa-radius*radius*baba,H=B*B-A*C;
 if(Math.abs(A)>1e-15&&H>=0){const t=(-B-Math.sqrt(H))/A,y=baoa+t*bard;if(t>=0&&y>=0&&y<=baba)result=Math.min(result,t);}
 sphere(a);sphere(b);return result;
}
