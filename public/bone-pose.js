import {createLocomotionPose} from './locomotion-pose.js';
// Shared source bone evaluation for rendering and authoritative hitboxes.
const finite=(n,fallback=0)=>Number.isFinite(n)?n:fallback;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function createBonePose(THREE,data,matrices=data.bones.map(()=>new THREE.Matrix4()),captureLocals=false,onlyBones=null){
  const unit = new THREE.Vector3(1, 1, 1);
  const euler = new THREE.Euler(0, 0, 0, 'ZYX'), nextQ = new THREE.Quaternion();
  const positions = Array.from({length: 4}, () => new THREE.Vector3());
  const rotations = Array.from({length: 4}, () => new THREE.Quaternion());
  const a = new Float64Array(6), b = new Float64Array(6), blendIndices = new Uint8Array(4);
  const adjustment = (data.controllers || []).map(c => {
    const value = c.type & 0x8000 ? c.start + c.rest * 360 / 256 : c.start + (c.end - c.start) * c.rest / 255;
    return c.type & (8 | 16 | 32) ? value * Math.PI / 180 : value;
  });
  let blendDescription='bind pose',gaitDescription={sequence:null,frame:0};
  const sequences=new Map((data.sequences||[]).map(s=>[s.name,s])),upper=[];
  const locals=captureLocals?data.bones.map(()=>({position:new THREE.Vector3(),rotation:new THREE.Quaternion()})):null;
  let previousPose=null;
  for(let i=0;i<data.bones.length;i++)upper[i]=data.bones[i].name==='Bip01 Spine'||(data.bones[i].parent>=0&&upper[data.bones[i].parent]);
  let locomotion=null;
  function pose(sequence,frame,p={},merged=null,mapping=null){
    if(!captureLocals&&!merged&&p.playerLocomotion){
      locomotion||=createLocomotionPose(THREE,data,matrices,upper,mask=>createBonePose(THREE,data,undefined,true,mask));
      if(locomotion.pose(sequence,frame,p,gaitDescription)){blendDescription='shared locomotion layers';return;}
    }
    const previous=sequences.get(p.playerPoseFromSequence),blend=clamp(finite(p.playerPoseBlend,1),0,1);
    const transitioning=!captureLocals&&previous&&blend<1;
    if(transitioning){
      previousPose||=createBonePose(THREE,data,undefined,true);
      previousPose.pose(previous,p.playerPoseFromFrame,{...p,playerGaitSequence:null,playerGaitFrame:null});
    }
    const time = clamp(finite(frame), 0, (sequence?.frames || 1) - 1);
    const first = Math.floor(time), next = Math.min(first + 1, (sequence?.frames || 1) - 1), fraction = time - first;
    // The Studio player renderer layers lower-body gait below the spine. Use
    // actual travelled distance, so shooting/flinching never freezes the legs.
    const gait=Number.isFinite(p.gaitDistance)||Number.isFinite(p.playerGaitFrame)?sequences.get(p.playerGaitSequence):null;
    const stride=gait?Math.hypot(...(gait.linearMovement||[])):0,gaitSpan=Math.max(1,(gait?.frames||1)-1);
    const gaitFrame=Number.isFinite(p.playerGaitFrame)?clamp(p.playerGaitFrame,0,gaitSpan):stride>0?((p.gaitDistance*40/stride*gaitSpan)%gaitSpan+gaitSpan)%gaitSpan:0;
    const gaitFirst=Math.floor(gaitFrame),gaitNext=Math.min(gaitFirst+1,gaitSpan),gaitFraction=gaitFrame-gaitFirst;
    gaitDescription.sequence=gait&&(stride>0||Number.isFinite(p.playerGaitFrame))?gait.name:null;gaitDescription.frame=gaitFrame;
    const count = sequence?.blendCount || 1, all = sequence?.blendTracks;
    let used = 1, bx = 0, by = 0;
    blendIndices[0] = 0;
    const normalized = (axis, fallback) => {
      const explicit = axis === 0 ? p.blendX : p.blendY;
      if (Number.isFinite(explicit)) return clamp(explicit, 0, 1);
      const start = sequence?.blendStart?.[axis], end = sequence?.blendEnd?.[axis];
      const degrees = axis === 0 ? -finite(p.pitch) * 180 / Math.PI : finite(p.aimYaw) * 180 / Math.PI;
      return Number.isFinite(start) && Number.isFinite(end) && end !== start ? clamp((degrees - start) / (end - start), 0, 1) : fallback;
    };
    if (all && [2, 4, 9].includes(count)) {
      // CS player nine-blend grids use columns for torso yaw and rows for
      // pitch. They do not use the generic sequence blend-axis descriptors.
      const relativeYaw=Number.isFinite(p.aimYaw)?p.aimYaw:Number.isFinite(p.gaitYaw)&&Number.isFinite(p.yaw)?Math.atan2(Math.sin(p.yaw-p.gaitYaw),Math.cos(p.yaw-p.gaitYaw)):0;
      const x=count===9?(Number.isFinite(p.blendX)?clamp(p.blendX,0,1):clamp(.5-relativeYaw/Math.PI,0,1)):normalized(0,.5);
      const y=count===9?(Number.isFinite(p.blendY)?clamp(p.blendY,0,1):clamp(.5-finite(p.pitch)/(Math.PI/2),0,1)):normalized(1,.5);
      if (count === 2) { used = 2; blendIndices[1] = 1; bx = x; }
      else {
        used = 4;
        const size = count === 9 ? 3 : 2, xx = x * (size - 1), yy = y * (size - 1);
        const col = Math.min(size - 2, Math.floor(xx)), row = Math.min(size - 2, Math.floor(yy));
        blendIndices[0] = row * size + col; blendIndices[1] = row * size + col + 1;
        blendIndices[2] = (row + 1) * size + col; blendIndices[3] = (row + 1) * size + col + 1;
        bx = xx - col; by = yy - row;
      }
      blendDescription = `${count} source blends (${count === 9 ? '3×3' : count === 4 ? '2×2' : 'linear'})`;
    } else blendDescription = count > 1 ? `blend 0 only: ${count} source blends unavailable/unsupported` : 'single source blend';
    for (let i = 0; i < data.bones.length; i++) {
      if (merged && mapping[i] >= 0) { matrices[i].copy(merged[mapping[i]]); continue; }
      if(onlyBones&&!onlyBones[i])continue;
      const bone = data.bones[i];
      const walking=gait&&(stride>0||Number.isFinite(p.playerGaitFrame))&&!upper[i],source=walking?gait:sequence;
      const from=walking?gaitFirst:first,to=walking?gaitNext:next,part=walking?gaitFraction:fraction,boneBlends=walking?1:used;
      for (let k = 0; k < boneBlends; k++) {
        const channels = (walking?(gait.tracks||gait.blendTracks?.[0]):(all?.[blendIndices[k]] || sequence?.tracks))?.[i];
        for (let axis = 0; axis < 6; axis++) {
          const track = channels?.[axis], adj = adjustment[bone.controllers?.[axis]] || 0;
          a[axis] = bone.value[axis] + (track?.values[from] || 0) * bone.scale[axis] + adj;
          b[axis] = bone.value[axis] + (track?.values[to] || 0) * bone.scale[axis] + adj;
          if (axis < 3 && track?.positionHold?.includes(from)) b[axis] = a[axis];
        }
        positions[k].set(a[0] + (b[0] - a[0]) * part, a[1] + (b[1] - a[1]) * part, a[2] + (b[2] - a[2]) * part);
        rotations[k].setFromEuler(euler.set(a[3], a[4], a[5], 'ZYX'));
        nextQ.setFromEuler(euler.set(b[3], b[4], b[5], 'ZYX')); rotations[k].slerp(nextQ, part);
      }
      if (boneBlends > 1) { positions[0].lerp(positions[1], bx); rotations[0].slerp(rotations[1], bx); }
      if (boneBlends === 4) {
        positions[2].lerp(positions[3], bx); rotations[2].slerp(rotations[3], bx);
        positions[0].lerp(positions[2], by); rotations[0].slerp(rotations[2], by);
      }
      // Source STUDIO_X/Y/Z root-motion axes are consumed by game movement.
      if (source?.motionBone === i) for (let axis = 0; axis < 3; axis++) if (source.motionType & (1 << axis)) positions[0].setComponent(axis, 0);
      if(transitioning&&!walking){
        positions[0].lerpVectors(previousPose.locals[i].position,positions[0],blend);
        nextQ.copy(rotations[0]);rotations[0].copy(previousPose.locals[i].rotation).slerp(nextQ,blend);
      }
      if(locals){locals[i].position.copy(positions[0]);locals[i].rotation.copy(rotations[0]);}
      if(captureLocals)continue;
      matrices[i].compose(positions[0], rotations[0], unit);
      if (bone.parent >= 0) matrices[i].premultiply(matrices[bone.parent]);
    }
  }
  return {pose,matrices,locals,blendInfo:()=>blendDescription,gaitInfo:()=>({...gaitDescription})};
}
