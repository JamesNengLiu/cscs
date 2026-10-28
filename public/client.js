import * as THREE from '/vendor/three.module.js';
import {loadOriginalMap} from './map-render.js';
import {PREDICTION_DT,MAX_PENDING_COMMANDS,reconcileMovement,visualCorrection,decayCorrection} from './prediction.js';
import {RULES,WEAPONS,SITES,VIEWS,MAP_VERSION,MAP_BOUNDS,groundHeight,movePlayer,eyeHeight,blankInput,siteAt,clamp} from './shared.js';
import {GUNS,EQUIPMENT} from './arsenal.js';
import {allowsPlayerActions} from './round-state.js';
import {ECONOMY} from './economy.js';
import {createShop,ownedWeapons,GRENADE_IDS} from './shop.js';
import {createWorldEffects,flashOpacity as calculateFlashOpacity} from './effects.js';
import {createPlayerActor} from './player-model.js';
import {CHARACTER_PRESETS,DEFAULT_CHARACTER,selectCharacter} from './characters-config.js';
import {createFrameMetrics,createResolutionController,interpolateRemote} from './performance.js';
import {createGpuTimer} from './gpu-timer.js';
import {SCOPED_SENSITIVITY,createMouseSettings,bindMouseSettings,mouseTurnFactor} from './mouse-settings.js';
const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,document.getElementById(id));return nodes.get(id);},canvas=$('game');
const text=(id,value)=>{const node=$(id),next=String(value);if(node.textContent!==next)node.textContent=next;};
const style=(id,key,value)=>{const node=$(id);if(node.style[key]!==value)node.style[key]=value;};
let mouseStorage;try{mouseStorage=localStorage;}catch{}
const mouseSettings=createMouseSettings(mouseStorage),scopedSettings=createMouseSettings(mouseStorage,SCOPED_SENSITIVITY);bindMouseSettings(document,mouseSettings,scopedSettings);
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
const frameMetrics=createFrameMetrics(),resolution=createResolutionController(devicePixelRatio);
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
try{const {createWeaponView}=await import('./weapon-model.js');weaponView=await createWeaponView(THREE,camera);}
catch(error){weaponModelError=String(error.message||error);}
const worldEffects=createWorldEffects(THREE,scene);
const remote=new Map(),effects=[],impacts=[];

let state=null,myId=null,joined=false,connected=false,locked=false,yaw=0,pitch=0,local=null,lastRound=-1,shotKick=0,hitAt=0,damageAt=0,noticeUntil=0,lag=0,recoilYaw=0,recoilPitch=0,preview=false,view='overview',renderY=null,sceneDirty=true,renderedView=null;
let stateReceivedAt=performance.now(),lastWeapon=null,activeWeapon=null,wheelAt=0,flashUntil=0,flashAmount=0,flashOpacity=0,smokeOpacity=0,visualSignature='';
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
const keys=new Set();let mouseFire=false,audio=null,maxBurst=0,maxRecoilPitch=0;
let inputSeq=0,pendingCommands=[],physicsAccumulator=0,correction={x:0,y:0,z:0},lastCorrection=0;
const socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}`);
function send(m){if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(m));}
function notify(text,seconds=3){$('notice').textContent=text;noticeUntil=performance.now()+seconds*1000;}
function sound(freq=120,duration=.05,volume=.025){if(!audio)return;const osc=audio.createOscillator(),gain=audio.createGain();osc.type='sawtooth';osc.frequency.setValueAtTime(freq,audio.currentTime);osc.frequency.exponentialRampToValueAtTime(Math.max(30,freq/3),audio.currentTime+duration);gain.gain.setValueAtTime(volume,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);osc.connect(gain);gain.connect(audio.destination);osc.start();osc.stop(audio.currentTime+duration);}
function clearInput(){keys.clear();mouseFire=false;pendingCommands=[];physicsAccumulator=0;send({type:'input',input:{...blankInput(),yaw,pitch,round:lastRound}});}
const shop=createShop({guns:GUNS,equipment:EQUIPMENT,economy:ECONOMY,send,onResume:resumeGame,onOpenChange(open){
  clearInput();$('board').hidden=true;sceneDirty=true;
  if(open){locked=false;document.exitPointerLock();}
  setMenuVisible(joined&&!locked&&!open);
  document.body.classList.toggle('buying',open);
}});
$('openBuyButton').onclick=()=>{if(joined&&connected)shop.setOpen(true);};
socket.onopen=()=>{connected=true;$('joinButton').disabled=false;$('joinButton').textContent='加入局域网房间';};
socket.onerror=()=>{$('error').textContent='无法连接服务器，请检查主机与端口。';};
socket.onclose=()=>{connected=false;clearInput();shop.setOpen(false);$('joinButton').disabled=true;$('error').textContent='连接已断开，请刷新页面重新加入。';if(joined){locked=false;document.exitPointerLock();setMenuVisible(true);}};
socket.onmessage=event=>{const m=JSON.parse(event.data);
  if(m.type==='hello')myId=m.id;
  if(m.type==='joined'){joined=true;$('lobby').hidden=true;$('hud').hidden=false;setMenuVisible(true);}
  if(m.type==='error'){$('error').textContent=m.message;notify(m.message);shop.reportError(m.message);$('joinButton').disabled=false;}
  if(m.type==='buyResult'||m.type==='buy-result')shop.reportResult(m.message||(m.ok?'购买成功':'购买失败'),Boolean(m.ok));
  if(m.type==='pong')lag=Math.round(performance.now()-m.sent);
  if(m.type==='state'){
    state=m;stateReceivedAt=performance.now();const me=m.players.find(p=>p.id===myId);
    if(me){
      if(!local||lastRound!==m.round){local={...me};yaw=me.yaw;pitch=me.pitch;lastRound=m.round;renderY=null;sceneDirty=true;inputSeq=0;pendingCommands=[];physicsAccumulator=0;correction={x:0,y:0,z:0};lastWeapon=null;activeWeapon=null;flashUntil=0;flashAmount=0;}
      else if(!me.alive||!allowsPlayerActions(m.phase)||!locked){local={...me};pendingCommands=[];physicsAccumulator=0;correction={x:0,y:0,z:0};}
      else {const result=reconcileMovement(me,pendingCommands,m.round);lastCorrection=Math.hypot(local.x-result.player.x,local.y-result.player.y,local.z-result.player.z);correction=visualCorrection(local,result.player,correction);local=result.player;pendingCommands=result.pending;}
      if(activeWeapon!==me.weapon){if(activeWeapon&&ownedWeapons(me,m.bomb).includes(activeWeapon))lastWeapon=activeWeapon;activeWeapon=me.weapon;sceneDirty=true;}
      if(me.flashUntil!==undefined){flashUntil=Number(me.flashUntil)||0;flashAmount=clamp(Number(me.flashAmount)||0,0,1);}
      if(!me.alive){flashUntil=0;flashAmount=0;}
      const signature=JSON.stringify([me.alive,me.weapon,me.zoom,me.shieldRaised,me.reloadAt,me.armour,me.flashUntil,me.flashAmount,m.bomb]);
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
    if(e.type==='round')notify(`第 ${e.round} 回合 · B 打开购买菜单`);
    if(e.type==='buy'&&(e.id===myId||e.target===myId))shop.reportResult(e.message||`已购买 ${weaponName(e.item)}`,e.ok!==false);
    if(e.type==='flash'&&(e.target??e.id)===myId&&player()?.alive){
      flashUntil=Number(e.flashUntil??e.until)||((Number(e.time)||serverTime())+(Number(e.duration)||3));
      flashAmount=clamp(Number(e.flashAmount??e.amount??1),0,1);sceneDirty=true;
    }
    if(e.type==='kill'){const div=document.createElement('div');div.textContent=`${e.attacker} → ${e.victim}`;$('feed').prepend(div);setTimeout(()=>div.remove(),5500);}
    if(e.type==='damage'&&e.id===myId){damageAt=performance.now();sound(65,.1,.025);}
    if(e.type==='shot'){
      if(joined)sceneDirty=true;
      const geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(e.from.x,e.from.y,e.from.z),new THREE.Vector3(e.to.x,e.to.y,e.to.z)]);
      const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:'#ffe2a0',transparent:true,opacity:.6}));scene.add(line);effects.push({object:line,until:performance.now()+65});
      if(effects.length>64){const old=effects.shift().object;scene.remove(old);old.geometry.dispose();old.material.dispose();}
      if(e.id===myId){shotKick=1;recoilYaw=e.recoilYaw||0;recoilPitch=e.recoilPitch||0;maxBurst=Math.max(maxBurst,e.burst||0);if(e.hit)hitAt=performance.now();sound(130,.07,.035);}
      else if(local){const dist=Math.hypot(local.x-e.from.x,local.z-e.from.z);if(dist<35)sound(105,.05,.018*(1-dist/35));}
      if(!e.hit){const dot=new THREE.Mesh(new THREE.SphereGeometry(.035,5,4),new THREE.MeshBasicMaterial({color:'#44372b'}));dot.position.set(e.to.x,e.to.y,e.to.z);scene.add(dot);impacts.push(dot);if(impacts.length>64){const old=impacts.shift();scene.remove(old);old.geometry.dispose();old.material.dispose();}}
    }
  }
};
function updateCharacterOptions(){const team=$('team').value,previous=$('character').value;$('character').replaceChildren();for(const preset of CHARACTER_PRESETS.filter(p=>p.team===team)){const o=document.createElement('option');o.value=preset.id;o.textContent=preset.label;$('character').append(o);}$('character').value=selectCharacter(team,previous)||DEFAULT_CHARACTER[team];}
$('team').addEventListener('change',updateCharacterOptions);updateCharacterOptions();
$('characterPreview').onclick=()=>{location.href='/characters.html?model='+encodeURIComponent($('character').value);};
$('joinForm').addEventListener('submit',e=>{e.preventDefault();$('joinButton').disabled=true;send({type:'join',name:$('name').value,team:$('team').value,character:$('character').value});});
function resumeGame(){
  if(!joined){setMenuVisible(false);return;}
  if(!connected){location.reload();return;}
  shop.setOpen(false);
  if(!audio){audio=new (window.AudioContext||window.webkitAudioContext)();}audio.resume();
  try{const result=canvas.requestPointerLock();result?.catch(()=>notify('无法捕获鼠标，请再次点击进入游戏'));}catch{notify('此浏览器不支持鼠标捕获，请使用桌面 Chrome / Edge');}
}
$('resumeButton').addEventListener('click',resumeGame);
function setMenuVisible(visible){
  const wasVisible=!$('resume').hidden;
  $('resume').hidden=!visible;document.body.classList.toggle('menu-open',visible);
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
document.addEventListener('pointerlockchange',()=>{sceneDirty=true;locked=document.pointerLockElement===canvas&&!shop.isOpen;if(joined)setMenuVisible(!locked&&!shop.isOpen);clearInput();frameMetrics.reset();resolution.reset();});
document.addEventListener('pointerlockerror',()=>notify('鼠标捕获失败，请点击“进入游戏”重试'));
document.addEventListener('mousemove',e=>{if(locked&&!document.hidden&&$('resume').hidden){const factor=mouseTurnFactor(mouseSettings,scopedSettings,player());yaw-=e.movementX*factor;pitch=clamp(pitch-e.movementY*factor,-1.45,1.45);}});
document.addEventListener('mousedown',e=>{if(!locked||shop.isOpen)return;if(e.button===0){mouseFire=true;send({type:'input',input:input()});}if(e.button===2){e.preventDefault();send({type:'secondary'});}});
document.addEventListener('mouseup',e=>{if(e.button===0){mouseFire=false;if(locked)send({type:'input',input:input()});}});
document.addEventListener('contextmenu',e=>{if(locked)e.preventDefault();});
document.addEventListener('wheel',e=>{if(!locked||shop.isOpen)return;e.preventDefault();if(!e.deltaY||performance.now()-wheelAt<150)return;wheelAt=performance.now();
  const p=player(),owned=ownedWeapons(p,state?.bomb);if(!p?.alive||owned.length<2)return;
  const index=owned.indexOf(p.weapon),next=(index+(e.deltaY>0?1:-1)+owned.length)%owned.length;send({type:'equip',weapon:owned[next]});
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
  if(e.code==='Escape'){e.preventDefault();openGameMenu();return;}
  if(!locked)return;
  if(['Tab','Space','KeyW','KeyA','KeyS','KeyD'].includes(e.code))e.preventDefault();keys.add(e.code);
  if(e.code==='Tab'){$('board').hidden=false;updateBoard();}
  if(e.code==='KeyR'&&!e.repeat)send({type:'reload'});
  const weapon={Digit1:1,Digit2:2,Digit3:3,Digit4:4,Digit5:5}[e.code];if(weapon&&!e.repeat)send({type:'equip',weapon});
  if(e.code==='KeyG'&&!e.repeat)send({type:'drop'});
  if(e.code==='KeyN'&&!e.repeat)send({type:'nightvision'});
  if(e.code==='KeyQ'&&!e.repeat&&lastWeapon&&ownedWeapons(player(),state?.bomb).includes(lastWeapon))send({type:'equip',weapon:lastWeapon});
  if(locked&&!e.repeat)send({type:'input',input:input()});
});
document.addEventListener('keyup',e=>{keys.delete(e.code);if(locked)send({type:'input',input:input()});if(e.code==='Tab'){$('board').hidden=true;e.preventDefault();}});
window.addEventListener('blur',clearInput);document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInput();});
function input(){if(!locked||shop.isOpen||!$('resume').hidden)return {...blankInput(),yaw,pitch,round:lastRound};return {round:lastRound,f:(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),s:(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0),yaw,pitch,fire:mouseFire,jump:keys.has('Space'),crouch:keys.has('KeyC'),walk:keys.has('ShiftLeft')||keys.has('ShiftRight'),use:keys.has('KeyE')};}
// Physics commands are sampled exactly once per fixed prediction step; idle clients send a neutral heartbeat.
setInterval(()=>{if(joined&&connected&&!locked)send({type:'input',input:{...blankInput(),yaw,pitch,round:lastRound}});},100);
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
  if(state.phase==='waiting')hint='双方各至少一人才能开始';
  else if(state.phase==='countdown')hint='准备阶段 · B 购买武器与装备 · 自定义开局 $10,000';
  else if(!p.alive)hint='本回合已阵亡，等待下一回合';
  else if(state.phase==='ended')hint='回合结束 · 可继续移动和开火，倒计时后开始下一回合';
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
  const me=player(),time=serverTime();
  const opacity=me?.alive?calculateFlashOpacity(flashUntil,flashAmount,time):0;
  if(opacity!==flashOpacity){flashOpacity=opacity;$('flashOverlay').style.opacity=String(flashOpacity);}
  style('hitmarker','opacity',now-hitAt<120?'1':'0');style('damageFlash','opacity',now-damageAt<160?'0.65':'0');
  if(now>noticeUntil&&$('notice').textContent)$('notice').textContent='';
  // Static lobby/inspection views render on demand; inactive clients should not compete with the active GPU view.
  if(!locked&&!sceneDirty&&!(joined&&(effects.length||worldEffects.active(time))))return;
  scene.fog=preview?null:gameplayFog;const desiredFov=preview?(view==='overview'?55:75):me?clamp(Number(me.zoom)||90,10,90):80;if(camera.fov!==desiredFov){camera.fov=desiredFov;camera.updateProjectionMatrix();}
  const scoped=Boolean(!preview&&me?.alive&&desiredFov<=40);
  $('scopeOverlay').hidden=!scoped;$('crosshair').hidden=scoped||!me?.alive||shop.isOpen||['knife','c4'].includes(me?.weapon);
  if(local&&me){if(allowsPlayerActions(state.phase)&&me.alive&&locked){physicsAccumulator=Math.min(.1,physicsAccumulator+dt);while(physicsAccumulator>=PREDICTION_DT&&pendingCommands.length<MAX_PENDING_COMMANDS){const command={seq:++inputSeq,round:state.round,input:input()};movePlayer(local,command.input,PREDICTION_DT);pendingCommands.push(command);send({type:'input',input:{...command.input,seq:command.seq,round:command.round}});physicsAccumulator-=PREDICTION_DT;}}
    correction=decayCorrection(correction,dt);
    const targetY=local.y+eyeHeight(local)+correction.y;renderY=renderY===null?targetY:renderY+(targetY-renderY)*Math.min(1,dt*22);
    recoilYaw+=((me.recoilYaw||0)-recoilYaw)*Math.min(1,dt*20);recoilPitch+=((me.recoilPitch||0)-recoilPitch)*Math.min(1,dt*20);
    maxRecoilPitch=Math.max(maxRecoilPitch,recoilPitch);
    camera.position.set(local.x+correction.x,renderY,local.z+correction.z);camera.rotation.set(clamp(pitch+recoilPitch,-1.5,1.5),yaw+recoilYaw,0,'YXZ');
    const gap=`${(6+Math.min(24,(me.spread||0)*550)).toFixed(2)}px`;if($('crosshair').style.getPropertyValue('--gap')!==gap)$('crosshair').style.setProperty('--gap',gap);
    if(now-lastHud>=100){const speed=Math.hypot(me.vx||0,me.vz||0);text('tuning',`速度 ${speed.toFixed(1)} m/s · ${!me.grounded?'空中散布':speed>.25?'移动散布':me.burstCount?'连射扩散':'静止精度'} · 连射 ${me.burstCount||0}`);lastHud=now;}
  }else{const preset=VIEWS[preview?view:'overview'];camera.position.set(...preset.eye);camera.lookAt(...preset.target);}
  const animationStarted=performance.now();
  for(const r of remote.values()){const p=r.p;r.display??={x:p.x,y:p.y,z:p.z};interpolateRemote(r.display,p,dt);r.renderState??={};Object.assign(r.renderState,p,r.display);r.actor.update(dt,r.renderState);}
  shotKick=Math.max(0,shotKick-dt*8);
  if(weaponView){
    const visibleWeapon=me?.shieldRaised?'shield':me?.weapon;
    if(me&&modelWeapon!==visibleWeapon){modelWeapon=visibleWeapon;Promise.resolve(weaponView.setWeapon(visibleWeapon)).then(()=>{sceneDirty=true;}).catch(error=>{weaponModelError=String(error.message||error);});}
    if(me)weaponView.update(dt,me);
    weaponView.group.position.set(.25+Math.sin(now*.007)*(me?.moving?.006:0),-.24-shotKick*.015,-.42+shotKick*.045);weaponView.group.rotation.x=shotKick*.07;
    weaponView.group.visible=Boolean(me?.alive&&!preview&&!scoped);
    if(weaponView.muzzle)weaponView.muzzle.visible=Boolean(me?.alive&&GUNS[me.weapon]&&shotKick>.75);
  }
  const animationMs=performance.now()-animationStarted;
  smokeOpacity=worldEffects.update(time,me?.alive&&!preview?camera.position:null);style('smokeOverlay','opacity',String(smokeOpacity));
  for(let i=effects.length-1;i>=0;i--)if(now>effects[i].until){const o=effects[i].object;scene.remove(o);o.geometry.dispose();o.material.dispose();effects.splice(i,1);}
  if(state){const bombTimer=state.phase==='live'&&state.bomb.state==='planted',remaining=Math.max(0,Math.ceil((bombTimer?state.bomb.endAt:state.endAt)-time));text('timer',state.phase==='waiting'?'--:--':`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`);style('timer','color',bombTimer?'rgb(255, 157, 112)':'rgb(255, 255, 255)');}
  text('network',connected?`${state?.players.length||0} / 10 人 · ${lag} ms`:'已断开');
  bombLight.intensity=state?.bomb.state==='planted'?(Math.sin(now*.012)+1)*1.5:0;if(bombMesh.visible){bombLight.position.copy(bombMesh.position);bombLight.position.y+=.4;}
  if(joined&&!preview&&now-lastMinimap>=1000/30){minimap();lastMinimap=now;}
  const renderStarted=performance.now();gpuMs=gpuTimer.poll(now);gpuTimer.begin();renderer.info.autoReset=false;renderer.info.reset();camera.layers.set(0);renderer.render(scene,camera);
  if(weaponView?.group.visible){const background=scene.background;scene.background=null;renderer.autoClear=false;renderer.clearDepth();camera.layers.set(1);renderer.render(scene,camera);camera.layers.set(0);renderer.autoClear=true;scene.background=background;}
  gpuTimer.end(now);sceneDirty=false;renderedView=preview?view:null;
  if(locked&&!document.hidden){frameMetrics.add(interval,performance.now()-started,animationMs,performance.now()-renderStarted);if(resolution.sample(interval,now,gpuMs))renderer.setPixelRatio(resolution.ratio);}
}
requestAnimationFrame(frame);window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);sceneDirty=true;});
window.addEventListener('pagehide',()=>{gpuTimer.dispose();weaponView?.dispose();for(const r of remote.values())r.actor.dispose();renderer.dispose();},{once:true});
// Read-only diagnostic hook for automated browser smoke tests.
window.lanStrike={getState:()=>state,getId:()=>myId,getPerformance:()=>({...frameMetrics.snapshot(),quality:resolution.quality,pixelRatio:renderer.getPixelRatio(),gpuTimerSupported:gpuTimer.supported,gpuMs,autoResolution:gpuTimer.supported?'gpu-timed':'manual-only-no-gpu-timer',skinning:'gpu',drawingBuffer:{width:canvas.width,height:canvas.height}}),getRenderInfo:()=>({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,frame:renderer.info.render.frame}),getDiagnostics:()=>({mapVersion:MAP_VERSION,mapFaces:mapRender.faces,terrainTriangles:mapRender.triangles,mapTextures:mapRender.textures,sourceSHA256:mapRender.sourceSHA256,preview,view,renderedView,locked,visibility:document.visibilityState,frameCount,lastFrameAge:performance.now()-previous,input:input(),localPosition:local?{x:local.x,y:local.y,z:local.z}:null,unackedInputs:pendingCommands.length,inputSeq,ackInputSeq:player()?.ackInputSeq,lastCorrection,visualCorrection:{...correction},impacts:impacts.length,recoilYaw,recoilPitch,maxBurst,maxRecoilPitch,cameraY:camera.position.y,money:player()?.money??null,character:player()?.character??null,armour:player()?.armour??0,buyMenuOpen:shop.isOpen,gameMenuOpen:!$('resume').hidden,mouseSensitivity:mouseSettings.value,scopedSensitivity:scopedSettings.value,weapon:player()?.weapon??null,weaponModel:{...(weaponView?.info()||{source:'unavailable',fallback:true}),...(weaponModelError?{error:weaponModelError}:{})},flashOpacity,smokeOpacity,grenadeCount:GRENADE_IDS.reduce((sum,id)=>sum+(player()?.grenades?.[id]||0),0),worldEffects:worldEffects.info(),remoteModels:[...remote].map(([id,r])=>({...r.actor.info(),playerId:id,character:r.p.character,team:r.p.team,position:r.actor.group.position.toArray()})),fov:camera.fov,lastWeapon})};
