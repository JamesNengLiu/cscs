import {disposeOwnedSkeletons} from './cs2-resource-lifecycle.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
export const PROJECTILE_MODEL_LIMIT=32;
export function createProjectileModels(THREE,scene,{nativeContent,onChange=()=>{}}={}){
 if(!nativeContent)throw Error('Native projectile content required');const templates=new Map(),slots=new Map(),pool=[];let disposed=false,peak=0,loadError=null;
 const ready=Promise.all(['hegrenade','flashbang','smokegrenade'].map(async key=>{const asset=await nativeContent.loadModel(key);templates.set(key,asset.gltf.scene);})).then(()=>{onChange();}).catch(e=>{loadError=e.message;throw e;});
 function take(kind){const cached=pool.findIndex(s=>s.kind===kind);if(cached>=0)return pool.splice(cached,1)[0];const template=templates.get(kind);if(!template)return null;const group=new THREE.Group(),model=cloneSkeleton(template);group.add(model);scene.add(group);return{kind,group};}
 function update(projectiles,time){if(disposed)return;const ids=new Set(projectiles.slice(0,32).map(p=>p.id));for(const [id,s]of slots)if(!ids.has(id)){s.group.visible=false;slots.delete(id);pool.push(s);}for(const p of projectiles.slice(0,32)){let slot=slots.get(p.id);if(!slot){slot=take(p.kind);if(!slot)continue;slots.set(p.id,slot);}slot.group.visible=true;slot.group.position.set(p.x,p.y,p.z);if(!p.resting)slot.group.rotation.set((time-(p.bornAt||0))*5,(time-(p.bornAt||0))*3,0);}peak=Math.max(peak,slots.size);}
 return{ready,update,info:()=>({source:'source2-native-weighted-gltf',active:slots.size,pooled:pool.length,peak,error:loadError}),dispose(){disposed=true;const seen=new Set();for(const s of [...slots.values(),...pool]){disposeOwnedSkeletons(s.group,seen);s.group.removeFromParent();}slots.clear();pool.length=0;}};
}
