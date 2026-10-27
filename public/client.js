import * as THREE from '/vendor/three.module.js';
import {loadOriginalMap} from './map-render.js';
import {PREDICTION_DT,MAX_PENDING_COMMANDS,reconcileMovement,visualCorrection,decayCorrection} from './prediction.js';
import {RULES,WEAPONS,SITES,VIEWS,MAP_VERSION,MAP_BOUNDS,groundHeight,movePlayer,eyeHeight,blankInput,siteAt,clamp} from './shared.js';
const $=id=>document.getElementById(id),canvas=$('game');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));renderer.setSize(innerWidth,innerHeight);
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
const gun=new THREE.Group();camera.add(gun);gun.position.set(.25,-.24,-.42);
const metal=new THREE.MeshLambertMaterial({color:'#45535e',depthTest:false}),wood=new THREE.MeshLambertMaterial({color:'#694632',depthTest:false});
box(0,0,0,.095,.11,.35,metal,gun);box(0,-.07,.08,.06,.12,.07,wood,gun);box(0,-.09,-.05,.06,.13,.09,metal,gun);box(0,0,-.25,.055,.06,.32,metal,gun);box(0,.07,-.08,.025,.025,.28,metal,gun);
gun.traverse(o=>{if(o.isMesh){o.renderOrder=100;o.castShadow=false;o.receiveShadow=false;}});
const muzzle=new THREE.Mesh(new THREE.SphereGeometry(.045,6,4),new THREE.MeshBasicMaterial({color:'#ffca69',depthTest:false}));muzzle.position.set(0,0,-.43);muzzle.visible=false;muzzle.renderOrder=110;gun.add(muzzle);
const remote=new Map(),effects=[],impacts=[];
function playerMesh(p){const g=new THREE.Group(),mat=new THREE.MeshStandardMaterial({color:p.team==='T'?'#a77e4d':'#477b9b',roughness:.9}),dark=new THREE.MeshStandardMaterial({color:'#26313c',roughness:.9});
  box(0,1.02,0,.48,.65,.3,mat,g);box(-.14,.35,0,.17,.7,.21,dark,g);box(.14,.35,0,.17,.7,.21,dark,g);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.21,12,10),new THREE.MeshStandardMaterial({color:p.team==='T'?'#d1ad82':'#5a7584',roughness:1}));head.position.y=1.56;head.castShadow=true;g.add(head);
  box(.28,1.14,-.22,.1,.12,.53,dark,g);scene.add(g);return g;
}
let state=null,myId=null,joined=false,connected=false,locked=false,yaw=0,pitch=0,local=null,lastRound=-1,shotKick=0,hitAt=0,damageAt=0,noticeUntil=0,lag=0,recoilYaw=0,recoilPitch=0,preview=false,view='overview',renderY=null,sceneDirty=true,renderedView=null;
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
socket.onopen=()=>{connected=true;$('joinButton').disabled=false;$('joinButton').textContent='加入局域网房间';};
socket.onerror=()=>{$('error').textContent='无法连接服务器，请检查主机与端口。';};
socket.onclose=()=>{connected=false;clearInput();$('joinButton').disabled=true;$('error').textContent='连接已断开，请刷新页面重新加入。';if(joined){document.exitPointerLock();$('resume').hidden=false;$('resumeTitle').textContent='服务器连接已断开';$('resumeButton').textContent='刷新并重新连接';}};
socket.onmessage=event=>{const m=JSON.parse(event.data);
  if(m.type==='hello')myId=m.id;
  if(m.type==='joined'){joined=true;$('lobby').hidden=true;$('hud').hidden=false;$('resume').hidden=false;}
  if(m.type==='error'){$('error').textContent=m.message;notify(m.message);$('joinButton').disabled=false;}
  if(m.type==='pong')lag=Math.round(performance.now()-m.sent);
  if(m.type==='state'){
    state=m;const me=m.players.find(p=>p.id===myId);
    if(me){
      if(!local||lastRound!==m.round){local={...me};yaw=me.yaw;pitch=me.pitch;lastRound=m.round;renderY=null;sceneDirty=true;inputSeq=0;pendingCommands=[];physicsAccumulator=0;correction={x:0,y:0,z:0};}
      else if(!me.alive||m.phase!=='live'||!locked){local={...me};pendingCommands=[];physicsAccumulator=0;correction={x:0,y:0,z:0};}
      else {const result=reconcileMovement(me,pendingCommands,m.round);lastCorrection=Math.hypot(local.x-result.player.x,local.y-result.player.y,local.z-result.player.z);correction=visualCorrection(local,result.player,correction);local=result.player;pendingCommands=result.pending;}
    }
    for(const p of m.players)if(p.id!==myId){if(!remote.has(p.id))remote.set(p.id,{mesh:playerMesh(p),p});else remote.get(p.id).p=p;}
    for(const [id,r] of remote)if(!m.players.some(p=>p.id===id)){scene.remove(r.mesh);r.mesh.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});remote.delete(id);}
    updateUI();
  }
  if(m.type==='events')for(const e of m.events){
    if(e.type==='notice')notify(e.text);
    if(e.type==='round')notify(`第 ${e.round} 回合 · 准备阶段选武器`);
    if(e.type==='kill'){const div=document.createElement('div');div.textContent=`${e.attacker} → ${e.victim}`;$('feed').prepend(div);setTimeout(()=>div.remove(),5500);}
    if(e.type==='damage'&&e.id===myId){damageAt=performance.now();sound(65,.1,.025);}
    if(e.type==='shot'){
      const geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(e.from.x,e.from.y,e.from.z),new THREE.Vector3(e.to.x,e.to.y,e.to.z)]);
      const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:'#ffe2a0',transparent:true,opacity:.6}));scene.add(line);effects.push({object:line,until:performance.now()+65});
      if(e.id===myId){shotKick=1;recoilYaw=e.recoilYaw||0;recoilPitch=e.recoilPitch||0;maxBurst=Math.max(maxBurst,e.burst||0);if(e.hit)hitAt=performance.now();sound(130,.07,.035);}
      else if(local){const dist=Math.hypot(local.x-e.from.x,local.z-e.from.z);if(dist<35)sound(105,.05,.018*(1-dist/35));}
      if(!e.hit){const dot=new THREE.Mesh(new THREE.SphereGeometry(.035,5,4),new THREE.MeshBasicMaterial({color:'#44372b'}));dot.position.set(e.to.x,e.to.y,e.to.z);scene.add(dot);impacts.push(dot);if(impacts.length>64){const old=impacts.shift();scene.remove(old);old.geometry.dispose();old.material.dispose();}}
    }
  }
};
$('joinForm').addEventListener('submit',e=>{e.preventDefault();$('joinButton').disabled=true;send({type:'join',name:$('name').value,team:$('team').value});});
$('resumeButton').addEventListener('click',()=>{
  if(!connected){location.reload();return;}
  if(!audio){audio=new (window.AudioContext||window.webkitAudioContext)();}audio.resume();
  try{const result=canvas.requestPointerLock();result?.catch(()=>notify('无法捕获鼠标，请再次点击进入游戏'));}catch{notify('此浏览器不支持鼠标捕获，请使用桌面 Chrome / Edge');}
});
document.addEventListener('pointerlockchange',()=>{sceneDirty=true;locked=document.pointerLockElement===canvas;if(joined)$('resume').hidden=locked;clearInput();});
document.addEventListener('pointerlockerror',()=>notify('鼠标捕获失败，请点击“进入游戏”重试'));
document.addEventListener('mousemove',e=>{if(locked){yaw-=e.movementX*.002;pitch=clamp(pitch-e.movementY*.002,-1.45,1.45);}});
document.addEventListener('mousedown',e=>{if(locked&&e.button===0){mouseFire=true;send({type:'input',input:input()});}});
document.addEventListener('mouseup',e=>{if(e.button===0){mouseFire=false;if(locked)send({type:'input',input:input()});}});
document.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('keydown',e=>{
  if(!joined||(!locked&&e.code!=='Tab'))return;
  if(e.code==='Escape'){document.exitPointerLock();clearInput();return;}
  if(['Tab','Space','KeyW','KeyA','KeyS','KeyD'].includes(e.code))e.preventDefault();keys.add(e.code);
  if(e.code==='Tab')$('board').hidden=false;
  if(e.code==='KeyR'&&!e.repeat)send({type:'reload'});
  const weapon={Digit1:'rifle',Digit2:'sniper',Digit3:'pistol'}[e.code];if(weapon&&!e.repeat)send({type:'equip',weapon});
  if(locked&&!e.repeat)send({type:'input',input:input()});
});
document.addEventListener('keyup',e=>{keys.delete(e.code);if(locked)send({type:'input',input:input()});if(e.code==='Tab'){$('board').hidden=true;e.preventDefault();}});
window.addEventListener('blur',clearInput);document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInput();});
function input(){return {round:lastRound,f:(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),s:(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0),yaw,pitch,fire:mouseFire,jump:keys.has('Space'),crouch:keys.has('KeyC'),walk:keys.has('ShiftLeft')||keys.has('ShiftRight'),use:keys.has('KeyE')};}
// Physics commands are sampled exactly once per fixed prediction step; idle clients send a neutral heartbeat.
setInterval(()=>{if(joined&&connected&&!locked)send({type:'input',input:{...blankInput(),yaw,pitch,round:lastRound}});},100);
setInterval(()=>{if(connected)send({type:'ping',sent:performance.now()});},1000);
function updateUI(){if(!state)return;const p=state.players.find(p=>p.id===myId);if(!p)return;
  $('score').textContent=`T ${state.score.T} : ${state.score.CT} CT`;
  $('phase').textContent=state.message;$('identity').textContent=`${p.team} / ${p.name}${p.alive?'':' · 等待下一回合'}`;$('health').innerHTML=`${p.hp} <span>HP</span>`;
  $('weapon').textContent=WEAPONS[p.weapon].name+(p.reloadAt?' · 换弹中':'');$('ammo').innerHTML=`${p.ammo} <span>/ ${p.reserve}</span>`;
  const b=state.bomb;let hint='WASD 移动 · R 换弹 · Tab 战绩';
  if(state.phase==='waiting')hint='双方各至少一人才能开始';
  else if(state.phase==='countdown')hint='1 突击步枪 · 2 狙击步枪 · 3 手枪（原型免费选枪）';
  else if(!p.alive)hint='本回合已阵亡，等待下一回合';
  else if(b.state==='carried'&&b.holder===p.id)hint=siteAt(p)?'在爆破区内，静止并按住 E 安放炸弹':'你携带炸弹，前往 A / B 点';
  else if(b.state==='dropped'&&p.team==='T')hint='炸弹已掉落，靠近并按 E 拾取';
  else if(b.state==='planted')hint=p.team==='CT'?'炸弹已安放，靠近并静止按住 E 拆除':'炸弹已安放，阻止对方拆除';
  $('hint').textContent=hint;$('actionText').textContent=p.action==='plant'?'正在安放炸弹':p.action==='defuse'?'正在拆除炸弹':'';
  $('progress').style.display=p.action?'block':'none';$('progress').value=p.progress/(p.action==='plant'?RULES.plantSeconds:RULES.defuseSeconds);
  $('boardBody').replaceChildren();for(const q of [...state.players].sort((a,b)=>a.team.localeCompare(b.team)||b.kills-a.kills)){const row=document.createElement('tr');for(const v of [q.team,q.name,q.alive?'存活':'等待',q.kills,q.deaths]){const td=document.createElement('td');td.textContent=String(v);row.append(td);}$('boardBody').append(row);}
  bombMesh.visible=['dropped','planted'].includes(b.state);if(bombMesh.visible)bombMesh.position.set(b.x,(b.y||0)+.2,b.z);
}
const ctx=$('minimap').getContext('2d');
function minimap(){ctx.drawImage(mapRender.minimap,0,0);const c=mapRender.minimapPoint;
  ctx.font='bold 14px sans-serif';ctx.textAlign='center';ctx.fillStyle='#ff6f39';for(const s of SITES){const [x,z]=c(s.x,s.z);ctx.fillText(s.name,x,z+4);}
  if(!state)return;const me=state.players.find(p=>p.id===myId);for(const p of state.players){if(!p.alive||p.team!==me?.team)continue;const [x,z]=c(p.x,p.z);ctx.fillStyle=p.id===myId?'#fff':'#58bce9';ctx.beginPath();ctx.arc(x,z,p.id===myId?3.5:2.5,0,Math.PI*2);ctx.fill();if(p.id===myId){const target=c(p.x-Math.sin(yaw)*3,p.z-Math.cos(yaw)*3);ctx.strokeStyle='#fff';ctx.beginPath();ctx.moveTo(x,z);ctx.lineTo(...target);ctx.stroke();}}
  const b=state.bomb;if(['dropped','planted'].includes(b.state)){const [x,z]=c(b.x,b.z);ctx.fillStyle='#ff5735';ctx.fillRect(x-3,z-3,6,6);}
}
let previous=performance.now(),frameCount=0;function frame(now){requestAnimationFrame(frame);const dt=Math.min(.05,(now-previous)/1000);previous=now;frameCount++;
  // Static lobby/inspection views render on demand; inactive clients should not compete with the active GPU view.
  if(!locked&&!sceneDirty)return;
  scene.fog=preview?null:gameplayFog;const desiredFov=preview?(view==='overview'?55:75):80;if(camera.fov!==desiredFov){camera.fov=desiredFov;camera.updateProjectionMatrix();}
  const me=state?.players.find(p=>p.id===myId);
  if(local&&me){if(state.phase==='live'&&me.alive&&locked){physicsAccumulator=Math.min(.1,physicsAccumulator+dt);while(physicsAccumulator>=PREDICTION_DT&&pendingCommands.length<MAX_PENDING_COMMANDS){const command={seq:++inputSeq,round:state.round,input:input()};movePlayer(local,command.input,PREDICTION_DT);pendingCommands.push(command);send({type:'input',input:{...command.input,seq:command.seq,round:command.round}});physicsAccumulator-=PREDICTION_DT;}}
    correction=decayCorrection(correction,dt);
    const targetY=local.y+eyeHeight(local)+correction.y;renderY=renderY===null?targetY:renderY+(targetY-renderY)*Math.min(1,dt*22);
    recoilYaw+=((me.recoilYaw||0)-recoilYaw)*Math.min(1,dt*20);recoilPitch+=((me.recoilPitch||0)-recoilPitch)*Math.min(1,dt*20);
    maxRecoilPitch=Math.max(maxRecoilPitch,recoilPitch);
    camera.position.set(local.x+correction.x,renderY,local.z+correction.z);camera.rotation.set(clamp(pitch+recoilPitch,-1.5,1.5),yaw+recoilYaw,0,'YXZ');gun.visible=me.alive;
    const gap=6+Math.min(24,(me.spread||0)*550);$('crosshair').style.setProperty('--gap',`${gap}px`);
    const speed=Math.hypot(me.vx||0,me.vz||0);$('tuning').textContent=`速度 ${speed.toFixed(1)} m/s · ${!me.grounded?'空中散布':speed>.25?'移动散布':me.burstCount?'连射扩散':'静止精度'} · 连射 ${me.burstCount||0}`;
  }else{const preset=VIEWS[preview?view:'overview'];camera.position.set(...preset.eye);camera.lookAt(...preset.target);gun.visible=false;}
  for(const r of remote.values()){const p=r.p;r.mesh.visible=p.alive;r.mesh.position.lerp(new THREE.Vector3(p.x,p.y,p.z),Math.min(1,dt*15));r.mesh.rotation.y=p.yaw;r.mesh.scale.y=p.crouch?.5:1;}
  shotKick=Math.max(0,shotKick-dt*8);gun.position.set(.25+Math.sin(now*.007)*(me?.moving?.006:0),-.24-shotKick*.015,-.42+shotKick*.045);gun.rotation.x=shotKick*.07;muzzle.visible=shotKick>.75;
  if(me){gun.scale.setScalar(me.weapon==='pistol'?.7:1);gun.scale.z=me.weapon==='sniper'?1.6:me.weapon==='pistol'?.65:1;}
  for(let i=effects.length-1;i>=0;i--)if(now>effects[i].until){const o=effects[i].object;scene.remove(o);o.geometry.dispose();o.material.dispose();effects.splice(i,1);}
  $('hitmarker').style.opacity=now-hitAt<120?'1':'0';$('damageFlash').style.opacity=now-damageAt<160?'.65':'0';if(now>noticeUntil)$('notice').textContent='';
  if(state){const remaining=Math.max(0,Math.ceil((state.bomb.state==='planted'?state.bomb.endAt:state.endAt)-state.time));$('timer').textContent=state.phase==='waiting'?'--:--':`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;$('timer').style.color=state.bomb.state==='planted'?'#ff9d70':'#fff';}
  $('network').textContent=connected?`${state?.players.length||0} / 10 人 · ${lag} ms`:'已断开';
  bombLight.intensity=state?.bomb.state==='planted'?(Math.sin(now*.012)+1)*1.5:0;if(bombMesh.visible)bombLight.position.copy(bombMesh.position).add(new THREE.Vector3(0,.4,0));
  minimap();renderer.render(scene,camera);sceneDirty=false;renderedView=preview?view:null;
}
requestAnimationFrame(frame);window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);sceneDirty=true;});
// Read-only diagnostic hook for automated browser smoke tests.
window.lanStrike={getState:()=>state,getId:()=>myId,getRenderInfo:()=>({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles}),getDiagnostics:()=>({mapVersion:MAP_VERSION,mapFaces:mapRender.faces,terrainTriangles:mapRender.triangles,mapTextures:mapRender.textures,sourceSHA256:mapRender.sourceSHA256,preview,view,renderedView,locked,visibility:document.visibilityState,frameCount,lastFrameAge:performance.now()-previous,input:input(),localPosition:local?{x:local.x,y:local.y,z:local.z}:null,unackedInputs:pendingCommands.length,inputSeq,ackInputSeq:state?.players.find(p=>p.id===myId)?.ackInputSeq,lastCorrection,visualCorrection:{...correction},impacts:impacts.length,recoilYaw,recoilPitch,maxBurst,maxRecoilPitch,cameraY:camera.position.y})};
