import * as THREE from '/vendor/three.module.js';
import {loadOriginalMap} from './map-render.js';
import {PREDICTION_DT,MAX_PENDING_COMMANDS,reconcileMovement,visualCorrection,decayCorrection} from './prediction.js';
import {RULES,WEAPONS,SITES,VIEWS,MAP_VERSION,MAP_BOUNDS,groundHeight,movePlayer,blankInput,siteAt,clamp} from './shared.js';
import {GUNS,EQUIPMENT} from './arsenal.js';
import {allowsPlayerActions} from './round-state.js';
import {ECONOMY} from './economy.js';
import {createShop,ownedWeapons,GRENADE_IDS} from './shop.js';
import {createWorldEffects,flashOpacity as calculateFlashOpacity} from './effects.js';
import {createShotEffects} from './shot-effects.js';
import {createPlayerHitEffects} from './player-hit-effects.js';
import {createPlayerActor} from './player-model.js';
import {CHARACTER_PRESETS,DEFAULT_CHARACTER,selectCharacter} from './characters-config.js';
import {createFrameMetrics,createResolutionController} from './performance.js';
import {GameConnection} from './game-connection.js';
import {createSnapshotBuffer} from './snapshot-buffer.js';
import {buildInputBatch} from './input-protocol.js';
import {createShotFeedback} from './shot-feedback.js';
import {createAwpView} from './awp-view.js';
import {usesMainWeaponRules,sampleViewRecoil} from './weapon-feel.js';
import {createMuzzlePulse} from './muzzle-pulse.js';
import {muzzleFlashProfile} from './muzzle-flash.js';
import {createPresentationWarmup} from './presentation-warmup.js';
import {createGrenadePrediction,GRENADE_PROTOCOL} from './grenade-intent.js';
import {createGpuTimer} from './gpu-timer.js';
import {SCOPED_SENSITIVITY,createMouseSettings,bindMouseSettings,mouseTurnFactor} from './mouse-settings.js';
import {PITCH_LIMIT,verticalFov} from './view-settings.js';
import {createGameAudio} from './game-audio.js';
import {bindAudioControls} from './audio-controls.js';
import {createWorldAudio} from './world-audio.js';
import {createMovementSoundState,movementSoundStep,RADIO_MENUS,RADIO_LABELS} from './movement-audio.js';
import {createCrosshair} from './crosshair.js';
import {crouchPressed,createInputSampler} from './controls.js';
import {createViewmodelSettings,bindViewmodelSettings,applyWeaponHand} from './viewmodel-settings.js';
import {createPlayerCamera} from './player-camera.js';
import {createNetworkDiagnostics,observeLongTasks,buildDiagnosticReport} from './network-diagnostics.js';
const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,document.getElementById(id));return nodes.get(id);},canvas=$('game');
const text=(id,value)=>{const node=$(id),next=String(value);if(node.textContent!==next)node.textContent=next;};
const style=(id,key,value)=>{const node=$(id);if(node.style[key]!==value)node.style[key]=value;};
let mouseStorage;try{mouseStorage=localStorage;}catch{}
const mouseSettings=createMouseSettings(mouseStorage),scopedSettings=createMouseSettings(mouseStorage,SCOPED_SENSITIVITY);bindMouseSettings(document,mouseSettings,scopedSettings);
const viewmodelSettings=createViewmodelSettings(mouseStorage);bindViewmodelSettings(document,viewmodelSettings,()=>{sceneDirty=true;});
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
const frameMetrics=createFrameMetrics(),resolution=createResolutionController(devicePixelRatio);
const networkDiagnostics=createNetworkDiagnostics(),longTaskObserver=observeLongTasks(networkDiagnostics),messageEncoder=new TextEncoder();
const snapshotBuffer=createSnapshotBuffer(),shotFeedback=createShotFeedback(),awpView=createAwpView(),muzzlePulse=createMuzzlePulse();
const crosshairFeedback=createCrosshair(),cameraDirection=new THREE.Vector3();
const playerCamera=createPlayerCamera();
let lastGameplayPerformance=null;
const gpuTimer=createGpuTimer(renderer.getContext());let gpuMs=null;
try{resolution.setQuality(localStorage.getItem('lan-strike-quality')||'auto');}catch{}
renderer.setPixelRatio(resolution.ratio);renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=false;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;renderer.toneMappingExposure=1;
const scene=new THREE.Scene();scene.background=new THREE.Color('#b8c4cd');scene.fog=null;
const gameplayFog=scene.fog;
const camera=new THREE.PerspectiveCamera(80,innerWidth/innerHeight,.06,450);camera.rotation.order='YXZ';scene.add(camera);
scene.add(new THREE.HemisphereLight('#e7efff','#746044',2.1));
const sun=new THREE.DirectionalLight('#ffe0aa',2.5);sun.position.set(-25,70,25);sun.castShadow=false;
sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-48,right:48,top:48,bottom:-48,near:1,far:130});sun.shadow.bias=-.0005;scene.add(sun);scene.add(sun.target);
let mapRender;try{mapRender=await loadOriginalMap(scene);}catch(error){$('error').textContent='地图资源加载失败，请检查 assets/dust2 与 map-data.js 是否完整。';$('joinButton').textContent='地图加载失败';throw error;}
function box(x,y,z,w,h,d,mat,parent=scene){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
const bombMesh=box(0,.2,0,.55,.35,.38,new THREE.MeshStandardMaterial({color:'#343f35',emissive:'#142818'}));bombMesh.visible=false;
const bombLight=new THREE.PointLight('#ff4422',0,7);scene.add(bombLight);
let weaponView=null,weaponModelError='',modelWeapon=null;
try{const {createWeaponView}=await import('./weapon-model.js');weaponView=await createWeaponView(THREE,camera,{onSound:name=>audio?.play(name,{volume:1,entityId:'local-viewmodel',channel:'item',priority:10})});}
catch(error){weaponModelError=String(error.message||error);}
const worldEffects=createWorldEffects(THREE,scene,{onChange:()=>{sceneDirty=true;}});
const shotEffects=createShotEffects(THREE,scene),playerHitEffects=createPlayerHitEffects(THREE,scene),remote=new Map();

let state=null,myId=null,joined=false,connected=false,locked=false,yaw=0,pitch=0,local=null,lastRound=-1,hitAt=0,damageAt=0,noticeUntil=0,lag=0,recoilYaw=0,recoilPitch=0,preview=false,view='overview',renderY=null,sceneDirty=true,renderedView=null;
let stateReceivedAt=performance.now(),lastWeapon=null,activeWeapon=null,wheelAt=0,flashUntil=0,flashAmount=0,flashFade=1.4,flashOpacity=0,smokeOpacity=0,visualSignature='';
const presentationWarmup=createPresentationWarmup(THREE,renderer,scene,camera,{canRun:()=>!locked&&!preview&&!document.hidden});
const initialHitResources=playerHitEffects.prepare(),initialShotResources=shotEffects.prepare();
presentationWarmup.enqueue({objects:[...initialHitResources.objects,...initialShotResources.objects,...(weaponView?[weaponView.muzzle]:[])],textures:[...initialHitResources.textures,...initialShotResources.textures,...(weaponView?[weaponView.muzzle.material.map]:[])]});
if(weaponView)presentationWarmup.enqueue(weaponView.prepare());
const qualityControls=[...document.querySelectorAll('[data-quality]')];
for(const control of qualityControls){control.value=resolution.quality;control.onchange=()=>{
  if(!resolution.setQuality(control.value))return;
  for(const other of qualityControls)other.value=resolution.quality;
  try{localStorage.setItem('lan-strike-quality',resolution.quality);}catch{}
  renderer.setPixelRatio(resolution.ratio);frameMetrics.reset();sceneDirty=true;
};}
const player=()=>state?.players.find(p=>p.id===myId);
const serverTime=()=>state?(state.time+Math.max(0,performance.now()-stateReceivedAt)/1000):0;
const weaponName=id=>GUNS[id]?.name||EQUIPMENT[id]?.name||({knife:'战术匕首',c4:'C4 炸弹'})[id]||WEAPONS[id]?.name||id||'—';
const requestedView=new URLSearchParams(location.search).get('view');
if(VIEWS[requestedView]){preview=true;view=requestedView;$('lobby').hidden=true;$('previewPanel').hidden=false;}
$('previewButton').onclick=()=>{preview=true;sceneDirty=true;$('lobby').hidden=true;$('previewPanel').hidden=false;};

$('backButton').onclick=()=>{if(!connected){location.href='/';return;}preview=false;sceneDirty=true;$('lobby').hidden=false;$('previewPanel').hidden=true;};
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{view=button.dataset.view;sceneDirty=true;};
const keys=new Set(),inputSampler=createInputSampler();let mouseFire=false,audio=null,maxBurst=0,maxRecoilPitch=0;
let localMovementSounds=createMovementSoundState(),audioRound=null,radioMenuIndex=null;
const worldAudio=createWorldAudio(()=>audio);
function ensureAudio(){if(!audio)audio=createGameAudio({settings:audioControls.settings});return audio;}
const audioControls=bindAudioControls(document,{getAudio:()=>audio,ensureAudio,storage:mouseStorage,getListener:()=>({position:camera.position,forward:camera.getWorldDirection(cameraDirection)})});
function resetRoundAudio(round){if(audioRound===round)return;audioRound=round;audio?.stopAll();worldAudio.reset();localMovementSounds=createMovementSoundState();}
function closeRadio(){radioMenuIndex=null;$('radioMenu').hidden=true;}
function openRadio(index){radioMenuIndex=index;const panel=$('radioChoices');panel.replaceChildren();RADIO_LABELS[index].forEach((label,i)=>{const item=document.createElement('div');item.textContent=`${i+1}. ${label}`;panel.append(item);});$('radioMenu').hidden=false;}
let inputSeq=0,pendingCommands=[],physicsAccumulator=0,correction={x:0,y:0,z:0},lastCorrection=0,lastInputPacket=0;
const socket=new GameConnection({deferStates:true});
const grenadePrediction=createGrenadePrediction({send:message=>send(message)});
function canSwitchWeapon(p,key){
  if(!p)return false;
  const owned=ownedWeapons(p,state?.bomb);
  if(key==='last')key=p.previousWeapon;
  if(typeof key==='number'||/^[1-5]$/.test(String(key))){
    const gs=GRENADE_IDS.filter(g=>p.grenades?.[g]>0);
    key=({1:p.primary||(p.shield?p.pistol:null),2:p.pistol,3:'knife',4:gs[(gs.indexOf(p.weapon)+1)%gs.length],5:owned.includes('c4')?'c4':null})[key];
  }
  return owned.includes(key)&&key!==p.weapon;
}
function send(m){if(socket.readyState===WebSocket.OPEN){if(['secondary','equip','reload','drop'].includes(m.type))m=awpView.intent(m,player(),{round:state?.round,stateTime:serverTime(),phase:state?.phase,canSwitch:m.type==='equip'&&canSwitchWeapon(player(),m.weapon)});if(m.type==='ping')networkDiagnostics.ping(m.sent);socket.send(JSON.stringify(m));networkDiagnostics.queues(socket.bufferedAmount);}}
function notify(text,seconds=3){$('notice').textContent=text;noticeUntil=performance.now()+seconds*1000;}
function clearInput(){grenadePrediction.cancel();closeRadio();keys.clear();mouseFire=false;pendingCommands=[];inputSampler.reset();physicsAccumulator=0;shotFeedback.cancel();muzzlePulse.reset();send({type:'input',input:{...blankInput(),yaw,pitch,round:lastRound,cancelThroughSeq:inputSeq}});}
function queueInputEdge(){if(locked)inputSampler.observe(input());}
function presentLocalShot(event,now=performance.now()){
  if(event.weapon!==player()?.weapon)return;
  awpView.shot(event,{stateTime:serverTime(),nowMs:now});
  crosshairFeedback.shot();muzzlePulse.trigger(now,muzzleFlashProfile(event).durationMs);if(joined&&!document.hidden)audio?.shot({...event,burstMode:event.burstMode??player()?.burstMode,shotId:event.token||event.shotId});
  recoilYaw=event.recoilYaw||0;recoilPitch=event.recoilPitch||0;
}
const shop=createShop({guns:GUNS,equipment:EQUIPMENT,economy:ECONOMY,send,onResume:resumeGame,onOpenChange(open){
  clearInput();$('board').hidden=true;sceneDirty=true;
  if(open){locked=false;document.exitPointerLock();}
  setMenuVisible(joined&&!locked&&!open);
  document.body.classList.toggle('buying',open);
}});
$('openBuyButton').onclick=()=>{if(joined&&connected)shop.setOpen(true);};
socket.onopen=()=>{connected=true;$('joinButton').disabled=false;$('joinButton').textContent=`加入局域网房间 · ${socket.transport==='webtransport'?'QUIC':'WebSocket'}`;};
socket.onerror=()=>{$('error').textContent='无法连接服务器，请检查主机与端口。';};
socket.onclose=()=>{awpView.reset();connected=false;clearInput();audio?.stopAll();worldAudio.reset();shop.setOpen(false);$('joinButton').disabled=true;$('error').textContent='连接已断开，请刷新页面重新加入。';if(joined){locked=false;document.exitPointerLock();setMenuVisible(true);}};
socket.onstatearrival=(m,event)=>networkDiagnostics.state(m,messageEncoder.encode(event.data).byteLength,event.receivedAtMs);
socket.onmessage=event=>{const m=JSON.parse(event.data);
  if(m.type==='hello')myId=m.id;
  if(m.type==='clockProbe')send({type:'clockReply',token:m.token});
  if(m.type==='joined'){joined=true;$('lobby').hidden=true;$('hud').hidden=false;setMenuVisible(true);}
  if(m.type==='error'){$('error').textContent=m.message;notify(m.message);shop.reportError(m.message);$('joinButton').disabled=false;}
  if(m.type==='buyResult'||m.type==='buy-result')shop.reportResult(m.message||(m.ok?'购买成功':'购买失败'),Boolean(m.ok));
  if(m.type==='pong'){lag=Math.round(performance.now()-m.sent);networkDiagnostics.pong(m);}
  if(m.type==='scopeAck'){awpView.confirm(m);sceneDirty=true;}
  if(m.type==='grenadeAck'){grenadePrediction.confirm(m);sceneDirty=true;}
  if(m.type==='state'){
    const receivedAt=event.receivedAtMs??performance.now();
    snapshotBuffer.push(m,receivedAt);
    state=m;stateReceivedAt=receivedAt;const me=m.players.find(p=>p.id===myId);
    if(me){
      me.ballisticsVersion=m.ballisticsVersion??0;
      if(!local||lastRound!==m.round){resetRoundAudio(m.round);shotEffects.clear();playerHitEffects.clear();worldEffects.clear();crosshairFeedback.reset();local={...me};playerCamera.reset(local);yaw=me.yaw;pitch=me.pitch;lastRound=m.round;renderY=null;sceneDirty=true;inputSeq=0;pendingCommands=[];inputSampler.reset();shotFeedback.reset();muzzlePulse.reset();physicsAccumulator=0;correction={x:0,y:0,z:0};lastWeapon=null;activeWeapon=null;flashUntil=0;flashAmount=0;}
      else if(!me.alive||!allowsPlayerActions(m.phase)||!locked){local={...me};playerCamera.reset(local);pendingCommands=[];physicsAccumulator=0;correction={x:0,y:0,z:0};}
      else {const result=reconcileMovement(me,pendingCommands,m.round,m.players);lastCorrection=Math.hypot(local.x-result.player.x,local.y-result.player.y,local.z-result.player.z);networkDiagnostics.prediction(lastCorrection,result.pending.length);correction=visualCorrection(local,result.player,correction);playerCamera.rebase(local,result.player);local=result.player;pendingCommands=result.pending;}
      if(activeWeapon!==me.weapon){if(activeWeapon&&ownedWeapons(me,m.bomb).includes(activeWeapon))lastWeapon=activeWeapon;activeWeapon=me.weapon;sceneDirty=true;}
      awpView.observe(me,{round:m.round,stateTime:m.time,protocol:m.scopeProtocol,nowMs:performance.now()});
      const confirmedShot=shotFeedback.observe(me,{round:m.round,stateTime:m.time,nowMs:performance.now()});if(confirmedShot)presentLocalShot(confirmedShot);
      grenadePrediction.observe(me,{round:m.round,stateTime:m.time,phase:m.phase});
      if(me.flashUntil!==undefined){flashUntil=Number(me.flashUntil)||0;flashAmount=clamp(Number(me.flashAmount)||0,0,1);flashFade=Number(me.flashFade)||1.4;}
      if(!me.alive){flashUntil=0;flashAmount=0;}
      const signature=JSON.stringify([me.alive,me.weapon,me.zoom,me.shieldRaised,me.reloadAt,me.armour,me.flashUntil,me.flashAmount,me.flashFade,me.grenadePhase,me.grenadeStartedAt,me.grenadeThrownAt,m.bomb]);
      if(signature!==visualSignature){sceneDirty=true;visualSignature=signature;}
    }
    if(worldEffects.sync(m)&&joined)sceneDirty=true;
    for(const p of m.players)if(p.id!==myId){
      let r=remote.get(p.id);if(!r){const actor=createPlayerActor(THREE,{onChange:()=>{sceneDirty=true;}});scene.add(actor.group);r={actor,mesh:actor.group,p,character:null};remote.set(p.id,r);}r.p=p;
      const character=selectCharacter(p.team,p.character);if(r.character!==character){r.character=character;Promise.resolve(r.actor.setCharacter(character)).then(()=>{sceneDirty=true;});}
    }
    for(const [id,r] of remote)if(!m.players.some(p=>p.id===id)){scene.remove(r.mesh);r.actor.dispose();remote.delete(id);}
    updateUI();
  }
  if(m.type==='events')for(const e of m.events){
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
    if(e.type==='explosion'){worldEffects.explode(e,serverTime());sceneDirty=true;}
    if(e.type==='shot'){
      if(joined){sceneDirty=true;shotEffects.add(e,performance.now()/1000);
        const target=remote.get(e.hitImpact?.targetId),point=playerHitEffects.add(e,performance.now()/1000,target?.rendered?target.mesh.position:target?.p);
        // Audio is routed once from authoritative sound/impact events; particles do not emit a second hit sound.
      }
      if(e.id===myId){if(shotFeedback.confirm(e,performance.now())&&e.weapon===player()?.weapon){muzzlePulse.trigger(performance.now(),muzzleFlashProfile(e).durationMs);if(joined&&!document.hidden)audio?.shot(e);}maxBurst=Math.max(maxBurst,e.burst||0);if(e.hit)hitAt=performance.now();}
      else if(joined&&local&&!document.hidden)audio?.shot(e,e.from);
    }
  }
};
function updateCharacterOptions(){const team=$('team').value,previous=$('character').value;$('character').replaceChildren();for(const preset of CHARACTER_PRESETS.filter(p=>p.team===team)){const o=document.createElement('option');o.value=preset.id;o.textContent=preset.label;$('character').append(o);}$('character').value=selectCharacter(team,previous)||DEFAULT_CHARACTER[team];}
$('team').addEventListener('change',updateCharacterOptions);updateCharacterOptions();
$('characterPreview').onclick=()=>{location.href='/characters.html?model='+encodeURIComponent($('character').value);};
$('joinForm').addEventListener('submit',e=>{e.preventDefault();$('joinButton').disabled=true;send({type:'join',name:$('name').value,team:$('team').value,character:$('character').value,grenadeProtocol:GRENADE_PROTOCOL});});
function resumeGame(){
  if(!joined){setMenuVisible(false);return;}
  if(!connected){location.reload();return;}
  shop.setOpen(false);
  audioControls.cancelTest();ensureAudio().resume();
  try{const result=canvas.requestPointerLock();result?.catch(()=>notify('无法捕获鼠标，请再次点击进入游戏'));}catch{notify('此浏览器不支持鼠标捕获，请使用桌面 Chrome / Edge');}
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
function openGameMenu(){
  locked=false;clearInput();$('board').hidden=true;sceneDirty=true;
  shop.setOpen(false);document.exitPointerLock();setMenuVisible(true);
}
$('lobbySettingsButton').addEventListener('click',openGameMenu);
$('gameMenuButton').addEventListener('click',openGameMenu);
document.addEventListener('pointerlockchange',()=>{sceneDirty=true;const frames=frameMetrics.snapshot();if(frames.samples)lastGameplayPerformance=frames;locked=document.pointerLockElement===canvas&&!shop.isOpen;if(joined)setMenuVisible(!locked&&!shop.isOpen);clearInput();frameMetrics.reset();resolution.reset();presentationWarmup.resume();});
document.addEventListener('pointerlockerror',()=>notify('鼠标捕获失败，请点击“进入游戏”重试'));
document.addEventListener('mousemove',e=>{if(locked&&!document.hidden&&$('resume').hidden){const p=player(),viewPlayer=p?.weapon==='awp'?{alive:p.alive,weapon:p.weapon,zoom:awpView.zoom(p,{stateTime:serverTime()})}:p;const factor=mouseTurnFactor(mouseSettings,scopedSettings,viewPlayer);yaw-=e.movementX*factor;pitch=clamp(pitch-e.movementY*factor,-PITCH_LIMIT,PITCH_LIMIT);}});
document.addEventListener('mousedown',e=>{if(!locked||shop.isOpen||!$('resume').hidden)return;if(e.button===0&&!mouseFire){mouseFire=true;grenadePrediction.press(player(),{round:lastRound,stateTime:serverTime(),phase:state?.phase,yaw,pitch});queueInputEdge();sceneDirty=true;}if(e.button===2){e.preventDefault();send({type:'secondary'});}});
document.addEventListener('mouseup',e=>{if(e.button===0){mouseFire=false;grenadePrediction.release({yaw,pitch});queueInputEdge();sceneDirty=true;}});
document.addEventListener('contextmenu',e=>{if(locked)e.preventDefault();});
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
  if(e.code==='KeyQ'&&!e.repeat&&lastWeapon&&ownedWeapons(player(),state?.bomb).includes(lastWeapon))send({type:'equip',weapon:lastWeapon});
  if(locked&&!e.repeat)queueInputEdge();
});
document.addEventListener('keyup',e=>{keys.delete(e.code);queueInputEdge();if(e.code==='Tab'){$('board').hidden=true;e.preventDefault();}});
window.addEventListener('blur',clearInput);document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();audio?.stopAll();audioControls.cancelTest();}else presentationWarmup.resume();});
function input(){if(!locked||shop.isOpen||!$('resume').hidden)return {...blankInput(),yaw,pitch,round:lastRound};return {round:lastRound,f:(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),s:(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0),yaw,pitch,fire:mouseFire,jump:keys.has('Space'),crouch:crouchPressed(keys),walk:keys.has('ShiftLeft')||keys.has('ShiftRight'),use:keys.has('KeyE')};}
// Physics commands are sampled exactly once per fixed prediction step; idle clients send a neutral heartbeat.
setInterval(()=>{if(joined&&connected&&!locked)send({type:'input',input:{...blankInput(),yaw,pitch,round:lastRound,cancelThroughSeq:inputSeq}});},100);
setInterval(()=>{if(connected)send({type:'ping',sent:performance.now()});},1000);
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
  bombMesh.visible=['dropped','planted'].includes(b.state);if(bombMesh.visible)bombMesh.position.set(b.x,(b.y||0)+.2,b.z);
}
const ctx=$('minimap').getContext('2d');
function minimap(){ctx.drawImage(mapRender.minimap,0,0);const c=mapRender.minimapPoint;
  ctx.font='bold 14px sans-serif';ctx.textAlign='center';ctx.fillStyle='#ff6f39';for(const s of SITES){const [x,z]=c(s.x,s.z);ctx.fillText(s.name,x,z+4);}
  if(!state)return;const me=state.players.find(p=>p.id===myId);for(const p of state.players){if(!p.alive||p.team!==me?.team)continue;const [x,z]=c(p.x,p.z);ctx.fillStyle=p.id===myId?'#fff':'#58bce9';ctx.beginPath();ctx.arc(x,z,p.id===myId?3.5:2.5,0,Math.PI*2);ctx.fill();if(p.id===myId){const target=c(p.x-Math.sin(yaw)*3,p.z-Math.cos(yaw)*3);ctx.strokeStyle='#fff';ctx.beginPath();ctx.moveTo(x,z);ctx.lineTo(...target);ctx.stroke();}}
  const b=state.bomb;if(['dropped','planted'].includes(b.state)){const [x,z]=c(b.x,b.z);ctx.fillStyle='#ff5735';ctx.fillRect(x-3,z-3,6,6);}
}
let previous=performance.now(),frameCount=0,lastMinimap=-Infinity,lastHud=-Infinity;
function frame(now){requestAnimationFrame(frame);const started=performance.now(),interval=now-previous,dt=Math.min(.05,interval/1000);previous=now;frameCount++;
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
  if(!locked&&!sceneDirty&&!(joined&&worldEffects.active(time)))return;
  scene.fog=preview?null:gameplayFog;const zoom=awpView.zoom(me,{stateTime:time,nowMs:now}),desiredFov=preview?(view==='overview'?55:75):verticalFov(zoom,camera.aspect);if(camera.fov!==desiredFov){camera.fov=desiredFov;camera.updateProjectionMatrix();}
  const scoped=Boolean(!preview&&me?.alive&&zoom<=40);
  $('scopeOverlay').hidden=!scoped;$('crosshair').hidden=scoped||!me?.alive||shop.isOpen||me?.weapon==='c4'||GUNS[me?.weapon]?.category==='sniper';
  if(local&&me){if(allowsPlayerActions(state.phase)&&me.alive&&locked){let sampledInput=false;physicsAccumulator=Math.min(.1,physicsAccumulator+dt);while(physicsAccumulator>=PREDICTION_DT&&pendingCommands.length<MAX_PENDING_COMMANDS){const sampled=inputSampler.sample(input()),command={seq:++inputSeq,round:state.round,input:sampled.input};const beforeStep={grounded:local.grounded,vx:local.vx,vy:local.vy,vz:local.vz};movePlayer(local,command.input,PREDICTION_DT,state.players);worldAudio.localMovement(movementSoundStep(localMovementSounds,{before:beforeStep,after:local,input:command.input,dt:PREDICTION_DT,surface:mapRender.groundSoundSurface(local)}));playerCamera.push(local);pendingCommands.push(command);sampledInput=true;if(sampled.critical)send({type:'inputCritical',commands:[{seq:command.seq,round:command.round,...command.input}]});const feedback=shotFeedback.sample({player:me,pose:local,input:command.input,seq:command.seq,round:state.round,time:serverTime(),stateTime:state.time,fixedStep:true,nowMs:now,allowed:true});if(feedback)presentLocalShot(feedback,now);physicsAccumulator-=PREDICTION_DT;}if((sampledInput||now-lastInputPacket>=1000/60)&&pendingCommands.length){const batch=buildInputBatch(pendingCommands,state.round,me.ackInputSeq||0);batch.viewTime=snapshotBuffer.diagnostics().playbackTimeMs/1000;batch.interpDelayMs=snapshotBuffer.diagnostics().delayMs;send(batch);lastInputPacket=now;}}
    correction=decayCorrection(correction,dt);
    renderY=playerCamera.update(local,{fractionSeconds:physicsAccumulator,correction});
    const predictedView=shotFeedback.view();
    if(usesMainWeaponRules(me)){const recoil=sampleViewRecoil(predictedView||me,physicsAccumulator);recoilYaw=recoil.recoilYaw;recoilPitch=recoil.recoilPitch;}
    else{recoilYaw+=((predictedView?.recoilYaw??me.recoilYaw??0)-recoilYaw)*Math.min(1,dt*20);recoilPitch+=((predictedView?.recoilPitch??me.recoilPitch??0)-recoilPitch)*Math.min(1,dt*20);}
    maxRecoilPitch=Math.max(maxRecoilPitch,recoilPitch);
    camera.position.set(playerCamera.position.x,renderY,playerCamera.position.z);camera.rotation.set(clamp(pitch+recoilPitch,-PITCH_LIMIT,PITCH_LIMIT),yaw+recoilYaw,0,'YXZ');
    audio?.listen(camera.position,camera.getWorldDirection(cameraDirection));
    const gap=`${crosshairFeedback.update(me,dt,innerWidth).toFixed(2)}px`;if($('crosshair').style.getPropertyValue('--gap')!==gap)$('crosshair').style.setProperty('--gap',gap);
    if(now-lastHud>=100){const speed=Math.hypot(me.vx||0,me.vz||0);text('tuning',`速度 ${speed.toFixed(1)} m/s · ${!me.grounded?'空中散布':speed>.25?'移动散布':me.burstCount?'连射扩散':'静止精度'} · 连射 ${me.burstCount||0}`);lastHud=now;}
  }else{const preset=VIEWS[preview?view:'overview'];camera.position.set(...preset.eye);camera.lookAt(...preset.target);}
  const animationStarted=performance.now();
  for(const [id,r] of remote){const pose=snapshotBuffer.sample(id,now)||r.p;r.actor.update(dt,pose);r.rendered=true;}
  const muzzleVisible=muzzlePulse.sample(now);
  if(weaponView){
    const visibleWeapon=me?.shieldRaised?'shield':me?.weapon;
    if(me&&modelWeapon!==visibleWeapon){modelWeapon=visibleWeapon;Promise.resolve(weaponView.setWeapon(visibleWeapon)).then(()=>{sceneDirty=true;presentationWarmup.enqueue(weaponView.prepare());}).catch(error=>{weaponModelError=String(error.message||error);});}
    if(me){const visual=grenadePrediction.view(shotFeedback.presentation(me),now/1000);weaponView.update(dt,visual,visual.grenadePredicted||visual.weaponLocalClock?now/1000:time);}
    const bob=Math.min(1,Math.hypot(local?.vx||0,local?.vz||0)/6.25);weaponView.group.position.set(.25,-.24+Math.abs(Math.sin(now*.007))*bob*.006,-.42);weaponView.group.rotation.x=0;
    applyWeaponHand(weaponView.group,viewmodelSettings.hand,Math.sin(now*.007)*bob*.006);
    weaponView.group.visible=Boolean(me?.alive&&!preview&&!scoped);
    if(weaponView.muzzle)weaponView.muzzle.visible=Boolean(me?.alive&&GUNS[me.weapon]&&muzzleVisible);
  }
  const animationMs=performance.now()-animationStarted;
  smokeOpacity=worldEffects.update(time,me?.alive&&!preview?camera.position:null,camera.quaternion);style('smokeOverlay','opacity',String(smokeOpacity));
  if(state){const bombTimer=state.phase==='live'&&state.bomb.state==='planted',remaining=Math.max(0,Math.ceil((bombTimer?state.bomb.endAt:state.endAt)-time));text('timer',state.phase==='waiting'?'--:--':`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`);style('timer','color',bombTimer?'rgb(255, 157, 112)':'rgb(255, 255, 255)');}
  text('network',connected?`${state?.players.length||0} / 10 人 · ${lag} ms · ${socket.transport==='webtransport'?'QUIC':'WS'}`:'已断开');
  bombLight.intensity=state?.bomb.state==='planted'?(Math.sin(now*.012)+1)*1.5:0;if(bombMesh.visible){bombLight.position.copy(bombMesh.position);bombLight.position.y+=.4;}
  if(joined&&!preview&&now-lastMinimap>=1000/30){minimap();lastMinimap=now;}
  const renderStarted=performance.now();gpuMs=gpuTimer.poll(now);gpuTimer.begin();renderer.info.autoReset=false;renderer.info.reset();camera.layers.set(0);renderer.render(scene,camera);
  if(weaponView?.group.visible){const background=scene.background;scene.background=null;renderer.autoClear=false;renderer.clearDepth();camera.layers.set(1);renderer.render(scene,camera);camera.layers.set(0);renderer.autoClear=true;scene.background=background;}
  gpuTimer.end(now);sceneDirty=false;renderedView=preview?view:null;
  if(locked&&!document.hidden){frameMetrics.add(interval,performance.now()-started,animationMs,performance.now()-renderStarted);if(resolution.sample(interval,now,gpuMs))renderer.setPixelRatio(resolution.ratio);}
}
requestAnimationFrame(frame);window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);sceneDirty=true;});
window.addEventListener('pagehide',()=>{presentationWarmup.dispose();audioControls.dispose();audio?.dispose();clearInterval(diagnosticUiTimer);longTaskObserver.dispose();gpuTimer.dispose();weaponView?.dispose();worldEffects.dispose();shotEffects.dispose();playerHitEffects.dispose();for(const r of remote.values())r.actor.dispose();renderer.dispose();},{once:true});
// Read-only diagnostic hook for automated browser smoke tests.
window.lanStrike={getState:()=>state,getId:()=>myId,getPerformance:()=>({...frameMetrics.snapshot(),quality:resolution.quality,pixelRatio:renderer.getPixelRatio(),gpuTimerSupported:gpuTimer.supported,gpuMs,autoResolution:gpuTimer.supported?'gpu-timed':'manual-only-no-gpu-timer',skinning:'gpu',drawingBuffer:{width:canvas.width,height:canvas.height}}),getRenderInfo:()=>({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,frame:renderer.info.render.frame}),getDiagnostics:()=>({presentationWarmup:presentationWarmup.diagnostics(),audio:audio?.diagnostics()||null,audioRouting:worldAudio.diagnostics(),soundSurface:mapRender.soundMaterials,transport:socket.transport,connection:socket.diagnostics(),interpolation:snapshotBuffer.diagnostics(),shotFeedback:shotFeedback.diagnostics(),awpView:awpView.diagnostics(),grenadePrediction:grenadePrediction.diagnostics(),mapVersion:MAP_VERSION,mapFaces:mapRender.faces,terrainTriangles:mapRender.triangles,mapTextures:mapRender.textures,sourceSHA256:mapRender.sourceSHA256,preview,view,renderedView,locked,visibility:document.visibilityState,frameCount,lastFrameAge:performance.now()-previous,input:input(),inputSampler:inputSampler.diagnostics(),localPosition:local?{x:local.x,y:local.y,z:local.z}:null,unackedInputs:pendingCommands.length,inputSeq,ackInputSeq:player()?.ackInputSeq,lastCorrection,visualCorrection:{...correction},impacts:shotEffects.info().decals,shotEffects:shotEffects.info(),playerHitEffects:playerHitEffects.info(),recoilYaw,recoilPitch,maxBurst,maxRecoilPitch,cameraY:camera.position.y,cameraPosition:{x:camera.position.x,y:camera.position.y,z:camera.position.z},money:player()?.money??null,character:player()?.character??null,armour:player()?.armour??0,buyMenuOpen:shop.isOpen,gameMenuOpen:!$('resume').hidden,weaponHand:viewmodelSettings.hand,mouseSensitivity:mouseSettings.value,scopedSensitivity:scopedSettings.value,weapon:player()?.weapon??null,weaponModel:{...(weaponView?.info()||{source:'unavailable',fallback:true}),...(weaponModelError?{error:weaponModelError}:{})},flashOpacity,smokeOpacity,grenadeCount:GRENADE_IDS.reduce((sum,id)=>sum+(player()?.grenades?.[id]||0),0),worldEffects:worldEffects.info(),remoteModels:[...remote].map(([id,r])=>({...r.actor.info(),playerId:id,character:r.p.character,team:r.p.team,position:r.actor.group.position.toArray()})),fov:camera.fov,lastWeapon})};
function diagnosticReport(){
  const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
  const current=window.lanStrike.getPerformance();
  const performanceReport=current.samples?current:{...current,...(lastGameplayPerformance||{})};
  return buildDiagnosticReport({network:{...networkDiagnostics.snapshot(),connection:socket.diagnostics(),interpolation:snapshotBuffer.diagnostics(),shotFeedback:shotFeedback.diagnostics()},performance:performanceReport,diagnostics:window.lanStrike.getDiagnostics(),longTaskSupported:longTaskObserver.supported,environment:{origin:location.origin,userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemoryGB:navigator.deviceMemory??null,viewport:{width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio},webglRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),visible:!document.hidden,scope:joined?'joined-client':'lobby-only'}});
}
window.lanStrike.getDiagnosticReport=diagnosticReport;
function refreshDiagnosticUI(){
  if($('resume').hidden)return;
  text('audioRuntimeStatus',audioControls.status());
  const r=networkDiagnostics.snapshot(),fmt=v=>Number.isFinite(v)?v.toFixed(1):'—';
  text('networkDiagnosticsStatus',`已采样 ${(r.durationMs/1000).toFixed(0)} 秒 · ${r.totals.receivedStates} 个状态 · ${r.totals.longTasks} 次长任务`);
  if($('networkDiagnosticsDetails').open)text('networkDiagnosticsText',[
    `应用层 RTT 中位 / P95 / 最大：${fmt(r.metrics.applicationRttMs?.median)} / ${fmt(r.metrics.applicationRttMs?.p95)} / ${fmt(r.metrics.applicationRttMs?.max)} ms`,
    `传输：${socket.transport} · 回退原因：${socket.reason||'无'} · 插值缓冲 ${fmt(snapshotBuffer.diagnostics().delayMs)} ms`,
    `到包间隔 P95 / 最大：${fmt(r.metrics.stateArrivalIntervalMs?.p95)} / ${fmt(r.metrics.stateArrivalIntervalMs?.max)} ms`,
    `前台帧间隔 P95 / 最大：${fmt(r.metrics.foregroundFrameIntervalMs?.p95)} / ${fmt(r.metrics.foregroundFrameIntervalMs?.max)} ms`,
    `服务器事件循环 P95 / 最大：${fmt(r.server?.serverLoopP95Ms)} / ${fmt(r.server?.serverLoopMaxMs)} ms`,
    `输入积压最大：${fmt(r.metrics.pendingInputs?.max)} · 位置纠正最大：${fmt(r.metrics.positionCorrectionUnits?.max)}`,
    r.server?.diagnosticsVersion?'服务端诊断已连接':'服务端完整诊断尚未收到；刷新或检查服务版本',
    'RTT 包含浏览器 / 服务器等待，不是纯网络延迟。',
  ].join('\n'));
}
$('networkDiagnosticsDetails').addEventListener('toggle',refreshDiagnosticUI);
$('resetDiagnosticsButton').addEventListener('click',()=>{networkDiagnostics.reset();lastGameplayPerformance=null;refreshDiagnosticUI();});
$('exportDiagnosticsButton').addEventListener('click',()=>{
  const report=diagnosticReport(),url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='lan-strike-diagnostics-'+report.exportedUTC.replace(/[:.]/g,'-')+'.json';link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('network').title='应用层往返耗时，含浏览器与服务端调度。排查卡顿请按 Esc 导出诊断 JSON。';
const diagnosticUiTimer=setInterval(refreshDiagnosticUI,1000);refreshDiagnosticUI();
