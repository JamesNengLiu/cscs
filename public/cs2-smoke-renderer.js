// Bounded uniform fog: one analytic depth-clipped segment per cloud, no
// particles, density samples or animated noise. The existing depth/scene
// target and warmup contract keep walls, inside views and first-use stable.
import {SMOKE_FIELD_LIMITS,SMOKE_FIELD_VERSION,smokeEnvelope} from './cs2-smoke-field.js';

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
uniform vec4 uVolumes[32];
uniform vec2 uShape[32];
void main(){
 vec2 sampleUv=vUv*uSampleScale;
 vec4 sceneColor=texture2D(tScene,sampleUv);
 float depth=texture2D(tDepth,sampleUv).r;
 vec4 view=uInverseProjection*vec4(vUv*2.-1.,depth*2.-1.,1.);view/=view.w;
 vec3 world=(uCameraWorld*view).xyz,delta=world-uCamera;
 float maxDistance=length(delta);vec3 ray=delta/max(maxDistance,.00001);
 float opticalDepth=0.;
 for(int i=0;i<32;i++){
  if(i>=uCount)break;
  vec3 radius=vec3(uVolumes[i].w,uShape[i].x,uVolumes[i].w);
  vec3 ro=(uCamera-uVolumes[i].xyz)/radius,rd=ray/radius;
  float a=dot(rd,rd),b=dot(ro,rd),c=dot(ro,ro)-1.,disc=b*b-a*c;
  if(disc<=0.||a<=0.)continue;
  float root=sqrt(disc),nearT=max(0.,(-b-root)/a),farT=min(maxDistance,(-b+root)/a);
  // A cheap analytic rim keeps the cloud from looking like a cut-out oval.
  // Its solid core extends to 80% of the radius; no density sampling is used.
  float rim=clamp(disc/(a*.36),0.,1.);rim=rim*rim*(3.-2.*rim);
  opticalDepth+=max(0.,farT-nearT)*rim*uShape[i].y*2.15;
  // Stop processing dense fog by saturating towards opacity. This can only
  // strengthen occlusion, including in front of bright HDR scene colours.
  if(opticalDepth>=8.)break;
 }
 float transmittance=opticalDepth>=8.?0.:exp(-opticalDepth);
 gl_FragColor=vec4(mix(vec3(.34,.33,.31),sceneColor.rgb,transmittance),sceneColor.a);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;

export function createSmokeRenderer(THREE,{renderer,scene,camera}={}){
 if(!THREE||!renderer||!scene||!camera)throw Error('Smoke renderer requires THREE, renderer, scene and camera');
 const size=new THREE.Vector2(),activeViewport=new THREE.Vector4(),savedViewport=new THREE.Vector4(),savedScissor=new THREE.Vector4();
 let target=null,width=0,height=0,activeWidth=0,activeHeight=0,targetAllocations=0,disposed=false,volumes=[],renderCount=0,prewarmed=false,lastVisible=0,firstRender=null;
 const warmup={compileCalls:0,draws:0,objectBatches:0,representativesSkipped:0,totalMs:0,compileWaitMs:0,submitMs:0,peakSubmitMs:0,programsBefore:null,programsAfter:null};let compositeDrawWarmed=false;
 const lastRender={frame:0,worldSubmitMs:0,compositeSubmitMs:0,programsBefore:null,programsAfterWorld:null,programsAfterComposite:null};
 const uniforms={tScene:{value:null},tDepth:{value:null},uSampleScale:{value:new THREE.Vector2(1,1)},uInverseProjection:{value:new THREE.Matrix4()},uCameraWorld:{value:new THREE.Matrix4()},uCamera:{value:new THREE.Vector3()},uCount:{value:0},uVolumes:{value:Array.from({length:32},()=>new THREE.Vector4())},uShape:{value:Array.from({length:32},()=>new THREE.Vector2())}};
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
  if(!compileOnly){const at=performance.now();inWarmSurface(true,()=>renderer.render(scene,camera));if(bothTargets)inWarmSurface(false,()=>renderer.render(scene,camera));if(!compositeDrawWarmed){const count=uniforms.uCount.value;uniforms.uCount.value=0;try{inWarmSurface(false,()=>renderer.render(compositeScene,compositeCamera));compositeDrawWarmed=true;}finally{uniforms.uCount.value=count;}}submitMs=performance.now()-at;warmup.draws++;warmup.submitMs+=submitMs;warmup.peakSubmitMs=Math.max(warmup.peakSubmitMs,submitMs);}
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
 function sync(state){
  if(disposed)return;
  volumes=(Array.isArray(state?.smokes)?state.smokes:[]).slice(0,SMOKE_FIELD_LIMITS.volumes).filter(v=>v?.fieldVersion===SMOKE_FIELD_VERSION&&[v.x,v.y,v.z,v.radius,v.bornAt,v.endAt].every(Number.isFinite)&&v.radius>0&&v.radius<=8&&v.endAt>v.bornAt&&(v.height===undefined||Number.isFinite(v.height)&&v.height>0&&v.height<=8)).map(v=>({id:v.id,x:v.x,y:v.y,z:v.z,radius:v.radius,height:v.height??3.2,bornAt:v.bornAt,endAt:v.endAt}));
 }
 // Uniform fog deliberately has no bullet apertures or blast density pulses.
 // Keep the presentation API so event delivery and all combat paths stay intact.
 function shot(){}
 function explode(){}
 function render(now){
  if(disposed||!Number.isFinite(now))return false;
  camera.updateMatrixWorld();projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(projection);candidates.length=0;
  for(const v of volumes){const opacity=smokeEnvelope(v,now);if(opacity<=0)continue;sphere.center.set(v.x,v.y+(v.height||3.2)*.45,v.z);sphere.radius=v.radius;if(frustum.intersectsSphere(sphere))candidates.push({volume:v,opacity});}
  lastVisible=candidates.length;if(!lastVisible)return false;
  renderer.getCurrentViewport(activeViewport);
  if(!prewarmed)prewarm();else resize();
  // The backbuffer keeps its maximum capacity during automatic scaling. Match
  // its active physical viewport in the reusable smoke target, not its capacity.
  activeWidth=Math.max(1,Math.min(width,Math.floor(activeViewport.z)));activeHeight=Math.max(1,Math.min(height,Math.floor(activeViewport.w)));
  target.viewport.set(0,0,activeWidth,activeHeight);target.scissor.set(0,0,activeWidth,activeHeight);target.scissorTest=true;
  uniforms.uSampleScale.value.set(activeWidth/width,activeHeight/height);
  uniforms.uCount.value=lastVisible;uniforms.uCamera.value.setFromMatrixPosition(camera.matrixWorld);uniforms.uCameraWorld.value.copy(camera.matrixWorld);uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
  for(let i=0;i<lastVisible;i++){
   const {volume:v,opacity}=candidates[i],scale=.2+.8*opacity;
   uniforms.uVolumes.value[i].set(v.x,v.y+v.height*.45,v.z,v.radius*scale);
   uniforms.uShape.value[i].set(v.height*.55*scale,opacity);
  }
  const previous=renderer.getRenderTarget(),autoClear=renderer.autoClear,scissorTest=renderer.getScissorTest();renderer.getViewport(savedViewport);renderer.getScissor(savedScissor);
  try{const started=performance.now(),programsBefore=renderer.info?.programs?.length??null;renderer.autoClear=true;renderer.setScissorTest(false);renderer.setRenderTarget(target);renderer.render(scene,camera);const worldDone=performance.now(),programsAfterWorld=renderer.info?.programs?.length??null;renderer.setRenderTarget(previous);renderer.render(compositeScene,compositeCamera);Object.assign(lastRender,{frame:renderCount+1,worldSubmitMs:worldDone-started,compositeSubmitMs:performance.now()-worldDone,programsBefore,programsAfterWorld,programsAfterComposite:renderer.info?.programs?.length??null});if(!firstRender)firstRender={...lastRender};renderCount++;return true;}
  finally{renderer.setRenderTarget(previous);renderer.autoClear=autoClear;renderer.setViewport(savedViewport);renderer.setScissor(savedScissor);renderer.setScissorTest(scissorTest);}
 }
 function dispose(){if(disposed)return;disposed=true;target?.dispose();geometry.dispose();material.dispose();compositeScene.remove(quad);volumes=[];}
 return{sync,shot,explode,render,prewarm,warmCurrentScene,warmObjects,get target(){return target;},resize,dispose,diagnostics:()=>({fieldVersion:SMOKE_FIELD_VERSION,mode:'simple-depth-fog',samples:0,maxDetailedVolumes:0,maxConservativeVolumes:32,visibleVolumes:lastVisible,simpleVolumes:lastVisible,detailedVolumes:0,degradedVolumes:0,bulletHoles:false,explosionClearing:false,densityCoefficient:2.15,droppedVolumes:0,volumes:volumes.length,width,height,activeWidth,activeHeight,sampleScale:uniforms.uSampleScale.value.toArray(),targetAllocations,renderCount,firstRender,lastRender:{...lastRender},warmup:{...warmup},prewarmed,disposed,depthTexture:!!target?.depthTexture,extraDraws:lastVisible?1:0})};
}
