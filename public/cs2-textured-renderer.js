import * as THREE from '/vendor/three.module.js';
import {decodeTexturedMap} from './cs2-textured-format.js';
const BASE='/assets/cs2-textured/';
const FORMATS={1:THREE.RGBA_S3TC_DXT1_Format,2:THREE.RGBA_S3TC_DXT5_Format,19:THREE.RGB_BPTC_UNSIGNED_Format,20:THREE.RGBA_BPTC_Format,21:THREE.RED_GREEN_RGTC2_Format,27:THREE.RED_RGTC1_Format};
const nextTask=()=>globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(r=>setTimeout(r,0));
export async function loadTexturedMap({scene,renderer,camera,progress,load}){
 renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{throw Error('验证材质编译失败：'+(gl.getShaderInfoLog(fragment)||gl.getShaderInfoLog(vertex)||gl.getProgramInfoLog(program)));};
 const metaAt=performance.now(),[manifest,textureIndex]=await Promise.all(['map.json','textures.json'].map(async name=>{const r=await fetch(BASE+name);if(!r.ok)throw Error('缺少贴图验证包 '+name);return r.json();}));
 load.metadataMs=performance.now()-metaAt;
 const gl=renderer.getContext();
 for(const extension of ['EXT_texture_compression_bptc','EXT_texture_compression_rgtc','WEBGL_compressed_texture_s3tc'])if(!gl.getExtension(extension))throw Error('此验证档位需要原生 '+extension+'，当前设备不支持');
 async function inflate(file){const response=await fetch(BASE+file);if(!response.ok||!response.body)throw Error('资源下载失败 '+file);return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();}
 const at=performance.now();progress('读取真实几何和材质纹理…');
 const geometryPromise=inflate(manifest.geometry.file);
 const channelKeys=new Set(['g_tColor','g_tNormal','g_tLayer1NormalRoughness','g_tLayer2Color','g_tLayer2NormalRoughness','g_tBlendModulation','g_tAmbientOcclusion','g_tLayer1AmbientOcclusion','g_tMetalness','g_tSelfIllumMask','g_tTintMask']);
 const skyName='materials/skybox/sky_de_dust2_exr_908a35ba.vtex_c';
 const names=new Set([skyName,manifest.lighting.irradiance,manifest.lighting.direction,manifest.lighting.shadows]);
 for(const material of manifest.materials)for(const [key,name]of Object.entries(material.TextureParams))if(channelKeys.has(key))names.add(name);
 const textureBuffers=new Map(),cache=new Map(),textures=new Set();let completed=0,downloadBytes=0;
 const pending=[...names];
 const workers=Array.from({length:6},async()=>{for(;;){const name=pending.shift();if(!name)return;const spec=textureIndex.textures[name];if(!spec)throw Error('原始纹理未准备 '+name);const buffer=await inflate(spec.file);if(buffer.byteLength!==spec.bytes)throw Error('纹理大小不匹配 '+name);textureBuffers.set(name,buffer);downloadBytes+=spec.downloadBytes;completed++;if(completed%24===0)progress(`加载原始纹理 ${completed}/${names.size}…`);await nextTask();}});
 await Promise.all(workers);const geometryBuffer=await geometryPromise;load.transferAndInflateMs=performance.now()-at;
 const buildAt=performance.now();progress('分片建立材质、烘焙光照和地图分区…');
 function texture(name,{color=false,clamp=false,channel=0}={}){
  if(!name)return null;const key=name+'|'+color+'|'+clamp+'|'+channel;if(cache.has(key))return cache.get(key);
  const meta=textureIndex.textures[name],buffer=textureBuffers.get(name);if(!meta||!buffer)throw Error('缺少原始纹理 '+name);
  const format=FORMATS[meta.format];if(!format)throw Error('未支持的纹理格式 '+meta.format);
  const mips=meta.mips.map(m=>{if(m.offset<0||m.bytes<=0||m.offset+m.bytes>buffer.byteLength)throw Error('纹理 mip 越界');return{data:new Uint8Array(buffer,m.offset,m.bytes),width:m.width,height:m.height};});
  let t;
  if(meta.faces===6){const faces=Array.from({length:6},(_,face)=>({width:mips[0].width,height:mips[0].height,mipmaps:mips.map(m=>({width:m.width,height:m.height,data:m.data.subarray(face*m.data.length/6,(face+1)*m.data.length/6)}))}));t=new THREE.CompressedCubeTexture(faces,format);}
  else t=new THREE.CompressedTexture(mips,mips[0].width,mips[0].height,format);
  t.name=name;t.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;t.wrapS=t.wrapT=clamp?THREE.ClampToEdgeWrapping:THREE.RepeatWrapping;
  t.minFilter=mips.length>1?THREE.LinearMipmapLinearFilter:THREE.LinearFilter;t.magFilter=THREE.LinearFilter;t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());t.channel=channel;t.needsUpdate=true;cache.set(key,t);textures.add(t);return t;
 }
 const light=texture(manifest.lighting.irradiance,{clamp:true,channel:1}),direction=texture(manifest.lighting.direction,{clamp:true}),shadows=texture(manifest.lighting.shadows,{clamp:true}),sky=texture(skyName,{clamp:true});
 scene.background=sky;
 // Source axes (X,Y,Z) -> browser (Y,Z,X), same mapping as the geometry.
 const axisRotation=new THREE.Matrix4().set(0,1,0,0,0,0,1,0,1,0,0,0,0,0,0,1),skyRotation=new THREE.Euler().setFromRotationMatrix(axisRotation);
 scene.backgroundRotation.copy(skyRotation);scene.environment=sky;scene.environmentRotation.copy(skyRotation);scene.environmentIntensity=.22;
 const sun=scene.children.find(o=>o.isDirectionalLight);for(const o of scene.children.filter(o=>o.isHemisphereLight))o.intensity=0;
 const pitch=manifest.lighting.sunAngles[0]*Math.PI/180,yaw=manifest.lighting.sunAngles[1]*Math.PI/180;
 sun.position.set(-Math.cos(pitch)*Math.sin(yaw),Math.sin(pitch),-Math.cos(pitch)*Math.cos(yaw)).multiplyScalar(100);
 sun.color.setRGB(...manifest.lighting.sunColor.map(c=>c/255),THREE.SRGBColorSpace);sun.intensity=2**manifest.lighting.sunBrightness;
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
 const decoded=await decodeTexturedMap(manifest,geometryBuffer),meshes=[];
 for(let i=0;i<decoded.length;i++){
  const data=decoded[i],chunk=manifest.geometry.chunks[i],geometry=new THREE.BufferGeometry();
  for(const [key,name,size,normalised]of [['position','position',3,false],['normal','normal',3,true],['tangent','tangent',4,true],['uv','uv',2,false],['uv1','uv1',2,false],['color','color',3,true],['blend','cs2Blend',4,true],['baked','cs2Baked',3,true]])geometry.setAttribute(name,new THREE.BufferAttribute(data[key],size,normalised));
  geometry.setIndex(new THREE.BufferAttribute(data.index,1));geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,getMaterial(chunk.material,chunk.mode));mesh.name=chunk.key;scene.add(mesh);meshes.push(mesh);if(i%24===23)await nextTask();
 }
 load.buildMs=performance.now()-buildAt;
 const warmAt=performance.now();progress('预热纹理、材质着色器和全图缓冲区…');
 let uploaded=0;for(const t of textures){renderer.initTexture(t);if(++uploaded%6===0)await new Promise(requestAnimationFrame);}
 await renderer.compileAsync(scene,camera);renderer.setScissorTest(true);renderer.setScissor(0,0,1,1);
 for(const mesh of meshes){mesh.visible=false;mesh.frustumCulled=false;}
 for(let i=0;i<meshes.length;i+=24){for(const mesh of meshes.slice(i,i+24))mesh.visible=true;renderer.render(scene,camera);for(const mesh of meshes.slice(i,i+24))mesh.visible=false;await new Promise(requestAnimationFrame);}
 for(const mesh of meshes){mesh.visible=true;mesh.frustumCulled=true;}renderer.setScissorTest(false);load.prewarmMs=performance.now()-warmAt;
 load.nativeTextureCount=textures.size;load.textureDownloadBytes=downloadBytes;load.textureBufferBytes=[...textureBuffers.values()].reduce((sum,b)=>sum+b.byteLength,0);load.estimatedTextureGPUBytes=[...textures].reduce((sum,t)=>sum+textureIndex.textures[t.name].bytes,0);
 return{manifest,geometryBuffer,meshes};
}
