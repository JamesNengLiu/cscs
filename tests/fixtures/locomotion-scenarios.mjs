// Original input schedules on the local map; no model or map data embedded.
import {Game} from '../../game.mjs';
import {supportHeight} from '../../public/shared.js';
export const locomotionScenarios=['start-stop','crouch-rise','jump-land','air-duck','repeat-jump'];
export function locomotionTrace(name){
 const g=new Game({random:()=>.5}),p=g.add('pose','Pose','T');g.begin();g.buy(p.id,'ak47');g.phase='live';g.time=10;g.endAt=1000;
 Object.assign(p,{x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),vx:0,vy:0,vz:0,yaw:0,pitch:0,nextAttackAt:0});
 const rows=[];
 for(let frame=0;frame<120;frame++){
  const t=frame/60,input={yaw:0,pitch:0};
  if(name==='start-stop')input.f=t>=.2&&t<.65?1:0;
  if(name==='crouch-rise')input.crouch=t>=.15&&t<.9;
  if(name==='jump-land'||name==='air-duck')input.jump=frame===12;
  if(name==='air-duck')input.crouch=t>=.3&&t<.53;
  if(name==='repeat-jump'){input.jump=frame%4===0;input.f=t<1.3?1:0;}
  g.input(p.id,input);g.step();rows.push({t:(frame+1)/60,time:g.time,player:g.snapshot(p.id).players[0]});
 }
 return rows;
}
