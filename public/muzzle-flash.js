// Original procedural atlas and bounded foreground flash. No gameplay/RNG writes.
import {GUNS} from './arsenal.js';
const profiles=Object.freeze({
  rifle:Object.freeze({kind:'rifle',tile:0,width:.12,height:.095,opacity:1,durationMs:32}),
  smg:Object.freeze({kind:'smg',tile:1,width:.08,height:.065,opacity:.9,durationMs:24}),
  sniper:Object.freeze({kind:'awp',tile:2,width:.145,height:.11,opacity:1,durationMs:40}),
  suppressed:Object.freeze({kind:'suppressed',tile:1,width:.035,height:.025,opacity:.22,durationMs:16}),
  legacy:Object.freeze({kind:'compact',tile:3,width:.05,height:.05,opacity:1,durationMs:32}),
});
export function muzzleFlashProfile(state={}){
  if(state.silenced&&['m4a1','usp'].includes(state.weapon))return profiles.suppressed;
  if(state.weapon==='awp')return profiles.sniper;
  return profiles[GUNS[state.weapon]?.category]||profiles.legacy;
}
function atlas(THREE){
  const size=64,data=new Uint8Array(size*size*4*4);
  for(let tile=0;tile<4;tile++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=(x+.5)/32-1,v=(y+.5)/32-1,r=Math.hypot(u,v),a=Math.atan2(v,u);
    const edge=tile===3?.8:tile===1?.42+.4*Math.abs(Math.cos(a*3))**7:tile===2?.35+.6*Math.abs(Math.cos(a*4+.3))**9:.32+.62*Math.abs(Math.cos(a*4))**8;
    const alpha=Math.max(0,Math.min(1,(edge-r)*9)),heat=Math.max(0,1-r*1.7),i=(y*size*4+tile*size+x)*4;
    data[i]=255;data[i+1]=Math.round(95+160*heat);data[i+2]=Math.round(15+220*heat**3);data[i+3]=Math.round(alpha*255);
  }
  const texture=new THREE.DataTexture(data,size*4,size,THREE.RGBAFormat);texture.colorSpace=THREE.SRGBColorSpace;texture.generateMipmaps=false;
  texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.repeat.set(.25,1);texture.needsUpdate=true;return texture;
}
export function createMuzzleFlash(THREE){
  const texture=atlas(THREE),material=new THREE.MeshBasicMaterial({map:texture,transparent:true,blending:THREE.AdditiveBlending,alphaTest:.015,depthTest:true,depthWrite:false,fog:false,toneMapped:false});
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),material);mesh.name='procedural-muzzle-flash';mesh.visible=false;mesh.frustumCulled=false;mesh.material.side=THREE.DoubleSide;mesh.material.forceSinglePass=true;
  let profile=profiles.legacy,token=null,rotation=0;
  return {mesh,texture,
    update(state={},time=null){
      profile=muzzleFlashProfile(state);texture.offset.x=profile.tile/4;mesh.scale.set(profile.width,profile.height,1);
      if(state.weaponShotToken!==token){token=state.weaponShotToken;let hash=17;for(const c of String(token||''))hash=Math.imul(hash,31)+c.charCodeAt(0)|0;rotation=(hash>>>0)%6283/1000;}
      mesh.rotation.z=rotation;
      const age=Number.isFinite(time)&&Number.isFinite(state.weaponShotAt)?Math.max(0,(time-state.weaponShotAt)*1000):0;
      material.opacity=profile.opacity*Math.max(.3,1-age/profile.durationMs);
    },
    info:()=>({kind:profile.kind,width:profile.width,height:profile.height,durationMs:profile.durationMs,opacity:material.opacity,atlas:true}),
    dispose(){mesh.geometry.dispose();material.dispose();texture.dispose();},
  };
}
