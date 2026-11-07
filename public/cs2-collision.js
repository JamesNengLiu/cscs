// CPU-only collision for the isolated Source 2 map adapter. The game supplies
// body dimensions/rules; this module never imports the legacy BSP or renderer.
// Convex planes use inside n·p <= d, positions are metres and body origins feet.
const EPS=1e-9,CONTACT=1e-7,DEFAULT_CHANNELS=['player','bullet','grenade','audio'];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const vector=p=>Array.isArray(p)||ArrayBuffer.isView(p)?[p[0],p[1],p[2]]:[p?.x,p?.y,p?.z];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const output=p=>({x:p[0],y:p[1],z:p[2]});
const endAt=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
function point(p,label){const v=vector(p);if(!v.every(finite))throw Error('Invalid collision '+label);return v;}
function normalize(n){const length=Math.hypot(...n);return length>EPS?n.map(v=>v/length):null;}
function points(values){if(!Array.isArray(values)&&!ArrayBuffer.isView(values))throw Error('Missing collision vertices');const flat=Array.isArray(values[0])?values.flat():values;if(flat.length%3||flat.length<9||flat.length>30000000||!flat.every(finite))throw Error('Invalid collision vertices');return Float64Array.from(flat);}
function vertex(v,i){return[v[i*3],v[i*3+1],v[i*3+2]];}
function bounds(v,ids=null){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<(ids?ids.length:v.length/3);i++){const at=(ids?ids[i]:i)*3;for(let k=0;k<3;k++){min[k]=Math.min(min[k],v[at+k]);max[k]=Math.max(max[k],v[at+k]);}}return{min,max};}
function overlaps(a,b){return a.min.every((v,k)=>v<=b.max[k]+CONTACT&&a.max[k]>=b.min[k]-CONTACT);}
function sweepBounds(a,b,e){return{min:a.map((v,k)=>Math.min(v,b[k])-e[k]-CONTACT),max:a.map((v,k)=>Math.max(v,b[k])+e[k]+CONTACT)};}
function buildTree(items){if(!items.length)return null;const min=items[0].bounds.min.slice(),max=items[0].bounds.max.slice();for(let i=1;i<items.length;i++)for(let k=0;k<3;k++){min[k]=Math.min(min[k],items[i].bounds.min[k]);max[k]=Math.max(max[k],items[i].bounds.max[k]);}const box={min,max};if(items.length<=8)return{...box,items};const extent=max.map((v,k)=>v-min[k]),axis=extent.indexOf(Math.max(...extent));items.sort((a,b)=>a.bounds.min[axis]+a.bounds.max[axis]-b.bounds.min[axis]-b.bounds.max[axis]);const half=items.length>>>1;return{...box,left:buildTree(items.slice(0,half)),right:buildTree(items.slice(half))};}
function query(tree,box,out,metrics){if(!tree||!overlaps(tree,box))return;metrics.nodes++;if(tree.items){for(const item of tree.items)if(overlaps(item.bounds,box))out.push(item);}else{query(tree.left,box,out,metrics);query(tree.right,box,out,metrics);}}
// Only triangle-only BVH nodes can be rejected by this slab. Hull planes
// are not certified to fit their authored vertex AABBs, so their ancestors
// retain the original broadphase. All accepted candidates retain tree order.
function pointSegmentIntersectsBounds(a,b,min,max,minOffset=0,maxOffset=0){
 let enter=-EPS,exit=1+EPS;
 for(let k=0;k<3;k++){
  // Match broadphase CONTACT padding and conservatively cover the triangle
  // kernel's barycentric EPS at this node's coordinate extent.
  const padding=2*CONTACT+4*EPS*(max[maxOffset+k]-min[minOffset+k]),lo=min[minOffset+k]-padding,hi=max[maxOffset+k]+padding,d=b[k]-a[k];
  if(d===0){if(a[k]<lo||a[k]>hi)return false;continue;}
  let near=(lo-a[k])/d,far=(hi-a[k])/d;if(near>far)[near,far]=[far,near];
  enter=Math.max(enter,near);exit=Math.min(exit,far);if(enter>exit+EPS)return false;
 }
 return true;
}
function markRawHullNodes(node,out){if(!node)return false;let hasHull;if(node.items)hasHull=node.items.some(item=>item.type==='hull');else{const left=markRawHullNodes(node.left,out),right=markRawHullNodes(node.right,out);hasHull=left||right;}if(hasHull)out.add(node);return hasHull;}
function queryPointRay(tree,box,out,metrics,a,b,hullNodes){
 if(!tree||!overlaps(tree,box)||!hullNodes.has(tree)&&!pointSegmentIntersectsBounds(a,b,tree.min,tree.max))return;
 metrics.nodes++;
 if(tree.items){for(const item of tree.items)if(overlaps(item.bounds,box)&&(item.type==='hull'||pointSegmentIntersectsBounds(a,b,item.bounds.min,item.bounds.max)))out.push(item);}
 else{queryPointRay(tree.left,box,out,metrics,a,b,hullNodes);queryPointRay(tree.right,box,out,metrics,a,b,hullNodes);}
}
function axisCollector(vertices){const found=new Set(),axes=[];return{add(n){n=normalize(n);if(!n)return;const first=n.find(x=>Math.abs(x)>1e-8);if(first<0)n=n.map(x=>-x);const key=n.map(x=>Math.round(x*1e7)).join(',');if(found.has(key))return;found.add(key);let min=Infinity,max=-Infinity;for(let i=0;i<vertices.length;i+=3){const value=vertices[i]*n[0]+vertices[i+1]*n[1]+vertices[i+2]*n[2];min=Math.min(min,value);max=Math.max(max,value);}axes.push({n,min,max});},axes};}
function hullAxes(shape){const v=shape.vertices,c=axisCollector(v);for(const p of shape.planes)c.add(p.slice(0,3));for(const n of [[1,0,0],[0,1,0],[0,0,1]])c.add(n);
 let edges=shape.edges;
 if(!edges?.length){edges=[];const membership=[];for(let i=0;i<v.length/3;i++){const p=vertex(v,i);membership.push(shape.planes.map((plane,id)=>Math.abs(dot(plane,p)-plane[3])<1e-5?id:-1).filter(id=>id>=0));}for(let a=0;a<membership.length;a++)for(let b=a+1;b<membership.length;b++)if(membership[a].filter(id=>membership[b].includes(id)).length>=2)edges.push([a,b]);}
 for(const pair of edges){const d=sub(vertex(v,pair[1]),vertex(v,pair[0]));for(const n of [[1,0,0],[0,1,0],[0,0,1]])c.add(cross(d,n));}return c.axes;
}
function triangleAxes(item){if(item.axes)return item.axes;const v=item.points,c=axisCollector(v),a=vertex(v,0),b=vertex(v,1),d=vertex(v,2),edges=[sub(b,a),sub(d,b),sub(a,d)];for(const n of [[1,0,0],[0,1,0],[0,0,1],cross(edges[0],sub(d,a))])c.add(n);for(const edge of edges)for(const n of [[1,0,0],[0,1,0],[0,0,1]])c.add(cross(edge,n));item.axes=c.axes;return item.axes;}
// Exact continuous SAT for translation of an axis-aligned body against a
// triangle or a convex hull (hull face, body face and edge cross-product axes).
function sweepAxes(axes,a,b,extents){let enter=0,exit=1,normal=null,strict=true;const velocity=sub(b,a);
 for(const axis of axes){const r=axis.n.reduce((sum,v,k)=>sum+Math.abs(v)*extents[k],0),lo=axis.min-r,hi=axis.max+r,from=dot(axis.n,a),speed=dot(axis.n,velocity);strict&&=from>lo+CONTACT&&from<hi-CONTACT;
  if(Math.abs(speed)<EPS){if(from<lo-CONTACT||from>hi+CONTACT)return null;if(from<=lo+CONTACT||from>=hi-CONTACT)return null;continue;}
  let near=(lo-from)/speed,far=(hi-from)/speed,sign=-1;if(near>far){[near,far]=[far,near];sign=1;}
  if(near>=enter-EPS){enter=Math.max(enter,near);normal=axis.n.map(v=>v*sign);}exit=Math.min(exit,far);if(enter>exit+EPS)return null;
 }
 if(strict)return{fraction:0,normal:[0,0,0],startSolid:true};
 if(!normal||enter< -EPS||enter>1+EPS||exit<0||dot(normal,velocity)>=-EPS)return null;
 return{fraction:Math.max(0,Math.min(1,enter)),normal,startSolid:false};
}
function rayTriangle(item,a,b){const v=item.points,p=vertex(v,0),e1=sub(vertex(v,1),p),e2=sub(vertex(v,2),p),direction=sub(b,a),h=cross(direction,e2),det=dot(e1,h);
 if(item.shape.twoSided===false?det<=EPS:Math.abs(det)<=EPS)return null;const inv=1/det,s=sub(a,p),u=dot(s,h)*inv;if(u< -EPS||u>1+EPS)return null;const q=cross(s,e1),w=dot(direction,q)*inv;if(w< -EPS||u+w>1+EPS)return null;const t=dot(e2,q)*inv;if(t< -EPS||t>1+EPS)return null;let normal=normalize(cross(e1,e2));if(!normal)return null;if(dot(normal,direction)>0)normal=normal.map(x=>-x);return{fraction:Math.max(0,Math.min(1,t)),normal,startSolid:false};}
function rayHull(shape,a,b){let enter=0,exit=1,normal=null,strict=true;const velocity=sub(b,a);
 for(const plane of shape.planes){const da=dot(plane,a)-plane[3],speed=dot(plane,velocity);strict&&=da< -CONTACT;if(Math.abs(speed)<EPS){if(da>CONTACT||Math.abs(da)<=CONTACT)return null;continue;}const t=-da/speed;if(speed<0){if(t>=enter-EPS){enter=Math.max(enter,t);normal=plane.slice(0,3);}}else exit=Math.min(exit,t);if(enter>exit+EPS)return null;}
 if(strict)return{fraction:0,normal:[0,0,0],startSolid:true};if(!normal||enter< -EPS||enter>1+EPS||exit<0||dot(normal,velocity)>=-EPS)return null;return{fraction:Math.max(0,Math.min(1,enter)),normal,startSolid:false};}
function channels(value){if(value===undefined)return new Set(DEFAULT_CHANNELS);if(!Array.isArray(value)||value.some(c=>!DEFAULT_CHANNELS.includes(c)))throw Error('Invalid collision channels');return new Set(value);}
function compileShape(source,index){if(!source||typeof source!=='object')throw Error('Invalid collision shape');const v=points(source.vertices),box=bounds(v),shape={...source,id:source.id??index,vertices:v,bounds:box,channels:channels(source.channels)};
 if(source.type==='hull'){
  if(!Array.isArray(source.planes)||source.planes.length<4||source.planes.length>512)throw Error('Invalid hull planes');shape.planes=source.planes.map(p=>{if(!Array.isArray(p)||p.length!==4||!p.every(finite))throw Error('Invalid hull plane');const length=Math.hypot(p[0],p[1],p[2]);if(length<EPS)throw Error('Invalid hull normal');return p.map(x=>x/length);});
  // The pinned PHYS has authored Float32 plane/vertex residuals up to .93mm.
  // Validate rather than "repair" those data; body SAT keeps vertex intervals.
  for(const p of shape.planes)for(let i=0;i<v.length;i+=3)if(p[0]*v[i]+p[1]*v[i+1]+p[2]*v[i+2]-p[3]>.002)throw Error('Hull plane excludes authored vertex');
  shape.edges=source.edges?Array.isArray(source.edges[0])?source.edges:source.edges.reduce((a,x,i)=>(i%2?a.at(-1).push(x):a.push([x]),a),[]):null;if(shape.edges?.some(e=>e.length!==2||e.some(i=>!Number.isInteger(i)||i<0||i>=v.length/3)))throw Error('Invalid hull edges');shape.axes=hullAxes(shape);return{shape,items:[{type:'hull',shape,bounds:box}]};
 }
 if(source.type==='mesh'){
  const ids=source.indices;if(!Array.isArray(ids)&&!ArrayBuffer.isView(ids)||ids.length%3||ids.length>30000000||ids.some(i=>!Number.isInteger(i)||i<0||i>=v.length/3))throw Error('Invalid mesh indices');const items=[];
  for(let i=0;i<ids.length;i+=3){const a=ids[i]*3,b=ids[i+1]*3,c=ids[i+2]*3,abx=v[b]-v[a],aby=v[b+1]-v[a+1],abz=v[b+2]-v[a+2],acx=v[c]-v[a],acy=v[c+1]-v[a+1],acz=v[c+2]-v[a+2];if(Math.hypot(aby*acz-abz*acy,abz*acx-abx*acz,abx*acy-aby*acx)<=1e-12)continue;
   const points=new Float64Array(9);for(let k=0;k<3;k++){points[k]=v[a+k];points[k+3]=v[b+k];points[k+6]=v[c+k];}items.push({type:'triangle',shape,triangle:i/3,points,bounds:{min:[Math.min(v[a],v[b],v[c]),Math.min(v[a+1],v[b+1],v[c+1]),Math.min(v[a+2],v[b+2],v[c+2])],max:[Math.max(v[a],v[b],v[c]),Math.max(v[a+1],v[b+1],v[c+1]),Math.max(v[a+2],v[b+2],v[c+2])]}});}return{shape,items};
 }throw Error('Unsupported collision shape type');
}

export function createCollisionWorld(data,{radius=.4,bodyHeight=1.8,crouchHeight=.9,skin=.0005,groundProbe=.04,trustedCompiled=false}={}){
 if(!data||data.schema!=='cs2-physics-v1'||data.units!=='metres'||!Array.isArray(data.shapes)||data.shapes.length>100000||[radius,bodyHeight,crouchHeight,skin,groundProbe].some(x=>!finite(x)||x<0))throw Error('Invalid collision world');
 if(data.compiledCollision)return createCompiledCollisionWorld(data,{radius,bodyHeight,crouchHeight,skin,groundProbe,trustedCompiled});
 const {materials,shapes,primitives,tree}=compileRawCollision(data);
 const pointRayHullNodes=new WeakSet();markRawHullNodes(tree,pointRayHullNodes);
 const metrics={queries:0,nodes:0,candidates:0,narrowPhase:0,totalMs:0,maxMs:0},worldBounds=tree?{min:tree.min.slice(),max:tree.max.slice()}:{min:[0,0,0],max:[0,0,0]},clock=()=>globalThis.performance?.now?.()??Date.now(),axisQueue=[];let axisCursor=0;
 function axes(item){if(item.axes)return item.axes;const value=triangleAxes(item);if(axisQueue.length<2048)axisQueue.push(item);else{axisQueue[axisCursor].axes=null;axisQueue[axisCursor]=item;axisCursor=(axisCursor+1)%2048;}return value;}
 function finish(hit,at){const duration=clock()-at;metrics.totalMs+=duration;metrics.maxMs=Math.max(metrics.maxMs,duration);return hit;}
 function trace(start,end,height=0,options={}){
  const at=clock();
  if(!finite(height)||height<0||height>32)throw Error('Invalid collision height');const r=options.radius??(height>0?radius:0);if(!finite(r)||r<0||r>32)throw Error('Invalid collision radius');let channel=options.channel||(height>0?'player':'bullet');if(channel==='shot')channel='bullet';if(!DEFAULT_CHANNELS.includes(channel)&&channel!=='all')throw Error('Invalid collision channel');
  const from=point(start,'start'),to=point(end,'end'),offset=height/2,a=[from[0],from[1]+offset,from[2]],b=[to[0],to[1]+offset,to[2]],extents=options.halfExtents?point(options.halfExtents,'extents'):[r,height>0?height/2:r,r];if(extents.some(x=>x<0))throw Error('Invalid collision extents');
  const candidates=[];metrics.queries++;if(height===0&&r===0&&options.halfExtents===undefined)queryPointRay(tree,sweepBounds(a,b,extents),candidates,metrics,a,b,pointRayHullNodes);else query(tree,sweepBounds(a,b,extents),candidates,metrics);metrics.candidates+=candidates.length;let best=null;
  for(const item of candidates){if(channel!=='all'&&!item.shape.channels.has(channel))continue;metrics.narrowPhase++;let hit;if(height===0&&extents.every(v=>v===0))hit=item.type==='hull'?rayHull(item.shape,a,b):rayTriangle(item,a,b);else hit=sweepAxes(item.type==='hull'?item.shape.axes:axes(item),a,b,extents);
   if(hit&&(hit.startSolid||!best||hit.fraction<best.fraction-1e-9||Math.abs(hit.fraction-best.fraction)<1e-9&&hit.normal[1]>best.normal[1])){best={...hit,item};if(hit.startSolid)break;}
  }
  if(!best)return finish({fraction:1,end:output(to),normal:[0,0,0],startSolid:false,shape:null,model:null,material:null,materialHash:null,surfacePropertyIndex:null},at);
  let fraction=best.fraction;if(!best.startSolid&&fraction>0){const normalTravel=Math.abs(dot(sub(b,a),best.normal));if(normalTravel>EPS)fraction=Math.max(0,fraction-skin/normalTravel);}
  const shape=best.item.shape,index=shape.triangleMaterials?.length?shape.triangleMaterials[best.item.triangle]:shape.surfacePropertyIndex,material=Number.isInteger(index)&&index>=0?materials[index]:null;return finish({fraction,end:output(endAt(from,to,fraction)),normal:best.normal.map(v=>Object.is(v,-0)?0:v),startSolid:best.startSolid,shape:shape.id,model:shape.id,triangle:best.item.triangle??null,material:material?material.name:shape.material??null,materialHash:material?material.hash:shape.materialHash??null,surfacePropertyIndex:index??null,collisionAttributeIndex:shape.collisionAttributeIndex??null,tags:shape.tags??shape.source?.interactAs??[],interactExclude:shape.source?.interactExclude??[],channel},at);
 }
 const collides=(x,z,r=radius,y=0,height=bodyHeight)=>trace({x,y,z},{x,y,z},height,{radius:r,channel:'player'}).startSolid;
 function findSupport(x,z,maxFeet=worldBounds.max[1]+1,options={}){const hit=trace({x,y:maxFeet+skin*2,z},{x,y:worldBounds.min[1]-8,z},options.height||0,{...options,channel:'player'});return !hit.startSolid&&hit.fraction<1&&hit.normal[1]>.7?hit:null;}
 const supportHeight=(x,z,maxFeet=worldBounds.max[1]+1)=>findSupport(x,z,maxFeet)?.end.y??maxFeet;
 function isGrounded(p){if((p.vy||0)>.01)return false;const hit=trace(p,{x:p.x,y:p.y-groundProbe,z:p.z},p.crouch?crouchHeight:bodyHeight,{channel:'player'});return !hit.startSolid&&hit.fraction<1&&hit.normal[1]>.7;}
 return{trace,raycast:(a,b,options={})=>trace(a,b,0,options),rayIntervals:makeRayIntervalQuery({materials,metrics,clock,finish,collect:(box,out)=>query(tree,box,out,metrics),item:value=>({shape:value.shape,triangle:value.triangle??null,points:value.points,planeView:value.type==='hull'?{count:value.shape.planes.length,get:i=>value.shape.planes[i]}:null,materialIndex:value.shape.triangleMaterials?.length?value.shape.triangleMaterials[value.triangle]:value.shape.surfacePropertyIndex})}),collides,findSupport,supportHeight,groundHeight:supportHeight,isGrounded,bounds:worldBounds,stats:()=>({...metrics,shapes:shapes.length,primitives:primitives.length,triangleAxisCache:axisQueue.length}),resetStats(){metrics.queries=metrics.nodes=metrics.candidates=metrics.narrowPhase=metrics.totalMs=metrics.maxMs=0;}};
}

function compileRawCollision(data){
 const materials=data.materials||[];if(!Array.isArray(materials)||materials.length>65536||materials.some(m=>!m||m.name!==null&&typeof m.name!=='string'||typeof m.hash!=='string'||!/^[0-9a-f]{8}$/.test(m.hash)))throw Error('Invalid collision materials');
 const primitives=[],shapes=[];for(let i=0;i<data.shapes.length;i++){const compiled=compileShape(data.shapes[i],i);const shape=compiled.shape;if(shape.surfacePropertyIndex!==undefined&&(!Number.isInteger(shape.surfacePropertyIndex)||shape.surfacePropertyIndex< -1||shape.surfacePropertyIndex>=materials.length))throw Error('Invalid shape material index');if(shape.triangleMaterials?.length&&(!Array.isArray(shape.triangleMaterials)||shape.type!=='mesh'||shape.triangleMaterials.length!==shape.indices.length/3||shape.triangleMaterials.some(i=>!Number.isInteger(i)||i< -1||i>=materials.length)))throw Error('Invalid triangle materials');shapes.push(shape);for(const item of compiled.items)primitives.push(item);}
 return{materials,shapes,primitives,tree:buildTree(primitives.slice())};
}

const ACCEL_SCHEMA='cs2-collision-accel-v1';
const CHANNEL_BITS={player:1,bullet:2,grenade:4,audio:8};
const channelMask=set=>[...set].reduce((mask,name)=>mask|CHANNEL_BITS[name],0);
/** Compile validated source geometry in a worker/offline, preserving Float64
 * intervals and the exact raw BVH candidate order. Only this buffer and small
 * shape metadata cross into the render thread. No Wasm or geometry quantizing. */
export function compileCollisionData(data){
 if(data?.schema!=='cs2-physics-v1'||data.units!=='metres'||!Array.isArray(data.shapes)||data.shapes.length>100000)throw Error('Invalid collision world');
 if(data.compiledCollision)throw Error('Collision source is already compiled');
 const {materials,shapes,primitives,tree}=compileRawCollision(data),shapeIds=new Map(shapes.map((shape,id)=>[shape,id])),primitiveIds=new Map(primitives.map((item,id)=>[item,id]));
 const nodes=[],order=[];
 function visit(node){if(!node)return -1;const id=nodes.length,entry={node,left:-1,right:-1,start:0,count:0};nodes.push(entry);if(node.items){entry.start=order.length;entry.count=node.items.length;for(const item of node.items)order.push(primitiveIds.get(item));}else{entry.left=visit(node.left);entry.right=visit(node.right);}return id;}
 visit(tree);
 const hullRanges=new Uint32Array(shapes.length*4),planes=[],axes=[];
 for(let i=0;i<shapes.length;i++){const shape=shapes[i];if(shape.type!=='hull')continue;hullRanges.set([planes.length/4,shape.planes.length,axes.length/5,shape.axes.length],i*4);for(const p of shape.planes)planes.push(...p);for(const a of shape.axes)axes.push(...a.n,a.min,a.max);}
 const primitiveInfo=new Int32Array(primitives.length*4),primitiveBounds=new Float64Array(primitives.length*6),trianglePoints=new Float64Array(primitives.length*9);
 for(let i=0;i<primitives.length;i++){const item=primitives[i],shape=item.shape,index=shape.triangleMaterials?.length?shape.triangleMaterials[item.triangle]:shape.surfacePropertyIndex;primitiveInfo.set([item.type==='hull'?0:1,shapeIds.get(shape),item.triangle??-1,index??-2],i*4);primitiveBounds.set([...item.bounds.min,...item.bounds.max],i*6);if(item.type==='triangle')trianglePoints.set(item.points,i*9);}
 const nodeBounds=new Float64Array(nodes.length*6),nodeLinks=new Int32Array(nodes.length*4);
 for(let i=0;i<nodes.length;i++){const n=nodes[i];nodeBounds.set([...n.node.min,...n.node.max],i*6);nodeLinks.set([n.left,n.right,n.start,n.count],i*4);}
 const metadata=shapes.map(shape=>({id:shape.id,type:shape.type,material:shape.material??null,materialHash:shape.materialHash??null,surfacePropertyIndex:shape.surfacePropertyIndex??null,collisionAttributeIndex:shape.collisionAttributeIndex??null,channels:[...shape.channels],channelMask:channelMask(shape.channels),twoSided:shape.twoSided??null,tags:shape.tags??shape.source?.interactAs??[],source:shape.source??null}));
 const arrays={hullRanges,planes:Float64Array.from(planes),axes:Float64Array.from(axes),primitiveInfo,primitiveBounds,trianglePoints,nodeBounds,nodeLinks,order:Uint32Array.from(order)},sections={};let size=0;
 for(const [name,array]of Object.entries(arrays)){size=Math.ceil(size/8)*8;sections[name]={offset:size,length:array.length};size+=array.byteLength;}
 const buffer=new ArrayBuffer(size);for(const [name,array]of Object.entries(arrays))new Uint8Array(buffer,sections[name].offset,array.byteLength).set(new Uint8Array(array.buffer,array.byteOffset,array.byteLength));
 return{...data,materials,shapes:metadata,compiledCollision:{schema:ACCEL_SCHEMA,bytes:size,shapeCount:shapes.length,primitiveCount:primitives.length,nodeCount:nodes.length,sections,buffer}};
}

function createCompiledCollisionWorld(data,{radius,bodyHeight,crouchHeight,skin,groundProbe,trustedCompiled}){
 const c=data.compiledCollision;
 if(c?.schema!==ACCEL_SCHEMA||!(c.buffer instanceof ArrayBuffer)||c.bytes!==c.buffer.byteLength||c.bytes>512*1024*1024||!Number.isSafeInteger(c.shapeCount)||c.shapeCount!==data.shapes.length||!Number.isSafeInteger(c.primitiveCount)||c.primitiveCount<0||c.primitiveCount>2000000||!Number.isSafeInteger(c.nodeCount)||c.nodeCount<0||c.nodeCount>4000000)throw Error('Invalid compiled collision header');
 const specs={hullRanges:[Uint32Array,c.shapeCount*4],planes:[Float64Array,null],axes:[Float64Array,null],primitiveInfo:[Int32Array,c.primitiveCount*4],primitiveBounds:[Float64Array,c.primitiveCount*6],trianglePoints:[Float64Array,c.primitiveCount*9],nodeBounds:[Float64Array,c.nodeCount*6],nodeLinks:[Int32Array,c.nodeCount*4],order:[Uint32Array,c.primitiveCount]},arrays={},spans=[];
 for(const [name,[Type,length]]of Object.entries(specs)){const s=c.sections?.[name];if(!s||!Number.isSafeInteger(s.offset)||!Number.isSafeInteger(s.length)||s.offset<0||s.length<0||s.offset%Type.BYTES_PER_ELEMENT||s.offset+s.length*Type.BYTES_PER_ELEMENT>c.bytes||length!==null&&s.length!==length)throw Error('Invalid compiled collision section');arrays[name]=new Type(c.buffer,s.offset,s.length);spans.push([s.offset,s.offset+s.length*Type.BYTES_PER_ELEMENT]);}
 spans.sort((a,b)=>a[0]-b[0]);if(spans.some((s,i)=>i&&s[0]<spans[i-1][1])||arrays.planes.length%4||arrays.axes.length%5)throw Error('Overlapping compiled collision sections');
 const shapes=data.shapes,materials=data.materials||[];if(!Array.isArray(materials)||materials.length>65536||materials.some(m=>!m||m.name!==null&&typeof m.name!=='string'||typeof m.hash!=='string'||!/^[0-9a-f]{8}$/.test(m.hash)))throw Error('Invalid collision materials');
 for(let i=0;i<shapes.length;i++){const shape=shapes[i],r=i*4;if(!shape||!['hull','mesh'].includes(shape.type)||!Array.isArray(shape.channels)||shape.channels.some(x=>!DEFAULT_CHANNELS.includes(x))||shape.channelMask!==channelMask(new Set(shape.channels))||arrays.hullRanges[r]*4+arrays.hullRanges[r+1]*4>arrays.planes.length||arrays.hullRanges[r+2]*5+arrays.hullRanges[r+3]*5>arrays.axes.length)throw Error('Invalid compiled collision shape');}
 // Worker output is built from the already byte-verified source; the browser
 // skips scanning millions of validated values again. Direct callers receive
 // full validation, including topology, indices and finite numeric storage.
 if(!trustedCompiled){
  for(const name of ['planes','axes','primitiveBounds','trianglePoints','nodeBounds'])if(!arrays[name].every(finite))throw Error('Non-finite compiled collision data');
  for(let i=0;i<c.primitiveCount;i++){const r=i*4;if(![0,1].includes(arrays.primitiveInfo[r])||arrays.primitiveInfo[r+1]<0||arrays.primitiveInfo[r+1]>=shapes.length||arrays.primitiveInfo[r+3]<-2||arrays.primitiveInfo[r+3]>=materials.length)throw Error('Invalid compiled primitive');for(let k=0;k<3;k++)if(arrays.primitiveBounds[i*6+k]>arrays.primitiveBounds[i*6+k+3])throw Error('Invalid compiled primitive bounds');}
  if(arrays.order.some(id=>id>=c.primitiveCount))throw Error('Invalid compiled primitive order');
  const seen=new Uint8Array(c.nodeCount),pending=c.nodeCount?[0]:[];while(pending.length){const id=pending.pop();if(id<0||id>=c.nodeCount||seen[id])throw Error('Invalid compiled collision tree');seen[id]=1;const p=id*4,count=arrays.nodeLinks[p+3];if(count>0){if(arrays.nodeLinks[p+2]<0||arrays.nodeLinks[p+2]+count>arrays.order.length)throw Error('Invalid compiled leaf');}else pending.push(arrays.nodeLinks[p],arrays.nodeLinks[p+1]);}
 }
 const {hullRanges,planes,axes,primitiveInfo,primitiveBounds,trianglePoints,nodeBounds,nodeLinks,order}=arrays,metrics={queries:0,nodes:0,candidates:0,narrowPhase:0,totalMs:0,maxMs:0},worldBounds=c.nodeCount?{min:Array.from(nodeBounds.subarray(0,3)),max:Array.from(nodeBounds.subarray(3,6))}:{min:[0,0,0],max:[0,0,0]},cache=new Map(),queue=[];let cacheCursor=0;
 const clock=()=>globalThis.performance?.now?.()??Date.now();
 function intersects(values,start,box){for(let k=0;k<3;k++)if(values[start+k]>box.max[k]+CONTACT||values[start+k+3]<box.min[k]-CONTACT)return false;return true;}
 function gather(id,box,out){if(!intersects(nodeBounds,id*6,box))return;metrics.nodes++;const start=id*4,count=nodeLinks[start+3];if(count){for(let at=nodeLinks[start+2];at<nodeLinks[start+2]+count;at++){const primitive=order[at];if(intersects(primitiveBounds,primitive*6,box))out.push(primitive);}}else{gather(nodeLinks[start],box,out);gather(nodeLinks[start+1],box,out);}}
 // This side table changes neither serialized collision data nor tree order.
 const pointRayHullNodes=new Uint8Array(c.nodeCount);
 function markHullNodes(id){const start=id*4,count=nodeLinks[start+3];let hasHull=false;if(count){for(let at=nodeLinks[start+2];at<nodeLinks[start+2]+count;at++)if(primitiveInfo[order[at]*4]===0){hasHull=true;break;}}else{const left=markHullNodes(nodeLinks[start]),right=markHullNodes(nodeLinks[start+1]);hasHull=left||right;}pointRayHullNodes[id]=hasHull?1:0;return hasHull;}
 if(c.nodeCount)markHullNodes(0);
 function gatherPointRay(id,box,out,a,b){
  if(!intersects(nodeBounds,id*6,box)||!pointRayHullNodes[id]&&!pointSegmentIntersectsBounds(a,b,nodeBounds,nodeBounds,id*6,id*6+3))return;
  metrics.nodes++;const start=id*4,count=nodeLinks[start+3];
  if(count){for(let at=nodeLinks[start+2];at<nodeLinks[start+2]+count;at++){const primitive=order[at];if(intersects(primitiveBounds,primitive*6,box)&&(primitiveInfo[primitive*4]===0||pointSegmentIntersectsBounds(a,b,primitiveBounds,primitiveBounds,primitive*6,primitive*6+3)))out.push(primitive);}}
  else{gatherPointRay(nodeLinks[start],box,out,a,b);gatherPointRay(nodeLinks[start+1],box,out,a,b);}
 }
 function hullRay(shapeIndex,a,b){let enter=0,exit=1,normal=null,strict=true;const velocity=sub(b,a),range=shapeIndex*4;
  for(let i=hullRanges[range]*4,end=i+hullRanges[range+1]*4;i<end;i+=4){const da=planes[i]*a[0]+planes[i+1]*a[1]+planes[i+2]*a[2]-planes[i+3],speed=planes[i]*velocity[0]+planes[i+1]*velocity[1]+planes[i+2]*velocity[2];strict&&=da< -CONTACT;if(Math.abs(speed)<EPS){if(da>CONTACT||Math.abs(da)<=CONTACT)return null;continue;}const t=-da/speed;if(speed<0){if(t>=enter-EPS){enter=Math.max(enter,t);normal=[planes[i],planes[i+1],planes[i+2]];}}else exit=Math.min(exit,t);if(enter>exit+EPS)return null;}
  if(strict)return{fraction:0,normal:[0,0,0],startSolid:true};if(!normal||enter< -EPS||enter>1+EPS||exit<0||dot(normal,velocity)>=-EPS)return null;return{fraction:Math.max(0,Math.min(1,enter)),normal,startSolid:false};
 }
 function hullSweep(shapeIndex,a,b,extents){let enter=0,exit=1,normal=null,strict=true;const velocity=sub(b,a),range=shapeIndex*4;
  for(let i=hullRanges[range+2]*5,end=i+hullRanges[range+3]*5;i<end;i+=5){const nx=axes[i],ny=axes[i+1],nz=axes[i+2],r=0+Math.abs(nx)*extents[0]+Math.abs(ny)*extents[1]+Math.abs(nz)*extents[2],lo=axes[i+3]-r,hi=axes[i+4]+r,from=nx*a[0]+ny*a[1]+nz*a[2],speed=nx*velocity[0]+ny*velocity[1]+nz*velocity[2];strict&&=from>lo+CONTACT&&from<hi-CONTACT;
   if(Math.abs(speed)<EPS){if(from<lo-CONTACT||from>hi+CONTACT)return null;if(from<=lo+CONTACT||from>=hi-CONTACT)return null;continue;}let near=(lo-from)/speed,far=(hi-from)/speed,sign=-1;if(near>far){[near,far]=[far,near];sign=1;}if(near>=enter-EPS){enter=Math.max(enter,near);normal=[nx*sign,ny*sign,nz*sign];}exit=Math.min(exit,far);if(enter>exit+EPS)return null;
  }if(strict)return{fraction:0,normal:[0,0,0],startSolid:true};if(!normal||enter< -EPS||enter>1+EPS||exit<0||dot(normal,velocity)>=-EPS)return null;return{fraction:Math.max(0,Math.min(1,enter)),normal,startSolid:false};
 }
 function triangle(id,shape){if(cache.has(id))return cache.get(id);const item={points:trianglePoints.subarray(id*9,id*9+9),shape,axes:null};if(queue.length<2048)queue.push(id);else{cache.delete(queue[cacheCursor]);queue[cacheCursor]=id;cacheCursor=(cacheCursor+1)%2048;}cache.set(id,item);return item;}
 function finish(hit,at){const duration=clock()-at;metrics.totalMs+=duration;metrics.maxMs=Math.max(metrics.maxMs,duration);return hit;}
 function trace(start,end,height=0,options={}){
  const at=clock();if(!finite(height)||height<0||height>32)throw Error('Invalid collision height');const r=options.radius??(height>0?radius:0);if(!finite(r)||r<0||r>32)throw Error('Invalid collision radius');let channel=options.channel||(height>0?'player':'bullet');if(channel==='shot')channel='bullet';if(!DEFAULT_CHANNELS.includes(channel)&&channel!=='all')throw Error('Invalid collision channel');
  const from=point(start,'start'),to=point(end,'end'),offset=height/2,a=[from[0],from[1]+offset,from[2]],b=[to[0],to[1]+offset,to[2]],extents=options.halfExtents?point(options.halfExtents,'extents'):[r,height>0?height/2:r,r];if(extents.some(x=>x<0))throw Error('Invalid collision extents');const candidates=[];metrics.queries++;if(c.nodeCount){if(height===0&&r===0&&options.halfExtents===undefined)gatherPointRay(0,sweepBounds(a,b,extents),candidates,a,b);else gather(0,sweepBounds(a,b,extents),candidates);}metrics.candidates+=candidates.length;let best=null;
  for(const id of candidates){const p=id*4,shapeIndex=primitiveInfo[p+1],shape=shapes[shapeIndex];if(channel!=='all'&&!(shape.channelMask&CHANNEL_BITS[channel]))continue;metrics.narrowPhase++;let hit;const ray=height===0&&extents.every(v=>v===0);if(primitiveInfo[p]===0)hit=ray?hullRay(shapeIndex,a,b):hullSweep(shapeIndex,a,b,extents);else{const item=triangle(id,shape);hit=ray?rayTriangle(item,a,b):sweepAxes(triangleAxes(item),a,b,extents);}
   if(hit&&(hit.startSolid||!best||hit.fraction<best.fraction-1e-9||Math.abs(hit.fraction-best.fraction)<1e-9&&hit.normal[1]>best.normal[1])){best={...hit,id,shapeIndex};if(hit.startSolid)break;}
  }
  if(!best)return finish({fraction:1,end:output(to),normal:[0,0,0],startSolid:false,shape:null,model:null,material:null,materialHash:null,surfacePropertyIndex:null},at);
  let fraction=best.fraction;if(!best.startSolid&&fraction>0){const normalTravel=Math.abs(dot(sub(b,a),best.normal));if(normalTravel>EPS)fraction=Math.max(0,fraction-skin/normalTravel);}const shape=shapes[best.shapeIndex],index=primitiveInfo[best.id*4+3],material=index>=0?materials[index]:null;
  return finish({fraction,end:output(endAt(from,to,fraction)),normal:best.normal.map(v=>Object.is(v,-0)?0:v),startSolid:best.startSolid,shape:shape.id,model:shape.id,triangle:primitiveInfo[best.id*4+2]<0?null:primitiveInfo[best.id*4+2],material:material?material.name:shape.material??null,materialHash:material?material.hash:shape.materialHash??null,surfacePropertyIndex:index===-2?null:index,collisionAttributeIndex:shape.collisionAttributeIndex??null,tags:shape.tags??shape.source?.interactAs??[],interactExclude:shape.source?.interactExclude??[],channel},at);
 }
 const collides=(x,z,r=radius,y=0,height=bodyHeight)=>trace({x,y,z},{x,y,z},height,{radius:r,channel:'player'}).startSolid;
 function findSupport(x,z,maxFeet=worldBounds.max[1]+1,options={}){const hit=trace({x,y:maxFeet+skin*2,z},{x,y:worldBounds.min[1]-8,z},options.height||0,{...options,channel:'player'});return !hit.startSolid&&hit.fraction<1&&hit.normal[1]>.7?hit:null;}
 const supportHeight=(x,z,maxFeet=worldBounds.max[1]+1)=>findSupport(x,z,maxFeet)?.end.y??maxFeet;
 function isGrounded(p){if((p.vy||0)>.01)return false;const hit=trace(p,{x:p.x,y:p.y-groundProbe,z:p.z},p.crouch?crouchHeight:bodyHeight,{channel:'player'});return !hit.startSolid&&hit.fraction<1&&hit.normal[1]>.7;}
 return{trace,raycast:(a,b,options={})=>trace(a,b,0,options),rayIntervals:makeRayIntervalQuery({materials,metrics,clock,finish,collect:(box,out)=>{if(c.nodeCount)gather(0,box,out);},item:id=>{const p=id*4,shapeIndex=primitiveInfo[p+1],shape=shapes[shapeIndex],r=shapeIndex*4;return{shape,triangle:primitiveInfo[p+2]<0?null:primitiveInfo[p+2],points:primitiveInfo[p]===1?trianglePoints.subarray(id*9,id*9+9):null,planeView:primitiveInfo[p]===0?{count:hullRanges[r+1],get:i=>planes.subarray((hullRanges[r]+i)*4,(hullRanges[r]+i+1)*4)}:null,materialIndex:primitiveInfo[p+3]===-2?undefined:primitiveInfo[p+3]};}}),collides,findSupport,supportHeight,groundHeight:supportHeight,isGrounded,bounds:worldBounds,compiled:true,compiledBytes:c.bytes,stats:()=>({...metrics,shapes:c.shapeCount,primitives:c.primitiveCount,triangleAxisCache:cache.size,compiled:true,compiledBytes:c.bytes}),resetStats(){metrics.queries=metrics.nodes=metrics.candidates=metrics.narrowPhase=metrics.totalMs=metrics.maxMs=0;}};
}


// Certified convex-volume entry/exit only. Open or unverified mesh surfaces are
// deliberately a separate list: pairing two arbitrary faces is not proof of a
// solid wall, and can incorrectly jump across a void or disconnected geometry.
function hullSegmentInterval(view,a,b){
 const velocity=sub(b,a);let enter=-Infinity,exit=Infinity,enterNormal=null,exitNormal=null,startInside=true;
 for(let i=0;i<view.count;i++){const p=view.get(i),distance=dot(p,a)-p[3],speed=dot(p,velocity);startInside&&=distance< -CONTACT;
  if(Math.abs(speed)<EPS){if(distance>=-CONTACT)return null;continue;}
  const t=-distance/speed;if(speed<0){if(t>enter){enter=t;enterNormal=[p[0],p[1],p[2]];}}else if(t<exit){exit=t;exitNormal=[p[0],p[1],p[2]];}
  if(enter>exit+EPS)return null;
 }
 if(!finite(enter)||!finite(exit)||exit-enter<=EPS||exit<0||enter>1||exit>1+EPS)return null;
 return{enterFraction:enter,exitFraction:Math.min(1,exit),enterNormal,exitNormal,startInside};
}
function makeRayIntervalQuery({materials,metrics,clock,finish,collect,item}){
 return(start,end,{channel='bullet',maxHits=256,includeBackfaces=true}={})=>{
  const at=clock(),a=point(start,'start'),b=point(end,'end');if(channel==='shot')channel='bullet';if(!DEFAULT_CHANNELS.includes(channel)&&channel!=='all')throw Error('Invalid collision channel');if(!Number.isSafeInteger(maxHits)||maxHits<1||maxHits>4096)throw Error('Invalid ray interval limit');
  const distance=Math.hypot(...sub(b,a));if(distance<EPS)return finish({intervals:[],surfaces:[],truncated:false},at);metrics.queries++;const candidates=[];collect(sweepBounds(a,b,[0,0,0]),candidates);metrics.candidates+=candidates.length;const intervals=[],surfaces=[];
  for(const candidate of candidates){const value=item(candidate),shape=value.shape,allowed=shape.channels instanceof Set?shape.channels.has(channel):Boolean(shape.channelMask&CHANNEL_BITS[channel]);if(channel!=='all'&&!allowed)continue;metrics.narrowPhase++;
   const material=Number.isInteger(value.materialIndex)&&value.materialIndex>=0?materials[value.materialIndex]:null,metadata={shape:shape.id,material:material?material.name:shape.material??null,materialHash:material?material.hash:shape.materialHash??null,surfacePropertyIndex:value.materialIndex??null,collisionAttributeIndex:shape.collisionAttributeIndex??null,tags:shape.tags??shape.source?.interactAs??[],interactExclude:shape.source?.interactExclude??[]};
   if(value.planeView){const hit=hullSegmentInterval(value.planeView,a,b);if(hit)intervals.push({kind:'solid-hull',...metadata,...hit,enter:output(endAt(a,b,hit.enterFraction)),exit:output(endAt(a,b,hit.exitFraction)),thicknessMetres:(hit.exitFraction-hit.enterFraction)*distance,exitCertified:true});}
   else{const hit=rayTriangle({points:value.points,shape:includeBackfaces?{twoSided:true}:shape},a,b);if(hit){const rawNormal=normalize(cross(sub(vertex(value.points,1),vertex(value.points,0)),sub(vertex(value.points,2),vertex(value.points,0))));surfaces.push({kind:'mesh-surface',...metadata,triangle:value.triangle,fraction:hit.fraction,position:output(endAt(a,b,hit.fraction)),normal:hit.normal,sourceNormal:rawNormal,frontFacing:dot(rawNormal,sub(b,a))<0,exitCertified:false});}}
  }
  intervals.sort((a,b)=>a.enterFraction-b.enterFraction||a.exitFraction-b.exitFraction);surfaces.sort((a,b)=>a.fraction-b.fraction);const truncated=intervals.length+surfaces.length>maxHits;
  // Never provide an arbitrary partial set as though it were a complete query.
  return finish({intervals:intervals.slice(0,maxHits),surfaces:surfaces.slice(0,Math.max(0,maxHits-Math.min(maxHits,intervals.length))),truncated},at);
 };
}
