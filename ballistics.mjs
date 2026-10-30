import {readFileSync} from 'node:fs';
import {MAP_DATA,trace} from './public/map.js';
// Geometry stays in the existing ignored BSP render resource. No material meshes are bundled here.
import {createGroundSoundSampler,parseSoundMaterials,textureSoundMaterial} from './public/audio-surfaces.js';
const surfaces=new Map();
let materials=new Map(),groundSounds=()=>({material:'concrete',texture:''});
try{materials=parseSoundMaterials(readFileSync(new URL('./public/assets/sounds/materials.txt',import.meta.url),'utf8'));}catch{}
export const groundSoundSurface=p=>groundSounds(p);
export function soundMaterialAt(position,normal,model=0){
  const point=[position.x,position.y,position.z];
  for(const face of surfaces.get(model)||[]){
    if(face.normal.reduce((s,n,i)=>s+n*normal[i],0)<.9||point.some((n,i)=>n<face.min[i]-.02||n>face.max[i]+.02))continue;
    if(Math.abs(face.normal.reduce((s,n,i)=>s+n*(point[i]-face.vertices[0][i]),0))>.025)continue;
    return {texture:face.name,material:textureSoundMaterial(face.name,materials)};
  }return {texture:'',material:'concrete'};
}
try{
  const data=JSON.parse(readFileSync(new URL('./public/assets/dust2/render.json',import.meta.url),'utf8'));
  if(data.sourceSHA256!==MAP_DATA.sourceSHA256)throw Error('Map material provenance differs');
  groundSounds=createGroundSoundSampler(data,materials,new Set(MAP_DATA.models.filter(m=>m.index===0||m.entity.classname==='func_breakable').map(m=>m.index)));
  for(const face of data.polygons.slice(0,20000)){
    const list=surfaces.get(face.model)||[];list.push({name:data.textures[face.texture].name,vertices:face.vertices,normal:face.normal,
      min:[0,1,2].map(i=>Math.min(...face.vertices.map(v=>v[i]))),max:[0,1,2].map(i=>Math.max(...face.vertices.map(v=>v[i])))});surfaces.set(face.model,list);
  }
}catch{}
const MATERIAL={metal:[.15,.2],concrete:[.25,.5],grate:[.5,.4],vent:[.5,.45],tile:[.65,.3],computer:[.4,.45],wood:[1,.6],glass:[1,.5]};
const AMMO={'9mm':[21,800], '45acp':[15,500], '50AE':[30,1000], '762Nato':[39,5000], '556Nato':[35,4000], '556NatoBox':[35,4000], '338Magnum':[45,8000], '57mm':[30,2000], '357SIG':[25,800]};
export function bulletProperties(w){const pair=AMMO[w.ammoType];return {power:pair?.[0]||0,distance:(pair?.[1]||0)/40,hits:w.category==='sniper'?3:['rifle','machinegun'].includes(w.category)||w.id==='deagle'?2:1};}
export function materialAt(position,normal,model=0){
  const entity=MAP_DATA.models[model]?.entity;
  const point=[position.x,position.y,position.z];
  for(const face of surfaces.get(model)||[]){
    if(face.normal.reduce((s,n,i)=>s+n*normal[i],0)<.9||point.some((n,i)=>n<face.min[i]-.02||n>face.max[i]+.02))continue;
    if(Math.abs(face.normal.reduce((s,n,i)=>s+n*(point[i]-face.vertices[0][i]),0))>.025)continue;
    const name=face.name.toLowerCase();
    if(/wood|crate|crte|box/.test(name))return 'wood';if(/grate|grille/.test(name))return 'grate';if(/duct|vent/.test(name))return 'vent';
    if(/metal|steel|iron/.test(name))return 'metal';if(/glass|window/.test(name))return 'glass';if(/tile/.test(name))return 'tile';
    return 'concrete';
  }
  return entity?.classname==='func_breakable'?({0:'glass',1:'wood',2:'metal',4:'concrete',5:'tile',6:'computer',7:'glass',8:'concrete'}[entity.material]||'concrete'):'concrete';
}
export function penetrationExit(point,d,power,material='concrete',tracer=trace){
  const max=power*(MATERIAL[material]?.[0]??.25)/40;
  // Walk the ORIGINAL point hull at one source-unit intervals, then refine the exit.
  // A missing exit stops the bullet; no jumping across thick walls or disconnected solids.
  let entered=false,previous=0;
  for(let distance=1/160;distance<=max+1e-8;distance+=1/80){
    const at={x:point.x+d.x*distance,y:point.y+d.y*distance,z:point.z+d.z*distance},solid=tracer(at,at).startSolid;
    if(solid)entered=true;
    else if(entered){let lo=previous,hi=distance;for(let i=0;i<8;i++){const mid=(lo+hi)/2,p={x:point.x+d.x*mid,y:point.y+d.y*mid,z:point.z+d.z*mid};if(tracer(p,p).startSolid)lo=mid;else hi=mid;}return {x:point.x+d.x*(hi+.002),y:point.y+d.y*(hi+.002),z:point.z+d.z*(hi+.002)};}
    previous=distance;
  }return null;
}
export const materialDamage=material=>MATERIAL[material]?.[1]??.5;
