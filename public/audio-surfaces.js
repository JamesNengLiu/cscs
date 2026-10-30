// GoldSrc materials.txt codes. Unknown textures deliberately fall back to concrete,
// never guessed from English texture names (wood has concrete footsteps in CS1.6).
export const MATERIAL_CODES=Object.freeze({C:'concrete',M:'metal',D:'dirt',V:'vent',G:'grate',T:'tile',S:'slosh',W:'wood',P:'computer',Y:'glass',X:'grass',F:'flesh',N:'snow'});
export function normalizeTextureName(name){
  if(typeof name!=='string')return '';
  let s=name;if(/^[+-]/.test(s))s=s.slice(2);if(/^[{!~ ]/.test(s))s=s.slice(1);
  return s.slice(0,16).toLowerCase();
}
export function parseSoundMaterials(text=''){
  const result=new Map();if(typeof text!=='string'||text.length>262144)return result;
  for(const raw of text.split(/\r?\n/).slice(0,8192)){
    const row=raw.split('//')[0].trim().match(/^([A-Z])\s+(\S{1,32})$/i);
    if(row&&Object.hasOwn(MATERIAL_CODES,row[1].toUpperCase()))result.set(normalizeTextureName(row[2]),MATERIAL_CODES[row[1].toUpperCase()]);
    if(result.size>=4096)break;
  }return result;
}
export function textureSoundMaterial(name,materials){return materials?.get(normalizeTextureName(name))||'concrete';}
const SIZE=4,EPS=.001;
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
function inside(vertices,normal,p){
  let sign=0;
  for(let i=0;i<vertices.length;i++){
    const a=vertices[i],b=vertices[(i+1)%vertices.length],u=b.map((n,j)=>n-a[j]),v=p.map((n,j)=>n-a[j]);
    const d=dot([u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],normal);
    if(Math.abs(d)<=EPS)continue;if(sign&&Math.sign(d)!==sign)return false;sign=Math.sign(d);
  }return true;
}
/** Index real BSP render faces once; query only neighbouring floor faces per audible step. */
export function createGroundSoundSampler(data,materials=new Map(),solidModels=new Set([0])){
  const grid=new Map();let indexed=0;
  for(const face of (data?.polygons||[]).slice(0,20000)){
    if(!solidModels.has(face.model??0)||!(face.normal?.[1]>.7)||!Array.isArray(face.vertices)||face.vertices.length<3||face.vertices.length>128)continue;
    const texture=data.textures?.[face.texture]?.name;if(typeof texture!=='string')continue;
    const f={vertices:face.vertices,normal:face.normal,texture,material:textureSoundMaterial(texture,materials)};
    const xs=face.vertices.map(v=>v[0]),zs=face.vertices.map(v=>v[2]);
    const x0=Math.floor((Math.min(...xs)-EPS)/SIZE),x1=Math.floor((Math.max(...xs)+EPS)/SIZE),z0=Math.floor((Math.min(...zs)-EPS)/SIZE),z1=Math.floor((Math.max(...zs)+EPS)/SIZE);
    if((x1-x0+1)*(z1-z0+1)>16384)continue;
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const key=x+','+z,list=grid.get(key)||[];list.push(f);grid.set(key,list);}
    indexed++;
  }
  function sample(position){
    if(!position||!['x','y','z'].every(k=>Number.isFinite(position[k])))return {material:'concrete',texture:''};
    let best=null,bestY=-Infinity;
    for(const f of grid.get(Math.floor(position.x/SIZE)+','+Math.floor(position.z/SIZE))||[]){
      const a=f.vertices[0],n=f.normal,y=a[1]-(n[0]*(position.x-a[0])+n[2]*(position.z-a[2]))/n[1];
      if(y>position.y+.08||y<position.y-.25||y<=bestY||!inside(f.vertices,n,[position.x,y,position.z]))continue;
      best=f;bestY=y;
    }
    return best?{texture:best.texture,material:best.material}:{material:'concrete',texture:''};
  }
  sample.info=()=>({indexed,cells:grid.size,materials:materials.size});return sample;
}
