// Server-confirmed, world-space hit feedback. One lazily created instanced batch.
import {hitFeedbackProfile} from './hit-feedback-profile.js';
export const PLAYER_HIT_LIMITS=Object.freeze({particles:256,marks:64,markSeconds:25});
const valid=v=>v&&[v.x,v.y,v.z].every(n=>Number.isFinite(n)&&Math.abs(n)<10000);
const SOUNDS=Object.freeze({blood:'player/bhit_flesh-1.wav',helmet:'player/bhit_helmet-1.wav',armour:'player/bhit_kevlar-1.wav',shield:'player/bhit_helmet-1.wav'});
export const playerHitSound=effect=>typeof effect==='string'&&Object.hasOwn(SOUNDS,effect)?SOUNDS[effect]:null;
export function createPlayerHitEffects(THREE,scene,{random=Math.random}={}){
  const capacity=PLAYER_HIT_LIMITS.particles+PLAYER_HIT_LIMITS.marks,slots=Array(capacity).fill(null),seen=new Set();
  let mesh=null,geometry,material,map,tint,next=0,nextMark=0,disposed=false,previousCount=0,accepted=0,lastProfile=null;
  const point=new THREE.Vector3(),scale=new THREE.Vector3(),rotation=new THREE.Quaternion(),spin=new THREE.Quaternion(),axis=new THREE.Vector3(0,0,1),matrix=new THREE.Matrix4();
  const unit=()=>Math.max(0,Math.min(.999999,Number(random())||0));
  function ensure(){
    if(mesh)return;
    const data=new Uint8Array(64*64*4);
    for(let y=0;y<64;y++)for(let x=0;x<64;x++){
      const u=(x+.5)/32-1,v=(y+.5)/32-1,r=Math.hypot(u,v),a=Math.atan2(v,u),edge=.7+.09*Math.sin(a*9)+.07*Math.sin(a*17+r*11),i=(y*64+x)*4;
      data[i]=data[i+1]=data[i+2]=255;data[i+3]=Math.round(Math.max(0,Math.min(1,(edge-r)/.2))*(.7+.3*Math.sin(x*2.1+y*.7)**2)*255);
    }
    map=new THREE.DataTexture(data,64,64,THREE.RGBAFormat);map.needsUpdate=true;
    geometry=new THREE.PlaneGeometry(1,1);tint=new THREE.InstancedBufferAttribute(new Float32Array(capacity*4),4);tint.setUsage(THREE.DynamicDrawUsage);geometry.setAttribute('hitTint',tint);
    material=new THREE.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,toneMapped:false,uniforms:{hitMap:{value:map}},
      vertexShader:'attribute vec4 hitTint;varying vec4 vTint;varying vec2 vHitUv;void main(){vTint=hitTint;vHitUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}',
      fragmentShader:`uniform sampler2D hitMap;varying vec4 vTint;varying vec2 vHitUv;void main(){gl_FragColor=texture2D(hitMap,vHitUv)*vTint;if(gl_FragColor.a<.015)discard;
      #include <colorspace_fragment>
      }`});
    mesh=new THREE.InstancedMesh(geometry,material,capacity);mesh.name='player-hit-feedback';mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;mesh.renderOrder=2;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh);
  }
  const particle=p=>{slots[next++%PLAYER_HIT_LIMITS.particles]=p;};
  function clear(){slots.fill(null);seen.clear();next=nextMark=previousCount=0;lastProfile=null;if(mesh){mesh.count=0;mesh.visible=false;}}
  return {
    prepare(){if(disposed)return null;ensure();return {objects:[mesh],textures:[map],valid:()=>!disposed};},
    add(event,time,targetPosition=null){
      const hit=event?.hitImpact;
      if(disposed||!Number.isFinite(time)||event?.type!=='shot'||!playerHitSound(hit?.effect)||!valid(hit.position)||!valid(hit.direction)||typeof hit.targetId!=='string')return null;
      const magnitude=Math.hypot(hit.direction.x,hit.direction.y,hit.direction.z);if(magnitude<.5||magnitude>1.5)return null;
      const key=event.shotId?`${event.shotId}:${hit.targetId}`:null;if(key&&seen.has(key))return null;
      if(key){seen.add(key);if(seen.size>256)seen.delete(seen.values().next().value);}
      const at=valid(targetPosition)&&valid(hit.offset)&&Math.hypot(hit.offset.x,hit.offset.y,hit.offset.z)<3
        ?{x:targetPosition.x+hit.offset.x,y:targetPosition.y+hit.offset.y,z:targetPosition.z+hit.offset.z}:{...hit.position};
      const d={x:hit.direction.x/magnitude,y:hit.direction.y/magnitude,z:hit.direction.z/magnitude};
      ensure();accepted++;
      const blood=hit.effect==='blood',spark=hit.effect==='helmet'||hit.effect==='shield';
      const profile=hitFeedbackProfile(event),count=profile.count;lastProfile={weapon:event.weapon,kind:profile.kind,effect:hit.effect,hitgroup:hit.hitgroup,count};
      for(let i=0;i<count;i++){
        const puff=i<profile.puffs,size=puff?profile.puffMin+unit()*profile.puffRange:profile.dropMin+unit()*profile.dropRange;
        particle({time,life:puff?profile.puffLife:profile.life,effect:hit.effect,x:at.x-d.x*.035,y:at.y-d.y*.035,z:at.z-d.z*.035,
          vx:-d.x*profile.outward+(unit()-.5)*(puff?.5:profile.spread),vy:-d.y*profile.outward+unit()*(puff?.5:1.5),vz:-d.z*profile.outward+(unit()-.5)*(puff?.5:profile.spread),
          size,stretch:profile.stretch,angle:unit()*Math.PI*2,color:blood?[.52,.008,.006]:spark?(profile.kind!=='legacy'&&i<2?[1,.95,.65]:[1,.72,.22]):[.42,.4,.36],opacity:puff?.85:1});
      }
      if(blood&&valid(hit.wall?.position)&&valid(hit.wall?.normal)&&Math.hypot(hit.wall.position.x-hit.position.x,hit.wall.position.y-hit.position.y,hit.wall.position.z-hit.position.z)<=2.6){
        const n=new THREE.Vector3(hit.wall.normal.x,hit.wall.normal.y,hit.wall.normal.z);
        if(n.length()>.5){n.normalize();const q=new THREE.Quaternion().setFromUnitVectors(axis,n).multiply(new THREE.Quaternion().setFromAxisAngle(axis,unit()*Math.PI*2));
          slots[PLAYER_HIT_LIMITS.particles+nextMark++%PLAYER_HIT_LIMITS.marks]={time,life:PLAYER_HIT_LIMITS.markSeconds,effect:'mark',x:hit.wall.position.x+n.x*.002,y:hit.wall.position.y+n.y*.002,z:hit.wall.position.z+n.z*.002,
            rotation:q,size:.2+unit()*.18,color:[.25,.004,.003],opacity:.8};}
      }
      return at;
    },
    update(time,cameraQuaternion=null){
      if(disposed||!mesh||!Number.isFinite(time))return false;let count=0;
      for(let i=0;i<slots.length;i++){
        const p=slots[i];if(!p)continue;const age=Math.max(0,time-p.time),life=age/p.life;
        if(life>=1){slots[i]=null;continue;}
        const mark=p.effect==='mark',size=p.size*(mark?1:1+life*.5);
        point.set(p.x+(p.vx||0)*age,p.y+(p.vy||0)*age-(mark?0:2*age*age),p.z+(p.vz||0)*age);
        if(mark)rotation.copy(p.rotation);else rotation.copy(cameraQuaternion||spin.identity()).multiply(spin.setFromAxisAngle(axis,p.angle));
        matrix.compose(point,rotation,scale.set(size,size*(p.stretch||1),1));mesh.setMatrixAt(count,matrix);
        tint.setXYZW(count,p.color[0],p.color[1],p.color[2],p.opacity*(mark?Math.min(1,(1-life)*5):1-life));count++;
      }
      const changed=previousCount>0||count>0;previousCount=count;mesh.count=count;mesh.visible=count>0;
      if(changed){mesh.instanceMatrix.needsUpdate=true;tint.needsUpdate=true;}return changed;
    },
    clear,
    info(){const counts={blood:0,helmet:0,armour:0,shield:0,mark:0};for(const p of slots)if(p)counts[p.effect]++;
      return {accepted,...counts,capacity,batches:mesh?1:0,active:slots.filter(Boolean).length,lastProfile:lastProfile&&{...lastProfile}};},
    dispose(){if(disposed)return;clear();disposed=true;if(mesh){scene.remove(mesh);mesh.dispose();geometry.dispose();material.dispose();map.dispose();}},
  };
}
