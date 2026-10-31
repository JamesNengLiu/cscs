// Original procedural input schedules for protecting the existing movement feel.
import {supportHeight} from '../../public/shared.js';
import {DOWNHILL_CASES,slopeStart} from '../downhill-fixtures.mjs';
export const slowdownColumns=['x','y','z','vx','vy','vz','grounded','crouch','duckAmount','duckElapsed','ducking','jumpHeld','jumpFatigue','gaitDistance','gaitYaw','airTime','landedSpeed','walk','moving','velocityModifier'];
export function flatSlowdownPose(patch={}){return {id:'victim',alive:true,weapon:'glock18',x:-18.4,z:22,y:supportHeight(-18.4,22,3.3),yaw:0,pitch:0,vx:0,vy:0,vz:0,grounded:true,crouch:false,duckAmount:0,velocityModifier:1,jumpFatigue:0,...patch};}
export const slowdownCases=[
 ...['run','stop','strafe','duck-jump'].map(mode=>({name:'flat-'+mode,mode})),
 ...DOWNHILL_CASES.map(route=>({name:route.name,mode:'slope-wheel',route})),
 ...[.5,.65].map(modifier=>({name:'legacy-hit-jump-'+modifier,mode:'legacy-hit-jump',modifier})),
];
export function slowdownCaseTrace(move,c){
 const p=flatSlowdownPose(c.route?slopeStart(c.route):{});if(c.modifier)Object.assign(p,{velocityModifier:c.modifier,vz:-6.25,hitSlowdownVersion:0});const rows=[];
 for(let frame=0;frame<120;frame++){
  const input={yaw:p.yaw,pitch:0,f:c.mode==='stop'&&frame>=50?0:1};
  if(c.mode==='strafe')Object.assign(input,{f:0,s:frame<60?1:-1});
  if(c.mode==='duck-jump')Object.assign(input,{crouch:frame>=20&&frame<65,jump:frame%20===0});
  if(c.mode==='slope-wheel'||c.mode==='legacy-hit-jump')input.jump=frame%4===0;
  move(p,input,1/60);rows.push(slowdownColumns.map(k=>p[k]??null));
 }
 return rows;
}
