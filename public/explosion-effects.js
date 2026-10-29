// Original procedural fire/smoke artwork. Effects follow authoritative detonation positions.
export const EXPLOSION_LIMITS=Object.freeze({bursts:16,seconds:2,firePerBurst:2,smokePerBurst:6,sparksPerBurst:12});
const clamp=n=>Math.max(0,Math.min(1,n));
function texture(THREE,fire){
  const size=64,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=(x+.5)/size*2-1,v=(y+.5)/size*2-1,r=Math.hypot(u,v),angle=Math.atan2(v,u);
    const edge=.78+.08*Math.sin(angle*7)+.05*Math.sin(angle*13+r*9),noise=.8+.2*Math.sin(x*.8+Math.cos(y*.4)*3);
    const alpha=clamp((edge-r)/.24)*noise,i=(y*size+x)*4;
    if(fire){const heat=clamp(1-r*1.3);data[i]=255;data[i+1]=Math.round(75+180*heat);data[i+2]=Math.round(8+215*heat**3);}
    else data[i]=data[i+1]=data[i+2]=255;
    data[i+3]=Math.round(alpha*255);
  }
  const result=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);result.colorSpace=THREE.SRGBColorSpace;result.needsUpdate=true;return result;
}
function batch(THREE,scene,name,capacity,map){
  const geometry=map?new THREE.PlaneGeometry(1,1):new THREE.BoxGeometry(1,1,1);
  const tint=new THREE.InstancedBufferAttribute(new Float32Array(capacity*4),4);tint.setUsage(THREE.DynamicDrawUsage);geometry.setAttribute('fxTint',tint);
  const material=new THREE.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,toneMapped:false,
    uniforms:{fxMap:{value:map},textured:{value:Boolean(map)}},
    vertexShader:`attribute vec4 fxTint;varying vec4 vTint;varying vec2 vFXuv;
      void main(){vTint=fxTint;vFXuv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`,
    fragmentShader:`uniform sampler2D fxMap;uniform bool textured;varying vec4 vTint;varying vec2 vFXuv;
      void main(){vec4 color=textured?texture2D(fxMap,vFXuv):vec4(1.0);gl_FragColor=color*vTint;if(gl_FragColor.a<.015)discard;
      #include <colorspace_fragment>
      }`,
  });
  const mesh=new THREE.InstancedMesh(geometry,material,capacity);mesh.name=name;mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;mesh.renderOrder=2;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh);return {mesh,tint,map};
}
export function createExplosionEffects(THREE,scene){
  const slots=Array(EXPLOSION_LIMITS.bursts).fill(null),seen=new Set();let next=0,peak=0,disposed=false,batches=null;
  const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),spin=new THREE.Quaternion(),scale=new THREE.Vector3(),matrix=new THREE.Matrix4(),axis=new THREE.Vector3(0,0,1);
  function ensure(){if(batches)return;batches=[
    batch(THREE,scene,'he-explosion-fire',slots.length*2,texture(THREE,true)),
    batch(THREE,scene,'he-explosion-smoke',slots.length*6,texture(THREE,false)),
    batch(THREE,scene,'he-explosion-sparks',slots.length*12,null),
  ];}
  function write(b,index,size,color,alpha){matrix.compose(position,rotation,scale.setScalar(size));b.mesh.setMatrixAt(index,matrix);b.tint.setXYZW(index,color[0],color[1],color[2],alpha);}
  function clear(){slots.fill(null);seen.clear();next=0;if(batches)for(const b of batches){b.mesh.count=0;b.mesh.visible=false;}}
  return {
    add(event,time){
      if(disposed||event?.type!=='explosion'||event.kind!=='hegrenade'||!Number.isFinite(time)||![event.x,event.y,event.z].every(n=>Number.isFinite(n)&&Math.abs(n)<10000))return false;
      const id=event.eventId??`${event.id}:${event.time??time}`;if(seen.has(id))return false;seen.add(id);if(seen.size>256)seen.delete(seen.values().next().value);
      ensure();let seed=0;for(const c of String(event.id??id))seed=(Math.imul(seed,31)+c.charCodeAt(0))>>>0;
      slots[next++%slots.length]={x:event.x,y:event.y,z:event.z,time,seed:seed%6283/1000};peak=Math.max(peak,slots.filter(Boolean).length);return true;
    },
    update(time,cameraQuaternion=null){
      if(disposed||!batches||!Number.isFinite(time))return false;const counts=[0,0,0];let active=false;
      for(let i=0;i<slots.length;i++){
        const s=slots[i];if(!s)continue;const age=Math.max(0,time-s.time);if(age>=EXPLOSION_LIMITS.seconds){slots[i]=null;continue;}active=true;
        if(age<.7)for(let j=0;j<2;j++){
          position.set(s.x+(j? .15:-.15),s.y+.35+age*.65+j*.12,s.z);
          rotation.copy(cameraQuaternion||spin.identity()).multiply(spin.setFromAxisAngle(axis,s.seed+j*1.7+age*.5));
          write(batches[0],counts[0]++,.55+Math.sqrt(age/.7)*2.5,[1,1,1],clamp(1-age/.7)**.7*(j?.65:1));
        }
        for(let j=0;j<6;j++){
          const angle=s.seed+j*Math.PI/3,spread=.12+age*.3;
          position.set(s.x+Math.cos(angle)*spread,s.y+.22+j*.1+age*(.35+j*.035),s.z+Math.sin(angle)*spread);
          rotation.copy(cameraQuaternion||spin.identity()).multiply(spin.setFromAxisAngle(axis,angle));
          const opacity=clamp(age/.18)*clamp((2-age)/.8)*.36;
          write(batches[1],counts[1]++, .6+age*.8+j*.055,[.3,.27,.23],opacity);
        }
        if(age<.65)for(let j=0;j<12;j++){
          const angle=s.seed+j*Math.PI*2/12,speed=1.5+j%4*.7;
          const y=s.y+.1+(1.6+j%3*.8)*age-5*age*age;if(y<s.y+.02)continue;
          position.set(s.x+Math.cos(angle)*age*speed,y,s.z+Math.sin(angle)*age*speed);rotation.identity();
          write(batches[2],counts[2]++,.022+j%3*.007,[1,.55,.12],clamp(1-age/.65));
        }
      }
      for(let i=0;i<batches.length;i++){const b=batches[i];b.mesh.count=counts[i];b.mesh.visible=counts[i]>0;b.mesh.instanceMatrix.needsUpdate=true;b.tint.needsUpdate=true;}
      return active;
    },
    // Keep one final cleanup frame even if the menu is rendering on demand.
    active:()=>slots.some(Boolean),
    info:()=>({active:slots.filter(Boolean).length,peak,capacity:slots.length,batches:batches?.length||0}),clear,
    dispose(){if(disposed)return;disposed=true;clear();if(batches)for(const b of batches){scene.remove(b.mesh);b.mesh.dispose();b.mesh.geometry.dispose();b.mesh.material.dispose();b.map?.dispose();}},
  };
}
