import * as THREE from '/vendor/three.module.js';
// Startup-only, async conservative GPU sample queries. Used to prioritize
// native texture tiers, NEVER to hide geometry. Alpha is ignored in queries
// (conservative solid triangles), but alpha/overlays never act as occluders.
export async function probeVisibleMaterials({scene,renderer,camera,entries,load,signal}){
 const gl=renderer.getContext(),wanted=new Set(),eligible=[],occluders=new Set(),savedChildren=scene.children.map(o=>[o,o.visible]);
 for(const entry of entries){const material=entry.meshes[0].material;for(const mesh of entry.meshes)if(mesh.visible){eligible.push({entry,mesh});if(!material.transparent&&!material.alphaTest&&!material.polygonOffset)occluders.add(mesh);}}
 const allowed=new Set(eligible.map(e=>e.mesh)),depth=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:true,side:THREE.FrontSide}),test=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false,side:THREE.DoubleSide,depthFunc:THREE.LessEqualDepth,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}),background=scene.background,override=scene.overrideMaterial,autoClear=renderer.autoClear,records=[],at=performance.now();
 try{
  scene.background=null;scene.overrideMaterial=depth;renderer.autoClear=true;for(const [o]of savedChildren)o.visible=occluders.has(o);renderer.render(scene,camera);
  for(const {entry,mesh} of eligible){const query=gl.createQuery();if(!query)throw Error('Unable to create native visibility query');records.push({entry,mesh,query,before:mesh.onBeforeRender,after:mesh.onAfterRender});mesh.onBeforeRender=()=>gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE,query);mesh.onAfterRender=()=>gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);}
  for(const [o]of savedChildren)o.visible=allowed.has(o);
  scene.overrideMaterial=test;renderer.autoClear=false;renderer.render(scene,camera);gl.flush();
  while(true){if(signal?.aborted)throw signal.reason||new DOMException('Query cancelled','AbortError');if(records.every(r=>gl.getQueryParameter(r.query,gl.QUERY_RESULT_AVAILABLE)))break;if(performance.now()-at>2000){for(const e of eligible)wanted.add(e.entry.group.material);load.materialProbeFallback=true;break;}await new Promise(requestAnimationFrame);}
  if(!load.materialProbeFallback)for(const r of records)if(gl.getQueryParameter(r.query,gl.QUERY_RESULT))wanted.add(r.entry.group.material);
 }catch(error){for(const e of eligible)wanted.add(e.entry.group.material);load.materialProbeFallback=true;load.materialProbeFallbackReason=error.message;
 }finally{for(const r of records){r.mesh.onBeforeRender=r.before;r.mesh.onAfterRender=r.after;gl.deleteQuery(r.query);}for(const [o,visible]of savedChildren)o.visible=visible;scene.background=background;scene.overrideMaterial=override;renderer.autoClear=autoClear;depth.dispose();test.dispose();}
 load.materialProbeMs=performance.now()-at;load.initialHighQualityMaterials=wanted.size;return wanted;
}
