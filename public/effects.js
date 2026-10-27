// Bounded, reusable geometry. Smoke is an approximate occlusion volume, not original CS rendering.
export const FX_LIMITS=Object.freeze({projectiles:64,smokes:32});
const clamp01=n=>Math.max(0,Math.min(1,Number(n)||0));
export function flashOpacity(until,amount,time){return clamp01(amount)*clamp01((Number(until)-time)/1.4);}
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
export function createWorldEffects(THREE,scene){
  const projectileGeometry=new THREE.SphereGeometry(.1,8,6),smokeGeometry=new THREE.SphereGeometry(1,12,8);
  const colors={hegrenade:'#74784a',flashbang:'#ded9b9',smokegrenade:'#b0c6b6'};
  const materials=Object.fromEntries(Object.entries(colors).map(([id,color])=>[id,new THREE.MeshLambertMaterial({color})]));
  const smokeMaterial=new THREE.MeshBasicMaterial({color:'#a6aaa1',transparent:true,opacity:.96,depthWrite:false,side:THREE.DoubleSide});
  const projectiles=[],clouds=[];let snapshot={projectiles:[],smokes:[]},signature='';
  function projectile(index){if(!projectiles[index]){const mesh=new THREE.Mesh(projectileGeometry,materials.hegrenade);scene.add(mesh);projectiles.push(mesh);}return projectiles[index];}
  function cloud(index){if(!clouds[index]){
    const group=new THREE.Group();
    for(const [x,y,z,scale] of [[0,0,0,1],[-.28,.12,.15,.83],[.28,-.04,-.12,.83]]){const mesh=new THREE.Mesh(smokeGeometry,smokeMaterial);mesh.position.set(x,y,z);mesh.scale.setScalar(scale);group.add(mesh);}
    scene.add(group);clouds.push(group);
  }return clouds[index];}
  const valid=p=>p&&[p.x,p.y,p.z].every(Number.isFinite);
  return {
    sync(state){snapshot={projectiles:(state.projectiles||[]).slice(0,FX_LIMITS.projectiles).filter(valid),smokes:(state.smokes||[]).slice(0,FX_LIMITS.smokes).filter(valid)};
      const next=JSON.stringify(snapshot),changed=next!==signature;signature=next;return changed;},
    update(time,position){
      for(let i=0;i<snapshot.projectiles.length;i++){const p=snapshot.projectiles[i],mesh=projectile(i);mesh.visible=true;mesh.position.set(p.x,p.y,p.z);mesh.material=materials[p.kind]||materials.hegrenade;}
      for(let i=snapshot.projectiles.length;i<projectiles.length;i++)projectiles[i].visible=false;
      for(let i=0;i<snapshot.smokes.length;i++){const s=snapshot.smokes[i],group=cloud(i);group.visible=Number.isFinite(s.endAt)&&s.endAt>time;group.position.set(s.x,s.y,s.z);group.scale.setScalar(Math.min(30,Math.max(.1,Number(s.radius)||3)));}
      for(let i=snapshot.smokes.length;i<clouds.length;i++)clouds[i].visible=false;
      return smokeOpacity(snapshot.smokes,position,time);
    },
    active(time){return snapshot.projectiles.length>0||snapshot.smokes.some(s=>s.endAt>time);},
    info(){return {projectiles:snapshot.projectiles.length,smokes:snapshot.smokes.length,projectilePool:projectiles.length,smokePool:clouds.length,approximateSmoke:true};},
    dispose(){for(const object of [...projectiles,...clouds])scene.remove(object);projectileGeometry.dispose();smokeGeometry.dispose();smokeMaterial.dispose();for(const material of Object.values(materials))material.dispose();}
  };
}
