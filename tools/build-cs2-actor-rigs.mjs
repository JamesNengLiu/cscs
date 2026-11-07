// Compile only imported glTF bone tracks/capsules to a small shared runtime rig.
// Raw/derived Valve data stays in ignored public/assets; this tool contains no data.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Matrix4,Vector3,Quaternion} from 'three';
export async function compileActorRig({modelFile,metadataFile,clips,actions,output,actionsByWeapon={},clipStrides=null}){
 const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
 const model=JSON.parse(await readFile(modelFile,'utf8')),metadata=JSON.parse(await readFile(metadataFile,'utf8'));
 if(metadata.schema!=='cscs.cs2.model-metadata.v1')throw Error('Unrecognized native model metadata');
 const named=new Map(model.nodes.map((n,i)=>[n.name,i])),s=metadata.skeleton,names=s.m_boneName,parent=s.m_nParent;
 const bones=names.map((name,i)=>{const node=model.nodes[named.get(name)];if(!node)throw Error('Bone missing from actual GLTF '+name);const p=new Vector3(),q=new Quaternion(),scale=new Vector3(1,1,1);if(node.matrix)new Matrix4().fromArray(node.matrix).decompose(p,q,scale);else{if(node.translation)p.fromArray(node.translation);if(node.rotation)q.fromArray(node.rotation);if(node.scale)scale.fromArray(node.scale);}return{name,parent:parent[i],position:p.toArray(),rotation:q.toArray(),scale:scale.toArray()};});
 const values=[],compiled={};
 for(const clip of clips){
  const doc=JSON.parse(await readFile(clip.file,'utf8')),buffers=await Promise.all((doc.buffers||[]).map(b=>{if(b.uri?.startsWith('data:'))return Buffer.from(b.uri.split(',')[1],'base64');return readFile(path.resolve(path.dirname(clip.file),b.uri));}));
  const read=index=>{const a=doc.accessors[index],v=doc.bufferViews[a.bufferView],width={SCALAR:1,VEC3:3,VEC4:4}[a.type];if(a.componentType!==5126||!width||a.sparse)throw Error('Unsupported native animation accessor');const out=[],buf=buffers[v.buffer];for(let i=0;i<a.count;i++)for(let k=0;k<width;k++){const at=(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||width*4)+k*4;if(at+4>buf.length)throw Error('Animation outside buffer');out.push(buf.readFloatLE(at));}return{values:out,count:a.count};};
  const animation=doc.animations?.find(a=>a.name===clip.name)||(!clip.name&&doc.animations?.length===1?doc.animations[0]:null);if(!animation)throw Error('Explicit original animation missing: '+clip.key);
  const tracks=[];let duration=Number.isFinite(clip.duration)&&clip.duration>0?clip.duration:0;
  for(const c of animation.channels){const name=doc.nodes[c.target.node].name,bone=names.indexOf(name);if(bone<0)continue;const sampler=animation.samplers[c.sampler];if(!['LINEAR','STEP',undefined].includes(sampler.interpolation))throw Error('Unsupported original animation interpolation');const input=read(sampler.input),output=read(sampler.output);if(input.count!==output.count)throw Error('Animation key-count mismatch');const times=values.length;values.push(...input.values);const at=values.length;values.push(...output.values);duration=Math.max(duration,input.values.at(-1)||0);tracks.push({bone,path:c.target.path,times,values:at,count:input.count,interpolation:sampler.interpolation||'LINEAR'});}
  if(new Set(tracks.map(t=>t.bone)).size<Math.min(10,bones.length)||duration<=0)throw Error('Incomplete native animation coverage '+clip.key);
  const stride=clipStrides?.clipStrides?.[clip.key];if(stride){if(!(stride.strideMeters>.1&&stride.strideMeters<10)||Math.abs(stride.durationSeconds-duration)>.001||stride.clipGLTFSHA256!==hash(await readFile(clip.file)))throw Error('Stride evidence does not match original clip '+clip.key);for(const b of stride.clipBuffers||[])if(hash(await readFile(path.resolve(path.dirname(clip.file),b.uri)))!==b.sha256)throw Error('Stride animation buffer changed');}
  compiled[clip.key]={duration,tracks,source:clip.source||null};
 }
 for(const key of ['idle','run','crouch'])if(!compiled[actions?.[key]])throw Error('Required native action missing: '+key);
 const hitboxes=metadata.hitboxSets?.cstrike?.m_HitBoxes?.map(h=>{const bone=names.findIndex(n=>n.toLowerCase()===h.m_sBoneName.toLowerCase());if(bone<0||h.m_nShapeType!==2||!(h.m_flShapeRadius>0))throw Error('Unsupported authored hit volume');return{name:h.m_name,bone,group:h.m_nGroupId,a:h.m_vMinBounds.map(v=>v*.0254),b:h.m_vMaxBounds.map(v=>v*.0254),radius:h.m_flShapeRadius*.0254};});
 if(!hitboxes?.length)throw Error('Native capsules missing');
 const bytes=Buffer.from(new Float32Array(values).buffer);
 const rig={schema:'cscs.cs2.rig.v1',source:metadata.source,modelSHA256:hash(await readFile(modelFile)),metadataSHA256:hash(await readFile(metadataFile)),buffer:path.basename(output)+'.bin',bufferSHA256:hash(bytes),bufferBytes:bytes.length,bones,clips:compiled,actions,actionsByWeapon,clipStrides:clipStrides?.clipStrides||null,strideEvidence:clipStrides?{schema:clipStrides.schema,classification:'contact-derived-candidates-with-explicit-direction-fallbacks',sourceReportSHA256:clipStrides.sourceReportSHA256,method:clipStrides.method,limitations:clipStrides.limitations}:null,hitboxes,rootMotion:'root_motion',yawOffset:Math.PI,stride:1.6,units:'metres',limitations:['Imported clips with shared sampling; retail animation graph, IK, constraints and ragdoll are not ported.','Root horizontal displacement is removed; authoritative movement owns player position.']};
 await writeFile(output+'.bin',bytes);await writeFile(output+'.json',JSON.stringify(rig));return rig;
}
if(process.argv[1]&&path.resolve(process.argv[1])===new URL(import.meta.url).pathname){const config=JSON.parse(await readFile(process.argv[2],'utf8'));for(const spec of config.models)console.log((await compileActorRig(spec)).source);}
