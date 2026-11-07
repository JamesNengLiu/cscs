// Offline kinematic evidence only. Never edits game code, manifest, source
// assets, rigs or runtime. Derived stride candidates are not retail ConVars.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Vector3,Quaternion,Matrix4} from 'three';

const root=path.resolve(import.meta.dirname,'..'),content=path.join(root,'public/assets/cs2-content');
const publish=process.argv.includes('--publish');
const familyArg=process.argv.find(value=>value.startsWith('--family='))?.slice(9)||(publish?'all':'rifle');
const families=familyArg==='all'?['rifle','pistol','knife']:[familyArg];
if(families.some(family=>!['rifle','pistol','knife'].includes(family)))throw Error('Unknown family');
if(publish&&familyArg!=='all')throw Error('Publishing requires all three prepared families');
const actors=['ctm_sas','tm_phoenix'],directions=['n','ne','e','se','s','sw','w','nw'],modes=['run','walk','crouch'];
const outputArg=process.argv.find(value=>value.startsWith('--output='))?.slice(9)||'locomotion-stride-audit.json';
if(!/^[a-zA-Z0-9_.-]+\.json$/.test(outputArg))throw Error('Output must be a local JSON basename');
const thresholds={heightAboveMinimum:.015,maxAbsVerticalSpeed:.25,minHorizontalSpeed:.2,minSamples:3,maxFitRms:.006,maxSpeedCv:.15,minVelocityDirectionCos:.95,maxLeftRightRelativeDifference:.15};
const manifest=JSON.parse(await fs.readFile(path.join(content,'manifest.json'),'utf8'));
const clips=new Map(manifest.clips.map(clip=>[clip.key,clip])),cache=new Map();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function document(filename){
 if(cache.has(filename))return cache.get(filename);
 const bytes=await fs.readFile(filename),doc=JSON.parse(bytes),buffers=await Promise.all(doc.buffers.map(buffer=>fs.readFile(path.resolve(path.dirname(filename),buffer.uri))));
 const value={doc,sha256:sha(bytes),buffers:doc.buffers.map((buffer,i)=>({uri:buffer.uri,sha256:sha(buffers[i])})),read(index){
  const a=doc.accessors[index],v=doc.bufferViews[a.bufferView],width={SCALAR:1,VEC3:3,VEC4:4}[a.type];
  if(a.componentType!==5126||!width||a.sparse)throw Error('Unsupported animation accessor');
  return Array.from({length:a.count},(_,j)=>Array.from({length:width},(_,k)=>buffers[v.buffer].readFloatLE((v.byteOffset||0)+(a.byteOffset||0)+j*(v.byteStride||width*4)+k*4)));
 }};cache.set(filename,value);return value;
}
function sample(track,time){
 let lo=0,hi=track.times.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(track.times[mid]<=time)lo=mid;else hi=mid-1;}
 const next=Math.min(lo+1,track.times.length-1),a=track.times[lo],b=track.times[next],f=b===a?0:Math.max(0,Math.min(1,(time-a)/(b-a)));
 return track.path==='rotation'?new Quaternion().fromArray(track.values[lo]).normalize().slerp(new Quaternion().fromArray(track.values[next]).normalize(),f).toArray():track.values[lo].map((x,i)=>x+(track.values[next][i]-x)*f);
}
async function trajectory(actor,entry){
 const modelFile=path.join(content,'models',actor,actor+'.gltf'),model=await document(modelFile),clip=await document(path.join(root,'public',entry.url));
 const byName=new Map(model.doc.nodes.map((node,i)=>[node.name,i])),animation=clip.doc.animations.find(animation=>animation.name===entry.name)||clip.doc.animations[0];
 const tracks=animation.channels.map(channel=>{const sampler=animation.samplers[channel.sampler];return{bone:byName.get(clip.doc.nodes[channel.target.node].name),name:clip.doc.nodes[channel.target.node].name,path:channel.target.path,times:clip.read(sampler.input).map(row=>row[0]),values:clip.read(sampler.output)};}).filter(track=>track.bone!==undefined);
 const rest=model.doc.nodes.map(node=>{const p=new Vector3(),q=new Quaternion(),s=new Vector3(1,1,1);if(node.matrix)new Matrix4().fromArray(node.matrix).decompose(p,q,s);else{if(node.translation)p.fromArray(node.translation);if(node.rotation)q.fromArray(node.rotation);if(node.scale)s.fromArray(node.scale);}return{translation:p.toArray(),rotation:q.toArray(),scale:s.toArray()};});
 const rows=[];for(let frame=0;frame<entry.frames;frame++){
  const time=frame*entry.duration/(entry.frames-1),poses=rest.map(p=>({translation:[...p.translation],rotation:[...p.rotation],scale:[...p.scale]}));
  for(const track of tracks)poses[track.bone][track.path]=sample(track,time);
  const matrices=[];function visit(index,parent){const p=poses[index],local=new Matrix4().compose(new Vector3().fromArray(p.translation),new Quaternion().fromArray(p.rotation),new Vector3().fromArray(p.scale));matrices[index]=parent?new Matrix4().multiplyMatrices(parent,local):local;for(const child of model.doc.nodes[index].children||[])visit(child,matrices[index]);}
  for(const index of model.doc.scenes[model.doc.scene||0].nodes)visit(index,null);
  const feet={};for(const name of ['ankle_L','ankle_R','ball_L','ball_R'])feet[name]=new Vector3().setFromMatrixPosition(matrices[byName.get(name)]).toArray();
  rows.push({frame,time,feet});
 }
 const rootTranslation=tracks.find(track=>track.name==='root_motion'&&track.path==='translation'),values=rootTranslation?.values;
 return{rows,duration:entry.duration,frames:entry.frames,fps:(entry.frames-1)/entry.duration,rootTranslation:values?{keyCount:values.length,first:values[0],last:values.at(-1),delta:values[0].map((v,i)=>values.at(-1)[i]-v)}:null,
  model:{file:path.relative(root,modelFile),sha256:model.sha256},clip:{file:entry.url,sha256:clip.sha256,buffers:clip.buffers,source:entry.source,compiledRootMotion:entry.rootMotion?.source}};
}
function fit(rows,bone,indices){
 const selected=indices.map(i=>rows[i]),meanT=selected.reduce((n,row)=>n+row.time,0)/selected.length;
 const line=axis=>{const mean=selected.reduce((n,row)=>n+row.feet[bone][axis],0)/selected.length,den=selected.reduce((n,row)=>n+(row.time-meanT)**2,0),slope=selected.reduce((n,row)=>n+(row.time-meanT)*(row.feet[bone][axis]-mean),0)/den;return{mean,slope};};
 const x=line(0),z=line(2),speed=Math.hypot(x.slope,z.slope),velocities=selected.slice(1).map((row,i)=>[(row.feet[bone][0]-selected[i].feet[bone][0])/(row.time-selected[i].time),(row.feet[bone][2]-selected[i].feet[bone][2])/(row.time-selected[i].time)]),speeds=velocities.map(v=>Math.hypot(...v)),mean=speeds.reduce((a,b)=>a+b,0)/speeds.length;
 const rms=Math.sqrt(selected.reduce((n,row)=>n+(row.feet[bone][0]-x.mean-x.slope*(row.time-meanT))**2+(row.feet[bone][2]-z.mean-z.slope*(row.time-meanT))**2,0)/selected.length),cv=Math.sqrt(speeds.reduce((n,s)=>n+(s-mean)**2,0)/speeds.length)/mean,minDirectionCos=Math.min(...velocities.map((v,i)=>(v[0]*x.slope+v[1]*z.slope)/(speeds[i]*speed))),ys=selected.map(row=>row.feet[bone][1]);
 return{indices,seconds:[selected[0].time,selected.at(-1).time],sampleCount:selected.length,verticalRangeMeters:Math.max(...ys)-Math.min(...ys),velocityXZ:[x.slope,z.slope],speedMetersPerSecond:speed,speedSourceUnitsPerSecond:speed/.0254,instantSpeedRange:[Math.min(...speeds),Math.max(...speeds)],fitRmsMeters:rms,speedCv:cv,minVelocityDirectionCos:minDirectionCos};
}
function contact(trajectory,bone,height=thresholds.heightAboveMinimum){
 const {rows}=trajectory,minY=Math.min(...rows.map(row=>row.feet[bone][1])),segments=[];let segment=[];
 // Exclude first/last source frame, and never wrap a fit across the cycle seam.
 for(let i=1;i<rows.length-2;i++){
  const a=rows[i],b=rows[i+1],p=a.feet[bone],q=b.feet[bone],dt=b.time-a.time;
  const valid=p[1]<=minY+height&&q[1]<=minY+height&&Math.abs((q[1]-p[1])/dt)<=thresholds.maxAbsVerticalSpeed&&Math.hypot(q[0]-p[0],q[2]-p[2])/dt>=thresholds.minHorizontalSpeed;
  if(valid){if(!segment.length)segment=[i];segment.push(i+1);}else if(segment.length){segments.push(segment);segment=[];}
 }if(segment.length)segments.push(segment);
 const accepted=[];
 for(const group of segments){const candidates=[];for(let start=0;start<=group.length-thresholds.minSamples;start++)for(let end=start+thresholds.minSamples;end<=group.length;end++){
   const value=fit(rows,bone,group.slice(start,end));
   if(value.fitRmsMeters<=thresholds.maxFitRms&&value.speedCv<=thresholds.maxSpeedCv&&value.minVelocityDirectionCos>=thresholds.minVelocityDirectionCos)candidates.push(value);
  }
  candidates.sort((a,b)=>b.sampleCount-a.sampleCount||a.fitRmsMeters-b.fitRmsMeters);if(candidates.length)accepted.push(candidates[0]);
 }
 accepted.sort((a,b)=>b.sampleCount-a.sampleCount||a.fitRmsMeters-b.fitRmsMeters);
 return{minimumHeightMeters:minY,heightThresholdMeters:height,selected:accepted[0]||null,allSegments:accepted};
}
const expectedDirection={n:[0,1],ne:[-Math.SQRT1_2,Math.SQRT1_2],e:[-1,0],se:[-Math.SQRT1_2,-Math.SQRT1_2],s:[0,-1],sw:[Math.SQRT1_2,-Math.SQRT1_2],w:[1,0],nw:[Math.SQRT1_2,Math.SQRT1_2]};
const results=[];
for(const family of families)for(const mode of modes)for(const direction of directions){
 const key=`world.${family}.${mode}_${direction}_${family}`,entry=clips.get(key);if(!entry)throw Error('Missing prepared original clip '+key);
 for(const actor of actors){
  const t=await trajectory(actor,entry),feet=Object.fromEntries(['ball_L','ball_R','ankle_L','ankle_R'].map(bone=>[bone,contact(t,bone)])),left=feet.ball_L.selected,right=feet.ball_R.selected;
  let derived=null;if(left&&right){const speed=(left.speedMetersPerSecond+right.speedMetersPerSecond)/2,v=[-(left.velocityXZ[0]+right.velocityXZ[0])/2,-(left.velocityXZ[1]+right.velocityXZ[1])/2],norm=Math.hypot(...v),directionXZ=v.map(x=>x/norm),expected=expectedDirection[direction],cos=directionXZ[0]*expected[0]+directionXZ[1]*expected[1],lrCos=(left.velocityXZ[0]*right.velocityXZ[0]+left.velocityXZ[1]*right.velocityXZ[1])/(left.speedMetersPerSecond*right.speedMetersPerSecond);
   const relativeDifference=Math.abs(left.speedMetersPerSecond-right.speedMetersPerSecond)/speed,minWindow=Math.min(...[left,right].map(value=>value.seconds[1]-value.seconds[0]));
   derived={classification:'kinematically-derived-candidate-not-retail-stride',nominalSpeedMetersPerSecond:speed,nominalSpeedSourceUnitsPerSecond:speed/.0254,strideMeters:speed*t.duration,strideSourceUnits:speed*t.duration/.0254,leftRightSpeedRange:[Math.min(left.speedMetersPerSecond,right.speedMetersPerSecond),Math.max(left.speedMetersPerSecond,right.speedMetersPerSecond)],leftRightRelativeDifference:relativeDifference,leftRightDirectionCos:lrCos,nominalDirectionModelXZ:directionXZ,expectedDirectionModelXZ:expected,directionCos:cos,directionErrorDegrees:Math.acos(Math.max(-1,Math.min(1,cos)))*180/Math.PI,oldStride1_6CadenceMultiplier:speed*t.duration/1.6,
    uncertainty:{classification:relativeDifference>thresholds.maxLeftRightRelativeDifference?'low':relativeDifference<.05&&minWindow>=.099?'higher':'moderate',relativeHalfSpread:relativeDifference/2,minContactWindowSeconds:minWindow,strideRangeMeters:[Math.min(left.speedMetersPerSecond,right.speedMetersPerSecond)*t.duration,Math.max(left.speedMetersPerSecond,right.speedMetersPerSecond)*t.duration]},
    recommendedUse:lrCos>.9&&cos>.95&&relativeDifference<=thresholds.maxLeftRightRelativeDifference?'per-clip-derived-phase-candidate':'review-direction-or-large-left-right-asymmetry'};
  }
  const balls=['ball_L','ball_R'].filter(bone=>feet[bone].selected),evidenceBones=balls.length?balls:['ankle_L','ankle_R'].filter(bone=>feet[bone].selected);
  let directionEvidence=null,singleFootCandidate=null;
  if(evidenceBones.length){
   const measured=evidenceBones.map(bone=>feet[bone].selected),back=[0,1].map(axis=>measured.reduce((n,value)=>n+value.velocityXZ[axis],0)/measured.length),length=Math.hypot(...back),motion=back.map(value=>-value/length),expected=expectedDirection[direction],cos=motion[0]*expected[0]+motion[1]*expected[1];
   directionEvidence={bones:evidenceBones,nominalDirectionModelXZ:motion,expectedDirectionModelXZ:expected,directionCos:cos,errorDegrees:Math.acos(Math.max(-1,Math.min(1,cos)))*180/Math.PI,confirmedSigns:cos>.95};
   if(!derived){const speed=measured.reduce((n,value)=>n+value.speedMetersPerSecond,0)/measured.length;singleFootCandidate={nominalSpeedMetersPerSecond:speed,strideMeters:speed*t.duration,evidenceBones,classification:'single-foot-or-ankle-only-low-confidence',recommendedUse:'evidence-only; keep original authored time or explicitly reviewed fallback until bilateral contact is validated'};}
  }
  const sensitivity={};for(const height of [.01,.02]){const a=contact(t,'ball_L',height).selected,b=contact(t,'ball_R',height).selected;sensitivity[height]=a&&b?{speed:(a.speedMetersPerSecond+b.speedMetersPerSecond)/2,stride:(a.speedMetersPerSecond+b.speedMetersPerSecond)/2*t.duration}:null;}
  results.push({actor,key,durationSeconds:t.duration,frameCount:t.frames,sourceFramesPerSecond:t.fps,model:t.model,clip:t.clip,rootTranslation:t.rootTranslation,feet,derived,singleFootCandidate,directionEvidence,sensitivity,trajectory:t.rows});
 }
}
const report={schema:'cscs.cs2.locomotion-kinematics-audit.v1',axes:'glTF metres: Y up, model +Z forward, +X source-left. Actor yaw+PI maps model -X to world/screen +X at yaw0.',units:{distance:'metres',sourceUnitToMeters:.0254,time:'seconds'},thresholds,method:'Source-frame TRS tracks -> original model world matrices -> ankle/ball. Low-Y continuous contact intervals exclude cycle seam; least-squares XZ velocity. Prefer ball contact; reject unstable ankle rolling by RMS/CV/direction criteria. Nominal speed is inverse stance-foot velocity; strideCandidate=nominalSpeed*originalDuration. No root displacement is fabricated.',limitations:['In-place rootMotion is zero and does not encode retail stride.','Foot-derived values are kinematic candidates, not evidence of retail animation-graph time warping or IK.','CT/T share original world tracks; identical results are not independent mocap samples.','Short contact windows, rolling feet and left/right asymmetry bound confidence; use reported ranges and sensitivity.','Only animation phase should consume derived candidates; never alter player velocity, physics or ballistics from this report.'],results};
const reportText=JSON.stringify(report,null,2)+'\n';
await fs.writeFile(path.join(root,'.local/cs2/content',outputArg),reportText);
const candidateName=outputArg.replace(/\.json$/,'.candidates.json'),sourceResults=results.filter(row=>row.actor==='ctm_sas');
const candidates={schema:'cscs.cs2.locomotion-phase-candidates.v1',classification:'derived-from-contact-trajectories-not-retail-constants',units:'metres and seconds',sourceReport:outputArg,thresholds,
 verifiedInputModelCount:actors.length,clipCandidates:Object.fromEntries(sourceResults.filter(row=>row.derived?.recommendedUse==='per-clip-derived-phase-candidate').map(row=>[row.key,{...row.derived,durationSeconds:row.durationSeconds,source:row.clip.source,gltfSHA256:row.clip.sha256}])),
 weakCandidates:Object.fromEntries(sourceResults.filter(row=>row.derived?.recommendedUse!=='per-clip-derived-phase-candidate').map(row=>[row.key,row.singleFootCandidate||row.derived])),directionEvidence:Object.fromEntries(sourceResults.map(row=>[row.key,row.directionEvidence])),
 limitations:report.limitations};
const candidateText=JSON.stringify(candidates,null,2)+'\n';
await fs.writeFile(path.join(root,'.local/cs2/content',candidateName),candidateText);
if(publish){
 const byKey=new Map(sourceResults.map(row=>[row.key,row])),clipStrides={};
 for(const row of sourceResults){
  const family=row.key.split('.')[1],mode=row.key.split('.')[2].split('_')[0],direct=row.derived?.recommendedUse==='per-clip-derived-phase-candidate',referenceClip=direct?row.key:`world.${family}.${mode}_n_${family}`,reference=byKey.get(referenceClip);
  if(!reference?.derived||reference.derived.recommendedUse!=='per-clip-derived-phase-candidate')throw Error('Missing measured N reference for '+row.key);
  const measured=reference.derived;
  clipStrides[row.key]={strideMeters:measured.strideMeters,durationSeconds:row.durationSeconds,clipGLTFSHA256:row.clip.sha256,clipBuffers:row.clip.buffers,
   referenceClip,referenceGLTFSHA256:reference.clip.sha256,referenceBuffers:reference.clip.buffers,classification:direct?'bilateral-derived-candidate':'family-mode-n-fallback',
   source:row.clip.source,referenceSource:reference.clip.source,
   uncertainty:direct?{...measured.uncertainty,heightSensitivity:row.sensitivity}:{classification:'fallback-not-bilaterally-confirmed-for-target',reference:measured.uncertainty,targetEvidence:row.singleFootCandidate||row.derived,
    exclusionReason:row.derived?'large-left-right-speed-asymmetry':'insufficient-stable-bilateral-source-frames'},
   directionEvidence:row.directionEvidence};
 }
 const value={schema:'cscs.cs2.clip-strides.v1',units:{stride:'metres per original cycle',duration:'seconds',sourceUnitsToMeters:.0254},
  sourceReportSHA256:sha(reportText),sourceCandidateSHA256:sha(candidateText),method:'Original glTF bone-world contact trajectories; source 30fps; bilateral low-Y stance regression. Weak clips explicitly fall back to measured same-family/mode N.',thresholds,clipStrides,
  limitations:report.limitations};
 await fs.writeFile(path.join(content,'locomotion-strides.json'),JSON.stringify(value,null,2)+'\n');
 console.log('Published locomotion-strides.json',Object.keys(clipStrides).length,'entries; no rig/runtime changes');
}
for(const result of sourceResults)console.log(JSON.stringify({key:result.key,period:result.durationSeconds,nominal:result.derived?.nominalSpeedMetersPerSecond,stride:result.derived?.strideMeters,direction:result.directionEvidence?.nominalDirectionModelXZ,errorDegrees:result.directionEvidence?.errorDegrees,status:result.derived?.recommendedUse||'weak-single-foot-evidence-only'}));
