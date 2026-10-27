import * as THREE from '/vendor/three.module.js';
import {MAP_DATA} from './map-data.js';
export async function loadOriginalMap(scene){
  const base='/assets/dust2/',response=await fetch(base+'render.json');if(!response.ok)throw Error('地图数据加载失败');
  const data=await response.json();if(data.sourceSHA256!==MAP_DATA.sourceSHA256)throw Error('Map source mismatch');
  const loader=new THREE.TextureLoader();
  const [lightmap,...images]=await Promise.all([loader.loadAsync(base+data.lightmap),...data.textures.map(t=>loader.loadAsync(base+t.image))]);
  lightmap.channel=1;lightmap.minFilter=THREE.LinearFilter;lightmap.magFilter=THREE.LinearFilter;lightmap.generateMipmaps=false;
  const groups=new Map();for(const p of data.polygons){if(!groups.has(p.texture))groups.set(p.texture,[]);groups.get(p.texture).push(p);}
  const group=new THREE.Group();group.name='Original BSP de_dust2';let triangles=0;
  for(const [index,polygons] of groups){const texture=images[index];texture.colorSpace=THREE.SRGBColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=4;
    const positions=[],normals=[],uv=[],uv1=[];
    for(const p of polygons)for(let i=1;i<p.vertices.length-1;i++)for(const k of [0,i,i+1]){
      positions.push(...p.vertices[k]);normals.push(...p.normal);uv.push(...p.uv[k]);uv1.push(...p.lightUv[k]);}
    const geometry=new THREE.BufferGeometry();
    for(const [name,array,size] of [['position',positions,3],['normal',normals,3],['uv',uv,2],['uv1',uv1,2]])geometry.setAttribute(name,new THREE.Float32BufferAttribute(array,size));
    geometry.computeBoundingSphere();triangles+=positions.length/9;
    const material=new THREE.MeshBasicMaterial({map:texture,lightMap:lightmap,lightMapIntensity:2,alphaTest:data.textures[index].masked?.5:0,side:THREE.FrontSide});
    const mesh=new THREE.Mesh(geometry,material);mesh.name=data.textures[index].name;group.add(mesh);
  }
  const skyFaces=await Promise.all(['rt','lf','bk','ft','up','dn'].map(face=>loader.loadAsync(base+`sky-${face}.png`)));
  skyFaces.forEach(t=>{t.colorSpace=THREE.SRGBColorSpace;t.generateMipmaps=false;t.minFilter=t.magFilter=THREE.LinearFilter;});
  const skyMaterial=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,depthTest:false,
    uniforms:Object.fromEntries(['rt','lf','bk','ft','up','dn'].map((name,i)=>[name,{value:skyFaces[i]}])),
    vertexShader:`varying vec3 vDirection;void main(){vDirection=position;vec4 p=projectionMatrix*mat4(mat3(viewMatrix))*vec4(position*300.0,1.0);gl_Position=p.xyww;}`,
    fragmentShader:`uniform sampler2D rt;uniform sampler2D lf;uniform sampler2D bk;uniform sampler2D ft;uniform sampler2D up;uniform sampler2D dn;varying vec3 vDirection;
    void main(){vec3 d=vec3(vDirection.x,-vDirection.z,vDirection.y),a=abs(d);vec2 uv;vec4 c;
    if(a.x>=a.y&&a.x>=a.z){uv=vec2(d.x>0.0?-d.y:d.y,d.z)/a.x*.5+.5;c=d.x>0.0?texture2D(rt,uv):texture2D(lf,uv);}
    else if(a.y>=a.z){uv=vec2(d.y>0.0?d.x:-d.x,d.z)/a.y*.5+.5;c=d.y>0.0?texture2D(bk,uv):texture2D(ft,uv);}
    else{uv=vec2(-d.y,d.z>0.0?-d.x:d.x)/a.z*.5+.5;c=d.z>0.0?texture2D(up,uv):texture2D(dn,uv);}gl_FragColor=c;
    #include <colorspace_fragment>
    }`});
  const sky=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),skyMaterial);sky.frustumCulled=false;sky.renderOrder=-1000;scene.add(sky);
  scene.add(group);
  const mini=document.createElement('canvas');mini.width=mini.height=200;const ctx=mini.getContext('2d');
  const a=MAP_DATA.bounds.min,b=MAP_DATA.bounds.max,scale=Math.min(184/(b[0]-a[0]),184/(b[2]-a[2]));
  const point=(x,z)=>[8+(x-a[0])*scale,8+(z-a[2])*scale];
  ctx.fillStyle='#14212a';ctx.fillRect(0,0,200,200);
  for(const p of [...data.polygons].sort((a,b)=>a.vertices[0][1]-b.vertices[0][1]))if(p.normal[1]>.7){
    ctx.fillStyle=p.vertices[0][1]>2?'#bdac8d':'#93866e';ctx.beginPath();p.vertices.forEach((v,i)=>{const c=point(v[0],v[2]);i?ctx.lineTo(...c):ctx.moveTo(...c);});ctx.closePath();ctx.fill();}
  return {faces:data.polygons.length,triangles,textures:images.length,sourceSHA256:data.sourceSHA256,minimap:mini,minimapPoint:point};
}
