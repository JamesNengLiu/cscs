import * as THREE from '/vendor/three.module.js';
import {loadGameMap} from './cs2-game-map.js';
import {WORLD_CONTRACT,WORLD_LOAD,CLIENT_WORLD,CLIENT_LIFETIME,WEAPON_PROFILE_ID,EXPERIMENT_CONFIG,sampleViewRecoil} from './cs2-client-world.js';
import {assertWorldCompatible} from './experimental-world-contract.js';
import {PREDICTION_DT,MAX_PENDING_COMMANDS,reconcileMovement,visualCorrection,decayCorrection} from './cs2-prediction.js';
import {RULES,WEAPONS,GUNS,SITES,VIEWS,MAP_VERSION,MAP_BOUNDS,groundHeight,trace,movePlayer,blankInput,siteAt,clamp} from './cs2-client-world.js';
import {EQUIPMENT} from './arsenal.js';
import {allowsPlayerActions} from './round-state.js';
import {ECONOMY} from './economy.js';
import {createShop,ownedWeapons,GRENADE_IDS} from './shop.js';
import {createWorldEffects as createLegacyWorldEffects,flashOpacity as calculateFlashOpacity} from './effects.js';
import {createSmokeRenderer} from './cs2-smoke-renderer.js';
import {createCS2GameAudio} from './cs2-game-audio.js';
import {createShotEffects} from './cs2-shot-effects.js';
import {disposeTemporaryInstances} from './cs2-resource-lifecycle.js';
import {createPlayerHitEffects} from './player-hit-effects.js';
import {createPlayerActor as createLegacyPlayerActor} from './player-model.js';
import {CHARACTER_PRESETS,DEFAULT_CHARACTER,selectCharacter} from './characters-config.js';
import {createFrameMetrics} from './performance.js';
import {createCS2ResolutionController,cs2RenderProfileFromSearch} from './cs2-render-profile.js';
import {GameConnection} from './cs2-game-connection.js';
import {createSnapshotBuffer} from './cs2-snapshot-buffer.js';
import {remoteExtrapolationSafe,remoteGapSafe,predictionCorrectionLimit} from './cs2-network-continuity.js';
import {buildInputBatch,inputViewMetadata} from './cs2-input-protocol.js';
import {createShotFeedback} from './cs2-shot-feedback.js';
import {createAwpView} from './cs2-awp-view.js';
import {createMuzzlePulse} from './muzzle-pulse.js';
import {muzzleFlashProfile} from './muzzle-flash.js';
import {createPresentationWarmup} from './presentation-warmup.js';
import {createGrenadePrediction,GRENADE_PROTOCOL,GRENADE_KINDS} from './cs2-grenade-intent.js';
import {createGpuTimer} from './gpu-timer.js';
import {SCOPED_SENSITIVITY,createMouseSettings,bindMouseSettings,mouseTurnFactor} from './mouse-settings.js';
import {createViewmodelCamera,formatViewmodelAttachment} from './cs2-viewmodel-presentation.js';
import {PITCH_LIMIT,verticalFov} from './view-settings.js';
import {createGameAudio} from './game-audio.js';
import {bindAudioControls} from './audio-controls.js';
import {createWorldAudio} from './world-audio.js';
import {createMovementSoundState,movementSoundStep,RADIO_MENUS,RADIO_LABELS} from './movement-audio.js';
import {createCS2Crosshair,bindCS2Crosshair} from './cs2-crosshair.js';
import {crouchPressed,createInputSampler} from './controls.js';
import {createViewmodelSettings,bindViewmodelSettings,applyWeaponHand} from './viewmodel-settings.js';
import {createPlayerCamera} from './cs2-player-camera.js';
import {createCameraSettings,bindCameraSettings} from './camera-settings.js';
import {createFrameTargetSettings,bindFrameTargets} from './performance-settings.js';
import {createRenderSurface} from './render-surface.js';
import {createPresentationSettings,bindPresentationSettings} from './presentation-settings.js';
import {createViewFeedback,viewmodelMotion} from './cs2-view-feedback.js';
import {createPointerInput,mouseCalibration} from './pointer-input.js';
import {createWeaponCosmetics} from './weapon-cosmetics.js';
import {createMuzzleLighting} from './cs2-muzzle-lighting.js';
import {createAcousticSampler} from './acoustic-sampler.js';
import {createActorScheduler} from './actor-scheduler.js';
import {createWeaponActionOrder,isWeaponAction,WEAPON_ACTION_PROTOCOL,WEAPON_ACTION_LIMIT} from './cs2-weapon-action-order.js';
import {createWeaponSwitchView,resolveViewWeapon,WEAPON_SWITCH_VIEW_PROTOCOL} from './cs2-weapon-switch-view.js';
import {createRenderedInputView} from './rendered-input-view.js';
import {createNetworkDiagnostics,observeLongTasks,buildDiagnosticReport} from './network-diagnostics.js';
const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,document.getElementById(id));return nodes.get(id);},canvas=$('game');
const text=(id,value)=>{const node=$(id),next=String(value);if(node.textContent!==next)node.textContent=next;};
const style=(id,key,value)=>{const node=$(id);if(node.style[key]!==value)node.style[key]=value;};
let mouseStorage;try{const backing=localStorage,prefix='lan-strike-cs2:';mouseStorage={getItem:key=>backing.getItem(prefix+key)??backing.getItem(key),setItem:(key,value)=>backing.setItem(prefix+key,value),removeItem:key=>backing.removeItem(prefix+key)};}catch{}
const mouseSettings=createMouseSettings(mouseStorage),scopedSettings=createMouseSettings(mouseStorage,SCOPED_SENSITIVITY);bindMouseSettings(document,mouseSettings,scopedSettings);
const viewmodelSettings=createViewmodelSettings(mouseStorage);bindViewmodelSettings(document,viewmodelSettings,()=>{sceneDirty=true;});
const terrainSmoothing=new URLSearchParams(location.search).get('terrainCamera')!=='legacy';
const presentationSettings=createPresentationSettings(mouseStorage),viewFeedback=createViewFeedback({legacy:!terrainSmoothing}),pointerInput=createPointerInput(canvas);
const lookDiagnosticsEnabled=new URLSearchParams(location.search).get('inputDiagnostics')==='1',lookDiagnostics=lookDiagnosticsEnabled?(await import('./cs2-look-diagnostics.js')).createLookDiagnostics({enabled:true}):null;
const shotDiagnosticsEnabled=new URLSearchParams(location.search).get('shotDiagnostics')==='1',shotDiagnostics=shotDiagnosticsEnabled?(await import('./cs2-shot-diagnostics.js')).createCS2ShotDiagnostics({enabled:true}):null;
const cameraSettings=createCameraSettings(mouseStorage,new URLSearchParams(location.search));
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
const frameMetrics=createFrameMetrics(),resolution=createCS2ResolutionController(devicePixelRatio);
const networkDiagnostics=createNetworkDiagnostics(),longTaskObserver=observeLongTasks(networkDiagnostics),messageEncoder=new TextEncoder();
const snapshotBuffer=createSnapshotBuffer({extrapolation:'velocity',maxExtrapolationMs:50,maxPlaybackRate:1.2,maxBridgeGapMs:500,canExtrapolate:(a,b,c)=>remoteExtrapolationSafe(a,b,c,state?.players),canBridgeGap:(a,b,c)=>remoteGapSafe(a,b,c,c.players)}),shotFeedback=createShotFeedback(),awpView=createAwpView({guns:GUNS}),muzzlePulse=createMuzzlePulse();
const crosshairFeedback=createCS2Crosshair({storage:mouseStorage}),cameraDirection=new THREE.Vector3();
bindCS2Crosshair(document,crosshairFeedback,$('crosshair'));
// Diagnostic rollback affects position presentation only; movement and aiming
// continue to use their original fixed-step/input clocks.
const playerCamera=createPlayerCamera({mode:cameraSettings.mode,stablePresentation:new URLSearchParams(location.search).get('cameraClock')!=='legacy',terrainSmoothing});
bindCameraSettings(document,cameraSettings,mode=>{playerCamera.setMode(mode);frameMetrics.reset();sceneDirty=true;const url=new URL(location.href);url.searchParams.set('camera',mode);history.replaceState(null,'',url);});
let lastGameplayPerformance=null,lastGameplayCamera=null;
const gpuTimer=createGpuTimer(renderer.getContext(),{onSample:sample=>{if(sample.tag?.active&&sample.completedAt-sample.submittedAt<=500)frameMetrics.addGpu(sample.ms,sample.tag.epoch);}});let gpuMs=null,pendingRenderRatio=null;
try{resolution.setQuality(mouseStorage?.getItem('lan-strike-quality')||'auto');}catch{}
const frameTargetSettings=createFrameTargetSettings(mouseStorage,new URLSearchParams(location.search));
resolution.setTarget(frameTargetSettings.target);
const renderSurface=createRenderSurface(renderer,canvas,{width:innerWidth,height:innerHeight,ratio:resolution.ratio});
resolution.setProfile(cs2RenderProfileFromSearch(location.search));renderSurface.setRatio(resolution.ratio);
renderer.shadowMap.enabled=false;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;renderer.toneMappingExposure=1;
const scene=new THREE.Scene();scene.background=new THREE.Color('#b8c4cd');scene.fog=null;
const gameplayFog=scene.fog;
const camera=new THREE.PerspectiveCamera(80,innerWidth/innerHeight,.06,450);camera.rotation.order='YXZ';scene.add(camera);
const viewmodelProjection=createViewmodelCamera(THREE,camera),viewmodelCamera=viewmodelProjection.camera;
const hemisphere=new THREE.HemisphereLight('#e7efff','#746044',2.1);hemisphere.layers.enable(1);scene.add(hemisphere);
const sun=new THREE.DirectionalLight('#ffe0aa',2.5);sun.layers.enable(1);sun.position.set(-25,70,25);sun.castShadow=false;
sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-48,right:48,top:48,bottom:-48,near:1,far:130});sun.shadow.bias=-.0005;scene.add(sun);scene.add(sun.target);
let mapRender;try{mapRender=await loadGameMap(scene,{renderer,camera,progress:value=>text('joinButton',value)});}catch(error){$('error').textContent='CS2 地图资源加载失败，请检查独立资源包。';$('joinButton').textContent='地图加载失败';throw error;}
function box(x,y,z,w,h,d,mat,parent=scene){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
const bombMesh=box(0,.2,0,.55,.35,.38,new THREE.MeshStandardMaterial({color:'#343f35',emissive:'#142818'}));bombMesh.visible=false;
const bombLight=new THREE.PointLight('#ff4422',0,7);scene.add(bombLight);
let nativeContent=null,contentManifest=null,createPlayerActor=createLegacyPlayerActor;
if(EXPERIMENT_CONFIG.contentManifest){
 const response=await fetch(EXPERIMENT_CONFIG.contentManifest,{signal:CLIENT_LIFETIME.signal});if(!response.ok)throw Error('Missing native content manifest');const bytes=await response.arrayBuffer(),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(EXPERIMENT_CONFIG.presentationProfileId!=='source2-native-'+digest.slice(0,16))throw Error('Native manifest mismatch');contentManifest=JSON.parse(new TextDecoder().decode(bytes));
 const {createNativeActors}=await import('./cs2-native-actors.js');nativeContent=await createNativeActors(THREE,{manifest:contentManifest,renderer,camera,scene,signal:CLIENT_LIFETIME.signal,progress:value=>text('joinButton',value)});createPlayerActor=nativeContent.createPlayerActor;
}
const nativeDrops=nativeContent?(await import('./cs2-native-drops.js')).createNativeDrops(THREE,{scene,content:nativeContent,manifest:contentManifest,onChange:()=>{sceneDirty=true;}}):null;
const audioPackage=nativeContent?await fetch('/assets/cs2-content/audio.json',{signal:CLIENT_LIFETIME.signal}).then(r=>r.json()):null;
let weaponView=null,weaponModelError='',modelWeapon=null;
try{const createWeaponView=nativeContent?(await import('./cs2-native-viewmodel.js')).createNativeWeaponView:(await import('./weapon-model.js')).createWeaponView;weaponView=await createWeaponView(THREE,camera,{content:nativeContent,manifest:contentManifest,guns:GUNS,onSound:cue=>{if(cue?.stop){audio?.stopChannel('local-viewmodel','item');return;}if(cue?.nativeEvent){void audio?.nativeEvent?.(cue.nativeEvent,{eventId:cue.eventId});return;}void audio?.play(cue,{volume:1,entityId:'local-viewmodel',channel:'item',priority:10});}});}
catch(error){weaponModelError=String(error.message||error);}
const muzzleLighting=createMuzzleLighting(THREE,{renderer,camera});
const weaponCosmetics=createWeaponCosmetics(THREE,scene,{trace,onContact:position=>{void audio?.play('debris/metal1.wav',{position,volume:.025,pitch:170,entityId:'cosmetic-shell',channel:'auto',priority:-5});},lighting:muzzleLighting});weaponCosmetics.setOptions(presentationSettings.values);muzzleLighting.prepare(scene);
const actorScheduler=createActorScheduler(THREE);
const cosmeticOrigin=new THREE.Vector3(),cosmeticMuzzle=new THREE.Vector3(),cosmeticRight=new THREE.Vector3(),cosmeticForward=new THREE.Vector3();
const createWorldEffects=nativeContent?(await import('./cs2-effects.js')).createWorldEffects:createLegacyWorldEffects;
const smokeRenderer=createSmokeRenderer(THREE,{renderer,scene,camera});await smokeRenderer.prewarm();
const worldEffects=createWorldEffects(THREE,scene,{nativeContent,smokeVolume:true,onChange:()=>{sceneDirty=true;}});
const shotEffects=createShotEffects(THREE,scene),playerHitEffects=createPlayerHitEffects(THREE,scene),remote=new Map();

let assetsReady=false,preparation=null,preparingRenderPass=false;const retainedWarmActors=[],retainedWarmRepresentatives=[];
let state=null,myId=null,joined=false,connected=false,locked=false,yaw=0,pitch=0,local=null,lastRound=-1,hitAt=0,damageAt=0,noticeUntil=0,lag=0,recoilYaw=0,recoilPitch=0,preview=false,view='overview',renderY=null,sceneDirty=true,renderedView=null;
let stateReceivedAt=performance.now(),lastWeapon=null,activeWeapon=null,wheelAt=0,flashUntil=0,flashAmount=0,flashFade=1.4,flashOpacity=0,smokeOpacity=0,visualSignature='',recoveryCorrection=false;
if(shotDiagnostics){
  const add=shotEffects.add.bind(shotEffects);
  shotEffects.add=(event,time)=>{const added=add(event,time);if(event?.id===myId)shotDiagnostics.effect(event,performance.now(),{added,decalCount:shotEffects.info().decals});return added;};
}
const presentationWarmup=createPresentationWarmup(THREE,renderer,scene,camera,{canRun:()=>!preparingRenderPass&&!locked&&!preview&&!document.hidden});
const initialHitResources=playerHitEffects.prepare(),initialShotResources=shotEffects.prepare();
presentationWarmup.enqueue({objects:[...initialHitResources.objects,...initialShotResources.objects,...(weaponView?[weaponView.muzzle]:[])],textures:[...initialHitResources.textures,...initialShotResources.textures,...(weaponView?[weaponView.muzzle.material.map]:[])]});
if(weaponView)presentationWarmup.enqueue(weaponView.prepare());
presentationWarmup.enqueue(weaponCosmetics.prepare());
void shotEffects.warm(renderer,camera);void weaponCosmetics.warm(renderer,camera);
bindPresentationSettings(document,presentationSettings,values=>{if(!values.landing)viewFeedback.reset();weaponCosmetics.setOptions(values);muzzleLighting.prepare(scene);sceneDirty=true;presentationWarmup.enqueue(weaponCosmetics.prepare());});
bindFrameTargets(document,frameTargetSettings,target=>{resolution.setTarget(target);frameMetrics.reset();sceneDirty=true;const url=new URL(location.href);if(url.searchParams.has('frameTarget')){url.searchParams.set('frameTarget',target);history.replaceState(null,'',url);}});
const qualityControls=[...document.querySelectorAll('[data-quality]')];
for(const control of qualityControls){control.value=resolution.quality;control.onchange=()=>{
  if(!resolution.setQuality(control.value))return;
  for(const other of qualityControls)other.value=resolution.quality;
  try{mouseStorage?.setItem('lan-strike-quality',resolution.quality);}catch{}
  pendingRenderRatio=null;renderSurface.setRatio(resolution.ratio,{allowGrowth:true});frameMetrics.reset();sceneDirty=true;
};}
const renderProfileControl=$('renderProfile');renderProfileControl.value=resolution.profile;
renderProfileControl.addEventListener('change',()=>{
  if(!resolution.setProfile(renderProfileControl.value))return;
  pendingRenderRatio=null;renderSurface.setRatio(resolution.ratio,{allowGrowth:true});
  frameMetrics.reset();lastGameplayPerformance=null;sceneDirty=true;
  const url=new URL(location.href);url.searchParams.set('present',resolution.profile);history.replaceState(null,'',url);
  refreshDiagnosticUI();
});
const player=()=>state?.players.find(p=>p.id===myId);
const shotAuthority=(p,snapshot=state)=>p&&snapshot?{round:snapshot.round,time:snapshot.time,weapon:p.weapon,ammo:p.ammo,reloadAt:p.reloadAt,shotsFired:p.shotsFired,ackInputSeq:p.ackInputSeq}:null;
const serverTime=()=>state?(state.time+Math.max(0,performance.now()-stateReceivedAt)/1000):0;
const weaponName=id=>GUNS[id]?.name||EQUIPMENT[id]?.name||({knife:'战术匕首',c4:'C4 炸弹'})[id]||WEAPONS[id]?.name||id||'—';
const requestedView=new URLSearchParams(location.search).get('view');
if(VIEWS[requestedView]){preview=true;view=requestedView;$('lobby').hidden=true;$('previewPanel').hidden=false;}
$('previewButton').onclick=()=>{preview=true;sceneDirty=true;$('lobby').hidden=true;$('previewPanel').hidden=false;};

$('backButton').onclick=()=>{if(!connected){location.href='/';return;}preview=false;sceneDirty=true;$('lobby').hidden=false;$('previewPanel').hidden=true;};
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{view=button.dataset.view;sceneDirty=true;};
const keys=new Set(),inputSampler=createInputSampler();let mouseFire=false,grenadeButtons=0,audio=null,maxBurst=0,maxRecoilPitch=0;
let localMovementSounds=createMovementSoundState(),audioRound=null,radioMenuIndex=null;
const acoustics=createAcousticSampler((a,b)=>CLIENT_WORLD.collision.trace(a,b,0,{radius:0,channel:'audio'}));
const worldAudio=createWorldAudio(()=>audio);
function ensureAudio(){if(!audio)audio=(audioPackage?createCS2GameAudio:createGameAudio)({package:audioPackage,settings:audioControls.settings,sampleAcoustics:(a,b)=>acoustics.sample(a,b),sampleRoom:p=>acoustics.room(p)});return audio;}
const audioControls=bindAudioControls(document,{getAudio:()=>audio,ensureAudio,storage:mouseStorage,getListener:()=>({position:camera.position,forward:camera.getWorldDirection(cameraDirection)})});
function resetRoundAudio(round){if(audioRound===round)return;audioRound=round;audio?.stopAll();worldAudio.reset();localMovementSounds=createMovementSoundState();acoustics.clear();}
function closeRadio(){radioMenuIndex=null;$('radioMenu').hidden=true;}
function openRadio(index){radioMenuIndex=index;const panel=$('radioChoices');panel.replaceChildren();RADIO_LABELS[index].forEach((label,i)=>{const item=document.createElement('div');item.textContent=`${i+1}. ${label}`;panel.append(item);});$('radioMenu').hidden=false;}
let inputSeq=0,pendingCommands=[],physicsAccumulator=0,correction={x:0,y:0,z:0},lastCorrection=0,lastInputPacket=0;
const socket=new GameConnection({deferStates:true});
const weaponActionOrder=createWeaponActionOrder(),renderedInputView=createRenderedInputView(),weaponSwitchView=createWeaponSwitchView();let weaponActionProtocol=false,inputViewProtocol=0,combatOrderVersion=0,weaponSwitchViewProtocol=0;
const grenadePrediction=createGrenadePrediction({send:message=>send(message)});
function canSwitchWeapon(p,key,fallback){return Boolean(resolveViewWeapon(p,key,state?.bomb,fallback));}
function weaponActionContext(){return {supported:weaponActionProtocol,round:state?.round,seq:inputSeq,ack:player()?.ackInputSeq||0,commands:pendingCommands,firePending:inputSampler.diagnostics().pendingPresses.includes('fire'),active:locked&&player()?.alive&&allowsPlayerActions(state?.phase),viewTime:snapshotBuffer.diagnostics().playbackTimeMs/1000,interpDelayMs:snapshotBuffer.diagnostics().delayMs};}
function transmit(m){if(socket.readyState===WebSocket.OPEN){weaponSwitchView.sent(m);if(isWeaponAction(m.type))m=awpView.intent(m,player(),{round:state?.round,stateTime:serverTime(),phase:state?.phase,canSwitch:m.type==='equip'&&canSwitchWeapon(player(),m.weapon,m.fallbackWeapon)});if(m.type==='ping')networkDiagnostics.ping(m.sent);socket.send(JSON.stringify(m));networkDiagnostics.queues(socket.bufferedAmount);}}
function send(m){if(socket.readyState!==WebSocket.OPEN)return;if(m.type==='equip'){if(GRENADE_KINDS.includes(player()?.weapon)&&canSwitchWeapon(player(),m.weapon,m.fallbackWeapon)){grenadePrediction.cancel({preserveReleased:true});grenadeButtons=0;}m=weaponSwitchView.intent(m,player(),{round:state?.round,phase:state?.phase,bomb:state?.bomb,canQueue:weaponActionOrder.pending<WEAPON_ACTION_LIMIT});}if(weaponActionProtocol&&isWeaponAction(m.type))m=weaponActionOrder.prepare(m,weaponActionContext());if(m)transmit(m);}
function flushWeaponActions(){for(const m of weaponActionOrder.flush(weaponActionContext()))transmit(m);}
function notify(text,seconds=3){$('notice').textContent=text;noticeUntil=performance.now()+seconds*1000;}
function clearInput(){weaponSwitchView.cancel();grenadePrediction.cancel();grenadeButtons=0;weaponActionOrder.cancel();closeRadio();keys.clear();mouseFire=false;pendingCommands=[];inputSampler.reset();physicsAccumulator=0;shotFeedback.cancel();muzzlePulse.reset();send({type:'input',input:{...blankInput(),yaw,pitch,round:lastRound,cancelThroughSeq:inputSeq}});}
function queueInputEdge(){if(locked)inputSampler.observe(input());}
function presentLocalShot(event,now=performance.now()){
  if(event.weapon!==player()?.weapon)return;
  shotDiagnostics?.predicted(event,performance.now());
  awpView.shot(event,{stateTime:serverTime(),nowMs:now});
  crosshairFeedback.shot();muzzlePulse.trigger(now,muzzleFlashProfile(event).durationMs);if(joined&&!document.hidden)audio?.shot({...event,burstMode:event.burstMode??player()?.burstMode,shotId:event.token||event.shotId});
  weaponCosmetics.enqueueLocal({...event,id:myId,round:event.round??lastRound});
  recoilYaw=event.recoilYaw||0;recoilPitch=event.recoilPitch||0;
}
const shop=createShop({guns:GUNS,equipment:EQUIPMENT,economy:ECONOMY,send,onResume:resumeGame,onOpenChange(open){
  clearInput();$('board').hidden=true;sceneDirty=true;
  if(open){locked=false;document.exitPointerLock();}
  setMenuVisible(joined&&!locked&&!open);
  document.body.classList.toggle('buying',open);
}});
$('openBuyButton').onclick=()=>{if(joined&&connected)shop.setOpen(true);};
socket.onopen=()=>{connected=true;$('joinButton').disabled=true;text('joinButton','校验世界与准备对战资源…');};
function checkContract(message){try{if(message.experimental!==true)throw Error('Experimental server required');assertWorldCompatible(WORLD_CONTRACT,message.worldContract);if(message.weaponProfileId!==WEAPON_PROFILE_ID)throw Error('Weapon profile mismatch');if(message.presentationProfileId!==EXPERIMENT_CONFIG.presentationProfileId)throw Error('Native rig mismatch');return true;}catch(error){$('error').textContent='实验版世界或规则不一致，请更新并重启对应实验服务。'+error.message;socket.close();return false;}}
async function prepareCombat(){
 if(preparation)return preparation;
 preparation=(async()=>{
  for(const [team,character] of [['T','terror'],['CT','urban']]){
   text('joinButton','准备 '+team+' 人物与动作…');
   const actor=createPlayerActor(THREE);retainedWarmActors.push(actor);
   const info=await actor.setCharacter(character);if(info.error)throw Error(info.error);
   actor.update(0,{team,weapon:team==='T'?'glock18':'usp',alive:true,grounded:true,x:0,y:0,z:0});
   await renderer.compileAsync(actor.group,camera,scene);
  }
  if(weaponView)for(const id of ['knife','ak47','m4a1','awp','usp','glock18',...GRENADE_KINDS]){
   text('joinButton','准备 '+weaponName(id)+'…');await weaponView.setWeapon(id);
   const info=weaponView.info();if(info.error)throw Error(info.error);
   await renderer.compileAsync(weaponView.group,camera,scene);
  }
  await worldEffects.ready;await mapRender.runtime.settled();
  text('joinButton','预热烟雾、人物与特效绘制…');preparingRenderPass=true;const warmAt=performance.now(),oldLayers=camera.layers.mask;
  try{
   await muzzleLighting.settled();camera.layers.set(0);
   await mapRender.runtime.prewarmPass(options=>smokeRenderer.warmCurrentScene({...options,signal:CLIENT_LIFETIME.signal}),{budgetMs:4,maxGroups:12});
   const mapMeshes=new Set(mapRender.runtime.meshes),effects=[];scene.traverse(object=>{if(object.isMesh&&!mapMeshes.has(object)&&!object.parent?.isCamera&&object.layers.test(camera.layers))effects.push(object);});
   const effectResources=worldEffects.prepare?.();const worlds=[...(effectResources?.objects||[]),...initialShotResources.objects,...(nativeContent?await nativeContent.warmObjects():[]),...retainedWarmActors.map(a=>a.group),...effects];
   const prepare=async()=>{muzzleLighting.prepare(scene,{force:true});await muzzleLighting.settled();};
   await smokeRenderer.warmObjects(worlds,{prepare,signal:CLIENT_LIFETIME.signal});
   camera.layers.set(1);const foreground=weaponView?.warmObjects?await weaponView.warmObjects():weaponView?[weaponView.group]:[];
   await smokeRenderer.warmObjects(foreground,{prepare,signal:CLIENT_LIFETIME.signal});
   const representatives=muzzleLighting.representatives();retainedWarmRepresentatives.push(...representatives);
   for(const layer of [0,1]){camera.layers.set(layer);const copies=representatives.filter(object=>(object.layers.mask&(1<<layer))!==0).map(object=>object.clone(false));try{await smokeRenderer.warmObjects(copies,{signal:CLIENT_LIFETIME.signal});}finally{disposeTemporaryInstances(copies);}}
   WORLD_LOAD.renderPassWarmupMs=performance.now()-warmAt;
  }finally{camera.layers.mask=oldLayers;preparingRenderPass=false;sceneDirty=true;}

  if(CLIENT_LIFETIME.signal.aborted)throw new DOMException('Aborted','AbortError');
  send({type:'assetReady',worldContract:WORLD_CONTRACT,weaponProfileId:WEAPON_PROFILE_ID,presentationProfileId:EXPERIMENT_CONFIG.presentationProfileId});
 })().catch(error=>{if(error.name!=='AbortError'){$('error').textContent='对战资源准备失败：'+error.message;text('joinButton','资源准备失败，请刷新');}throw error;});
 return preparation;
}
socket.onerror=()=>{$('error').textContent='无法连接服务器，请检查主机与端口。';};
socket.onclose=()=>{weaponSwitchView.reset();awpView.reset();connected=false;clearInput();audio?.stopAll();worldAudio.reset();shop.setOpen(false);$('joinButton').disabled=true;$('error').textContent='连接已断开，请刷新页面重新加入。';if(joined){locked=false;document.exitPointerLock();setMenuVisible(true);}};
socket.onstatearrival=(m,event)=>{networkDiagnostics.state(m,messageEncoder.encode(event.data).byteLength,event.receivedAtMs);if(shotDiagnostics){const own=m.players?.find(p=>p.id===myId);if(own)shotDiagnostics.stateArrival(shotAuthority(own,m),event.receivedAtMs);}};
socket.onstatehistory=entries=>snapshotBuffer.pushBatch(entries.filter(e=>checkContract(e.snapshot)),{updateClock:performance.now()>=timelineClockResumeAt});
socket.onmessage=event=>{const m=JSON.parse(event.data);
  if(m.type==='hello'){if(!checkContract(m))return;void prepareCombat().catch(()=>{});myId=m.id;weaponActionProtocol=m.weaponActionProtocol===WEAPON_ACTION_PROTOCOL;inputViewProtocol=m.inputViewProtocol||0;combatOrderVersion=m.combatOrderVersion||0;weaponSwitchViewProtocol=m.weaponSwitchViewProtocol===WEAPON_SWITCH_VIEW_PROTOCOL?WEAPON_SWITCH_VIEW_PROTOCOL:0;}
  if(m.type==='clockProbe')send({type:'clockReply',token:m.token});
  if(m.type==='assetReadyAck'){if(!checkContract(m)||!m.ok)return;assetsReady=true;$('joinButton').disabled=false;text('joinButton',`加入 CS2 实验房间 · ${socket.transport==='webtransport'?'QUIC':'WebSocket'}`);}
  if(m.type==='joined'){if(!checkContract(m))return;joined=true;$('lobby').hidden=true;$('hud').hidden=false;setMenuVisible(true);}
  if(m.type==='error'){$('error').textContent=m.message;notify(m.message);shop.reportError(m.message);$('joinButton').disabled=!assetsReady;}
  if(m.type==='buyResult'||m.type==='buy-result')shop.reportResult(m.message||(m.ok?'购买成功':'购买失败'),Boolean(m.ok));
  if(m.type==='pong'){lag=Math.round(performance.now()-m.sent);networkDiagnostics.pong(m);}
  if(m.type==='scopeAck'){weaponSwitchView.confirm(m);awpView.confirm(m);sceneDirty=true;}
  if(m.type==='grenadeAck'){grenadePrediction.confirm(m);sceneDirty=true;}
  if(m.type==='state'){
    if(!checkContract(m))return;
    const receivedAt=event.receivedAtMs??performance.now();
    const previousAuthority=player(),previousStateTime=state?.time;
    if(!event.timelineBuffered)snapshotBuffer.push(m,receivedAt);
    state=m;stateReceivedAt=receivedAt;const me=m.players.find(p=>p.id===myId);
    if(me){
      me.ballisticsVersion=m.ballisticsVersion??0;
      me.hitSlowdownVersion=m.hitSlowdownVersion??0;
      me.hitRecoveryVersion=m.hitRecoveryVersion===1?1:0;
      me.collisionVersion=m.collisionVersion??0;
      me.jumpFatigueVersion=m.jumpFatigueVersion??0;
      if(!local||lastRound!==m.round){grenadeButtons=0;resetRoundAudio(m.round);shotEffects.clear();playerHitEffects.clear();worldEffects.clear();crosshairFeedback.reset();local={...me};playerCamera.reset(local);viewFeedback.reset();weaponCosmetics.clear();weaponActionOrder.cancel();yaw=me.yaw;pitch=me.pitch;lastRound=m.round;renderY=null;sceneDirty=true;inputSeq=0;pendingCommands=[];inputSampler.reset();shotFeedback.reset();muzzlePulse.reset();physicsAccumulator=0;correction={x:0,y:0,z:0};recoveryCorrection=false;lastWeapon=null;activeWeapon=null;flashUntil=0;flashAmount=0;}
      else if(!me.alive||!allowsPlayerActions(m.phase)||!locked){grenadeButtons=0;local={...me};playerCamera.reset(local);viewFeedback.reset();weaponCosmetics.clear();weaponActionOrder.cancel();pendingCommands=[];physicsAccumulator=0;correction={x:0,y:0,z:0};recoveryCorrection=false;}
      else {const result=reconcileMovement(me,pendingCommands,m.round,m.players),allowance=predictionCorrectionLimit(local,result.player,{previousAuthority,authority:me,intervalSeconds:m.time-previousStateTime,activeRecovery:recoveryCorrection});lastCorrection=Math.hypot(local.x-result.player.x,local.y-result.player.y,local.z-result.player.z);networkDiagnostics.prediction(lastCorrection,result.pending.length);correction=visualCorrection(local,result.player,correction,{maxDistance:allowance});if(allowance>.5&&Math.hypot(correction.x,correction.y,correction.z)>.05)recoveryCorrection=true;if(lastCorrection>allowance)viewFeedback.reset();playerCamera.rebase(local,result.player,{maxDistance:allowance});local=result.player;pendingCommands=result.pending;}
      if(activeWeapon!==me.weapon){grenadeButtons=0;if(activeWeapon&&ownedWeapons(me,m.bomb).includes(activeWeapon))lastWeapon=activeWeapon;activeWeapon=me.weapon;sceneDirty=true;}
      weaponSwitchView.observe(me,{round:m.round,time:m.time,protocol:weaponSwitchViewProtocol,phase:m.phase});
      awpView.observe(me,{round:m.round,stateTime:m.time,protocol:m.scopeProtocol,nowMs:performance.now()});
      const confirmedShot=shotFeedback.observe(me,{round:m.round,stateTime:m.time,nowMs:performance.now()});if(confirmedShot)presentLocalShot(confirmedShot);
      grenadePrediction.observe(me,{round:m.round,stateTime:m.time,phase:m.phase,grenadeProfileId:m.grenadeProfileId});
      if(me.flashUntil!==undefined){flashUntil=Number(me.flashUntil)||0;flashAmount=clamp(Number(me.flashAmount)||0,0,1);flashFade=Number(me.flashFade)||1.4;}
      if(!me.alive){flashUntil=0;flashAmount=0;}
      const signature=JSON.stringify([me.alive,me.weapon,me.zoom,me.shieldRaised,me.reloadAt,me.armour,me.flashUntil,me.flashAmount,me.flashFade,me.grenadePhase,me.grenadeStartedAt,me.grenadeThrownAt,m.bomb]);
      if(signature!==visualSignature){sceneDirty=true;visualSignature=signature;}
    }
    nativeDrops?.sync(m);if(nativeContent)smokeRenderer.sync(m);if(worldEffects.sync(m)&&joined)sceneDirty=true;
    for(const p of m.players)if(p.id!==myId){
      let r=remote.get(p.id);if(!r){const actor=createPlayerActor(THREE,{onChange:()=>{sceneDirty=true;muzzleLighting.prepare(scene);}});scene.add(actor.group);r={actor,mesh:actor.group,p,character:null};remote.set(p.id,r);}r.p=p;
      const character=selectCharacter(p.team,p.character);if(r.character!==character){r.character=character;Promise.resolve(r.actor.setCharacter(character)).then(()=>{sceneDirty=true;});}
    }
    for(const [id,r] of remote)if(!m.players.some(p=>p.id===id)){scene.remove(r.mesh);r.actor.dispose();remote.delete(id);}
    updateUI();
  }
  if(m.type==='events')for(const e of m.events){
    if(shotDiagnostics&&e.type==='shot'&&e.id===myId)shotDiagnostics.shot(e,performance.now(),shotAuthority(player()));
    if(e.type==='notice')notify(e.text);
    if(e.type==='round'){if(joined)resetRoundAudio(e.round);notify(`第 ${e.round} 回合 · B 打开购买菜单`);}
    if(joined&&!document.hidden)worldAudio.handle(e,{myId,team:player()?.team,round:audioRound});
    if(e.type==='buy'&&(e.id===myId||e.target===myId))shop.reportResult(e.message||`已购买 ${weaponName(e.item)}`,e.ok!==false);
    if(e.type==='flash'&&(e.target??e.id)===myId&&player()?.alive){
      flashUntil=Number(e.flashUntil??e.until)||((Number(e.time)||serverTime())+(Number(e.duration)||3));
      flashAmount=clamp(Number(e.flashAmount??e.amount??1),0,1);flashFade=Number(e.fade)||1.4;sceneDirty=true;
    }
    if(e.type==='kill'){const div=document.createElement('div');div.textContent=`${e.attacker} → ${e.victim}`;$('feed').prepend(div);setTimeout(()=>div.remove(),5500);}
    if(e.type==='damage'&&e.id===myId)damageAt=performance.now();
    if(e.type==='explosion'){if(nativeContent)smokeRenderer.explode(e,serverTime());worldEffects.explode(e,serverTime());sceneDirty=true;}
    if(e.type==='shot'){if(nativeContent)smokeRenderer.shot(e);
      if(joined){sceneDirty=true;shotEffects.add(e,performance.now()/1000);
        const target=remote.get(e.hitImpact?.targetId),point=playerHitEffects.add(e,performance.now()/1000,target?.rendered?target.mesh.position:target?.p);
        // Audio is routed once from authoritative sound/impact events; particles do not emit a second hit sound.
      }
      if(e.id===myId){if(shotFeedback.confirm(e,performance.now())&&e.weapon===player()?.weapon){muzzlePulse.trigger(performance.now(),muzzleFlashProfile(e).durationMs);if(joined&&!document.hidden)audio?.shot(e);weaponCosmetics.enqueueLocal({...e,round:e.round??lastRound});}maxBurst=Math.max(maxBurst,e.burst||0);if(e.hit)hitAt=performance.now();}
      else if(joined&&local&&!document.hidden){audio?.shot(e,e.from);if(locked&&e.from&&Math.hypot(e.from.x-local.x,e.from.y-local.y,e.from.z-local.z)<30)weaponCosmetics.remote(e,performance.now()/1000);}
    }
  }
};
function updateCharacterOptions(){const team=$('team').value,previous=$('character').value;$('character').replaceChildren();for(const preset of CHARACTER_PRESETS.filter(p=>p.team===team&&p.id===(team==='T'?'terror':'urban'))){const o=document.createElement('option');o.value=preset.id;o.textContent=nativeContent?(team==='T'?'T · CS2 Phoenix':'CT · CS2 SAS'):preset.label;$('character').append(o);}$('character').value=team==='T'?'terror':'urban';}
$('team').addEventListener('change',()=>{updateCharacterOptions();sceneDirty=true;});updateCharacterOptions();
$('characterPreview').hidden=true;
$('joinForm').addEventListener('submit',e=>{e.preventDefault();if(!assetsReady)return;$('joinButton').disabled=true;send({type:'join',worldContract:WORLD_CONTRACT,weaponProfileId:WEAPON_PROFILE_ID,presentationProfileId:EXPERIMENT_CONFIG.presentationProfileId,name:$('name').value,team:$('team').value,character:$('character').value,grenadeProtocol:GRENADE_PROTOCOL});});
function resumeGame(){
  if(!joined){setMenuVisible(false);return;}
  if(!connected){location.reload();return;}
  shop.setOpen(false);
  audioControls.cancelTest();ensureAudio().resume();
  void pointerInput.request(presentationSettings.values.rawMouse).then(ok=>{if(!ok)notify('无法捕获鼠标，请再次点击进入游戏');});
}
$('resumeButton').addEventListener('click',resumeGame);
function setMenuVisible(visible){
  if(visible)presentationWarmup.resume();
  const wasVisible=!$('resume').hidden;
  $('resume').hidden=!visible;document.body.classList.toggle('menu-open',visible);
  if(!visible)audioControls.cancelTest();
  for(const id of ['lobby','hud','previewPanel'])$(id).inert=visible;
  if(!visible){if(wasVisible&&!joined)$('lobbySettingsButton').focus();return;}
  text('resumeTitle',joined&&!connected?'服务器连接已断开':'游戏菜单');
  text('resumeButton',!joined?'返回大厅':connected?'继续游戏':'刷新并重新连接');
  text('menuNotice',joined?'菜单内停止本机操作，但局域网对局不会暂停。':'无需加入房间即可调整本机设置。');
  $('openBuyButton').hidden=!joined||!connected;
  if(!wasVisible)$('resumeButton').focus();
}
function rememberGameplayDiagnostics(){
  const frames=frameMetrics.snapshot();
  if(frames.samples){lastGameplayPerformance=frames;lastGameplayCamera=playerCamera.diagnostics();}
}
function openGameMenu(){
  if(locked)rememberGameplayDiagnostics();
  locked=false;clearInput();$('board').hidden=true;sceneDirty=true;
  shop.setOpen(false);document.exitPointerLock();setMenuVisible(true);
}
$('lobbySettingsButton').addEventListener('click',openGameMenu);
$('gameMenuButton').addEventListener('click',openGameMenu);
document.addEventListener('pointerlockchange',()=>{sceneDirty=true;if(locked)rememberGameplayDiagnostics();locked=document.pointerLockElement===canvas&&!shop.isOpen;if(locked)lookDiagnostics?.begin({wallNow:performance.now(),yaw,pitch,rawMode:pointerInput.diagnostics().mode,sensitivity:mouseSettings.value});else lookDiagnostics?.end({wallNow:performance.now(),reason:'pointer-unlocked'});if(joined)setMenuVisible(!locked&&!shop.isOpen);clearInput();frameMetrics.reset();resolution.reset();viewFeedback.reset();presentationWarmup.resume();});
document.addEventListener('pointerlockerror',()=>{if(!pointerInput.inflight&&document.pointerLockElement!==canvas)notify('鼠标捕获失败，请点击“进入游戏”重试');});
document.addEventListener('mousemove',e=>{if(locked&&!document.hidden&&$('resume').hidden){const receivedAt=lookDiagnosticsEnabled?performance.now():0;if(!pointerInput.observe(e.movementX,e.movementY))return;const p=player(),viewPlayer=p?.weapon==='awp'?{alive:p.alive,weapon:p.weapon,zoom:awpView.zoom(p,{stateTime:serverTime()})}:p;const factor=mouseTurnFactor(mouseSettings,scopedSettings,viewPlayer);yaw-=e.movementX*factor;pitch=clamp(pitch-e.movementY*factor,-PITCH_LIMIT,PITCH_LIMIT);if(lookDiagnosticsEnabled)lookDiagnostics.observe({receivedAt,eventTimestamp:e.timeStamp,movementX:e.movementX,movementY:e.movementY,yaw,pitch,factor});}});
function grenadeInputContext(){return {round:lastRound,stateTime:serverTime(),phase:state?.phase,yaw,pitch,eventTimeStamp:arguments[0]?.timeStamp,grenadeProfileId:state?.grenadeProfileId,afterInputSeq:typeof inputSeq==='number'?inputSeq:0};}
document.addEventListener('mousedown',e=>{
 if(!locked||shop.isOpen||!$('resume').hidden)return;
 const grenade=GRENADE_KINDS.includes(player()?.weapon),bit=e.button===0?1:e.button===2?2:0;
 if(e.button===0&&!mouseFire){mouseFire=true;queueInputEdge();sceneDirty=true;}
 if(grenade&&bit){e.preventDefault();grenadeButtons|=bit;grenadePrediction.buttons(player(),grenadeButtons,grenadeInputContext(e));sceneDirty=true;}
 else if(e.button===2){e.preventDefault();send({type:'secondary'});}
});
document.addEventListener('mouseup',e=>{
 const bit=e.button===0?1:e.button===2?2:0;
 if(bit&&(grenadeButtons&bit)){grenadeButtons&=~bit;grenadePrediction.buttons(player(),grenadeButtons,grenadeInputContext(e));sceneDirty=true;}
 if(e.button===0){mouseFire=false;queueInputEdge();sceneDirty=true;}
});
document.addEventListener('contextmenu',e=>{
  if(shop.isOpen){e.preventDefault();resumeGame();}
  else if(locked)e.preventDefault();
});
document.addEventListener('wheel',e=>{if(!locked||shop.isOpen||!$('resume').hidden)return;e.preventDefault();if(!e.deltaY||!player()?.alive)return;
  if(e.deltaY>0){inputSampler.wheel(input());return;}
  if(performance.now()-wheelAt<150)return;wheelAt=performance.now();
  const p=player(),owned=ownedWeapons(p,state?.bomb);if(owned.length<2)return;
  const index=owned.indexOf(p.weapon),next=(index-1+owned.length)%owned.length;send({type:'equip',weapon:owned[next]});
},{passive:false});
document.addEventListener('keydown',e=>{
  if(!$('resume').hidden){
    if(e.code==='Tab'){
      const targets=[...$('resume').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(el=>el.getClientRects().length),first=targets[0],last=targets.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
    if(e.code==='Escape'){e.preventDefault();if(!joined)setMenuVisible(false);}
    return;
  }
  if(!joined)return;
  if(e.code==='KeyB'&&connected&&!e.repeat&&!['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)){e.preventDefault();shop.toggle();return;}
  if(shop.isOpen){
    if(e.code==='Escape'){e.preventDefault();shop.setOpen(false);}
    if(e.code==='Tab'){
      const targets=[...$('buyMenu').querySelectorAll('button:not(:disabled)')],first=targets[0],last=targets.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
    return;
  }
  if(e.code==='Escape'){e.preventDefault();if(radioMenuIndex!==null){closeRadio();return;}openGameMenu();return;}
  if(!locked)return;
  if(radioMenuIndex!==null&&(/^Digit[0-9]$/.test(e.code)||e.code==='Escape')){
    e.preventDefault();const slot=Number(e.code.slice(5))-1;if(RADIO_MENUS[radioMenuIndex]?.[slot]&&!e.repeat)send({type:'radio',menu:radioMenuIndex,slot});closeRadio();return;
  }
  if(['KeyZ','KeyX','KeyV'].includes(e.code)&&!e.repeat){e.preventDefault();const index={KeyZ:0,KeyX:1,KeyV:2}[e.code];if(radioMenuIndex===index)closeRadio();else openRadio(index);return;}
  if(['Tab','Space','KeyW','KeyA','KeyS','KeyD','KeyC','KeyR','KeyG','KeyN','KeyQ','KeyE','Digit1','Digit2','Digit3','Digit4','Digit5','ControlLeft','ControlRight'].includes(e.code))e.preventDefault();keys.add(e.code);
  if(e.code==='Tab'){$('board').hidden=false;updateBoard();}
  if(e.code==='KeyR'&&!e.repeat)send({type:'reload'});
  const weapon={Digit1:1,Digit2:2,Digit3:3,Digit4:4,Digit5:5}[e.code];if(weapon&&!e.repeat)send({type:'equip',weapon});
  if(e.code==='KeyG'&&!e.repeat)send({type:'drop'});
  if(e.code==='KeyN'&&!e.repeat)send({type:'nightvision'});
  // Resolve each Q against the preceding ordered switch, even before its snapshot arrives.
  if(e.code==='KeyQ'&&!e.repeat&&player()?.alive)send({type:'equip',weapon:'last',fallbackWeapon:lastWeapon});
  if(locked&&!e.repeat)queueInputEdge();
});
document.addEventListener('keyup',e=>{keys.delete(e.code);queueInputEdge();if(e.code==='Tab'){$('board').hidden=true;e.preventDefault();}});
window.addEventListener('blur',clearInput);document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();audio?.stopAll();audioControls.cancelTest();}else presentationWarmup.resume();});
function input(){if(!locked||shop.isOpen||!$('resume').hidden)return {...blankInput(),yaw,pitch,round:lastRound};return {round:lastRound,f:(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),s:(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0),yaw,pitch,fire:mouseFire,jump:keys.has('Space'),crouch:crouchPressed(keys),walk:keys.has('ShiftLeft')||keys.has('ShiftRight'),use:keys.has('KeyE')};}
// Physics commands are sampled exactly once per fixed prediction step; idle clients send a neutral heartbeat.
const idleInputTimer=setInterval(()=>{if(joined&&connected&&!locked)send({type:'input',input:{...blankInput(),yaw,pitch,round:lastRound,cancelThroughSeq:inputSeq}});},100);
const pingTimer=setInterval(()=>{if(connected)send({type:'ping',sent:performance.now()});},1000);
let boardSignature='';
function updateBoard(){
  if(!state||$('board').hidden)return;
  const sorted=[...state.players].sort((a,b)=>a.team.localeCompare(b.team)||b.kills-a.kills);
  const signature=JSON.stringify(sorted.map(q=>[q.id,q.team,q.name,q.alive,q.kills,q.deaths]));
  if(signature===boardSignature)return;boardSignature=signature;
  const fragment=document.createDocumentFragment();
  for(const q of sorted){const row=document.createElement('tr');for(const v of [q.team,q.name,q.alive?'存活':'等待',q.kills,q.deaths]){const td=document.createElement('td');td.textContent=String(v);row.append(td);}fragment.append(row);}
  $('boardBody').replaceChildren(fragment);
}
function updateUI(){if(!state)return;const p=state.players.find(p=>p.id===myId);if(!p)return;
  text('score',`T ${state.score.T} : ${state.score.CT} CT`);
  text('phase',state.message);text('identity',`${p.team} / ${p.name}${p.alive?'':' · 等待下一回合'}`);text('healthValue',Math.ceil(p.hp));
  text('money',Number.isFinite(p.money)?`$${p.money.toLocaleString('en-US')}`:'$—');text('armourValue',Math.ceil(p.armour||0));
  style('game','filter',p.alive&&p.nightvisionOn?'brightness(1.8) sepia(1) saturate(3) hue-rotate(55deg)':'');
  text('armourType',p.helmet?'护甲 + 头盔':'护甲');
  text('equipmentStatus',[p.defuseKit?'拆弹器':'',p.nightvision?'夜视仪':'',p.shield?(p.shieldRaised?'盾牌已举起':'盾牌'):''].filter(Boolean).join(' · '));
  text('weapon',weaponName(p.weapon)+(p.reloadAt?' · 换弹中':'')+(p.shieldRaised?' · 举盾':'')+(p.silenced?' · 消音':'')+(p.burstMode?' · 三连发':''));
  text('ammoValue',GRENADE_IDS.includes(p.weapon)?p.grenades?.[p.weapon]||0:['knife','c4'].includes(p.weapon)?'—':p.ammo??'—');
  text('reserveValue',GUNS[p.weapon]||!['knife','c4',...GRENADE_IDS].includes(p.weapon)?`/ ${p.reserve??0}`:'');
  text('buyIndicator',p.alive&&p.canBuy?'B 购买 · 可用':'B 浏览装备');$('buyIndicator').dataset.available=String(Boolean(p.alive&&p.canBuy));
  const owned=ownedWeapons(p,state.bomb);
  for(const el of document.querySelectorAll('[data-slot]')){const slot=Number(el.dataset.slot),ids=slot===1?[p.primary]:slot===2?[p.pistol]:slot===3?['knife']:slot===4?GRENADE_IDS:['c4'];el.dataset.active=String(ids.includes(p.weapon));el.dataset.owned=String(ids.some(id=>owned.includes(id)));}
  text('grenadeCounts',`HE ${p.grenades?.hegrenade||0} · FLASH ${p.grenades?.flashbang||0} · SMOKE ${p.grenades?.smokegrenade||0}`);
  shop.update(p,state);
  const b=state.bomb;let hint='B 购买 · 1–5 装备 · Q 切回 · G 丢弃 · R 换弹';
  if(state.phase==='waiting')hint='正在准备回合';
  else if(state.phase==='countdown')hint='准备阶段 · B 购买武器与装备 · 自定义开局 $10,000';
  else if(!p.alive)hint='本回合已阵亡，等待下一回合';
  else if(state.phase==='ended')hint='回合结束 · 可继续移动和开火，倒计时后开始下一回合';
  else if(!state.players.some(q=>q.team!==p.team))hint='可自由行动和购买 · 对手加入后重新开局';
  else if(b.state==='carried'&&b.holder===p.id)hint=siteAt(p)?'在爆破区内，静止并按住 E 安放炸弹':'你携带炸弹，前往 A / B 点';
  else if(b.state==='dropped'&&p.team==='T')hint='炸弹已掉落，靠近并按 E 拾取';
  else if(b.state==='planted')hint=p.team==='CT'?'炸弹已安放，靠近并静止按住 E 拆除':'炸弹已安放，阻止对方拆除';
  text('hint',hint);text('actionText',p.action==='plant'?'正在安放炸弹':p.action==='defuse'?'正在拆除炸弹':'');
  $('progress').style.display=p.action?'block':'none';$('progress').value=p.progress/(p.action==='plant'?RULES.plantSeconds:p.defuseKit?ECONOMY.defuseKitSeconds:ECONOMY.defuseSeconds);
  updateBoard();
  bombMesh.visible=!nativeDrops?.bombReady&&['dropped','planted'].includes(b.state);if(bombMesh.visible)bombMesh.position.set(b.x,(b.y||0)+.2,b.z);
}
const ctx=$('minimap').getContext('2d');
function minimap(){ctx.drawImage(mapRender.minimap,0,0);const c=mapRender.minimapPoint;
  ctx.font='bold 14px sans-serif';ctx.textAlign='center';ctx.fillStyle='#ff6f39';for(const s of SITES){const [x,z]=c(s.x,s.z);ctx.fillText(s.name,x,z+4);}
  if(!state)return;const me=state.players.find(p=>p.id===myId);for(const p of state.players){if(!p.alive||p.team!==me?.team)continue;const [x,z]=c(p.x,p.z);ctx.fillStyle=p.id===myId?'#fff':'#58bce9';ctx.beginPath();ctx.arc(x,z,p.id===myId?3.5:2.5,0,Math.PI*2);ctx.fill();if(p.id===myId){const target=c(p.x-Math.sin(yaw)*3,p.z-Math.cos(yaw)*3);ctx.strokeStyle='#fff';ctx.beginPath();ctx.moveTo(x,z);ctx.lineTo(...target);ctx.stroke();}}
  const b=state.bomb;if(['dropped','planted'].includes(b.state)){const [x,z]=c(b.x,b.z);ctx.fillStyle='#ff5735';ctx.fillRect(x-3,z-3,6,6);}
}
let stopped=false,rafId;
let previous=performance.now(),frameCount=0,lastMinimap=-Infinity,lastHud=-Infinity,timelineClockResumeAt=0,lastCameraMs=0;
let lookMapUpdateMs=0;
function updateMapRuntime(now){if(!lookDiagnosticsEnabled){mapRender.runtime.update(now);return;}const at=performance.now();mapRender.runtime.update(now);lookMapUpdateMs+=performance.now()-at;}
function frame(now){if(stopped)return;rafId=requestAnimationFrame(frame);const started=performance.now(),interval=now-previous,dt=Math.min(.05,interval/1000);previous=now;frameCount++;
  if(preparingRenderPass)return;lookMapUpdateMs=0;updateMapRuntime(now);
  if(interval>100)timelineClockResumeAt=now+100;
  socket.flushState();
  networkDiagnostics.frame(interval,joined&&locked&&!document.hidden);
  const me=player(),time=serverTime();
  const opacity=me?.alive?calculateFlashOpacity(flashUntil,flashAmount,time,flashFade):0;
  if(opacity!==flashOpacity){flashOpacity=opacity;$('flashOverlay').style.opacity=String(flashOpacity);}
  style('hitmarker','opacity','0');style('damageFlash','opacity',now-damageAt<160?'0.65':'0');
  if(now>noticeUntil&&$('notice').textContent)$('notice').textContent='';
  if(shotEffects.update(now/1000))sceneDirty=true;
  if(playerHitEffects.update(now/1000,camera.quaternion))sceneDirty=true;
  // Static lobby/inspection views render on demand; inactive clients should not compete with the active GPU view.
  if(!locked&&!sceneDirty&&!(joined&&worldEffects.active(time))){updateMapRuntime(now);return;}
  const displayMe=weaponSwitchView.view(me,{bomb:state?.bomb});
  scene.fog=preview?null:gameplayFog;const zoom=displayMe?.weaponSwitchPredicted?displayMe.zoom:awpView.zoom(me,{stateTime:time,nowMs:now}),desiredFov=preview?(view==='overview'?55:75):verticalFov(zoom,camera.aspect);if(camera.fov!==desiredFov){camera.fov=desiredFov;camera.updateProjectionMatrix();}
  const scoped=Boolean(!preview&&me?.alive&&zoom<=40);
  $('scopeOverlay').hidden=!scoped;$('crosshair').hidden=scoped||Boolean(nativeContent&&zoom<90)||!me?.alive||shop.isOpen||displayMe?.weapon==='c4'||GUNS[displayMe?.weapon]?.category==='sniper';
  if(local&&me){if(allowsPlayerActions(state.phase)&&me.alive&&locked){let sampledInput=false;physicsAccumulator=Math.min(.1,physicsAccumulator+dt);while(physicsAccumulator>=PREDICTION_DT&&pendingCommands.length<MAX_PENDING_COMMANDS){const sampled=inputSampler.sample(input()),command={seq:++inputSeq,round:state.round,input:sampled.input,...renderedInputView.command(state.round)};const beforeStep={grounded:local.grounded,vx:local.vx,vy:local.vy,vz:local.vz};movePlayer(local,command.input,PREDICTION_DT,state.players);viewFeedback.observe(beforeStep,local,{seq:command.seq,round:state.round,now,enabled:presentationSettings.values.landing,strength:presentationSettings.values.landingStrength});worldAudio.localMovement(movementSoundStep(localMovementSounds,{before:beforeStep,after:local,input:command.input,dt:PREDICTION_DT,surface:mapRender.groundSoundSurface(local)}));playerCamera.push(local,command.input,state.players);pendingCommands.push(command);sampledInput=true;if(sampled.critical)send({type:'inputCritical',...inputViewMetadata(command),commands:[{seq:command.seq,round:command.round,...command.input,...inputViewMetadata(command)}]});const feedback=shotFeedback.sample({player:me,pose:local,input:command.input,seq:command.seq,round:state.round,time:serverTime(),stateTime:state.time,fixedStep:true,nowMs:now,allowed:true,switchBlocked:weaponSwitchView.blocksShot(command.seq)});if(feedback)presentLocalShot(feedback,now);physicsAccumulator-=PREDICTION_DT;}if((sampledInput||now-lastInputPacket>=1000/60)&&pendingCommands.length){const batch=buildInputBatch(pendingCommands,state.round,me.ackInputSeq||0);const stamp=renderedInputView.command(state.round);batch.viewTime=stamp.viewTime;batch.interpDelayMs=stamp.interpDelayMs;batch.viewAgeMs=stamp.viewAgeMs;send(batch);lastInputPacket=now;}}
    if(weaponActionOrder.pending)flushWeaponActions();
    correction=decayCorrection(correction,dt,recoveryCorrection?{maxSpeed:Math.max(2.5,Math.min(6,Math.hypot(local.vx||0,local.vz||0)*.9))}:undefined);if(Math.hypot(correction.x,correction.y,correction.z)<.001)recoveryCorrection=false;
    const cameraStarted=performance.now();renderY=playerCamera.update(local,{fractionSeconds:physicsAccumulator,correction,dt,frameTimeMs:now,players:state.players,enabled:locked&&me.alive&&allowsPlayerActions(state.phase)&&pendingCommands.length<MAX_PENDING_COMMANDS});lastCameraMs=performance.now()-cameraStarted;
    const predictedView=shotFeedback.view();
    const recoil=sampleViewRecoil(predictedView||me,physicsAccumulator);recoilYaw=recoil.recoilYaw;recoilPitch=recoil.recoilPitch;
    maxRecoilPitch=Math.max(maxRecoilPitch,recoilPitch);
    const landing=viewFeedback.sample(now,presentationSettings.values.landing),motion=viewmodelMotion(local,now,presentationSettings.values);camera.position.set(playerCamera.position.x,renderY,playerCamera.position.z);camera.rotation.set(clamp(pitch+recoilPitch,-PITCH_LIMIT,PITCH_LIMIT),yaw+recoilYaw,landing.roll+motion.cameraRoll,'YXZ');
    audio?.listen(camera.position,camera.getWorldDirection(cameraDirection));
    const gap=`${crosshairFeedback.update(me,dt,innerWidth).toFixed(2)}px`;if($('crosshair').style.getPropertyValue('--gap')!==gap)$('crosshair').style.setProperty('--gap',gap);
    if(now-lastHud>=100){const speed=Math.hypot(me.vx||0,me.vz||0);text('tuning',`速度 ${speed.toFixed(1)} m/s · ${!me.grounded?'空中散布':speed>.25?'移动散布':me.burstCount?'连射扩散':'静止精度'} · 连射 ${me.burstCount||0}`);lastHud=now;}
  }else{const preset=VIEWS[preview?view:($('team').value==='CT'?'ct':'t')];camera.position.set(...preset.eye);camera.lookAt(...preset.target);}
  const animationStarted=performance.now();
  actorScheduler.begin(camera);for(const [id,r] of remote){const pose=snapshotBuffer.sample(id,now)||r.p,visible=actorScheduler.shouldPose(pose);r.actor.group.visible=visible;r.actor.update(dt,pose,{renderPose:visible});r.rendered=true;}
  const muzzleVisible=muzzlePulse.sample(now);
  if(weaponView){
    const displayWeapon=weaponSwitchView.view(me,{bomb:state?.bomb}),visibleWeapon=displayWeapon?.shieldRaised?'shield':displayWeapon?.weapon;
    if(me&&modelWeapon!==visibleWeapon){modelWeapon=visibleWeapon;Promise.resolve(weaponView.setWeapon(visibleWeapon)).then(result=>{if(result?.error)notify('武器资源加载失败，切换后可重试。');sceneDirty=true;presentationWarmup.enqueue(weaponView.prepare());muzzleLighting.prepare(scene);}).catch(error=>{weaponModelError=String(error.message||error);});}
    if(me){const visual=weaponSwitchView.view(grenadePrediction.view(shotFeedback.presentation(me),now/1000),{bomb:state?.bomb});weaponView.update(dt,visual,visual.grenadePredicted||visual.weaponLocalClock?now/1000:time,{hand:viewmodelSettings.hand,motion:viewmodelMotion(local,now,presentationSettings.values)});}
    if(!weaponView.presentation){const motion=viewmodelMotion(local,now,presentationSettings.values);weaponView.group.position.set(.25,-.24+motion.y,-.42);weaponView.group.rotation.x=0;weaponView.group.rotation.z=motion.roll;applyWeaponHand(weaponView.group,viewmodelSettings.hand,motion.side);}
    viewmodelProjection.sync(weaponView.presentation?.());
    weaponView.group.visible=Boolean(me?.alive&&!preview&&!scoped);
    if(weaponView.muzzle)weaponView.muzzle.visible=Boolean(me?.alive&&GUNS[visibleWeapon]&&!displayWeapon?.weaponSwitchPredicted&&muzzleVisible);
  }
  if(weaponView&&me){weaponView.group.updateWorldMatrix(true,false);if(!weaponView.ejectionPosition(cosmeticOrigin))cosmeticOrigin.set(.08,-.1,-.25);cosmeticOrigin.applyMatrix4(weaponView.group.matrixWorld);cosmeticMuzzle.copy(weaponView.muzzle.position).applyMatrix4(weaponView.group.matrixWorld);formatViewmodelAttachment(cosmeticOrigin,camera,viewmodelCamera,cosmeticOrigin);formatViewmodelAttachment(cosmeticMuzzle,camera,viewmodelCamera,cosmeticMuzzle);cosmeticRight.set(viewmodelSettings.hand==='left'?-1:1,0,0).applyQuaternion(camera.quaternion);cosmeticForward.set(0,0,-1).applyQuaternion(camera.quaternion);weaponCosmetics.flushLocal({weapon:weaponSwitchView.view(me,{bomb:state?.bomb})?.weapon,origin:cosmeticOrigin,muzzle:cosmeticMuzzle,right:cosmeticRight,forward:cosmeticForward,now:now/1000});}
  if(weaponCosmetics.update(now/1000,camera.quaternion))sceneDirty=true;
  const animationMs=performance.now()-animationStarted;
  smokeOpacity=worldEffects.update(time,me?.alive&&!preview?camera.position:null,camera.quaternion);style('smokeOverlay','opacity',String(smokeOpacity));
  if(state){const bombTimer=state.phase==='live'&&state.bomb.state==='planted',remaining=Math.max(0,Math.ceil((bombTimer?state.bomb.endAt:state.endAt)-time));text('timer',state.phase==='waiting'?'--:--':`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`);style('timer','color',bombTimer?'rgb(255, 157, 112)':'rgb(255, 255, 255)');}
  text('network',connected?`${state?.players.length||0} / 10 人 · ${lag} ms · ${socket.transport==='webtransport'?'QUIC':'WS'}`:'已断开');
  bombLight.intensity=state?.bomb.state==='planted'?(Math.sin(now*.012)+1)*1.5:0;if(bombMesh.visible){bombLight.position.copy(bombMesh.position);bombLight.position.y+=.4;}
  if(joined&&!preview&&now-lastMinimap>=1000/30){minimap();lastMinimap=now;}
  const renderStarted=performance.now();gpuMs=gpuTimer.poll(now);let resizeMs=0;
  // Change the effective viewport before drawing. Reuse the allocated buffer;
  // reallocating it under GPU pressure can synchronously stall this thread.
  if(pendingRenderRatio!==null){const resizeStarted=performance.now();renderSurface.setRatio(pendingRenderRatio);pendingRenderRatio=null;resizeMs=performance.now()-resizeStarted;}
  updateMapRuntime(now);gpuTimer.begin();renderer.info.autoReset=false;renderer.info.reset();camera.layers.set(0);if(!smokeRenderer.render(time))renderer.render(scene,camera);
  if(weaponView?.group.visible){const background=scene.background;scene.background=null;renderer.autoClear=false;renderer.clearDepth();viewmodelCamera.layers.set(1);renderer.render(scene,viewmodelCamera);camera.layers.set(0);renderer.autoClear=true;scene.background=background;}
  gpuTimer.end(now,{ratio:renderSurface.ratio,epoch:frameMetrics.epoch,active:locked&&!document.hidden});shotDiagnostics?.submitted(performance.now());sceneDirty=false;renderedView=preview?view:null;
  if(joined&&!preview&&me?.alive)renderedInputView.present(state.round,snapshotBuffer.view());
  if(locked&&!document.hidden){
    const submitted=performance.now(),gpu=gpuTimer.latest(),adaptStarted=performance.now();
    if(resolution.sample(interval,now,gpuMs,{cpuMs:submitted-started,gpuSampleId:gpu?.serial??0,gpuSubmittedAt:gpu?.submittedAt??-Infinity,gpuRatio:gpu?.tag?.ratio??NaN}))pendingRenderRatio=resolution.ratio;
    frameMetrics.add(interval,performance.now()-started,animationMs,submitted-renderStarted,lastCameraMs,Math.max(0,started-now),resizeMs+performance.now()-adaptStarted);
    if(lookDiagnosticsEnabled)lookDiagnostics.sample({now,wallNow:started,yaw,pitch,cameraYaw:camera.rotation.y,cameraPitch:camera.rotation.x,recoilYaw,recoilPitch,cpuMs:performance.now()-started,mapUpdateMs:lookMapUpdateMs,renderSubmitMs:submitted-renderStarted,animationMs,cameraMs:lastCameraMs,renderRatio:renderSurface.ratio,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,gpuMs,gpuSampleId:gpu?.serial});
  }
}
rafId=requestAnimationFrame(frame);window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();viewmodelProjection.sync(weaponView?.presentation?.());renderSurface.resize(innerWidth,innerHeight);smokeRenderer.resize();sceneDirty=true;});
window.addEventListener('pagehide',()=>{stopped=true;cancelAnimationFrame(rafId);clearInterval(idleInputTimer);clearInterval(pingTimer);socket.close();mapRender.runtime.dispose();smokeRenderer.dispose();nativeDrops?.dispose();for(const actor of retainedWarmActors)actor.dispose();for(const object of retainedWarmRepresentatives){if(object.userData.cs2WarmMaterial)object.material.dispose();disposeTemporaryInstances([object]);}nativeContent?.dispose();presentationWarmup.dispose();audioControls.dispose();audio?.dispose();clearInterval(diagnosticUiTimer);longTaskObserver.dispose();gpuTimer.dispose();weaponView?.dispose();weaponCosmetics.dispose();worldEffects.dispose();shotEffects.dispose();playerHitEffects.dispose();for(const r of remote.values())r.actor.dispose();renderer.dispose();},{once:true});
// Read-only diagnostic hook for automated browser smoke tests.
window.lanStrike={getState:()=>state,getId:()=>myId,getPerformance:()=>({...frameMetrics.snapshot(),quality:resolution.quality,pixelRatio:renderSurface.ratio,renderSurface:renderSurface.diagnostics(),gpuTimerSupported:gpuTimer.supported,gpuMs,gpuTimer:gpuTimer.diagnostics(),renderBudget:resolution.diagnostics(),autoResolution:gpuTimer.supported?'gpu-timed':'manual-only-no-gpu-timer',skinning:'gpu',drawingBuffer:{width:canvas.width,height:canvas.height}}),getRenderInfo:()=>({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,frame:renderer.info.render.frame}),getDiagnostics:()=>({crosshair:crosshairFeedback.values,inputViewProtocol,combatOrderVersion,weaponSwitchView:weaponSwitchView.diagnostics(),renderedInputView:renderedInputView.diagnostics(),weaponActions:{supported:weaponActionProtocol,...weaponActionOrder.diagnostics()},presentationWarmup:presentationWarmup.diagnostics(),audio:audio?.diagnostics()||null,audioRouting:worldAudio.diagnostics(),acoustics:acoustics.diagnostics(),soundSurface:mapRender.soundMaterials,presentation:presentationSettings.values,actorScheduling:actorScheduler.diagnostics(),landing:viewFeedback.diagnostics(),pointerInput:pointerInput.diagnostics(),weaponCosmetics:weaponCosmetics.info(),hitRecoveryVersion:local?.hitRecoveryVersion??0,velocityModifier:local?.velocityModifier??1,transport:socket.transport,connection:socket.diagnostics(),interpolation:snapshotBuffer.diagnostics(),shotFeedback:shotFeedback.diagnostics(),awpView:awpView.diagnostics(),grenadePrediction:grenadePrediction.diagnostics(),mapVersion:MAP_VERSION,mapFaces:mapRender.faces,terrainTriangles:mapRender.triangles,mapTextures:mapRender.textures,experimental:true,worldContract:WORLD_CONTRACT,weaponProfileId:WEAPON_PROFILE_ID,nativeContent:nativeContent?.diagnostics()||null,nativeDrops:nativeDrops?.diagnostics()||null,presentationProfileId:EXPERIMENT_CONFIG.presentationProfileId,worldLoading:WORLD_LOAD,mapStreaming:mapRender.runtime.info(),sourceSHA1:mapRender.sourceSHA1,preview,view,renderedView,locked,visibility:document.visibilityState,frameCount,lastFrameAge:performance.now()-previous,input:input(),inputSampler:inputSampler.diagnostics(),localPosition:local?{x:local.x,y:local.y,z:local.z}:null,localVelocity:local?{x:local.vx,y:local.vy,z:local.vz}:null,cameraFractionSeconds:Math.max(0,Math.min(PREDICTION_DT,physicsAccumulator)),unackedInputs:pendingCommands.length,inputSeq,ackInputSeq:player()?.ackInputSeq,lastCorrection,predictionRecoveryActive:recoveryCorrection,visualCorrection:{...correction},impacts:shotEffects.info().decals,shotEffects:shotEffects.info(),playerHitEffects:playerHitEffects.info(),recoilYaw,recoilPitch,maxBurst,maxRecoilPitch,viewRoll:camera.rotation.z,cameraY:camera.position.y,cameraMode:playerCamera.mode,cameraDiagnostics:playerCamera.diagnostics(),cameraPosition:{x:camera.position.x,y:camera.position.y,z:camera.position.z},viewmodelProjection:viewmodelProjection.diagnostics(),money:player()?.money??null,character:player()?.character??null,armour:player()?.armour??0,buyMenuOpen:shop.isOpen,gameMenuOpen:!$('resume').hidden,weaponHand:viewmodelSettings.hand,mouseSensitivity:mouseSettings.value,scopedSensitivity:scopedSettings.value,weapon:player()?.weapon??null,weaponModel:{...(weaponView?.info()||{source:'unavailable',fallback:true}),...(weaponModelError?{error:weaponModelError}:{})},flashOpacity,smokeOpacity,grenadeCount:GRENADE_IDS.reduce((sum,id)=>sum+(player()?.grenades?.[id]||0),0),worldEffects:worldEffects.info(),smokeRenderer:smokeRenderer.diagnostics(),remoteModels:[...remote].map(([id,r])=>({...r.actor.info(),playerId:id,character:r.p.character,team:r.p.team,visible:r.actor.group.visible,position:r.actor.group.position.toArray()})),fov:camera.fov,lastWeapon})};
function diagnosticReport(){
  const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
  const current=window.lanStrike.getPerformance();
  const performanceReport=current.samples?current:{...current,...(lastGameplayPerformance||{})};
  const report=buildDiagnosticReport({network:{...networkDiagnostics.snapshot(),connection:socket.diagnostics(),interpolation:snapshotBuffer.diagnostics(),shotFeedback:shotFeedback.diagnostics(),renderedInputView:renderedInputView.diagnostics()},performance:performanceReport,diagnostics:window.lanStrike.getDiagnostics(),longTaskSupported:longTaskObserver.supported,environment:{origin:location.origin,userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemoryGB:navigator.deviceMemory??null,viewport:{width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio},webglRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),visible:!document.hidden,scope:joined?'joined-client':'lobby-only'}});
  report.cameraPresentation=locked&&current.samples?playerCamera.diagnostics():(lastGameplayCamera||playerCamera.diagnostics());
  if(lookDiagnosticsEnabled)report.lookInput={...lookDiagnostics.snapshot(),pointerInput:pointerInput.diagnostics()};if(shotDiagnostics)report.shotDiagnostics=shotDiagnostics.report({transport:socket.transport});return report;
}
window.lanStrike.getDiagnosticReport=diagnosticReport;
window.lanStrike.getLookDiagnostics=()=>lookDiagnostics?.snapshot()??{enabled:false};
function refreshDiagnosticUI(){
  if($('resume').hidden)return;
  text('audioRuntimeStatus',audioControls.status());text('rawMouseStatus',pointerInput.status());const calibration=mouseCalibration(mouseSettings.radiansPerPixel,presentationSettings.values.dpi);text('mouseCalibration',`普通视角每360°约 ${calibration.countsPerTurn.toFixed(0)} 个鼠标计数${calibration.cmPerTurn===null?'':` · 约 ${calibration.cmPerTurn.toFixed(1)} cm（按填写DPI估算）`}`);
  text('renderProfileStatus',resolution.profile==='headroom'?'B · 渲染比例上限 75%，保留抗锯齿；切回 A 恢复原画质。':'A · 原画质预算；B 为可回退的稳帧实验。');
  const budget=resolution.diagnostics();text('frameTargetStatus',`${resolution.quality==='auto'?'自动画质':'固定画质'} · 性能预算 ${budget.targetHz} FPS${budget.target==='auto'?'（自动）':''}`);
  const r=networkDiagnostics.snapshot(),fmt=v=>Number.isFinite(v)?v.toFixed(1):'—';
  text('networkDiagnosticsStatus',`已采样 ${(r.durationMs/1000).toFixed(0)} 秒 · ${r.totals.receivedStates} 个状态 · ${r.totals.longTasks} 次长任务${lookDiagnosticsEnabled?' · 转向采样已开启':''}${shotDiagnosticsEnabled?' · 射击链路采样已开启':''}`);
  if($('networkDiagnosticsDetails').open)text('networkDiagnosticsText',[
    `应用层 RTT 中位 / P95 / 最大：${fmt(r.metrics.applicationRttMs?.median)} / ${fmt(r.metrics.applicationRttMs?.p95)} / ${fmt(r.metrics.applicationRttMs?.max)} ms`,
    `传输：${socket.transport} · 回退原因：${socket.reason||'无'} · 插值缓冲 ${fmt(snapshotBuffer.diagnostics().delayMs)} ms`,
    `到包间隔 P95 / 最大：${fmt(r.metrics.stateArrivalIntervalMs?.p95)} / ${fmt(r.metrics.stateArrivalIntervalMs?.max)} ms`,
    `画质预算：${budget.targetHz} FPS / ${budget.budgetMs.toFixed(2)} ms · ${budget.classification} · ${budget.lastDecision}`,
    `前台帧间隔 P95 / 最大：${fmt(r.metrics.foregroundFrameIntervalMs?.p95)} / ${fmt(r.metrics.foregroundFrameIntervalMs?.max)} ms`,
    `服务器事件循环 P95 / 最大：${fmt(r.server?.serverLoopP95Ms)} / ${fmt(r.server?.serverLoopMaxMs)} ms`,
    `输入积压最大：${fmt(r.metrics.pendingInputs?.max)} · 位置纠正最大：${fmt(r.metrics.positionCorrectionUnits?.max)}`,
    r.server?.diagnosticsVersion?'服务端诊断已连接':'服务端完整诊断尚未收到；刷新或检查服务版本',
    'RTT 包含浏览器 / 服务器等待，不是纯网络延迟。',
  ].join('\n'));
}
$('networkDiagnosticsDetails').addEventListener('toggle',refreshDiagnosticUI);
$('resetDiagnosticsButton').addEventListener('click',()=>{networkDiagnostics.reset();shotDiagnostics?.reset();lastGameplayPerformance=null;lastGameplayCamera=null;refreshDiagnosticUI();});
$('exportDiagnosticsButton').addEventListener('click',()=>{
  const report=diagnosticReport(),url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='lan-strike-diagnostics-'+report.exportedUTC.replace(/[:.]/g,'-')+'.json';link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('network').title='应用层往返耗时，含浏览器与服务端调度。排查卡顿请按 Esc 导出诊断 JSON。';
const diagnosticUiTimer=setInterval(refreshDiagnosticUI,1000);refreshDiagnosticUI();

canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();stopped=true;cancelAnimationFrame(rafId);socket.close();CLIENT_LIFETIME.abort();mapRender.runtime.dispose();$('error').textContent='显卡上下文已丢失，请刷新重新加载实验版。';},{once:true});

if(new URLSearchParams(location.search).get('automation')==='1')window.cs2Automation=Object.freeze({start(){if(!joined)throw Error('Join first');locked=true;shop.setOpen(false);setMenuVisible(false);sceneDirty=true;frameMetrics.reset();},stop(){locked=false;clearInput();setMenuVisible(true);},fire(value){mouseFire=Boolean(value);queueInputEdge();},look(nextYaw,nextPitch=0){if(!Number.isFinite(nextYaw)||!Number.isFinite(nextPitch))throw Error('Invalid automation angles');yaw=nextYaw;pitch=clamp(nextPitch,-PITCH_LIMIT,PITCH_LIMIT);sceneDirty=true;},setKeys(codes=[]){keys.clear();for(const code of codes)keys.add(code);queueInputEdge();},resetMetrics(){frameMetrics.reset();networkDiagnostics.reset();}});
