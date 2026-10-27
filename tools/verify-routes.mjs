import fs from 'node:fs';
import assert from 'node:assert/strict';
import {MAP_DATA,RULES,SPAWN_POINTS,SITES,trace,collides,isGrounded,movePlayer,siteAt} from '../public/shared.js';
const render=JSON.parse(fs.readFileSync('public/assets/dust2/render.json'));
const STEP=.8,buckets=new Map(),cellCache=new Map(),edgeCache=new Map();
const key=(x,z)=>`${x},${z}`;
for(const poly of render.polygons)if(poly.normal[1]>.7){const v=poly.vertices,minX=Math.ceil(Math.min(...v.map(v=>v[0]))/STEP),maxX=Math.floor(Math.max(...v.map(v=>v[0]))/STEP),minZ=Math.ceil(Math.min(...v.map(v=>v[2]))/STEP),maxZ=Math.floor(Math.max(...v.map(v=>v[2]))/STEP);
  for(let ix=minX;ix<=maxX;ix++)for(let iz=minZ;iz<=maxZ;iz++){const k=key(ix,iz);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(poly);}}
function inPoly(x,z,vertices){let sign=0;for(let i=0;i<vertices.length;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length],c=(b[0]-a[0])*(z-a[2])-(b[2]-a[2])*(x-a[0]);if(Math.abs(c)<1e-6)continue;if(sign&&Math.sign(c)!==sign)return false;sign=Math.sign(c);}return true;}
function cell(ix,iz){const k=key(ix,iz);if(cellCache.has(k))return cellCache.get(k);const nodes=[],x=ix*STEP,z=iz*STEP;
  for(const poly of buckets.get(k)||[]){if(!inPoly(x,z,poly.vertices))continue;const v=poly.vertices[0],n=poly.normal,y=v[1]-(n[0]*(x-v[0])+n[2]*(z-v[2]))/n[1];
    const hit=trace({x,y:y+.5,z},{x,y:y-.1,z},RULES.bodyHeight);if(hit.startSolid||hit.fraction===1||hit.normal[1]<.7)continue;
    const p=hit.end;if(nodes.some(n=>Math.abs(n.y-p.y)<.05)||collides(x,z,RULES.radius,p.y)||!isGrounded(p))continue;
    nodes.push({...p,ix,iz,id:`${k},${Math.round(p.y*100)}`});}
  cellCache.set(k,nodes);return nodes;}
function nearest(p){const nodes=[];for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)nodes.push(...cell(Math.round(p.x/STEP)+dx,Math.round(p.z/STEP)+dz));assert.ok(nodes.length,`No walkable node near ${JSON.stringify(p)}`);nodes.sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)+Math.abs(a.y-p.y)-Math.hypot(b.x-p.x,b.z-p.z)-Math.abs(b.y-p.y));return nodes[0];}
function traverse(a,b){const p={...a,vx:0,vy:0,vz:0,yaw:0,pitch:0};
  for(let i=0;i<100;i++){const distance=Math.hypot(b.x-p.x,b.z-p.z);if(distance<.085&&Math.abs(p.y-b.y)<.15)return true;
    movePlayer(p,{f:Math.min(1,distance/.2),yaw:Math.atan2(-(b.x-p.x),-(b.z-p.z))},1/120);}
  return false;}
function edge(a,b){const k=a.id+'>'+b.id;if(!edgeCache.has(k))edgeCache.set(k,b.y-a.y<=1.15&&b.y-a.y>=-2&&traverse(a,b));return edgeCache.get(k);}
function path(start,goal){const open=[start],scores=new Map([[start.id,0]]),parents=new Map(),known=new Map([[start.id,start]]),closed=new Set();let expanded=0;
  const h=n=>Math.hypot(n.x-goal.x,n.z-goal.z)+Math.abs(n.y-goal.y)*.1;
  while(open.length){let best=0;for(let i=1;i<open.length;i++)if(scores.get(open[i].id)+h(open[i])<scores.get(open[best].id)+h(open[best]))best=i;
    const a=open.splice(best,1)[0];if(closed.has(a.id))continue;closed.add(a.id);expanded++;
    if(a.id===goal.id){const result=[a];while(parents.has(result[0].id))result.unshift(known.get(parents.get(result[0].id)));return {points:result,expanded};}
    assert.ok(expanded<18000,'Navigation expansion limit');
    for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]])for(const b of cell(a.ix+dx,a.iz+dz)){
      if(closed.has(b.id))continue;const cost=scores.get(a.id)+Math.hypot(b.x-a.x,b.z-a.z)+Math.abs(b.y-a.y)*.1;
      if(cost>=(scores.get(b.id)??Infinity)||!edge(a,b))continue;known.set(b.id,b);scores.set(b.id,cost);parents.set(b.id,a.id);open.push(b);}}
  throw Error(`No physical path ${start.id} -> ${goal.id}; expanded ${expanded}`);}
function replay(points){const p={...points[0],vx:0,vy:0,vz:0,yaw:0,pitch:0},samples=[];let frames=0;
  for(const target of points.slice(1)){let reached=false;for(let i=0;i<120;i++){const d=Math.hypot(target.x-p.x,target.z-p.z);if(d<.14&&Math.abs(p.y-target.y)<.2){reached=true;break;}
      movePlayer(p,{f:Math.min(1,d/.25),yaw:Math.atan2(-(target.x-p.x),-(target.z-p.z))},1/60);frames++;
      assert.equal(collides(p.x,p.z,RULES.radius,p.y),false,`Entered solid near ${JSON.stringify(p)}`);if(frames%30===0)samples.push({x:p.x,y:p.y,z:p.z});}
    assert.ok(reached,`Replay blocked at ${JSON.stringify(p)} -> ${JSON.stringify(target)}`);}
  return {end:{x:p.x,y:p.y,z:p.z},seconds:frames/60,samples};}
const t=SPAWN_POINTS.T[0],ct=SPAWN_POINTS.CT[0],a=SITES[0],b=SITES[1];
const specs=[['T-A-long',[t,{x:40,y:0,z:-20},a]],['T-A-short',[t,{x:12,y:2.4,z:-40},a]],['T-B-tunnels',[t,{x:-44,y:0,z:-28},b]],['CT-A',[ct,a]],['CT-B',[ct,b]]];
const report={sourceSHA256:MAP_DATA.sourceSHA256,gridStep:STEP,routes:[],method:'Candidate floor grid; every accepted edge and each full route replayed with actual shared movement and BSP hull collision. Not a 2D connectivity-only test.'};
for(const [name,waypoints]of specs){const points=[];let expanded=0;for(let i=0;i<waypoints.length-1;i++){const result=path(nearest(waypoints[i]),nearest(waypoints[i+1]));points.push(...(i?result.points.slice(1):result.points));expanded+=result.expanded;}
  const result=replay(points);assert.equal(siteAt(result.end)?.name,name.includes('-A')?'A':'B');
  report.routes.push({name,status:'passed',expanded,...result,points:points.map(p=>({x:p.x,y:p.y,z:p.z}))});fs.writeFileSync('artifacts/routes-report.json',JSON.stringify(report,null,2));console.log('PASS',name,result.seconds.toFixed(2)+' simulated seconds',points.length+' nodes');}
report.status='passed';report.routesVerified=report.routes.length;fs.writeFileSync('artifacts/routes-report.json',JSON.stringify(report,null,2));
