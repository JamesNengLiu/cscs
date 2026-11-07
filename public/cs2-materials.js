import * as THREE from '/vendor/three.module.js';
// Shared material equations; the frozen textured control keeps its original code.
export function createSourceMaterials({manifest,texture,light,direction,shadows}){
 const materialCache=new Map(),materialList=[];
 const vector=(v,defaultValue)=>new THREE.Vector2(...(v||defaultValue).slice(0,2));
 function getMaterial(index,mode){
  const key=index+':'+mode;if(materialCache.has(key))return materialCache.get(key);
  const source=manifest.materials[index],maps=source.TextureParams,p=source.FloatParams,v=source.VectorParams,f=source.IntParams;
  const firstNormal=maps.g_tLayer1NormalRoughness||maps.g_tNormal,normalTex=texture(firstNormal),second=!!maps.g_tLayer2Color&&f.F_LAYERS>0,hasLight=mode==='lightmap';
  const alpha=f.F_ALPHA_TEST===1||f.F_ALPHA_TEST===2||source.alphaMode==='MASK';
  const material=new THREE.MeshStandardMaterial({map:texture(maps.g_tColor,{color:true}),normalMap:normalTex,roughnessMap:normalTex,roughness:normalTex?1:.8,metalnessMap:texture(maps.g_tMetalness),metalness:maps.g_tMetalness?1:Math.max(0,p.g_flMetalness||0),vertexColors:true,lightMap:hasLight?light:null,lightMapIntensity:Math.PI,
   alphaTest:alpha?(p.g_flAlphaTestReference??source.alphaCutoff):0,transparent:!alpha&&(f.F_TRANSLUCENT===1||source.alphaMode==='BLEND'),side:source.doubleSided||f.F_RENDER_BACKFACES===1?THREE.DoubleSide:THREE.FrontSide,
   depthWrite:alpha||!(f.F_TRANSLUCENT===1||source.alphaMode==='BLEND'),polygonOffset:f.F_OVERLAY===1,polygonOffsetFactor:f.F_OVERLAY===1?-1:0,polygonOffsetUnits:f.F_OVERLAY===1?-1:0});
  material.name=source.Name+':'+mode;material.envMapIntensity=mode==='ambient'?.6:.12;
  if(maps.g_tAmbientOcclusion||maps.g_tLayer1AmbientOcclusion){material.aoMap=texture(maps.g_tAmbientOcclusion||maps.g_tLayer1AmbientOcclusion);material.aoMap.channel=0;}
  const normalTransform=v.g_vLayer1NormalTexCoordScale||v.g_vNormalTexCoordScale||[1,1];
  material.onBeforeCompile=shader=>{
   const uniforms={cs2UvScale:vector(v.g_vLayer1TexCoordScale||v.g_vTexCoordScale,[1,1]),cs2UvOffset:vector(v.g_vLayer1TexCoordOffset||v.g_vTexCoordOffset,[0,0]),cs2UvCenter:vector(v.g_vLayer1TexCoordCenter||v.g_vTexCoordCenter,[.5,.5]),cs2UvRotation:(p.g_flLayer1TexCoordRotation||p.g_flTexCoordRotation||0)*Math.PI/180,
    cs2NormalScale:vector(normalTransform,[1,1]),cs2Layer2Scale:vector(v.g_vLayer2TexCoordScale,[1,1]),cs2Layer2Offset:vector(v.g_vLayer2TexCoordOffset,[0,0]),cs2LayerTint1:new THREE.Color().setRGB(...(v.g_vLayer1Tint||[1,1,1]).slice(0,3),THREE.SRGBColorSpace),cs2LayerTint2:new THREE.Color().setRGB(...(v.g_vLayer2Tint||[1,1,1]).slice(0,3),THREE.SRGBColorSpace),
    cs2Layer2Color:second?texture(maps.g_tLayer2Color,{color:true}):null,cs2Layer2Normal:second?texture(maps.g_tLayer2NormalRoughness):null,cs2BlendMod:second?texture(maps.g_tBlendModulation):null,cs2Softness:p.g_flBlendSoftness??.1,
    cs2Direction:direction,cs2Shadows:shadows,cs2TintMask:maps.g_tTintMask?texture(maps.g_tTintMask):null};
   for(const [name,value]of Object.entries(uniforms))shader.uniforms[name]={value};
   shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
attribute vec4 cs2Blend;attribute vec3 cs2Baked;varying vec4 cs2BlendValue;varying vec3 cs2BakedValue;
uniform vec2 cs2UvScale,cs2UvOffset,cs2UvCenter;uniform float cs2UvRotation;`)
    .replace('#include <uv_vertex>',`#include <uv_vertex>
cs2BlendValue=cs2Blend;cs2BakedValue=cs2Baked*36.0;
vec2 baseUv=uv-cs2UvCenter;float c=cos(cs2UvRotation),s=sin(cs2UvRotation);baseUv=mat2(c,-s,s,c)*baseUv*cs2UvScale+cs2UvCenter+cs2UvOffset;
#ifdef USE_MAP
vMapUv=baseUv;
#endif
#ifdef USE_NORMALMAP
vNormalMapUv=baseUv;
#endif
#ifdef USE_ROUGHNESSMAP
vRoughnessMapUv=baseUv;
#endif
#ifdef USE_AOMAP
vAoMapUv=baseUv;
#endif
#ifdef USE_METALNESSMAP
vMetalnessMapUv=baseUv;
#endif`);
   shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
varying vec4 cs2BlendValue;varying vec3 cs2BakedValue;uniform vec2 cs2NormalScale,cs2Layer2Scale,cs2Layer2Offset;
uniform vec3 cs2LayerTint1,cs2LayerTint2;uniform sampler2D cs2Layer2Color,cs2Layer2Normal,cs2BlendMod,cs2Direction,cs2Shadows,cs2TintMask;uniform float cs2Softness;
vec3 cs2HemiNormal(vec2 packed){vec2 p=vec2(packed.x+packed.y-1.003922,packed.x-packed.y);return normalize(vec3(p.x,-p.y,1.0-abs(p.x)-abs(p.y)));}
float cs2BlendFactor(vec2 mappedUv){${second?`float vertex=cs2BlendValue.r;${maps.g_tBlendModulation?`vec4 modulate=texture2D(cs2BlendMod,mappedUv);float mask=${f.F_FANCY_BLENDING===3?'modulate.a':'modulate.g'};float softness=${f.F_FANCY_BLENDING===1?'modulate.r':'cs2Softness'};return smoothstep(mask-max(.001,softness),mask+max(.001,softness),vertex);`:'return vertex;'}`:'return 0.0;'}}`)
    .replace('#include <map_fragment>',`#ifdef USE_MAP
vec4 sampledDiffuseColor=texture2D(map,vMapUv);sampledDiffuseColor.rgb*=cs2LayerTint1;
${second?'sampledDiffuseColor=mix(sampledDiffuseColor,texture2D(cs2Layer2Color,vMapUv*cs2Layer2Scale+cs2Layer2Offset)*vec4(cs2LayerTint2,1.0),cs2BlendFactor(vMapUv));':''}
diffuseColor*=sampledDiffuseColor;
#endif`)
    .replace('#include <color_fragment>',maps.g_tTintMask&&f.F_TINT_MASK===1?'diffuseColor.rgb *= mix(vec3(1.0),vColor.rgb,texture2D(cs2TintMask,vMapUv).r);':'#include <color_fragment>')
    .replace('#include <metalnessmap_fragment>',`float metalnessFactor=metalness;
#ifdef USE_METALNESSMAP
metalnessFactor*=texture2D(metalnessMap,vMetalnessMapUv).r;
#endif`)
    .replace('#include <roughnessmap_fragment>',`float roughnessFactor=roughness;
#ifdef USE_ROUGHNESSMAP
vec4 cs2NormalPacked=texture2D(roughnessMap,vRoughnessMapUv*cs2NormalScale);
${second?'cs2NormalPacked=mix(cs2NormalPacked,texture2D(cs2Layer2Normal,vRoughnessMapUv*cs2Layer2Scale+cs2Layer2Offset),cs2BlendFactor(vMapUv));':''}
roughnessFactor*=cs2NormalPacked.b;
#endif`)
    .replace('#include <normal_fragment_maps>',`#ifdef USE_NORMALMAP_TANGENTSPACE
vec4 cs2Packed=texture2D(normalMap,vNormalMapUv*cs2NormalScale);
${second?'cs2Packed=mix(cs2Packed,texture2D(cs2Layer2Normal,vNormalMapUv*cs2Layer2Scale+cs2Layer2Offset),cs2BlendFactor(vMapUv));':''}
vec3 cs2TangentNormal=cs2HemiNormal(cs2Packed.rg);normal=normalize(tbn*cs2TangentNormal);
#endif`)
    .replace('#include <lights_fragment_maps>',`#include <lights_fragment_maps>
${hasLight?`vec3 cs2Light=texture2D(lightMap,vLightMapUv).rgb;vec3 packedDir=texture2D(cs2Direction,vLightMapUv).rgb;vec2 dirXY=packedDir.xy*2.0-1.0;float dz=sqrt(max(.0001,1.0-dot(dirXY,dirXY)));vec3 lightDirection=normalize(vec3(dirXY,dz));vec3 lightNormal=vec3(0.0,0.0,1.0);
#ifdef USE_NORMALMAP_TANGENTSPACE
lightNormal=cs2TangentNormal;
#endif
vec3 nondirectional=cs2Light*packedDir.z;vec3 adjusted=(max(0.0,dot(lightDirection,lightNormal))*(cs2Light-nondirectional)/max(.05,lightDirection.z))+nondirectional;
irradiance+=(max(vec3(0.0),adjusted)-cs2Light)*PI;`:mode==='vertex'?'irradiance+=cs2BakedValue*PI;':''}`);
   // Source shadow channel 0 belongs to the authored light_environment. This
   // affects direct sunlight, not indirect baked irradiance or the whole BRDF.
   if(hasLight)shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );','getDirectionalLightInfo( directionalLight, directLight );\n directLight.color *= 1.0 - texture2D( cs2Shadows, vLightMapUv ).r;'));
  };
  material.customProgramCacheKey=()=>[mode,second,!!maps.g_tBlendModulation,f.F_FANCY_BLENDING||0,!!maps.g_tTintMask&&f.F_TINT_MASK===1].join(':');materialCache.set(key,material);materialList.push(material);return material;
 }
 return{getMaterial,materialList};
}
