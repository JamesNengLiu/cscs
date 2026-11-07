// Independent offline packer. Does not touch the v1.0 map, simulation or assets.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {identifyLightmapCoordinate,textureCoordinateName} from './cs2-material-coordinates.mjs';
const args=process.argv.slice(2),arg=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const input=path.resolve(arg('--input','.local/cs2/textured/export-materials/geometry.gltf'));
const output=path.resolve(arg('--output','public/assets/cs2-textured'));
const base=path.dirname(input),source=JSON.parse(await readFile(input,'utf8'));
// The viewer scales exactly the draw calls/channels flagged as lightmapped.
// Comparing against the same export with no material search paths preserves
// that evidence; TEXCOORD_1 is NOT always a lightmap (e.g. F_FORCE_UV2 crates).
const uvReferenceFile=path.resolve(arg('--uv-reference',path.join(base,'uv-reference.gltf')));
const uvReference=JSON.parse(await readFile(uvReferenceFile,'utf8'));
const uvReferenceBuffers=await Promise.all(uvReference.buffers.map(b=>readFile(path.join(path.dirname(uvReferenceFile),b.uri))));
assert.equal(uvReference.meshes.length,source.meshes.length);
const reference=JSON.parse(await readFile('public/assets/cs2-benchmark/map.json','utf8'));
const sourceMaterials=JSON.parse(await readFile(arg('--materials',path.join(base,'source-materials.json')),'utf8'));
const materialMap=JSON.parse(await readFile('.local/cs2/benchmark/source-material-map.json','utf8'));
const nativeTextures=JSON.parse(await readFile(path.join(output,'textures.json'),'utf8'));
assert.equal(source.asset.version,'2.0');assert.equal(source.meshes.length,3612);
const buffers=await Promise.all(source.buffers.map(async b=>{
 assert.ok(b.uri&&!/[:\\]/.test(b.uri)&&!b.uri.split('/').includes('..'));
 const data=await readFile(path.join(base,b.uri));assert.equal(data.length,b.byteLength);return data;
}));
const types={5120:[1,'getInt8'],5121:[1,'getUint8'],5122:[2,'getInt16'],5123:[2,'getUint16'],5125:[4,'getUint32'],5126:[4,'getFloat32']};
const widths={SCALAR:1,VEC2:2,VEC3:3,VEC4:4},accessors=new Map();
function accessor(index){
 if(index===undefined)return null;if(accessors.has(index))return accessors.get(index);
 const a=source.accessors[index],v=source.bufferViews[a.bufferView],b=buffers[v.buffer],type=types[a.componentType],width=widths[a.type];
 assert.ok(type&&width&&!a.sparse);const offset=(v.byteOffset||0)+(a.byteOffset||0),stride=v.byteStride||type[0]*width;
 assert.ok(offset+(a.count-1)*stride+type[0]*width<=b.length);const data=new DataView(b.buffer,b.byteOffset,b.byteLength);
 const result={count:a.count,width,get(i,k=0){let x=data[type[1]](offset+i*stride+k*type[0],true);if(a.normalized&&a.componentType!==5126){const signed=[5120,5122].includes(a.componentType),max=2**(type[0]*8-(signed?1:0))-1;x=signed?Math.max(-1,x/max):x/max;}return x;}};
 accessors.set(index,result);return result;
}
function originalUv(index,id,k){const a=uvReference.accessors[index],v=uvReference.bufferViews[a.bufferView],b=uvReferenceBuffers[v.buffer];assert.equal(a.componentType,5126);return b.readFloatLE((v.byteOffset||0)+(a.byteOffset||0)+id*(v.byteStride||8)+k*4);}
function lightmapAccessor(meshIndex,primitiveIndex,primitive){
 const original=uvReference.meshes[meshIndex].primitives[primitiveIndex],current={},prior={};
 for(const [key,index]of Object.entries(primitive.attributes))if(key.startsWith('TEXCOORD_')&&source.accessors[index].type==='VEC2'){
  current[key]=accessor(index);prior[key]={count:current[key].count,get:(id,k)=>originalUv(original.attributes[key],id,k)};
 }
 const name=identifyLightmapCoordinate(current,prior);return name?accessor(primitive.attributes[name]):null;
}
const sourceNames=Object.keys(materialMap).sort((a,b)=>b.length-a.length);
const modelName=name=>sourceNames.find(s=>name===s||name.startsWith(s+'.')||name.startsWith(s+'_fragment'));
const groups=new Map(),materials=[],materialIndices=new Map(),models=new Set(),omitted=[],lightModes={},coverage={},bounds=new THREE.Box3();
let triangles=0,maxPositionError=0;
const colorByte=x=>Math.max(0,Math.min(255,Math.round(x*255)));
function materialInfo(index){
 const g=source.materials[index],v=g.extras?.vmat;assert.ok(v,'Missing source material metadata');
 const name=v.Name.endsWith('_c')?v.Name:v.Name+'_c';
 if(!materialIndices.has(name)){
  const original=sourceMaterials[name]||{...v,TextureParams:{}};
  const m={...original,Name:name,alphaMode:g.alphaMode||'OPAQUE',alphaCutoff:g.alphaCutoff??.5,doubleSided:!!g.doubleSided};
  for(const [key,filename]of Object.entries(m.TextureParams))assert.ok(nativeTextures.textures[filename]||!['g_tColor','g_tNormal','g_tLayer1NormalRoughness','g_tLayer2Color','g_tLayer2NormalRoughness'].includes(key),'Missing authored texture '+filename);
  materialIndices.set(name,materials.length);materials.push(m);
 }
 return {index:materialIndices.get(name),name,tint:g.pbrMetallicRoughness?.baseColorFactor||[1,1,1,1]};
}
function visit(index,parent){
 const node=source.nodes[index],world=node.matrix?new THREE.Matrix4().fromArray(node.matrix):new THREE.Matrix4().compose(new THREE.Vector3().fromArray(node.translation||[0,0,0]),new THREE.Quaternion().fromArray(node.rotation||[0,0,0,1]),new THREE.Vector3().fromArray(node.scale||[1,1,1]));world.premultiply(parent);
 if(node.mesh!==undefined){
  const mesh=source.meshes[node.mesh],name=node.name||mesh.name||'',original=modelName(name);if(original)models.add(original);
  const invisible=(materialMap[original]||[]).every(m=>m.startsWith('materials/tools/'))&&(materialMap[original]||[]).length;
  // Keep real decals/signs. Animated dust/steam/light-shaft cards need their own particle implementation.
  if(invisible||/_nomerge\d+_(?:steam_|dust_00\d|lightshaft_)/i.test(name)){omitted.push(name);}
  else for(const [primitiveIndex,primitive]of mesh.primitives.entries()){
   assert.equal(primitive.mode??4,4);const mi=materialInfo(primitive.material),m=materials[mi.index];
   if(mi.name.startsWith('materials/tools/'))continue;
   const p=accessor(primitive.attributes.POSITION),n=accessor(primitive.attributes.NORMAL),t=accessor(primitive.attributes.TANGENT),uv=accessor(primitive.attributes[textureCoordinateName(m.IntParams)]),lm=lightmapAccessor(node.mesh,primitiveIndex,primitive),blend=accessor(primitive.attributes._TEXCOORD_4),ids=accessor(primitive.indices);
   // COLOR_0 on foliage is wind/AO data, not baked irradiance. LPV/extra vertex
   // lighting isn't exported by this path: use the disclosed ambient fallback.
   const mode=lm?'lightmap':'ambient',count=ids?.count??p.count,normalMatrix=new THREE.Matrix3().getNormalMatrix(world),transformKey=world.elements.join(',');assert.equal(count%3,0);assert.ok(n&&uv&&t);
   const attrKey=JSON.stringify(primitive.attributes),lightKey=mode+':'+mi.index;
   lightModes[mode]=(lightModes[mode]||0)+count/3;coverage[mi.name]=(coverage[mi.name]||0)+count/3;
   for(let i=0;i<count;i+=3){
    const corners=[];let x=0,z=0;
    for(let k=0;k<3;k++){const id=ids?ids.get(i+k):i+k;assert.ok(id>=0&&id<p.count);const point=new THREE.Vector3(p.get(id,0),p.get(id,1),p.get(id,2)).applyMatrix4(world);corners.push({id,point});x+=point.x/3;z+=point.z/3;}
    const key=Math.floor(x/24)+':'+Math.floor(z/24)+':'+lightKey;
    let group=groups.get(key);if(!group){group={key,material:mi.index,mode,position:[],normal:[],tangent:[],uv:[],uv1:[],blend:[],color:[],baked:[],index:[],vertices:new Map()};groups.set(key,group);}
    for(const {id,point}of corners){
     const vertexKey=attrKey+'|'+id+'|'+transformKey+'|'+mi.tint.join(',');let target=group.vertices.get(vertexKey);
     if(target===undefined){
      target=group.position.length/3;group.vertices.set(vertexKey,target);const xyz=point.toArray().map(Math.fround);
      maxPositionError=Math.max(maxPositionError,...xyz.map((v,k)=>Math.abs(v-point.getComponent(k))));bounds.expandByPoint(point);group.position.push(...xyz);
      const normal=new THREE.Vector3(n.get(id,0),n.get(id,1),n.get(id,2)).applyMatrix3(normalMatrix).normalize(),tangent=new THREE.Vector3(t.get(id,0),t.get(id,1),t.get(id,2)).transformDirection(world);
      group.normal.push(...normal.toArray().map(v=>Math.round(v*32767)));group.tangent.push(...tangent.toArray().map(v=>Math.round(v*32767)),Math.round(t.get(id,3)*32767));
      group.uv.push(uv.get(id,0),uv.get(id,1));group.uv1.push(lm?.get(id,0)||0,lm?.get(id,1)||0);
      for(let k=0;k<4;k++)group.blend.push(blend?colorByte(blend.get(id,k)):0);
      group.color.push(...mi.tint.slice(0,3).map(colorByte));
      group.baked.push(0,0,0);
     }group.index.push(target);
    }triangles++;
   }
  }
 }
 for(const child of node.children||[])visit(child,world);
}
for(const node of source.scenes[source.scene||0].nodes)visit(node,new THREE.Matrix4());
assert.equal(models.size,reference.geometry.sourceModels);assert.ok(triangles>=reference.geometry.triangles&&triangles<reference.geometry.triangles+15000);assert.ok(maxPositionError<.0001);
for(let k=0;k<3;k++){assert.ok(Math.abs(bounds.min.getComponent(k)-reference.geometry.bounds.min[k])<.001);assert.ok(Math.abs(bounds.max.getComponent(k)-reference.geometry.bounds.max[k])<.001);}
const blobs=[],chunks=[];let offset=0,vertices=0;
function append(array){const padding=(4-offset%4)%4;if(padding){blobs.push(Buffer.alloc(padding));offset+=padding;}const start=offset,bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength);blobs.push(bytes);offset+=bytes.length;return{offset:start,length:array.length};}
for(const group of groups.values()){
 const chunk={key:group.key,material:group.material,mode:group.mode};
 for(const [key,Type]of [['position',Float32Array],['normal',Int16Array],['tangent',Int16Array],['uv',Float32Array],['uv1',Float32Array],['blend',Uint8Array],['color',Uint8Array],['baked',Uint16Array],['index',Uint32Array]])chunk[key]=append(new Type(group[key]));
 vertices+=group.position.length/3;chunks.push(chunk);group.vertices.clear();
}
const binary=Buffer.concat(blobs),compressed=gzipSync(binary,{level:9});
const manifest={format:'cs2-map-textured-v1',source:{...reference.source,materialDepotManifest:'6679288287140932208'},units:reference.units,spawns:reference.spawns,sites:reference.sites,coordinateAudit:reference.coordinateAudit,geometry:{file:'map.bin.gz',bytes:binary.length,downloadBytes:compressed.length,sha256:createHash('sha256').update(binary).digest('hex'),triangles,vertices,batches:chunks.length,sourceModels:models.size,maxPositionErrorMetres:maxPositionError,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},chunks},materials,lightModes,coverage,omittedLayers:omitted,
 lighting:{irradiance:'maps/de_dust2/lightmaps/irradiance.vtex_c',direction:'maps/de_dust2/lightmaps/directional_irradiance.vtex_c',shadows:'maps/de_dust2/lightmaps/direct_light_shadows.vtex_c',sunAngles:[50,43,0],sunColor:[255,222,189],sunBrightness:2.5,uvScaleAlreadyBaked:true},
 quality:{materials:'authored albedo, packed normals/roughness, layer blend, alpha masks and decals; Three.js PBR approximation',textureMax:nativeTextures.textureMax,lightmapMax:nativeTextures.lightmapMax,originalLightmaps:true,source2Occlusion:false,gameplay:false,limitations:['No original Source 2 reflection probes/LPV/3D skybox','No volumetric fog, original postprocessing, moving particle cards or dynamic world shadows','Material/shading approximation; not identical CS2 renderer']}};
await mkdir(output,{recursive:true});await writeFile(path.join(output,'map.bin.gz'),compressed);await writeFile(path.join(output,'map.json'),JSON.stringify(manifest));
console.log(JSON.stringify({triangles,vertices,batches:chunks.length,geometryBytes:binary.length,compressedBytes:compressed.length,materials:materials.length,lightModes,maxPositionError}));
