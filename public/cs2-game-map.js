import * as THREE from '/vendor/three.module.js';
import {loadOptimizedMap} from './cs2-optimized-renderer.js';
import {CLIENT_WORLD,WORLD_CONTRACT,RULES,CLIENT_LIFETIME} from './cs2-client-world.js';
export async function loadGameMap(scene,{renderer,camera,progress=()=>{}}){
 const load={},start=CLIENT_WORLD.resolveSpawn('T',0),eye=[start.x,start.y+RULES.eye,start.z];
 const runtime=await loadOptimizedMap({scene,renderer,camera,progress,load,signal:CLIENT_LIFETIME.signal,initialView:()=>({eye,target:[eye[0]-Math.sin(start.yaw)*8,eye[1],eye[2]-Math.cos(start.yaw)*8]})});
 try{
 const min=runtime.manifest.geometry.bounds.min,max=runtime.manifest.geometry.bounds.max,scale=Math.min(184/(max[0]-min[0]),184/(max[2]-min[2])),point=(x,z)=>[8+(x-min[0])*scale,8+(z-min[2])*scale];
 const mini=document.createElement('canvas');mini.width=mini.height=200;const ctx=mini.getContext('2d');ctx.fillStyle='#14212a';ctx.fillRect(0,0,200,200);
 // Actual navigation polygons, transformed by the exported source-axis matrix.
 const nav=await fetch('/assets/cs2-physics/nav.gltf',{signal:CLIENT_LIFETIME.signal}).then(r=>{if(!r.ok)throw Error('Missing original navigation overview');return r.json();});
 const buffers=await Promise.all(nav.buffers.map(b=>fetch('/assets/cs2-physics/'+b.uri,{signal:CLIENT_LIFETIME.signal}).then(r=>r.arrayBuffer())));
 const read=index=>{const a=nav.accessors[index],v=nav.bufferViews[a.bufferView],b=new DataView(buffers[v.buffer]),size=a.type==='VEC3'?3:1,width={5123:2,5125:4,5126:4}[a.componentType],get={5123:'getUint16',5125:'getUint32',5126:'getFloat32'}[a.componentType];return{count:a.count,get:(i,k=0)=>b[get]((v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||size*width)+k*width,true)};};
 for(const node of nav.nodes){if(node.mesh===undefined)continue;const matrix=new THREE.Matrix4().fromArray(node.matrix);for(const primitive of nav.meshes[node.mesh].primitives){const p=read(primitive.attributes.POSITION),ids=primitive.indices===undefined?null:read(primitive.indices),count=ids?.count||p.count;ctx.fillStyle='#aa9c7d';for(let i=0;i<count;i+=3){ctx.beginPath();for(let k=0;k<3;k++){const id=ids?ids.get(i+k):i+k,v=new THREE.Vector3(p.get(id,0),p.get(id,1),p.get(id,2)).applyMatrix4(matrix),c=point(v.x,v.z);k?ctx.lineTo(...c):ctx.moveTo(...c);}ctx.closePath();ctx.fill();}}}
 const surface=p=>{const hit=CLIENT_WORLD.collision.raycast({x:p.x,y:p.y+.15,z:p.z},{x:p.x,y:p.y-.6,z:p.z},{channel:'audio'});return{material:hit.material||'concrete',surfaceHash:hit.materialHash,texture:''};};
 return{runtime,load,minimap:mini,minimapPoint:point,groundSoundSurface:surface,soundMaterials:{source:'original-PHYS-surface-tags',unknown:'hash-preserved'},faces:runtime.manifest.geometry.triangles,triangles:runtime.manifest.geometry.triangles,textures:runtime.manifest.materials.length,sourceSHA1:WORLD_CONTRACT.sourceSHA1};
 }catch(error){try{runtime.dispose();}catch{}throw error;}
}
