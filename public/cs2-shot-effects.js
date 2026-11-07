// Isolated CS2 presentation adapter. Impact behavior is unchanged; its extra
// glow material is exposed as a detached, attribute-identical warmup proxy.
import {prepareCosmetics} from './prepare-cosmetics.js';
import {impactProfile,cosmeticRandom} from './impact-profile.js';
// Original procedural impact art; no imported game decals or visible bullet trails.
export const SHOT_FX_LIMITS=Object.freeze({decals:256,variants:4,dust:128,debris:192,decalSeconds:60,dustSeconds:.32,debrisSeconds:.8});
const validVector=v=>v&&[v.x,v.y,v.z].every(Number.isFinite);
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

function craterTexture(THREE,variant){
  const size=96,data=new Uint8Array(size*size*4),phase=variant*1.71;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=(x+.5)/size*2-1,v=(y+.5)/size*2-1,r=Math.hypot(u,v),angle=Math.atan2(v,u);
    const edge=.66+.055*Math.sin(angle*7+phase)+.035*Math.sin(angle*13-phase);
    const core=.22+.025*Math.sin(angle*9+phase),noise=Math.sin(x*17.13+y*37.7+phase)*.5+.5;
    let alpha=(1-smooth(edge-.1,edge+.035,r))*.76,shade=1;
    let color=[172,155,127];
    if(r<core){color=[14,12,10];alpha=.98;}
    else if(r<core+.13){shade=.36+.64*smooth(core,core+.13,r);}
    else shade=.74+.2*Math.cos(angle+.8)+noise*.14;
    if(r>core&&r<edge+.13&&Math.abs(Math.sin(angle*(3+variant)+phase+r*3))<.035){color=[33,29,24];alpha=Math.max(alpha,.65);}
    const i=(y*size+x)*4;
    for(let c=0;c<3;c++)data[i+c]=Math.round(color[c]*shade);
    data[i+3]=Math.round(alpha*255);
  }
  const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
  texture.colorSpace=THREE.SRGBColorSpace;texture.generateMipmaps=true;
  texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;
  return texture;
}

export function createShotEffects(THREE,scene,{random=null}={}){
  const plane=new THREE.PlaneGeometry(1,1),dustGeometry=new THREE.IcosahedronGeometry(1,0),debrisGeometry=new THREE.TetrahedronGeometry(1);
  const capacity=SHOT_FX_LIMITS.decals/SHOT_FX_LIMITS.variants;
  const matrix=new THREE.Matrix4(),zero=new THREE.Matrix4().makeScale(0,0,0);
  const position=new THREE.Vector3(),normal=new THREE.Vector3(),scale=new THREE.Vector3();
  const orientation=new THREE.Quaternion(),spin=new THREE.Quaternion(),identity=new THREE.Quaternion(),front=new THREE.Vector3(0,0,1);
  const tangent=new THREE.Vector3(),bitangent=new THREE.Vector3();
  const debrisRotation=new THREE.Euler(),debrisColor=new THREE.Color();
  const variants=Array.from({length:SHOT_FX_LIMITS.variants},(_,i)=>{
    const texture=craterTexture(THREE,i),material=new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.025,
      depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,toneMapped:false});
    const mesh=new THREE.InstancedMesh(plane,material,capacity);
    mesh.name=`bullet-hole-${i}`;mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;mesh.renderOrder=1;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh);
    return {mesh,texture,material,slots:Array(capacity).fill(null),next:0};
  });
  const dustMaterial=new THREE.MeshBasicMaterial({color:'#c4b08f',transparent:true,opacity:.48,depthTest:true,depthWrite:false});
  const dustMesh=new THREE.InstancedMesh(dustGeometry,dustMaterial,SHOT_FX_LIMITS.dust);
  dustMesh.name='bullet-impact-dust';dustMesh.count=0;dustMesh.visible=false;dustMesh.frustumCulled=false;
  dustMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(dustMesh);
  const glow=new THREE.InstancedBufferAttribute(new Float32Array(SHOT_FX_LIMITS.debris),1);glow.setUsage(THREE.DynamicDrawUsage);debrisGeometry.setAttribute('impactGlow',glow);
  const debrisMaterial=new THREE.MeshLambertMaterial({color:0xffffff,flatShading:true,depthTest:true,depthWrite:true});
  const glowMaterial=debrisMaterial.clone();
  glowMaterial.onBeforeCompile=shader=>{shader.vertexShader='attribute float impactGlow;varying float vImpactGlow;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvImpactGlow=impactGlow;');shader.fragmentShader='varying float vImpactGlow;\n'+shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vColor.rgb*vImpactGlow;');};glowMaterial.customProgramCacheKey=()=> 'impact-glow-v1';
  const debrisMesh=new THREE.InstancedMesh(debrisGeometry,debrisMaterial,SHOT_FX_LIMITS.debris);
  debrisMesh.name='bullet-impact-debris';debrisMesh.count=0;debrisMesh.visible=false;debrisMesh.frustumCulled=false;
  debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(debrisMesh);
  debrisMesh.setColorAt(0,new THREE.Color(1,1,1));
  const glowProxy=debrisMesh.clone(false);glowProxy.name='bullet-impact-debris-glow-warm';glowProxy.material=glowMaterial;glowProxy.visible=false;glowProxy.count=0;
  const dust=Array(SHOT_FX_LIMITS.dust).fill(null),debris=Array(SHOT_FX_LIMITS.debris).fill(null);
  let nextDust=0,nextDebris=0,decals=0,disposed=false,nextExpiry=Infinity,recipe=impactProfile('concrete'),rand=()=>.5,glowReady=true;
  const unit=()=>Math.max(0,Math.min(.999999,Number(rand())||0));
  function clear(){
    if(disposed)return;
    for(const v of variants){v.slots.fill(null);v.next=0;v.mesh.count=0;v.mesh.visible=false;}
    dust.fill(null);glow.array.fill(0);glow.needsUpdate=true;nextExpiry=Infinity;nextDust=0;decals=0;dustMesh.count=0;dustMesh.visible=false;
    debris.fill(null);nextDebris=0;debrisMesh.count=0;debrisMesh.visible=false;debrisMesh.material=debrisMaterial;
  }
  return {
    warm(renderer,camera){glowReady=false;const clone=debrisMesh.clone();clone.material=glowMaterial;return prepareCosmetics(THREE,renderer,camera,scene,{objects:[clone]}).then(ok=>{if(!disposed)glowReady=ok;return ok;});},
    prepare(){if(disposed)return null;return {objects:[...variants.map(v=>v.mesh),dustMesh,debrisMesh,glowProxy],textures:[...new Set([...variants.map(v=>v.texture),...Object.values(glowMaterial).filter(value=>value?.isTexture)])],valid:()=>!disposed};},
    add(event,time){
      const impact=event?.impact;
      if(disposed||event?.hit||!Number.isFinite(time)||!validVector(impact?.position)||!validVector(impact?.normal))return false;
      if(typeof impact.soundSurface?.texture==='string'&&impact.soundSurface.texture.toLowerCase()==='sky')return false;
      normal.set(impact.normal.x,impact.normal.y,impact.normal.z);
      const length=normal.length();if(!Number.isFinite(length)||length<.5)return false;
      normal.divideScalar(length);position.set(impact.position.x,impact.position.y,impact.position.z).addScaledVector(normal,.0015);
      rand=typeof random==='function'?random:cosmeticRandom(event.shotId||event.eventId||`${impact.position.x}:${impact.position.y}:${impact.position.z}:${time}`);recipe=impactProfile(impact.soundSurface?.material||impact.material);
      const v=variants[Math.floor(unit()*variants.length)],index=v.next++%capacity,size=(.12+unit()*.04)*1.8;
      if(v.slots[index]===null)decals++;
      v.slots[index]=time+SHOT_FX_LIMITS.decalSeconds;nextExpiry=Math.min(nextExpiry,v.slots[index]);
      orientation.setFromUnitVectors(front,normal);spin.setFromAxisAngle(front,unit()*Math.PI*2);orientation.multiply(spin);
      matrix.compose(position,orientation,scale.set(size,size,1));v.mesh.setMatrixAt(index,matrix);
      v.mesh.instanceMatrix.needsUpdate=true;v.mesh.count=Math.max(v.mesh.count,index+1);v.mesh.visible=true;
      tangent.set(1,0,0).applyQuaternion(orientation);bitangent.set(0,1,0).applyQuaternion(orientation);
      for(let i=0;i<recipe.dust;i++){
        const slot=nextDust++%dust.length,a=(unit()-.5)*1.5,b=(unit()-.5)*1.5,out=.45+unit()*.8;
        dust[slot]={time,x:position.x,y:position.y,z:position.z,
          vx:tangent.x*a+bitangent.x*b+normal.x*out,vy:tangent.y*a+bitangent.y*b+normal.y*out,vz:tangent.z*a+bitangent.z*b+normal.z*out,
          size:.06+unit()*.055};
        dustMesh.setMatrixAt(slot,zero);dustMesh.count=Math.max(dustMesh.count,slot+1);
      }
      // One instanced batch for all chips, with analytic motion instead of
      // per-fragment world traces. Shrink at the end rather than sorting alpha.
      const material=impact.soundSurface?.material||impact.material;
      const tint=recipe.tint;
      for(let i=0;i<recipe.chips;i++){
        const slot=nextDebris++%debris.length,a=(unit()-.5)*3.3,b=(unit()-.5)*3.3,out=1.6+unit()*2;
        debris[slot]={time,x:position.x,y:position.y,z:position.z,
          vx:tangent.x*a+bitangent.x*b+normal.x*out,vy:tangent.y*a+bitangent.y*b+normal.y*out,vz:tangent.z*a+bitangent.z*b+normal.z*out,
          shape:recipe.shape,glow:0,out,ny:normal.y,size:i<2?.05+unit()*.025:.032+unit()*.028,life:SHOT_FX_LIMITS.debrisSeconds*(.65+unit()*.35),
          rx:unit()*6.28,ry:unit()*6.28,rz:unit()*6.28,spin:(unit()-.5)*22};
        debrisColor.setHex(tint).multiplyScalar(i<2?1.15+unit()*.3:.65+unit()*.55);debrisMesh.setColorAt(slot,debrisColor);
        glow.array[slot]=0;debrisMesh.setMatrixAt(slot,zero);debrisMesh.count=Math.max(debrisMesh.count,slot+1);
      }
      for(let i=0;glowReady&&i<recipe.sparks;i++){
        const slot=nextDebris++%debris.length,a=(unit()-.5)*4,b=(unit()-.5)*4,out=2+unit()*3;
        debris[slot]={time,x:position.x,y:position.y,z:position.z,vx:tangent.x*a+bitangent.x*b+normal.x*out,vy:tangent.y*a+bitangent.y*b+normal.y*out,vz:tangent.z*a+bitangent.z*b+normal.z*out,out,ny:normal.y,size:.025+unit()*.02,life:.07+unit()*.09,rx:unit()*6.28,ry:unit()*6.28,rz:unit()*6.28,spin:0,shape:[.13,4,.13],glow:1};
        glow.array[slot]=2;debrisColor.setHex(0xffc77b);debrisMesh.setColorAt(slot,debrisColor);debrisMesh.setMatrixAt(slot,zero);debrisMesh.count=Math.max(debrisMesh.count,slot+1);
      }
      glow.needsUpdate=true;debrisMesh.material=glowReady&&debris.some(p=>p?.glow)?glowMaterial:debrisMaterial;
      debrisMesh.instanceMatrix.needsUpdate=true;debrisMesh.instanceColor.needsUpdate=true;debrisMesh.visible=true;
      dustMesh.instanceMatrix.needsUpdate=true;dustMesh.visible=dust.some(Boolean);return true;
    },
    update(time){
      if(disposed||!Number.isFinite(time))return false;
      let changed=false;
      if(time>=nextExpiry){nextExpiry=Infinity;for(const v of variants){let active=false,dirty=false;
        for(let i=0;i<v.slots.length;i++)if(v.slots[i]!==null){
          if(time>=v.slots[i]){v.slots[i]=null;decals--;v.mesh.setMatrixAt(i,zero);dirty=true;changed=true;}else {active=true;nextExpiry=Math.min(nextExpiry,v.slots[i]);}
        }
        if(dirty)v.mesh.instanceMatrix.needsUpdate=true;v.mesh.visible=active;
      }
      }
      let activeDust=0,dirty=false;
      for(let i=0;dustMesh.visible&&i<dust.length;i++){const p=dust[i];if(!p)continue;
        const age=Math.max(0,time-p.time),life=age/SHOT_FX_LIMITS.dustSeconds;
        if(life>=1){dust[i]=null;dustMesh.setMatrixAt(i,zero);}else{
          const size=p.size*Math.sin(Math.PI*life);
          position.set(p.x+p.vx*age,p.y+p.vy*age-.6*age*age,p.z+p.vz*age);
          matrix.compose(position,identity,scale.setScalar(size));dustMesh.setMatrixAt(i,matrix);activeDust++;
        }
        dirty=true;
      }
      if(dirty){dustMesh.instanceMatrix.needsUpdate=true;changed=true;}dustMesh.visible=activeDust>0;
      let activeDebris=0;dirty=false;
      for(let i=0;debrisMesh.visible&&i<debris.length;i++){const p=debris[i];if(!p)continue;
        const age=Math.max(0,time-p.time),life=age/p.life;
        // Do not fall back through the struck floor/slope plane.
        if(life>=1||.0015+p.out*age-4*p.ny*age*age<0){debris[i]=null;debrisMesh.setMatrixAt(i,zero);}else{
          const size=p.size*Math.min(1,(1-life)/.3);
          position.set(p.x+p.vx*age,p.y+p.vy*age-4*age*age,p.z+p.vz*age);
          orientation.setFromEuler(debrisRotation.set(p.rx+age*p.spin,p.ry+age*p.spin*.7,p.rz-age*p.spin*.4));
          matrix.compose(position,orientation,scale.set(size*p.shape[0],size*p.shape[1],size*p.shape[2]));debrisMesh.setMatrixAt(i,matrix);activeDebris++;
        }
        dirty=true;
      }
      if(dirty){debrisMesh.instanceMatrix.needsUpdate=true;changed=true;debrisMesh.material=glowReady&&debris.some(p=>p?.glow)?glowMaterial:debrisMaterial;}debrisMesh.visible=activeDebris>0;
      return changed;
    },
    clear,
    info(){return {glowReady,sparks:debris.filter(p=>p?.glow).length,material:recipe.kind,decals,dust:dust.filter(Boolean).length,debris:debris.filter(Boolean).length,decalCapacity:SHOT_FX_LIMITS.decals,dustCapacity:SHOT_FX_LIMITS.dust,debrisCapacity:SHOT_FX_LIMITS.debris,variants:variants.length,tracers:0};},
    dispose(){if(disposed)return;clear();disposed=true;
      for(const v of variants){scene.remove(v.mesh);v.mesh.dispose();v.material.dispose();v.texture.dispose();}
      scene.remove(dustMesh);dustMesh.dispose();plane.dispose();dustGeometry.dispose();dustMaterial.dispose();
      glowProxy.removeFromParent();glowProxy.dispose();
      scene.remove(debrisMesh);debrisMesh.dispose();debrisGeometry.dispose();debrisMaterial.dispose();glowMaterial.dispose();
    }
  };
}
