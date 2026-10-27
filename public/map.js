import {RULES} from './config.js';
import {MAP_DATA} from './map-data.js';
export {MAP_DATA};
export const MAP_VERSION=MAP_DATA.version,MAP_BOUNDS=MAP_DATA.bounds;
export const SPAWN_POINTS=MAP_DATA.spawns;
export const SPAWNS={T:SPAWN_POINTS.T[0],CT:SPAWN_POINTS.CT[0]};
export const SITES=MAP_DATA.sites;
const solids=MAP_DATA.models.filter(m=>m.index===0||m.entity.classname==='func_breakable');
const EPS=1/1280;
const dot=(p,n)=>p.x*n[0]+p.y*n[1]+p.z*n[2];
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
const hull=height=>height<=RULES.crouchHeight+.01?3:1;
function contents(model,p,h=0){
  const tree=h===0?MAP_DATA.nodes:MAP_DATA.clipnodes;let node=model.heads[h],guard=0;
  while(node>=0){if(++guard>20000)throw Error('Invalid BSP traversal');const n=tree[node],plane=MAP_DATA.planes[n[0]];node=n[dot(p,plane)-plane[3]>=0?1:2];}
  return node;
}
function sweepModel(model,start,end,h){
  const tree=h===0?MAP_DATA.nodes:MAP_DATA.clipnodes;
  function visit(index,lo,hi,normal){
    if(index<0)return index===-2?{fraction:lo,normal,startSolid:lo===0}:null;
    const node=tree[index],plane=MAP_DATA.planes[node[0]],a=mix(start,end,lo),b=mix(start,end,hi);
    const da=dot(a,plane)-plane[3],db=dot(b,plane)-plane[3];
    if(da>=0&&db>=0)return visit(node[1],lo,hi,normal);
    if(da<0&&db<0)return visit(node[2],lo,hi,normal);
    const t=Math.max(lo,Math.min(hi,lo+(hi-lo)*da/(da-db))),side=da<0?1:0;
    const near=visit(node[side+1],lo,t,normal);if(near)return near;
    return visit(node[2-side],t,hi,plane.slice(0,3).map(v=>v*(side?-1:1)));
  }
  return visit(model.heads[h],0,1,[0,0,0]);
}
// Both peers use original pre-expanded standing/crouched BSP hulls; point rays use hull 0.
export function trace(start,end,height=0){
  const h=height?hull(height):0,offset=height/2;
  const a={...start,y:start.y+offset},b={...end,y:end.y+offset};
  let best={fraction:1,normal:[0,0,0],startSolid:false,model:null};
  for(const model of solids){const result=sweepModel(model,a,b,h);if(result&&(result.fraction<best.fraction||result.startSolid)){
    best={...result,model:model.index};if(result.startSolid)break;}}
  if(best.fraction<1&&!best.startSolid){const normalSpeed=Math.abs((end.x-start.x)*best.normal[0]+(end.y-start.y)*best.normal[1]+(end.z-start.z)*best.normal[2]);
    if(normalSpeed>1e-9)best.fraction=Math.max(0,best.fraction-EPS/normalSpeed);}
  best.end=mix(start,end,best.fraction);return best;
}
export function collides(x,z,r=RULES.radius,y=0,height=RULES.bodyHeight){
  const center={x,y:y+height/2,z},h=hull(height);
  return solids.some(model=>contents(model,center,h)===-2);
}
export function supportHeight(x,z,maxFeet=24){const hit=trace({x,y:maxFeet+EPS*2,z},{x,y:-100,z});return hit.fraction<1&&!hit.startSolid?hit.end.y:maxFeet;}
export function groundHeight(x,z,maxFeet=24){return supportHeight(x,z,maxFeet);}
export function isGrounded(p){const t=trace(p,{...p,y:p.y-.04},p.crouch?RULES.crouchHeight:RULES.bodyHeight);return !t.startSolid&&t.fraction<1&&t.normal[1]>.7&&(p.vy||0)<=.01;}
export function wallDistance(o,d){const t=trace(o,{x:o.x+d.x*250,y:o.y+d.y*250,z:o.z+d.z*250});return t.fraction*250;}
export function siteAt(p){const h=p.crouch?RULES.crouchHeight:RULES.bodyHeight,center={x:p.x,y:p.y+h/2,z:p.z};return SITES.find(s=>contents(MAP_DATA.models[s.model],center,hull(h))===-2);}
// Original BSP buy triggers are queried, never replaced by estimated spawn circles.
export function buyZoneAt(p){const h=p.crouch?RULES.crouchHeight:RULES.bodyHeight,center={x:p.x,y:p.y+h/2,z:p.z};
  return MAP_DATA.models.some(m=>m.entity.classname==='func_buyzone'&&(!m.entity.team||m.entity.team==='0'||m.entity.team===(p.team==='T'?'1':'2'))&&contents(m,center,hull(h))===-2);}
export const VIEWS={overview:{eye:[72,100,90],target:[-8,0,-28]},short:{eye:[8,1.6,-38.4],target:[10.4,3.4,-45.6]},
  long:{eye:[40,4.6,-18],target:[33,4,-60]},tunnels:{eye:[-48.8,2.4,-38.4],target:[-47.2,1.6,-47.2]},
  mid:{eye:[-6,3,-32],target:[3,-1,-47]},b:{eye:[-52,5.2,-45.6],target:[-42,1.4,-62.4]},a:{eye:[39.2,7.6,-76],target:[28.6,3.4,-61.4]}};
// No legacy hand-built walls remain in the active map.
export const WALLS=[],COVERS=[],ROOFS=[],BLOCKS=[],AREAS=[],LABELS=[],SURFACES=[],TERRAIN_TRIANGLES=[];
