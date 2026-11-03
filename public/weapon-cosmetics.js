import {prepareCosmetics} from './prepare-cosmetics.js';
import {GUNS} from './arsenal.js';
import {cosmeticRandom} from './impact-profile.js';
export const WEAPON_COSMETIC_LIMITS=Object.freeze({shells:64,smoke:16,queue:32,seen:256});
export function createWeaponCosmetics(THREE,scene,{trace=null,onContact=()=>{},lighting=null}={}){
 const shellGeometry=new THREE.CylinderGeometry(.007,.007,.028,6,1),shellMaterial=new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false});
 const shellMesh=new THREE.InstancedMesh(shellGeometry,shellMaterial,WEAPON_COSMETIC_LIMITS.shells);shellMesh.name='spent-casings';shellMesh.count=0;shellMesh.visible=false;shellMesh.frustumCulled=false;shellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);shellMesh.setColorAt(0,new THREE.Color(0xb99c51));scene.add(shellMesh);
 const pixels=new Uint8Array(32*32*4);for(let y=0;y<32;y++)for(let x=0;x<32;x++){const r=Math.hypot((x-15.5)/16,(y-15.5)/16),i=(y*32+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=190;pixels[i+3]=Math.max(0,Math.round((1-r)**2*80))*(r<1);}
 const texture=new THREE.DataTexture(pixels,32,32,THREE.RGBAFormat);texture.needsUpdate=true;
 const smokeGeometry=new THREE.PlaneGeometry(1,1),smokeMaterial=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,depthTest:true,opacity:.22,side:THREE.DoubleSide,toneMapped:false});
 smokeMaterial.forceSinglePass=true;
 const smokeMesh=new THREE.InstancedMesh(smokeGeometry,smokeMaterial,WEAPON_COSMETIC_LIMITS.smoke);smokeMesh.name='short-gun-smoke';smokeMesh.count=0;smokeMesh.visible=false;smokeMesh.frustumCulled=false;smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(smokeMesh);
 const shells=Array(WEAPON_COSMETIC_LIMITS.shells).fill(null),smokes=Array(WEAPON_COSMETIC_LIMITS.smoke).fill(null),seen=new Set(),queue=[];
 const matrix=new THREE.Matrix4(),zero=new THREE.Matrix4().makeScale(0,0,0),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),euler=new THREE.Euler(),scale=new THREE.Vector3(),color=new THREE.Color();
 let options={shells:true,gunSmoke:true,muzzleLight:false},nextShell=0,nextSmoke=0,disposed=false,dropped=0,ready=true;
 function accept(event){if(!GUNS[event?.weapon])return false;const key=`${event.round}:${event.id}:${event.weapon}:${event.shotOrdinal??event.ordinal??event.token??event.shotId}`;if(seen.has(key))return false;seen.add(key);if(seen.size>WEAPON_COSMETIC_LIMITS.seen)seen.delete(seen.values().next().value);return key;}
 function spawn(event,origin,muzzle,right,forward,now){
  if(disposed||!ready||!origin||![origin.x,origin.y,origin.z,now].every(Number.isFinite))return false;
  const random=cosmeticRandom(event.key),shotgun=['m3','xm1014'].includes(event.weapon);
  if(options.shells){const index=nextShell++%shells.length,hit=trace?.(origin,{x:origin.x,y:origin.y-8,z:origin.z}),floor=hit&&!hit.startSolid&&hit.fraction<1&&hit.normal[1]>.7?hit.end.y:origin.y-1.5;
   shells[index]={at:now,x:origin.x,y:origin.y,z:origin.z,vx:right.x*(.9+random()*.5)-forward.x*.25,vy:.8+random()*.7,vz:right.z*(.9+random()*.5)-forward.z*.25,floor,impact:Math.max(0,((.8)+Math.sqrt(.8*.8+40*Math.max(0,origin.y-floor-.008)))/20),contacted:false,angle:random()*6.28,spin:10+random()*8,shotgun};shells[index].impact=(shells[index].vy+Math.sqrt(shells[index].vy**2+40*Math.max(0,origin.y-floor-.008)))/20;shellMesh.setMatrixAt(index,zero);color.setHex(shotgun?0xa14735:0xb99c51);shellMesh.setColorAt(index,color);shellMesh.count=Math.max(shellMesh.count,index+1);shellMesh.instanceColor.needsUpdate=true;shellMesh.visible=true;}
  if(options.gunSmoke&&!event.silenced){const index=nextSmoke++%smokes.length;smokes[index]={at:now,x:muzzle.x,y:muzzle.y,z:muzzle.z,dx:forward.x,dy:forward.y,dz:forward.z};smokeMesh.setMatrixAt(index,zero);smokeMesh.count=Math.max(smokeMesh.count,index+1);smokeMesh.visible=true;}
  if(options.muzzleLight&&event.local)lighting?.trigger(muzzle,now,{silenced:event.silenced,weight:100});return true;
 }
 function clear(){shells.fill(null);smokes.fill(null);queue.length=0;seen.clear();shellMesh.count=smokeMesh.count=0;shellMesh.visible=smokeMesh.visible=false;nextShell=nextSmoke=0;lighting?.reset();}
 return {
  warm(renderer,camera){ready=false;return prepareCosmetics(THREE,renderer,camera,scene,this.prepare()).then(ok=>{if(!disposed)ready=ok;return ok;});},
  setOptions(value){options={...options,...value};lighting?.setEnabled(options.muzzleLight);if(!options.shells){shells.fill(null);shellMesh.visible=false;}if(!options.gunSmoke){smokes.fill(null);smokeMesh.visible=false;}},
  enqueueLocal(event){if(disposed)return false;const key=accept(event);if(!key)return false;if(queue.length>=WEAPON_COSMETIC_LIMITS.queue){queue.shift();dropped++;}queue.push({weapon:event.weapon,key,silenced:!!event.silenced,local:true});return true;},
  flushLocal({weapon,origin,muzzle,right,forward,now}){for(const event of queue.splice(0))if(event.weapon===weapon)spawn(event,origin,muzzle,right,forward,now);},
  remote(event,now){const key=accept(event);if(!key||!event.from||!event.to)return false;const f=new THREE.Vector3(event.to.x-event.from.x,event.to.y-event.from.y,event.to.z-event.from.z).normalize(),r=new THREE.Vector3().crossVectors(f,new THREE.Vector3(0,1,0)).normalize(),o=new THREE.Vector3(event.from.x,event.from.y-.1,event.from.z).addScaledVector(r,.18),m=o.clone().addScaledVector(f,.3);return spawn({...event,key},o,m,r,f,now);},
  update(now,cameraQuaternion){if(disposed)return false;let changed=false,active=0;if(shellMesh.visible)for(let i=0;i<shells.length;i++){const p=shells[i];if(!p)continue;const age=Math.max(0,now-p.at);if(age>1.7){shells[i]=null;shellMesh.setMatrixAt(i,zero);changed=true;continue;}let y=p.y+p.vy*age-10*age*age,ground=age>=p.impact,t=age;
   if(ground){const since=age-p.impact,bounce=Math.max(0,(20*p.impact-p.vy)*.22);y=p.floor+.008+Math.max(0,bounce*since-10*since*since);t=p.impact+(1-Math.exp(-8*since))*.45/8;if(!p.contacted){p.contacted=true;onContact({x:p.x+p.vx*p.impact,y:p.floor+.01,z:p.z+p.vz*p.impact});}}
   const fade=Math.min(1,(1.7-age)/.2);
   position.set(p.x+p.vx*t,y,p.z+p.vz*t);rotation.setFromEuler(euler.set(p.angle+(ground?.6:t)*p.spin,.4,p.angle+t*3));matrix.compose(position,rotation,scale.setScalar((p.shotgun?1.35:1)*fade));shellMesh.setMatrixAt(i,matrix);active++;changed=true;
  }if(shellMesh.visible)shellMesh.instanceMatrix.needsUpdate=true;shellMesh.visible=active>0;
   active=0;if(smokeMesh.visible)for(let i=0;i<smokes.length;i++){const p=smokes[i];if(!p)continue;const age=Math.max(0,now-p.at),life=.18;if(age>=life){smokes[i]=null;smokeMesh.setMatrixAt(i,zero);}else{const size=(.035+age*.35)*Math.max(0,1-age/life);position.set(p.x+p.dx*age*.2,p.y+.08*age,p.z+p.dz*age*.2);rotation.copy(cameraQuaternion||new THREE.Quaternion());matrix.compose(position,rotation,scale.set(size,size,1));smokeMesh.setMatrixAt(i,matrix);active++;}changed=true;}if(smokeMesh.visible)smokeMesh.instanceMatrix.needsUpdate=true;smokeMesh.visible=active>0;const lit=!!lighting?.update(now);return changed||lit;
  },
  clear,prepare:()=>({objects:[shellMesh,smokeMesh],textures:[texture],valid:()=>!disposed}),
  info:()=>({ready,shells:shells.filter(Boolean).length,smoke:smokes.filter(Boolean).length,queued:queue.length,dropped,limits:WEAPON_COSMETIC_LIMITS,light:lighting?.diagnostics()}),
  dispose(){if(disposed)return;clear();disposed=true;shellMesh.removeFromParent();smokeMesh.removeFromParent();shellMesh.dispose();smokeMesh.dispose();for(const r of [shellGeometry,shellMaterial,smokeGeometry,smokeMaterial,texture])r.dispose();}
 };
}
