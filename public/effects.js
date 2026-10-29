// Bounded, reusable geometry. Smoke is an approximate occlusion volume, not original CS rendering.
import {createProjectileModels,PROJECTILE_MODEL_LIMIT} from './projectile-models.js';
import {createExplosionEffects} from './explosion-effects.js';
import {createProjectileBuffer} from './projectile-buffer.js';
export const FX_LIMITS=Object.freeze({projectiles:PROJECTILE_MODEL_LIMIT,smokes:32});
const clamp01=n=>Math.max(0,Math.min(1,Number(n)||0));
export function flashOpacity(until,amount,time,fade=1.4){
  const duration=Number.isFinite(fade)&&fade>0?fade:1.4;
  return clamp01(amount)*clamp01((Number(until)-time)/duration);
}
export function smokeOpacity(smokes,position,time){
  if(!position)return 0;let opacity=0;
  for(const s of smokes.slice(0,FX_LIMITS.smokes)){
    if(!Number.isFinite(s.endAt)||s.endAt<=time)continue;
    const radius=Math.max(.1,Number(s.radius)||3),distance=Math.hypot(position.x-s.x,position.y-s.y,position.z-s.z);
    const inside=clamp01((radius-distance)/(radius*.25));
    opacity=Math.max(opacity,inside*.995*clamp01((s.endAt-time)/.8));
  }
  return opacity;
}
export function createWorldEffects(THREE,scene,options={}){
  const projectileModels=createProjectileModels(THREE,scene,options),smokeGeometry=new THREE.SphereGeometry(1,12,8);
  const explosions=createExplosionEffects(THREE,scene),projectileBuffer=createProjectileBuffer(),detonated=new Set();
  const smokeMaterial=new THREE.MeshBasicMaterial({color:'#a6aaa1',transparent:true,opacity:.96,depthWrite:false,side:THREE.DoubleSide});
  const clouds=[];let snapshot={projectiles:[],smokes:[]},signature='';
  function cloud(index){if(!clouds[index]){
    const group=new THREE.Group();
    for(const [x,y,z,scale] of [[0,0,0,1],[-.28,.12,.15,.83],[.28,-.04,-.12,.83]]){const mesh=new THREE.Mesh(smokeGeometry,smokeMaterial);mesh.position.set(x,y,z);mesh.scale.setScalar(scale);group.add(mesh);}
    scene.add(group);clouds.push(group);
  }return clouds[index];}
  const valid=p=>p&&[p.x,p.y,p.z].every(Number.isFinite);
  return {
    ready:projectileModels.ready,
    clear(){explosions.clear();projectileBuffer.clear();detonated.clear();snapshot={projectiles:[],smokes:[]};signature='';projectileModels.update([],0);for(const cloud of clouds)cloud.visible=false;},
    explode(event,time){
      if(event?.type!=='explosion'||!Number.isFinite(time)||!['hegrenade','flashbang','smokegrenade'].includes(event.kind)||![event.x,event.y,event.z].every(n=>Number.isFinite(n)&&Math.abs(n)<10000))return false;
      detonated.add(event.id);if(detonated.size>256)detonated.delete(detonated.values().next().value);
      snapshot.projectiles=snapshot.projectiles.filter(p=>p.id!==event.id);projectileBuffer.remove(event.id);
      const added=explosions.add(event,time);options.onChange?.();return added;
    },
    sync(state){snapshot={projectiles:(state.projectiles||[]).slice(0,FX_LIMITS.projectiles).filter(p=>valid(p)&&!detonated.has(p.id)),smokes:(state.smokes||[]).slice(0,FX_LIMITS.smokes).filter(valid)};
      projectileBuffer.push(snapshot.projectiles,state.time,state.round);
      const next=JSON.stringify(snapshot),changed=next!==signature;signature=next;return changed;},
    update(time,position,cameraQuaternion=null){
      projectileModels.update(projectileBuffer.sample(time),time);explosions.update(time,cameraQuaternion);
      for(let i=0;i<snapshot.smokes.length;i++){const s=snapshot.smokes[i],group=cloud(i);group.visible=Number.isFinite(s.endAt)&&s.endAt>time;group.position.set(s.x,s.y,s.z);group.scale.setScalar(Math.min(30,Math.max(.1,Number(s.radius)||3)));}
      for(let i=snapshot.smokes.length;i<clouds.length;i++)clouds[i].visible=false;
      return smokeOpacity(snapshot.smokes,position,time);
    },
    active(time){return snapshot.projectiles.length>0||snapshot.smokes.some(s=>s.endAt>time)||explosions.active(time);},
    info(){return {projectiles:snapshot.projectiles.length,smokes:snapshot.smokes.length,projectilePool:projectileModels.info().peak,projectileModels:projectileModels.info(),explosions:explosions.info(),smokePool:clouds.length,approximateSmoke:true};},
    dispose(){projectileModels.dispose();explosions.dispose();for(const object of clouds)scene.remove(object);smokeGeometry.dispose();smokeMaterial.dispose();}
  };
}
