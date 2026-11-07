import * as THREE from '/vendor/three.module.js';
import {decodeOptimizedMap,createWorkingIndices} from './cs2-optimized-format.js';
import {createWorldVisibility} from './cs2-visibility.js';
import {createTextureStream} from './cs2-texture-stream.js';
import {createMapIndexUploadManager} from './cs2-index-upload.js';
import {createSourceMaterials} from './cs2-materials.js';
import {probeVisibleMaterials} from './cs2-material-probe.js';
const BASE='/assets/cs2-optimized/';
const tick=()=>new Promise(requestAnimationFrame);
export async function loadOptimizedMap({scene,renderer,camera,progress,load,prepareActors,prepareEffects,initialView,signal}){
 const active=()=>{if(signal?.aborted)throw signal.reason||new DOMException('Map loading cancelled','AbortError');};active();
 const query=new URLSearchParams(location.search),cull=query.get('culling')!=='none',pvsEnabled=query.get('pvs')!=='0',batching=query.get('batch')!=='0';
 renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{throw Error('优化材质编译失败：'+(gl.getShaderInfoLog(fragment)||gl.getShaderInfoLog(vertex)||gl.getProgramInfoLog(program)));};
 for(const extension of ['EXT_texture_compression_bptc','EXT_texture_compression_rgtc','WEBGL_compressed_texture_s3tc'])if(!renderer.getContext().getExtension(extension))throw Error('Native compressed textures unavailable: '+extension);
 const fetchJson=async name=>{const r=await fetch(BASE+name,{signal});if(!r.ok)throw Error('缺少优化资源 '+name);return r.json();},metaAt=performance.now();
 const [manifest,textureIndex]=await Promise.all(['map.json','textures.json'].map(fetchJson));load.metadataMs=performance.now()-metaAt;
 load.visibilityDownloadBytes=manifest.visibility.downloadBytes;
 active();async function inflate(url){const response=await fetch(url,{signal});if(!response.ok||!response.body)throw Error('加载失败 '+url);const data=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();active();return data;}
 const begin=performance.now();let geometryPromise=inflate(BASE+manifest.geometry.file);const visibilityPromise=inflate(BASE+manifest.visibility.file);
 // Prefetch may outlive an initial-view rejection; mark it handled until the
 // caller cancels the shared signal, while still awaiting it on the normal path.
 void geometryPromise.catch(()=>{});void visibilityPromise.catch(()=>{});
 const actorsPrepared=prepareActors?.();prepareEffects?.();
 if(initialView){const view=await initialView(manifest);active();if(!['eye','target'].every(k=>Array.isArray(view?.[k])&&view[k].length===3&&view[k].every(Number.isFinite)))throw Error('Invalid initial experimental camera');camera.position.fromArray(view.eye);camera.lookAt(new THREE.Vector3().fromArray(view.target));}
 else{const spawn=manifest.spawns.find(s=>s.team==='T'),angle=spawn.sourceAngles[1]*Math.PI/180;camera.position.fromArray(spawn.position);camera.position.y+=1.65;camera.lookAt(camera.position.clone().add(new THREE.Vector3(Math.sin(angle)*8,0,Math.cos(angle)*8)));}camera.updateMatrixWorld();
 const stream=await createTextureStream({renderer,index:textureIndex,base:BASE,progress,inflate});const stopStream=()=>stream.dispose();signal?.addEventListener('abort',stopStream,{once:true});active();const visibility=createWorldVisibility(manifest.visibility,await visibilityPromise);
 let boot=true,disposed=false;const pumpBoot=async()=>{while(boot&&!disposed&&!signal?.aborted){await tick();if(!boot||disposed||signal?.aborted)break;const at=performance.now();for(let i=0;i<8&&performance.now()-at<2;i++)if(!stream.pump())break;}};void pumpBoot();
 const frustum=new THREE.Frustum(),clip=new THREE.Matrix4(),groups=manifest.geometry.groups;
 const parts=groups.map(group=>group.parts.map(part=>({...part,box:new THREE.Box3(new THREE.Vector3().fromArray(part.bounds.min),new THREE.Vector3().fromArray(part.bounds.max)),shown:false})));
 const selections=parts.map(list=>new Uint8Array(list.length));let lastRowPosition=null,cachedRow=null;
 function selection(){camera.updateMatrixWorld();frustum.setFromProjectionMatrix(clip.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));const position=camera.position.toArray();
  if(!lastRowPosition||position.some((v,i)=>v!==lastRowPosition[i])){lastRowPosition=position;cachedRow=cull&&pvsEnabled?visibility.row(position):null;}const row=cachedRow;
  for(let i=0;i<parts.length;i++)for(let k=0;k<parts[i].length;k++){const part=parts[i][k];selections[i][k]=Number(!cull||(visibility.visible(row,manifest.visibility.lists[part.visibility])&&frustum.intersectsBox(part.box)));}return selections;
 }
 let selected=selection(),activeMaterials=new Set(groups.filter((g,i)=>selected[i].some(Boolean)).map(g=>g.material));
 let currentReady=Promise.resolve(),initialProbeLimited=true;
 let decoded=await decodeOptimizedMap(manifest,await geometryPromise);active();geometryPromise=null;load.transferAndInflateMs=performance.now()-begin;load.geometryDecodedBytes=manifest.geometry.bytes;
 const texture=stream.texture,light=texture(manifest.lighting.irradiance,{clamp:true,channel:1}),direction=texture(manifest.lighting.direction,{clamp:true}),shadows=texture(manifest.lighting.shadows,{clamp:true}),sky=texture('materials/skybox/sky_de_dust2_exr_908a35ba.vtex_c',{clamp:true});
 scene.background=sky;const axisRotation=new THREE.Matrix4().set(0,1,0,0,0,0,1,0,1,0,0,0,0,0,0,1),skyRotation=new THREE.Euler().setFromRotationMatrix(axisRotation);scene.backgroundRotation.copy(skyRotation);scene.environment=sky;scene.environmentRotation.copy(skyRotation);scene.environmentIntensity=.22;
 const sun=scene.children.find(o=>o.isDirectionalLight);for(const o of scene.children.filter(o=>o.isHemisphereLight))o.intensity=0;const pitch=manifest.lighting.sunAngles[0]*Math.PI/180,yaw=manifest.lighting.sunAngles[1]*Math.PI/180;sun.position.set(-Math.cos(pitch)*Math.sin(yaw),Math.sin(pitch),-Math.cos(pitch)*Math.cos(yaw)).multiplyScalar(100);sun.color.setRGB(...manifest.lighting.sunColor.map(c=>c/255),THREE.SRGBColorSpace);sun.intensity=2**manifest.lighting.sunBrightness;
 const {getMaterial}=createSourceMaterials({manifest,texture,light,direction,shadows}),meshes=[],entries=[],buildAt=performance.now();
 for(let i=0;i<groups.length;i++){active();
  const group=groups[i],data=decoded[i],material=getMaterial(group.material,group.mode);material.defaultAttributeValues={cs2Baked:[0,0,0]};
  const attributes={};for(const [key,name,size,normalized]of [['position','position',3,false],['normal','normal',3,true],['tangent','tangent',4,true],['uv','uv',2,false],['uv1','uv1',2,false],['color','color',3,true],['blend','cs2Blend',4,true]])attributes[name]=new THREE.BufferAttribute(data[key],size,normalized).onUpload(function(){this.array=null;});
  const groupBounds=new THREE.Box3();for(const part of parts[i])groupBounds.union(part.box);
  function geometry(box=groupBounds){const g=new THREE.BufferGeometry();for(const [name,attribute]of Object.entries(attributes))g.setAttribute(name,attribute);g.boundingBox=box.clone();g.boundingSphere=box.getBoundingSphere(new THREE.Sphere());return g;}
  const sourceIndex=data.index.slice(),entry={group,data:{index:sourceIndex},parts:parts[i],geometries:[],meshes:[],working:null};
  if(!batching||material.transparent){const index=new THREE.BufferAttribute(sourceIndex,1);for(const part of parts[i]){const g=geometry(part.box);g.setIndex(index);g.setDrawRange(part.start,part.count);const mesh=new THREE.Mesh(g,material);mesh.name=group.key+':'+part.start;mesh.frustumCulled=false;mesh.matrixAutoUpdate=false;scene.add(mesh);entry.geometries.push(g);entry.meshes.push(mesh);meshes.push(mesh);}}
  else{const g=geometry(),working=createWorkingIndices(group.vertices,data.index.length);g.setIndex(new THREE.BufferAttribute(working,1).setUsage(THREE.DynamicDrawUsage));const mesh=new THREE.Mesh(g,material);mesh.name=group.key;mesh.frustumCulled=false;mesh.matrixAutoUpdate=false;scene.add(mesh);entry.working=working;entry.geometries.push(g);entry.meshes.push(mesh);meshes.push(mesh);}
  entries.push(entry);if(i%12===11)await tick();
 }
 function applySelection(next){let shownParts=0,shownTriangles=0;const wanted=new Set();for(let i=0;i<entries.length;i++){const e=entries[i],list=next[i];let changed=false,used=0;for(let k=0;k<e.parts.length;k++){const part=e.parts[k],visible=list[k];changed ||=part.shown!==visible;part.shown=visible;if(visible){shownParts++;shownTriangles+=part.count/3;wanted.add(e.group.material);}}
   if(e.working){if(changed||!e.initialized){for(let k=0;k<list.length;k++)if(list[k]){const part=e.parts[k];e.working.set(e.data.index.subarray(part.start,part.start+part.count),used);used+=part.count;}const g=e.geometries[0];g.setDrawRange(0,used);if(used){g.index.clearUpdateRanges();g.index.addUpdateRange(0,used);g.index.needsUpdate=true;}e.meshes[0].visible=used>0;e.initialized=true;}}
   else for(let k=0;k<list.length;k++)e.meshes[k].visible=list[k];
  }return{wanted,shownParts,shownTriangles};
 }
 let counters=applySelection(selected),lastMatrix=camera.matrixWorld.elements.slice(),lastProjection=camera.projectionMatrix.elements.slice(),lastTrim=0,updates=0;
 load.buildMs=performance.now()-buildAt;
 progress('预热全图材质与缓冲，保证首屏原始精度…');const warmAt=performance.now();
 // Compile every material while loading, including currently hidden regions.
 await actorsPrepared;active();for(const mesh of meshes)mesh.visible=true;await renderer.compileAsync(scene,camera);active();
 const allTextures=[...stream.allTextures()];for(let i=0;i<allTextures.length;i++){active();renderer.initTexture(allTextures[i]);if(i%12===11)await tick();}
 renderer.setScissorTest(true);renderer.setScissor(0,0,1,1);for(const mesh of meshes)mesh.visible=false;
 for(let i=0;i<entries.length;i+=12){active();for(const e of entries.slice(i,i+12)){for(const mesh of e.meshes)mesh.visible=true;if(e.working){e.working.set(e.data.index);e.geometries[0].setDrawRange(0,e.data.index.length);e.geometries[0].index.needsUpdate=true;}}
  renderer.render(scene,camera);for(const e of entries.slice(i,i+12))for(const mesh of e.meshes)mesh.visible=false;await tick();}
 for(const e of entries)e.initialized=false;counters=applySelection(selected);renderer.setScissorTest(false);
 const firstMaterials=await probeVisibleMaterials({scene,renderer,camera,entries,load,signal});active();currentReady=stream.wanted([...firstMaterials].map(i=>manifest.materials[i]));await currentReady;active();renderer.render(scene,camera);load.prewarmMs=performance.now()-warmAt;boot=false;
 const initial=stream.info(),retainedGeometryCPUBytes=entries.reduce((sum,e)=>sum+e.data.index.byteLength+(e.working?.byteLength||0),0),estimatedGeometryGPUBytes=manifest.geometry.bytes-entries.reduce((sum,e)=>sum+e.data.index.byteLength,0)+entries.reduce((sum,e)=>sum+(e.working?.byteLength||e.data.index.byteLength),0);decoded=null;Object.assign(load,{initialTextureDownloadBytes:initial.downloadBytes,textureDownloadBytes:initial.downloadBytes,textureBufferBytes:initial.textureBufferBytes,estimatedTextureGPUBytes:initial.estimatedTextureGPUBytes,nativeTextureCount:initial.textures,firstViewFullQuality:true,retainedGeometryCPUBytes,estimatedGeometryGPUBytes,staticCpuAttributesReleased:true});
 let passWarming=false,passWarmup=null;
 async function prewarmPass(draw,{budgetMs=4,maxGroups=12}={}){
  if(typeof draw!=='function'||!Number.isFinite(budgetMs)||budgetMs<=0||!Number.isSafeInteger(maxGroups)||maxGroups<1||maxGroups>12)throw Error('Invalid map render-pass warmup');
  if(passWarming)throw Error('Map render-pass warmup is already running');active();passWarming=true;const started=performance.now(),downloadBefore=stream.info().downloadBytes;let batches=0,peakSubmitMs=0,groups=0,batchSize=Math.min(4,maxGroups),turnGroups=0,turnStarted=performance.now();
  try{
   // Queue target-specific KHR programs before the first actual draw. Compile
   // does not request high mips or need to upload hidden full indices.
   for(const mesh of meshes)mesh.visible=true;
   let compile;try{compile=draw({compileOnly:true});}finally{for(const mesh of meshes)mesh.visible=false;}const compileStats=await compile;active();
   for(let start=0;start<entries.length;){const batch=entries.slice(start,start+batchSize);for(const e of batch){for(const mesh of e.meshes)mesh.visible=true;if(e.working){e.working.set(e.data.index);const g=e.geometries[0];g.setDrawRange(0,e.data.index.length);g.index.clearUpdateRanges();g.index.addUpdateRange(0,e.data.index.length);g.index.needsUpdate=true;}}
    const at=performance.now();let result;try{result=await draw({compile:false});}finally{for(const e of batch)for(const mesh of e.meshes)mesh.visible=false;}active();const submitMs=result?.submitMs??performance.now()-at;peakSubmitMs=Math.max(peakSubmitMs,submitMs);groups+=batch.length;start+=batch.length;batches++;turnGroups+=batch.length;
    batchSize=Math.max(1,Math.min(maxGroups,Math.floor(batch.length*budgetMs/Math.max(.1,submitMs))));
    if(start<entries.length&&(performance.now()-turnStarted>=budgetMs||turnGroups>=maxGroups)){await tick();active();turnGroups=0;turnStarted=performance.now();batchSize=Math.min(batchSize,maxGroups);}else batchSize=Math.min(batchSize,Math.max(1,maxGroups-turnGroups));
   }
   return passWarmup={groups,batches,totalMs:performance.now()-started,peakSubmitMs,downloadBefore,downloadAfter:stream.info().downloadBytes,budgetMs,maxGroups,programsBefore:compileStats?.programsBefore??null,programsAfter:compileStats?.programsAfter??null,scope:'Loading-only real render-pass variants; native preview textures, no full-map high-mip request'};
  }finally{for(const e of entries)e.initialized=false;selected=selection();counters=applySelection(selected);passWarming=false;}
 }
 // Install only after successful loading. Each registered map attribute owns
 // a complete drawn prefix; actor/effect buffers remain outside this manager.
 active();const indexUploads=createMapIndexUploadManager({gl:renderer.getContext(),canvas:renderer.domElement,signal});
 try{for(const entry of entries)if(entry.working)indexUploads.register(entry.working,{usage:THREE.DynamicDrawUsage});}catch(error){indexUploads.close();throw error;}
 return{manifest,geometryBuffer:null,meshes,
  prewarmPass,
  update(now){if(disposed||signal?.aborted||passWarming)return;stream.pump(now);camera.updateMatrixWorld();const matrix=camera.matrixWorld.elements,projection=camera.projectionMatrix.elements;
   if(matrix.some((v,i)=>Math.abs(v-lastMatrix[i])>1e-9)||projection.some((v,i)=>v!==lastProjection[i])){lastMatrix=matrix.slice();lastProjection=projection.slice();selected=selection();counters=applySelection(selected);updates++;const ids=counters.wanted;if(initialProbeLimited||ids.size!==activeMaterials.size||[...ids].some(i=>!activeMaterials.has(i))){initialProbeLimited=false;activeMaterials=ids;currentReady=stream.wanted([...ids].map(i=>manifest.materials[i]));void currentReady.catch(()=>{});}}
   if(now-lastTrim>1000){lastTrim=now;stream.trim();}
  },settled:async()=>{await currentReady;active();const error=renderer.getContext().getError();if(error!==0)throw Error('WebGL error after streaming: '+error);return stream.info();},info:()=>({...stream.info(),...counters,wanted:undefined,updates,pvs:pvsEnabled,culling:cull,batching,retainedGeometryCPUBytes,passWarming,passWarmup}),dispose(){disposed=true;boot=false;indexUploads.close();signal?.removeEventListener('abort',stopStream);stream.dispose();}};
}
