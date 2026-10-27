import {Game} from '../game.mjs';
import {SPAWN_POINTS,SITES,RULES,collides,supportHeight,isGrounded,movePlayer,siteAt,trace} from '../public/shared.js';
const report={spawns:{},sites:[],movement:[]};
for(const [team,list]of Object.entries(SPAWN_POINTS))report.spawns[team]=list.map(s=>{const y=supportHeight(s.x,s.z,s.y+.05);return {...s,y,blocked:collides(s.x,s.z,RULES.radius,y),grounded:isGrounded({...s,y})};});
for(const site of SITES){const p={x:site.x,y:supportHeight(site.x,site.z,site.y+1),z:site.z};report.sites.push({...p,name:site.name,blocked:collides(p.x,p.z,RULES.radius,p.y),site:siteAt(p)?.name,traceDown:trace(p,{...p,y:p.y-1},RULES.bodyHeight)});}
const g=new Game(),p=g.add('t','T','T');
for(let i=0;i<120;i++)movePlayer(p,{f:1,yaw:0},1/60);
report.movement.push(p);console.log(JSON.stringify(report,null,2));
