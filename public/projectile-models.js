import {loadWeaponManifest,loadConvertedWeapon} from './weapon-model.js';

export const PROJECTILE_MODEL_LIMIT=64;
const KINDS=['hegrenade','flashbang','smokegrenade'];
const BASE='/assets/weapons/';
const requireValue=(condition,message)=>{if(!condition)throw Error(message);};

function batches(THREE,parts,kind){
  return parts.map(({geometry,material},i)=>{
    const mesh=new THREE.InstancedMesh(geometry,material,PROJECTILE_MODEL_LIMIT);
    mesh.name=`projectile:${kind}:${i}`;mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);return mesh;
  });
}
function release(template){
  for(const mesh of template.meshes)mesh.dispose();
  for(const geometry of new Set(template.meshes.map(m=>m.geometry)))geometry.dispose();
  for(const material of new Set(template.meshes.map(m=>m.material))){material.map?.dispose();material.dispose();}
}
function fallback(THREE,kind){
  const color={hegrenade:'#52613b',flashbang:'#777d80',smokegrenade:'#526452'}[kind];
  const material=new THREE.MeshBasicMaterial({color}),metal=new THREE.MeshBasicMaterial({color:'#42474a'});
  const body=new THREE.CylinderGeometry(.023,.026,kind==='hegrenade'?.066:.088,8);
  const top=new THREE.CylinderGeometry(.012,.018,.016,8);top.translate(0,.047,0);
  const lever=new THREE.BoxGeometry(.008,.07,.008);lever.translate(.025,.015,0);
  // A recognizable canister/cap/lever while loading; diagnostics explicitly label it as fallback.
  return {meshes:batches(THREE,[{geometry:body,material},{geometry:top,material:metal},{geometry:lever,material:metal}],kind),
    source:'procedural-grenade-fallback',radius:.065,halfWidth:.03,error:null,verified:false};
}

async function original(THREE,kind,entry){
  const {data,verified}=await loadConvertedWeapon(kind,entry);
  const part=data.bodyparts.findIndex(p=>p.name.toLowerCase()==='weapon');
  const selected=data.meshes.filter(m=>m.bodypart===part&&m.model===0);
  requireValue(part>=0&&selected.length>0&&selected.length<=3,'No supported separate projectile bodypart');
  // Bake only the weapon body into one rigid local frame. Hands/arms are never selected.
  const matrices=[],position=new THREE.Vector3(),q=new THREE.Quaternion(),unit=new THREE.Vector3(1,1,1),euler=new THREE.Euler();
  for(const bone of data.bones){const v=bone.value;
    const matrix=new THREE.Matrix4().compose(position.set(v[0],v[1],v[2]),q.setFromEuler(euler.set(v[3],v[4],v[5],'ZYX')),unit);
    if(bone.parent>=0)matrix.premultiply(matrices[bone.parent]);matrices.push(matrix);
  }
  const inverse=matrices[selected[0].vertexBones[0]].clone().invert();
  const basis=new THREE.Matrix4().makeRotationX(-Math.PI/2),toLocal=matrices.map(m=>new THREE.Matrix4().multiplyMatrices(basis,new THREE.Matrix4().multiplyMatrices(inverse,m)));
  const bounds=new THREE.Box3(),point=new THREE.Vector3(),specs=[];
  for(const source of selected){const positions=[],normals=[],uv=[];
    const textureIndex=data.skins[0][source.skinref],texture=data.textures[textureIndex];
    for(let i=0;i<source.vertexBones.length;i++){
      point.fromArray(source.positions,i*3).applyMatrix4(toLocal[source.vertexBones[i]]).multiplyScalar(1/40);
      positions.push(point.x,point.y,point.z);bounds.expandByPoint(point);
      point.fromArray(source.normals,i*3).transformDirection(toLocal[source.normalBones[i]]);normals.push(point.x,point.y,point.z);
      uv.push(source.uvPixels[i*2]/texture.width,source.uvPixels[i*2+1]/texture.height);
    }
    specs.push({source,positions,normals,uv,textureIndex});
  }
  const size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  requireValue(size.length()>0&&size.length()<.5,'Invalid projectile body bounds');
  const textureIndices=[...new Set(specs.map(s=>s.textureIndex))],loader=new THREE.TextureLoader();
  const loaded=await Promise.allSettled(textureIndices.map(i=>loader.loadAsync(`${BASE}${kind}/${data.textures[i].file}`)));
  if(loaded.some(r=>r.status==='rejected')){for(const r of loaded)if(r.status==='fulfilled')r.value.dispose();throw Error('Projectile texture load failed');}
  const materials=new Map(textureIndices.map((i,j)=>{
    const map=loaded[j].value;map.flipY=false;map.colorSpace=THREE.SRGBColorSpace;
    map.wrapS=map.wrapT=THREE.RepeatWrapping;map.needsUpdate=true;
    return [i,new THREE.MeshBasicMaterial({map,depthTest:true,depthWrite:true,toneMapped:false,alphaTest:data.textures[i].flags&64?.5:0})];
  }));
  const parts=specs.map(s=>{
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(s.positions,3));geometry.translate(-center.x,-center.y,-center.z);
    geometry.setAttribute('normal',new THREE.Float32BufferAttribute(s.normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(s.uv,2));geometry.setIndex(s.source.indices);
    geometry.computeBoundingSphere();return {geometry,material:materials.get(s.textureIndex)};
  });
  return {meshes:batches(THREE,parts,kind),source:'viewmodel-weapon-body',radius:size.length()/2,halfWidth:size.x/2,
    error:null,verified,sourceSHA256:data.metadata.sourceSHA256,bodypart:data.bodyparts[part].name,triangles:parts.reduce((n,p)=>n+p.geometry.index.count/3,0)};
}

export function createProjectileModels(THREE,scene,{onChange=()=>{},loadAssets=true}={}){
  const models=Object.fromEntries(KINDS.map(kind=>[kind,fallback(THREE,kind)]));
  for(const model of Object.values(models))for(const mesh of model.meshes)scene.add(mesh);
  let disposed=false,peak=0;
  const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),euler=new THREE.Euler(),matrix=new THREE.Matrix4(),unit=new THREE.Vector3(1,1,1);
  const info=()=>({peak,batches:Object.values(models).reduce((n,m)=>n+m.meshes.length,0),capacity:PROJECTILE_MODEL_LIMIT,
    models:KINDS.map(kind=>({kind,source:models[kind].source,error:models[kind].error,verified:models[kind].verified,
      sourceSHA256:models[kind].sourceSHA256||null,bodypart:models[kind].bodypart||null,triangles:models[kind].triangles||0}))});
  const ready=loadAssets?(async()=>{
    try{const manifest=await loadWeaponManifest();
      await Promise.all(KINDS.map(async kind=>{
        try{const next=await original(THREE,kind,manifest.weapons[kind]);
          if(disposed){release(next);return;}
          const old=models[kind];for(const mesh of old.meshes)scene.remove(mesh);release(old);models[kind]=next;
          for(const mesh of next.meshes)scene.add(mesh);onChange();
        }catch(error){if(!disposed){models[kind].error=String(error.message||error);onChange();}}
      }));
    }catch(error){if(!disposed){for(const model of Object.values(models))model.error=String(error.message||error);onChange();}}
    return info();
  })():Promise.resolve(info());
  return {ready,info,
    update(projectiles,time){
      if(disposed||!Number.isFinite(time))return;
      const counts={hegrenade:0,flashbang:0,smokegrenade:0};
      for(const [i,p] of projectiles.slice(0,PROJECTILE_MODEL_LIMIT).entries()){
        if(!Object.hasOwn(models,p?.kind)||![p.x,p.y,p.z].every(Number.isFinite))continue;
        const model=models[p.kind],index=counts[p.kind]++;
        let seed=0;for(const c of String(p.id??`${p.kind}:${i}`))seed=(Math.imul(seed,31)+c.charCodeAt(0))>>>0;
        const angle=(seed%6283)/1000,age=!p.resting&&Number.isFinite(p.bornAt)?Math.max(0,time-p.bornAt):0;
        euler.set(p.resting?0:angle+age*6,angle+age*3,p.resting?Math.PI/2:angle*.7+age*4);
        position.set(p.x,p.y+(p.resting?model.halfWidth:model.radius),p.z);
        matrix.compose(position,rotation.setFromEuler(euler),unit);
        for(const mesh of model.meshes)mesh.setMatrixAt(index,matrix);
      }
      peak=Math.max(peak,Object.values(counts).reduce((a,b)=>a+b,0));
      for(const kind of KINDS)for(const mesh of models[kind].meshes){mesh.count=counts[kind];mesh.visible=mesh.count>0;mesh.instanceMatrix.needsUpdate=true;}
    },
    dispose(){if(disposed)return;disposed=true;for(const model of Object.values(models)){for(const mesh of model.meshes)scene.remove(mesh);release(model);}}
  };
}
