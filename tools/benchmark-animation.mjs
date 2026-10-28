// Deterministic CPU animation workload, not an end-to-end FPS benchmark.
import * as THREE from 'three';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createPlayerActor} from '../public/player-model.js';
import {createWeaponView} from '../public/weapon-model.js';
const mode=process.argv.includes('--gpu')?'gpu':'cpu';
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9)||`artifacts/animation-${mode}.json`;
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{try{return new Response(await readFile(new URL(`../public${url}`,import.meta.url)));}catch{return new Response('missing',{status:404});}};
class FileTextures{async loadAsync(url){const bytes=await readFile(new URL(`../public${url}`,import.meta.url));const t=new THREE.Texture();t.image={width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};return t;}}
const three={...THREE,TextureLoader:FileTextures};
const actors=[];let weapon;
try{
  for(let i=0;i<9;i++){
    const a=createPlayerActor(three,{skinning:mode});actors.push(a);await a.setCharacter(i%2?'urban':'terror_trump');
    if(a.info().error)throw Error(a.info().error);
    a.update(0,{weapon:'ak47',alive:true,vx:5,grounded:true});
  }
  const deadline=performance.now()+20000;
  while(actors.some(a=>!a.info().thirdPersonWeapon.loaded)){
    if(performance.now()>deadline)throw Error('Third person weapon timeout');await new Promise(r=>setTimeout(r,5));
  }
  const camera=new THREE.PerspectiveCamera();weapon=await createWeaponView(three,camera,{skinning:mode});await weapon.setWeapon('ak47');
  if(weapon.info().error)throw Error(weapon.info().error);
  const state={alive:true,grounded:true,vx:5,weapon:'ak47',ammo:30,playerSequence:'walk',playerFrame:0,pitch:0};
  const times=[];
  for(let frame=0;frame<720;frame++){
    state.playerFrame=(frame%24)/2;state.pitch=Math.sin(frame*.02)*.5;
    const start=performance.now();for(const a of actors)a.update(1/120,state);weapon.update(1/120,state);
    const elapsed=performance.now()-start;if(frame>=120)times.push(elapsed);
  }
  const sorted=times.toSorted((a,b)=>a-b),q=p=>sorted[Math.floor((sorted.length-1)*p)];
  const result={mode,scope:'Node CPU animation only: 9 remote actors + 9 p_ak47 + 1 v_ak47; no rasterization, no network, no FPS claim',samples:times.length,warmupFrames:120,medianMs:q(.5),p95Ms:q(.95),meanMs:times.reduce((a,b)=>a+b,0)/times.length,actorSkinning:actors[0].info().skinning||'legacy-cpu',weaponSkinning:weapon.info().skinning||'legacy-cpu'};
  await mkdir('artifacts',{recursive:true});await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{for(const a of actors)a.dispose();weapon?.dispose?.();globalThis.fetch=originalFetch;}
