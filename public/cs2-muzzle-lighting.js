// PBR-compatible experimental pulse; a fixed shader uniform never adds per-shot light counts.
import {prepareCosmetics} from './prepare-cosmetics.js';
// Optional single pulse. Prepare a matching material program off-scene first;
// install callbacks on the owned original only after the async program is ready.
export function createMuzzleLighting(THREE,{renderer=null,camera=null}={}){
 const uniforms={lsFlashPosition:{value:new THREE.Vector3()},lsFlashColor:{value:new THREE.Color(0xffc88a)},lsFlashStrength:{value:0},lsFlashRange:{value:3.2}},known=new WeakMap(),entries=new Set(),jobs=new Set();
 let enabled=false,until=0,at=0,priority=-Infinity,baseStrength=0,failures=0;
 function apply(entry,on){if(entry.disposed||on&&!entry.ready||entry.applied===on)return;entry.material.onBeforeCompile=on?entry.compile:entry.previous;entry.material.customProgramCacheKey=on?()=>entry.key:entry.previousKey;entry.material.needsUpdate=true;entry.applied=on;}
 return {
  setEnabled(value){enabled=!!value;if(!enabled)uniforms.lsFlashStrength.value=0;for(const entry of entries)apply(entry,enabled);},
  prepare(scene,{force=false}={}){if(!enabled&&!force)return 0;const pending=[],newEntries=[];scene.traverse(object=>{for(const material of [].concat(object.material||[])){if(known.has(material)){known.get(material).layers|=object.layers.mask;continue;}if(!material.isMeshBasicMaterial&&!material.isMeshLambertMaterial&&!material.isMeshStandardMaterial)continue;
   const entry={material,previous:material.onBeforeCompile,previousKey:material.customProgramCacheKey,layers:object.layers.mask,key:material.customProgramCacheKey()+'|ls-flash-v1',ready:false,finished:false,applied:false,disposed:false};known.set(material,entry);entries.add(entry);
   entry.compile=shader=>{entry.previous.call(material,shader);Object.assign(shader.uniforms,uniforms);shader.vertexShader='varying vec3 lsFlashWorld;\n'+shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvec4 lsP=vec4(transformed,1.0);\n#ifdef USE_INSTANCING\nlsP=instanceMatrix*lsP;\n#endif\nlsFlashWorld=(modelMatrix*lsP).xyz;');shader.fragmentShader='varying vec3 lsFlashWorld;uniform vec3 lsFlashPosition;uniform vec3 lsFlashColor;uniform float lsFlashStrength;uniform float lsFlashRange;\n'+shader.fragmentShader.replace('#include <tonemapping_fragment>','if(lsFlashStrength>0.0){float f=max(0.0,1.0-distance(lsFlashWorld,lsFlashPosition)/lsFlashRange);gl_FragColor.rgb+=lsFlashColor*lsFlashStrength*f*f;}\n#include <tonemapping_fragment>');};
   const clone=material.clone();clone.onBeforeCompile=entry.compile;clone.customProgramCacheKey=()=>entry.key;entry.clone=clone;
   material.addEventListener('dispose',()=>{if(entry.disposed)return;entry.disposed=true;if(entry.finished)clone.dispose();entries.delete(entry);});
   const representative=object.clone(false);representative.material=Array.isArray(object.material)?object.material.map(m=>m===material?clone:m):clone;entry.representative=representative;pending.push(representative);newEntries.push(entry);
  }});
  if(newEntries.length){const done=ok=>{for(const entry of newEntries){entry.finished=true;entry.ready=ok;if(entry.disposed)entry.clone.dispose();else if(enabled)apply(entry,true);}if(!ok)failures++;};if(renderer&&camera){const job=prepareCosmetics(THREE,renderer,camera,scene,{objects:pending}).then(done).finally(()=>jobs.delete(job));jobs.add(job);}else done(true);}return newEntries.length;},
  async settled(){while(jobs.size)await Promise.allSettled([...jobs]);},
  representatives(){const groups=new Map();for(const entry of entries){if(entry.disposed||!entry.ready)continue;
   const cached=renderer?.properties?.get(entry.clone)?.currentProgram?.cacheKey,object=entry.representative,material=entry.clone;
   const fallback=JSON.stringify([material.type,entry.key,material.side,material.transparent,material.alphaTest>0,material.vertexColors,material.flatShading,object.isSkinnedMesh,object.isInstancedMesh,!!object.instanceColor,Object.keys(object.geometry?.morphAttributes||{}),Object.entries(object.geometry?.attributes||{}).map(([k,v])=>[k,v.itemSize]),...['map','normalMap','roughnessMap','metalnessMap','aoMap','lightMap','alphaMap','emissiveMap','bumpMap','displacementMap','envMap'].map(k=>[k,!!material[k],material[k]?.channel,material[k]?.colorSpace])]);
   for(const baseline of [false,true]){const key=(cached||fallback).replace(baseline?'|ls-flash-v1':'__never_replace__','')+'|state:'+baseline;let group=groups.get(key);if(group){group.layers.mask|=entry.layers;continue;}
    let representative=entry.representative;if(baseline){const plain=entry.material.clone();plain.onBeforeCompile=entry.previous;plain.customProgramCacheKey=entry.previousKey;representative=entry.representative.clone(false);representative.material=plain;representative.userData.cs2WarmMaterial=true;}representative.userData.cs2WarmRepresentative=true;representative.layers.mask=entry.layers;groups.set(key,representative);
   }
  }return[...groups.values()];},
  trigger(position,now,{silenced=false,weight=1}={}){if(!enabled||!position||![position.x,position.y,position.z,now].every(Number.isFinite))return false;if(now<until&&weight<priority)return false;uniforms.lsFlashPosition.value.copy(position);at=now;until=now+.035;priority=weight;baseStrength=silenced?.06:.24;uniforms.lsFlashStrength.value=baseStrength;return true;},
  update(now){const active=enabled&&now<until;if(!active)uniforms.lsFlashStrength.value=0;else uniforms.lsFlashStrength.value=baseStrength*Math.max(0,Math.min(1,1-(now-at)/.035));return active;},
  reset(){until=0;uniforms.lsFlashStrength.value=0;},diagnostics:()=>({enabled,materials:entries.size,pending:[...entries].filter(e=>!e.finished&&!e.disposed).length,failures,active:uniforms.lsFlashStrength.value>0})
 };
}
