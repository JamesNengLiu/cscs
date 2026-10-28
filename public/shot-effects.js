// Original procedural impact art; no imported game decals or visible bullet trails.
export const SHOT_FX_LIMITS=Object.freeze({decals:256,variants:4,dust:128,decalSeconds:60,dustSeconds:.16});
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

export function createShotEffects(THREE,scene,{random=Math.random}={}){
  const plane=new THREE.PlaneGeometry(1,1),dustGeometry=new THREE.IcosahedronGeometry(1,0);
  const capacity=SHOT_FX_LIMITS.decals/SHOT_FX_LIMITS.variants;
  const matrix=new THREE.Matrix4(),zero=new THREE.Matrix4().makeScale(0,0,0);
  const position=new THREE.Vector3(),normal=new THREE.Vector3(),scale=new THREE.Vector3();
  const orientation=new THREE.Quaternion(),spin=new THREE.Quaternion(),identity=new THREE.Quaternion(),front=new THREE.Vector3(0,0,1);
  const tangent=new THREE.Vector3(),bitangent=new THREE.Vector3();
  const variants=Array.from({length:SHOT_FX_LIMITS.variants},(_,i)=>{
    const texture=craterTexture(THREE,i),material=new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.025,
      depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,toneMapped:false});
    const mesh=new THREE.InstancedMesh(plane,material,capacity);
    mesh.name=`bullet-hole-${i}`;mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;mesh.renderOrder=1;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh);
    return {mesh,texture,material,slots:Array(capacity).fill(null),next:0};
  });
  const dustMaterial=new THREE.MeshBasicMaterial({color:'#a99b80',transparent:true,opacity:.36,depthTest:true,depthWrite:false});
  const dustMesh=new THREE.InstancedMesh(dustGeometry,dustMaterial,SHOT_FX_LIMITS.dust);
  dustMesh.name='bullet-impact-dust';dustMesh.count=0;dustMesh.visible=false;dustMesh.frustumCulled=false;
  dustMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(dustMesh);
  const dust=Array(SHOT_FX_LIMITS.dust).fill(null);let nextDust=0,decals=0,disposed=false;
  const unit=()=>Math.max(0,Math.min(.999999,Number(random())||0));
  function clear(){
    if(disposed)return;
    for(const v of variants){v.slots.fill(null);v.next=0;v.mesh.count=0;v.mesh.visible=false;}
    dust.fill(null);nextDust=0;decals=0;dustMesh.count=0;dustMesh.visible=false;
  }
  return {
    add(event,time){
      const impact=event?.impact;
      if(disposed||event?.hit||!Number.isFinite(time)||!validVector(impact?.position)||!validVector(impact?.normal))return false;
      normal.set(impact.normal.x,impact.normal.y,impact.normal.z);
      const length=normal.length();if(!Number.isFinite(length)||length<.5)return false;
      normal.divideScalar(length);position.set(impact.position.x,impact.position.y,impact.position.z).addScaledVector(normal,.0015);
      const v=variants[Math.floor(unit()*variants.length)],index=v.next++%capacity,size=.12+unit()*.04;
      if(v.slots[index]===null)decals++;
      v.slots[index]=time+SHOT_FX_LIMITS.decalSeconds;
      orientation.setFromUnitVectors(front,normal);spin.setFromAxisAngle(front,unit()*Math.PI*2);orientation.multiply(spin);
      matrix.compose(position,orientation,scale.set(size,size,1));v.mesh.setMatrixAt(index,matrix);
      v.mesh.instanceMatrix.needsUpdate=true;v.mesh.count=Math.max(v.mesh.count,index+1);v.mesh.visible=true;
      tangent.set(1,0,0).applyQuaternion(orientation);bitangent.set(0,1,0).applyQuaternion(orientation);
      for(let i=0;i<4;i++){
        const slot=nextDust++%dust.length,a=(unit()-.5)*.65,b=(unit()-.5)*.65,out=.15+unit()*.3;
        dust[slot]={time,x:position.x,y:position.y,z:position.z,
          vx:tangent.x*a+bitangent.x*b+normal.x*out,vy:tangent.y*a+bitangent.y*b+normal.y*out,vz:tangent.z*a+bitangent.z*b+normal.z*out,
          size:.012+unit()*.018};
        dustMesh.setMatrixAt(slot,zero);dustMesh.count=Math.max(dustMesh.count,slot+1);
      }
      dustMesh.instanceMatrix.needsUpdate=true;dustMesh.visible=true;return true;
    },
    update(time){
      if(disposed||!Number.isFinite(time))return false;
      let changed=false;
      for(const v of variants){let active=false,dirty=false;
        for(let i=0;i<v.slots.length;i++)if(v.slots[i]!==null){
          if(time>=v.slots[i]){v.slots[i]=null;decals--;v.mesh.setMatrixAt(i,zero);dirty=true;changed=true;}else active=true;
        }
        if(dirty)v.mesh.instanceMatrix.needsUpdate=true;v.mesh.visible=active;
      }
      let activeDust=0,dirty=false;
      for(let i=0;i<dust.length;i++){const p=dust[i];if(!p)continue;
        const age=Math.max(0,time-p.time),life=age/SHOT_FX_LIMITS.dustSeconds;
        if(life>=1){dust[i]=null;dustMesh.setMatrixAt(i,zero);}else{
          const size=p.size*Math.sin(Math.PI*life);
          position.set(p.x+p.vx*age,p.y+p.vy*age-.6*age*age,p.z+p.vz*age);
          matrix.compose(position,identity,scale.setScalar(size));dustMesh.setMatrixAt(i,matrix);activeDust++;
        }
        dirty=true;
      }
      if(dirty){dustMesh.instanceMatrix.needsUpdate=true;changed=true;}dustMesh.visible=activeDust>0;
      return changed;
    },
    clear,
    info(){return {decals,dust:dust.filter(Boolean).length,decalCapacity:SHOT_FX_LIMITS.decals,dustCapacity:SHOT_FX_LIMITS.dust,variants:variants.length,tracers:0};},
    dispose(){if(disposed)return;clear();disposed=true;
      for(const v of variants){scene.remove(v.mesh);v.mesh.dispose();v.material.dispose();v.texture.dispose();}
      scene.remove(dustMesh);dustMesh.dispose();plane.dispose();dustGeometry.dispose();dustMaterial.dispose();
    }
  };
}
