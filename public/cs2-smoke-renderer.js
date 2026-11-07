// Depth-aware, bounded volumetric pilot. This is a raymarched density field,
// not translucent sphere geometry. World rendering remains one pass; smoke
// adds one fullscreen composite only while a visible volume is active.
import {SMOKE_FIELD_LIMITS,SMOKE_FIELD_VERSION,smokeEnvelope,applySmokeShot,applySmokeExplosion} from './cs2-smoke-field.js';

const fragmentShader=`
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform vec2 uSampleScale;
uniform mat4 uInverseProjection;
uniform mat4 uCameraWorld;
uniform vec3 uCamera;
uniform int uCount;
uniform int uOverflowCount;
uniform vec4 uVolumes[4];
uniform vec2 uShape[4];
uniform vec4 uOverflow[28];
uniform vec2 uOverflowShape[28];
uniform vec4 uHoleFrom[16];
uniform vec4 uHoleTo[16];
uniform vec4 uClear[8];
uniform float uClearStrength[8];
float noiseField(vec3 p){return .68+.16*sin(p.x*2.1+p.y*1.9)+.09*sin(p.z*3.4-p.x*1.2)+.07*sin(p.y*4.5+p.z*2.7);}
float lineDistance(vec3 p,vec3 a,vec3 b){vec3 d=b-a;float t=clamp(dot(p-a,d)/max(dot(d,d),.000001),0.,1.);return length(p-a-d*t);}
float densityAt(vec3 p,int i){
 vec3 radius=vec3(uVolumes[i].w,uShape[i].x,uVolumes[i].w);
 float edge=length((p-uVolumes[i].xyz)/radius);
 float density=(1.-smoothstep(.35,1.,edge))*clamp(noiseField(p),.2,1.)*uShape[i].y;
 for(int j=0;j<4;j++){int h=i*4+j;float strength=uHoleTo[h].w;if(strength>0.){float d=lineDistance(p,uHoleFrom[h].xyz,uHoleTo[h].xyz)/max(.001,uHoleFrom[h].w);density*=1.-exp(-d*d*2.)*strength;}}
 for(int j=0;j<2;j++){int h=i*2+j;float strength=uClearStrength[h];if(strength>0.){float d=distance(p,uClear[h].xyz)/max(.001,uClear[h].w);density*=1.-(1.-smoothstep(.65,1.,d))*strength;}}
 return max(0.,density);
}
void main(){
 vec2 sampleUv=vUv*uSampleScale;
 vec4 sceneColor=texture2D(tScene,sampleUv);float depth=texture2D(tDepth,sampleUv).r;
 vec4 view=uInverseProjection*vec4(vUv*2.-1.,depth*2.-1.,1.);view/=view.w;
 vec3 world=(uCameraWorld*view).xyz,delta=world-uCamera;float maxDistance=length(delta);vec3 ray=delta/max(maxDistance,.00001);
 vec3 smokeLight=vec3(.34,.33,.31);float transmittance=1.;
 for(int i=0;i<4;i++){
  if(i>=uCount)break;
  vec3 radius=vec3(uVolumes[i].w,uShape[i].x,uVolumes[i].w),ro=(uCamera-uVolumes[i].xyz)/radius,rd=ray/radius;
  float a=dot(rd,rd),b=dot(ro,rd),c=dot(ro,ro)-1.,disc=b*b-a*c;
  if(disc<=0.)continue;
  float root=sqrt(disc),nearT=max(0.,(-b-root)/a),farT=min(maxDistance,(-b+root)/a);
  if(farT<=nearT)continue;
  float stepLength=(farT-nearT)/8.;
  for(int j=0;j<8;j++){
   vec3 p=uCamera+ray*(nearT+(float(j)+.5)*stepLength);
   float density=densityAt(p,i);transmittance*=exp(-density*stepLength*2.15);
  }
 }
 // Additional confirmed clouds retain conservative occlusion. They use the
 // exact depth-bounded ellipsoid segment length instead of per-sample detail;
 // reduced quality may hide more, never reveal an enemy through the fifth cloud.
 for(int i=0;i<28;i++){
  if(i>=uOverflowCount)break;
  vec3 radius=vec3(uOverflow[i].w,uOverflowShape[i].x,uOverflow[i].w),ro=(uCamera-uOverflow[i].xyz)/radius,rd=ray/radius;
  float a=dot(rd,rd),b=dot(ro,rd),c=dot(ro,ro)-1.,disc=b*b-a*c;
  if(disc<=0.)continue;
  float root=sqrt(disc),nearT=max(0.,(-b-root)/a),farT=min(maxDistance,(-b+root)/a);
  if(farT>nearT)transmittance*=exp(-(farT-nearT)*uOverflowShape[i].y*2.15);
 }
 gl_FragColor=vec4(mix(smokeLight,sceneColor.rgb,transmittance),sceneColor.a);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;

export function createSmokeRenderer(THREE,{renderer,scene,camera}={}){
 if(!THREE||!renderer||!scene||!camera)throw Error('Smoke renderer requires THREE, renderer, scene and camera');
 const size=new THREE.Vector2(),activeViewport=new THREE.Vector4(),savedViewport=new THREE.Vector4(),savedScissor=new THREE.Vector4();
 let target=null,width=0,height=0,activeWidth=0,activeHeight=0,targetAllocations=0,disposed=false,volumes=[],renderCount=0,prewarmed=false,lastVisible=0,degradedVolumes=0,firstRender=null;
 const warmup={compileCalls:0,draws:0,objectBatches:0,representativesSkipped:0,totalMs:0,compileWaitMs:0,submitMs:0,peakSubmitMs:0,programsBefore:null,programsAfter:null};let compositeDrawWarmed=false;
 const lastRender={frame:0,worldSubmitMs:0,compositeSubmitMs:0,programsBefore:null,programsAfterWorld:null,programsAfterComposite:null};
 const uniforms={tScene:{value:null},tDepth:{value:null},uSampleScale:{value:new THREE.Vector2(1,1)},uInverseProjection:{value:new THREE.Matrix4()},uCameraWorld:{value:new THREE.Matrix4()},uCamera:{value:new THREE.Vector3()},uCount:{value:0},uOverflowCount:{value:0},uVolumes:{value:Array.from({length:4},()=>new THREE.Vector4())},uShape:{value:Array.from({length:4},()=>new THREE.Vector2())},uOverflow:{value:Array.from({length:28},()=>new THREE.Vector4())},uOverflowShape:{value:Array.from({length:28},()=>new THREE.Vector2())},uHoleFrom:{value:Array.from({length:16},()=>new THREE.Vector4())},uHoleTo:{value:Array.from({length:16},()=>new THREE.Vector4())},uClear:{value:Array.from({length:8},()=>new THREE.Vector4())},uClearStrength:{value:new Float32Array(8)}};
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,2,0,0,2],2));
 const material=new THREE.ShaderMaterial({uniforms,vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader,depthTest:false,depthWrite:false,toneMapped:true,transparent:false});
 const compositeScene=new THREE.Scene(),compositeCamera=new THREE.Camera(),quad=new THREE.Mesh(geometry,material);quad.frustumCulled=false;compositeScene.add(quad);
 const projection=new THREE.Matrix4(),frustum=new THREE.Frustum(),sphere=new THREE.Sphere(),candidates=[];
 function resize(w,h){if(disposed)return false;if(w===undefined||h===undefined){renderer.getDrawingBufferSize(size);w=size.x;h=size.y;}w=Math.max(1,Math.floor(w));h=Math.max(1,Math.floor(h));if(w===width&&h===height&&target)return false;
  // Keep the intermediate in linear half-float where supported; an 8-bit
  // linear target visibly quantizes dark wall colours after the sRGB roundtrip.
  const type=renderer.extensions?.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType;
  width=w;height=h;if(target)target.dispose();target=new THREE.WebGLRenderTarget(width,height,{type,depthBuffer:true,stencilBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});targetAllocations++;target.texture.name='cs2-smoke-world-color';target.depthTexture=new THREE.DepthTexture(width,height,THREE.UnsignedIntType);target.depthTexture.name='cs2-smoke-world-depth';uniforms.tScene.value=target.texture;uniforms.tDepth.value=target.depthTexture;return true;
 }
 function prewarm(){if(disposed||prewarmed)return;resize();renderer.initRenderTarget?.(target);renderer.compile(compositeScene,compositeCamera);prewarmed=true;}
 const warmTick=()=>new Promise(resolve=>globalThis.requestAnimationFrame?requestAnimationFrame(resolve):setTimeout(resolve,0));
 function checkWarm(signal){if(disposed||signal?.aborted)throw signal?.reason||new DOMException('Smoke pass warmup cancelled','AbortError');}
 async function waitWarm(jobs,signal){const pending=Promise.all(jobs);if(!signal)return pending;return new Promise((resolve,reject)=>{const finish=(done,value)=>{signal.removeEventListener('abort',abort);done(value);},abort=()=>finish(reject,signal.reason||new DOMException('Smoke pass warmup cancelled','AbortError'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();pending.then(value=>finish(resolve,value),error=>finish(reject,error));});}
 // compileAsync dispatches its target-specific program work synchronously;
 // restore the renderer BEFORE awaiting its completion so an intervening rAF
 // cannot accidentally draw the lobby into this offscreen target.
 function inWarmSurface(offscreen,callback){
  prewarm();const previous=renderer.getRenderTarget(),autoClear=renderer.autoClear,test=renderer.getScissorTest(),viewport=new THREE.Vector4(),scissor=new THREE.Vector4(),tv=target.viewport.clone(),ts=target.scissor.clone(),tt=target.scissorTest;
  renderer.getViewport(viewport);renderer.getScissor(scissor);
  try{renderer.autoClear=true;if(offscreen){target.viewport.set(0,0,width,height);target.scissor.set(0,0,1,1);target.scissorTest=true;renderer.setRenderTarget(target);}else{renderer.setRenderTarget(null);const pixelRatio=renderer.getPixelRatio?.()||1;renderer.setScissor(new THREE.Vector4(0,0,1/pixelRatio,1/pixelRatio));renderer.setScissorTest(true);}return callback();}
  finally{target.viewport.copy(tv);target.scissor.copy(ts);target.scissorTest=tt;renderer.setRenderTarget(previous);renderer.autoClear=autoClear;renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(test);}
 }
 async function warmCurrentScene({compile=true,compileOnly=false,bothTargets=false,compileRoot=null,signal}={}){
  checkWarm(signal);prewarm();const started=performance.now(),before=renderer.info?.programs?.length??null;warmup.programsBefore??=before;let compileMs=0,submitMs=0;
  if(compile){const at=performance.now(),compileScene=()=>renderer.compileAsync?renderer.compileAsync(compileRoot||scene,camera,compileRoot?scene:null):renderer.compile(compileRoot||scene,camera,compileRoot?scene:null);
   // Three0.186 checkMaterialsReady reads material.currentProgram dynamically.
   // A concurrent canvas compile could replace that pointer and make the RT
   // promise report the wrong variant ready. Await each output in sequence.
   await waitWarm([inWarmSurface(true,compileScene)],signal);checkWarm(signal);
   if(bothTargets){await waitWarm([inWarmSurface(false,compileScene)],signal);checkWarm(signal);}
   if(!compositeDrawWarmed){await waitWarm([inWarmSurface(false,()=>renderer.compileAsync?renderer.compileAsync(compositeScene,compositeCamera):renderer.compile(compositeScene,compositeCamera))],signal);checkWarm(signal);}
   compileMs=performance.now()-at;warmup.compileCalls++;warmup.compileWaitMs+=compileMs;
  }
  if(!compileOnly){const at=performance.now();inWarmSurface(true,()=>renderer.render(scene,camera));if(bothTargets)inWarmSurface(false,()=>renderer.render(scene,camera));if(!compositeDrawWarmed){const count=uniforms.uCount.value,overflow=uniforms.uOverflowCount.value;uniforms.uCount.value=uniforms.uOverflowCount.value=0;try{inWarmSurface(false,()=>renderer.render(compositeScene,compositeCamera));compositeDrawWarmed=true;}finally{uniforms.uCount.value=count;uniforms.uOverflowCount.value=overflow;}}submitMs=performance.now()-at;warmup.draws++;warmup.submitMs+=submitMs;warmup.peakSubmitMs=Math.max(warmup.peakSubmitMs,submitMs);}
  const result={compileWaitMs:compileMs,submitMs,totalMs:performance.now()-started,programsBefore:before,programsAfter:renderer.info?.programs?.length??null};warmup.totalMs+=result.totalMs;warmup.programsAfter=result.programsAfter;return result;
 }
 function warmRepresentativeKey(object){
  if(!object.userData?.cs2WarmRepresentative||!object.isMesh)return null;
  const geometry=object.geometry,features=[object.type,!!object.isSkinnedMesh,!!object.isInstancedMesh,!!object.isBatchedMesh,!!object.instanceColor,object.layers.mask,Object.entries(geometry?.attributes||{}).map(([key,a])=>[key,a.itemSize,a.normalized,a.gpuType]).sort(),Object.entries(geometry?.morphAttributes||{}).map(([key,a])=>[key,a.length,a[0]?.itemSize]).sort()];
  return JSON.stringify([features,[].concat(object.material||[]).map(material=>{const custom=material.customProgramCacheKey(),cached=renderer.properties?.get(material)?.currentProgram?.cacheKey;return cached?[cached,custom]:[material.type,custom,material.defines,material.side,material.transparent,material.alphaTest>0,material.alphaHash,material.alphaToCoverage,material.vertexColors,material.flatShading,material.normalMapType,material.toneMapped,...['map','normalMap','roughnessMap','metalnessMap','aoMap','lightMap','alphaMap','emissiveMap','bumpMap','displacementMap','envMap'].map(key=>[key,!!material[key],material[key]?.channel,material[key]?.colorSpace])];})]);
 }
 async function warmObjects(objects,{prepare=()=>{},batchSize=12,signal}={}){
  if(!Array.isArray(objects)||!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>12)throw Error('Invalid smoke warm objects');checkWarm(signal);const input=[...new Set(objects.filter(Boolean))],keys=new Set(),unique=input.filter(object=>{const key=warmRepresentativeKey(object);if(key===null)return true;if(keys.has(key)){warmup.representativesSkipped++;return false;}keys.add(key);return true;}),started=performance.now();
  for(let start=0;start<unique.length;start+=batchSize){checkWarm(signal);const records=[],ranges=new Map(),compileRoot=new THREE.Group(),seen=new Set();try{for(const object of unique.slice(start,start+batchSize)){let parent=object.parent,inside=false;for(let n=object;n;n=n.parent)if(n===scene){inside=true;break;}records.push({object,parent,index:parent?.children.indexOf(object),visible:object.visible});if(!inside)scene.add(object);object.visible=true;object.traverse(node=>{if(!(node.isMesh||node.isPoints||node.isLine||node.isSprite)||!node.visible)return;records.push({node,frustum:node.frustumCulled,count:node.isInstancedMesh?node.count:undefined});node.frustumCulled=false;if(node.isInstancedMesh&&node.count===0)node.count=1;const g=node.geometry;if(g?.drawRange?.count===0&&!ranges.has(g)){ranges.set(g,{...g.drawRange});g.setDrawRange(0,Math.min(3,g.index?.count||g.attributes.position?.count||0));}if(!seen.has(node)){seen.add(node);compileRoot.add(node.clone(false));}});}await prepare();checkWarm(signal);await warmCurrentScene({bothTargets:true,compileRoot,signal});warmup.objectBatches++;}
   finally{for(const [geometry,range]of ranges)geometry.setDrawRange(range.start,range.count);for(const record of records.reverse()){if(record.node){record.node.frustumCulled=record.frustum;if(record.count!==undefined)record.node.count=record.count;}else{const {object,parent,index,visible}=record;object.visible=visible;if(object.parent!==parent){object.removeFromParent();if(parent){parent.add(object);parent.children.splice(parent.children.indexOf(object),1);parent.children.splice(index,0,object);}}}}}
   await warmTick();
  }return{objects:unique.length,inputObjects:input.length,representativeDuplicates:input.length-unique.length,batches:Math.ceil(unique.length/batchSize),totalMs:performance.now()-started};
 }
 function sync(state){if(disposed)return;volumes=(Array.isArray(state?.smokes)?state.smokes:[]).filter(v=>v?.fieldVersion===SMOKE_FIELD_VERSION&&Number.isFinite(v.x)&&Number.isFinite(v.y)&&Number.isFinite(v.z)&&Number.isFinite(v.radius)&&v.radius>0&&v.radius<=8&&Number.isFinite(v.bornAt)&&Number.isFinite(v.endAt)).slice(0,SMOKE_FIELD_LIMITS.volumes).map(v=>structuredClone(v));}
 function shot(event){if(!disposed)applySmokeShot(volumes,event,Number.isFinite(event?.time)?event.time:0);}
 function explode(event,time){if(!disposed)applySmokeExplosion(volumes,event,Number.isFinite(event?.time)?event.time:time);}
 function render(now){
  if(disposed||!Number.isFinite(now))return false;
  camera.updateMatrixWorld();projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(projection);candidates.length=0;
  for(const v of volumes){const opacity=smokeEnvelope(v,now);if(opacity<=0)continue;sphere.center.set(v.x,v.y+(v.height||3.2)*.45,v.z);sphere.radius=v.radius;if(frustum.intersectsSphere(sphere))candidates.push({volume:v,opacity,distance:sphere.center.distanceToSquared(camera.position)});}
  candidates.sort((a,b)=>a.distance-b.distance);lastVisible=Math.min(4,candidates.length);degradedVolumes=Math.min(28,Math.max(0,candidates.length-4));if(!lastVisible)return false;
  renderer.getCurrentViewport(activeViewport);
  if(!prewarmed)prewarm();else resize();
  // The backbuffer keeps its maximum capacity during automatic scaling. Match
  // its active physical viewport in the reusable smoke target, not its capacity.
  activeWidth=Math.max(1,Math.min(width,Math.floor(activeViewport.z)));activeHeight=Math.max(1,Math.min(height,Math.floor(activeViewport.w)));
  target.viewport.set(0,0,activeWidth,activeHeight);target.scissor.set(0,0,activeWidth,activeHeight);target.scissorTest=true;
  uniforms.uSampleScale.value.set(activeWidth/width,activeHeight/height);
  uniforms.uCount.value=lastVisible;uniforms.uOverflowCount.value=degradedVolumes;uniforms.uCamera.value.setFromMatrixPosition(camera.matrixWorld);uniforms.uCameraWorld.value.copy(camera.matrixWorld);uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
  for(let i=0;i<degradedVolumes;i++){const c=candidates[i+4],v=c.volume,scale=.2+.8*c.opacity;uniforms.uOverflow.value[i].set(v.x,v.y+(v.height||3.2)*.45,v.z,v.radius*scale);uniforms.uOverflowShape.value[i].set((v.height||3.2)*.55*scale,c.opacity);}
  for(let i=0;i<4;i++){
   const c=candidates[i],v=c?.volume,opacity=c?.opacity||0;if(v){const scale=.2+.8*opacity;uniforms.uVolumes.value[i].set(v.x,v.y+(v.height||3.2)*.45,v.z,v.radius*scale);uniforms.uShape.value[i].set((v.height||3.2)*.55*scale,opacity);}else {uniforms.uVolumes.value[i].set(0,0,0,1);uniforms.uShape.value[i].set(1,0);}
   const holes=(v?.holes||[]).filter(h=>h.endAt>now).slice(-4),clears=(v?.clears||[]).filter(h=>h.endAt>now).slice(-2);
   for(let j=0;j<4;j++){const h=holes[j],index=i*4+j;if(h){const strength=Math.max(0,Math.min(1,(h.endAt-now)/(h.endAt-h.bornAt)));uniforms.uHoleFrom.value[index].set(h.from.x,h.from.y,h.from.z,h.radius);uniforms.uHoleTo.value[index].set(h.to.x,h.to.y,h.to.z,strength);}else {uniforms.uHoleFrom.value[index].set(0,0,0,1);uniforms.uHoleTo.value[index].set(0,0,0,0);}}
   for(let j=0;j<2;j++){const h=clears[j],index=i*2+j;if(h){uniforms.uClear.value[index].set(h.position.x,h.position.y,h.position.z,h.radius);uniforms.uClearStrength.value[index]=Math.sin(Math.max(0,Math.min(1,(now-h.bornAt)/(h.endAt-h.bornAt)))*Math.PI);}else{uniforms.uClear.value[index].set(0,0,0,1);uniforms.uClearStrength.value[index]=0;}}
  }
  const previous=renderer.getRenderTarget(),autoClear=renderer.autoClear,scissorTest=renderer.getScissorTest();renderer.getViewport(savedViewport);renderer.getScissor(savedScissor);
  try{const started=performance.now(),programsBefore=renderer.info?.programs?.length??null;renderer.autoClear=true;renderer.setScissorTest(false);renderer.setRenderTarget(target);renderer.render(scene,camera);const worldDone=performance.now(),programsAfterWorld=renderer.info?.programs?.length??null;renderer.setRenderTarget(previous);renderer.render(compositeScene,compositeCamera);Object.assign(lastRender,{frame:renderCount+1,worldSubmitMs:worldDone-started,compositeSubmitMs:performance.now()-worldDone,programsBefore,programsAfterWorld,programsAfterComposite:renderer.info?.programs?.length??null});if(!firstRender)firstRender={...lastRender};renderCount++;return true;}
  finally{renderer.setRenderTarget(previous);renderer.autoClear=autoClear;renderer.setViewport(savedViewport);renderer.setScissor(savedScissor);renderer.setScissorTest(scissorTest);}
 }
 function dispose(){if(disposed)return;disposed=true;target?.dispose();geometry.dispose();material.dispose();compositeScene.remove(quad);volumes=[];}
 return{sync,shot,explode,render,prewarm,warmCurrentScene,warmObjects,get target(){return target;},resize,dispose,diagnostics:()=>({fieldVersion:SMOKE_FIELD_VERSION,mode:'depth-aware-raymarch-pilot',samples:8,maxDetailedVolumes:4,maxConservativeVolumes:28,visibleVolumes:lastVisible+degradedVolumes,detailedVolumes:lastVisible,degradedVolumes,droppedVolumes:0,volumes:volumes.length,width,height,activeWidth,activeHeight,sampleScale:uniforms.uSampleScale.value.toArray(),targetAllocations,renderCount,firstRender,lastRender:{...lastRender},warmup:{...warmup},prewarmed,disposed,depthTexture:!!target?.depthTexture,extraDraws:lastVisible?1:0})};
}
