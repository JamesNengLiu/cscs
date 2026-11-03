import * as THREE from 'three';import {Game} from '../../game.mjs';import {playerHitboxes} from '../../hitboxes.mjs';import {supportHeight,eyeHeight,blankInput} from '../../public/shared.js';
export function aimAt(p,q,time,group='chest'){
 const box=playerHitboxes(q,time).find(b=>b.group===group),at=new THREE.Vector3(...box.min.map((x,i)=>(x+box.max[i])/2)).applyMatrix4(new THREE.Matrix4().fromArray(box.inverse).invert());p.yaw=Math.atan2(-(at.x-p.x),-(at.z-p.z));p.pitch=Math.atan2(at.y+(group==='head'?.05:0)-p.y-eyeHeight(p),Math.hypot(at.x-p.x,at.z-p.z));
}
export function createDuel({join=['host','guest'],hp=100,GameClass=Game}={}){
 const g=new GameClass({random:()=>.5,audioRandom:()=>.5});for(const id of join)g.add(id,id,id==='host'?'T':'CT');g.begin();g.time=10;g.phase='live';g.endAt=1000;for(const id of join)g.buy(id,'awp');
 const host=g.players.get('host'),guest=g.players.get('guest');for(const [p,z,yaw]of [[host,22,0],[guest,19,Math.PI]]){Object.assign(p,{x:-18.4,z,y:supportHeight(-18.4,z,3.3),vx:0,vy:0,vz:0,grounded:true,yaw,pitch:0,zoom:40,nextAttackAt:0,nextShotAt:0,lastShot:-100,hp,armour:0,helmet:false,flinchAt:-100});g.input(p.id,{...blankInput(),round:g.round,yaw,pitch:0});}
 aimAt(host,guest,g.time);aimAt(guest,host,g.time);g.events=[];
 const command=(id,seq=1,patch={})=>{const p=g.players.get(id);return {seq,round:g.round,...blankInput(),fire:true,yaw:p.yaw,pitch:p.pitch,...patch};};return {g,host,guest,command};
}
