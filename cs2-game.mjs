// Independent authority over the Source 2 CPU world. Combat/action ordering is
// copied from the verified v1.0 kernel; all map-bound services are injected.
import {RULES as LEGACY_RULES,WEAPONS as LEGACY_WEAPONS} from './public/config.js';
import {rayBox,direction} from './public/math.js';
import {GUNS as LEGACY_GUNS,EQUIPMENT} from './public/arsenal.js';
import {createWeaponRuntime} from './public/cs2-weapon-runtime.js';
import {createCS2WeaponBehavior} from './public/cs2-weapon-behavior.js';
import {getWeaponProfile,isCS2WeaponProfile} from './public/cs2-weapon-profile.js';
import {CS2_GRENADE_PROFILE} from './public/cs2-grenade-profile.js';
import {applySmokeShot,applySmokeExplosion} from './public/cs2-smoke-field.js';
import {createHitboxRuntime} from './cs2-hitboxes.mjs';
import {createBallistics} from './cs2-ballistics.mjs';
import {createInventory,GRENADE_IDS} from './cs2-inventory.mjs';
import {createGrenadeRuntime,GRENADE_LIMITS} from './cs2-grenades.mjs';
import {captureGrenadePose,recordGrenadeJump,finalizeGrenadeJumpPunch,selectGrenadeJumpPose,applyGrenadeReleaseView} from './cs2-grenade-launch.mjs';
import {createMovementSoundState,movementSoundStep,RADIO_MENUS} from './public/movement-audio.js';
import {safeSound} from './public/sound-catalog.js';
import {allowsPlayerActions} from './public/round-state.js';
import {selectCharacter} from './public/characters-config.js';
import {ECONOMY,clampMoney,equipmentPrice} from './public/economy.js';
import {armourDamage} from './public/armour.js';
import {MOVEMENT_SYNC,INPUT_DT,MAX_INPUT_QUEUE,MAX_INPUT_BATCH,MAX_INPUT_AGE_TICKS,INPUT_REORDER_TICKS,LEGACY_INPUT_GRACE_SECONDS,normalizeInputCommand,isNeutralInput,validInputSequence} from './public/cs2-input-protocol.js';
import {GRENADE_TIMING,resetGrenadeThrow,grenadeActionPhase} from './public/grenade-state.js';
import {GRENADE_PROTOCOL,normalizeGrenadeIntent} from './public/cs2-grenade-intent.js';
import {createThrowControl,changeThrowButtons,throwStrength,throwMode} from './public/cs2-grenade-controls.js';
import {SCOPE_VIEW_PROTOCOL} from './public/awp-view.js';
import {createLocomotionState,stepLocomotion,copyLocomotion} from './public/player-locomotion.js';
import {MAIN_BALLISTICS_VERSION} from './public/weapon-feel.js';
import {hitRecoveryProfile} from './public/hit-recovery.js';
import {WEAPON_ACTION_LIMIT} from './public/cs2-weapon-action-order.js';
// The legacy movement corrections remain enabled; no old world module loads.
const HIT_SLOWDOWN_VERSION=1,COLLISION_VERSION=1,JUMP_FATIGUE_VERSION=1;
// Relative input-edge time affects only strength selection. It never advances
// preparation, simulation, projectile birth/fuse, movement or weapon clocks.
function grenadeControlTime(intent,now){return intent?.clientClock?intent.controlAt+intent.edgeElapsed+Math.max(0,now-intent.edgeReceivedAt):now;}
export function createCS2Game(world,options={}){
 if(!world?.collision?.trace||!world?.movement?.movePlayer||!world?.contract||typeof world.resolveSpawn!=='function')throw Error('An experimental CPU world is required');
 const weaponProfile=typeof options.weaponProfile==='string'?getWeaponProfile(options.weaponProfile):options.weaponProfile||getWeaponProfile('legacy'),METRES_PER_UNIT=weaponProfile.metresPerUnit,cs2=isCS2WeaponProfile(weaponProfile);
 getWeaponProfile(weaponProfile.id); // Reject unknown explicit profile objects as well as strings.
 const RULES=options.rules||world.movement.rules||LEGACY_RULES,WEAPONS=options.weapons||(cs2?weaponProfile.weapons:world.movement.profile?.weapons)||LEGACY_WEAPONS,GUNS=options.guns||weaponProfile.guns||LEGACY_GUNS;
 if(RULES.tick!==60)throw Error('Authoritative input protocol requires 60 Hz');
 const {blankInput,sanitizedInput,movePlayer,eyeHeight}=world.movement;
 const trace=(a,b)=>world.collision.trace(a,b,0,{radius:0,channel:'bullet'});
 const supportHeight=world.collision.supportHeight.bind(world.collision),isGrounded=world.collision.isGrounded.bind(world.collision);
 const siteAt=world.siteAt,buyZoneAt=world.buyZoneAt,MAP_VERSION=world.contract.mapId;
 const wallDistance=(o,d,range=250)=>trace(o,{x:o.x+d.x*range,y:o.y+d.y*range,z:o.z+d.z*range}).fraction*range;
 const weaponBehavior=options.weaponBehavior||(cs2?createCS2WeaponBehavior(weaponProfile):null),weaponRuntime=options.weaponRuntime||createWeaponRuntime(world,{rules:RULES,weapons:WEAPONS,guns:GUNS,behavior:weaponBehavior}),{resetWeapon,updateWeapon,spreadDirection,consumeGunShot,updateReload}=weaponRuntime;
 const {freshLoadout,saveActive,refillAmmo,activate,ownedWeapons}=createInventory({resetWeapon,guns:GUNS,deploySeconds:weaponRuntime.deploySeconds});
 const grenadeProfile=options.grenadeProfile===false?null:options.grenadeProfile||(cs2?CS2_GRENADE_PROFILE:null);
 const {createGrenade,stepGrenades}=createGrenadeRuntime(world,{profile:grenadeProfile});
 const {bulletProperties,impactSurface,penetrationExit,materialDamage,groundSoundSurface}=createBallistics(world,{metresPerUnit:METRES_PER_UNIT});
 const {rayPlayer,hitboxAnimation,hitboxDiagnostics,HIT_REACTION,advanceAnimation}=createHitboxRuntime(options.hitboxes);
const own=(o,k)=>typeof k==='string'&&Object.hasOwn(o,k);
const opponent=team=>team==='T'?'CT':'T';
class ExperimentalGame {
  #inputs=new Map();
  #receiptOrder=0;
  #locomotion=new WeakMap();
  #grenadeJumps=new WeakMap();
  #movementSounds=new Map();
  #bombSounds=null;
  constructor({random=Math.random,audioRandom=Math.random,friendlyFire=false,hitRecovery='baseline'}={}){this.experimental=true;this.world=world;this.worldContract=world.contract;this.weaponProfileId=weaponProfile.id;this.weaponProfile=weaponProfile;this.hitRecovery=hitRecoveryProfile(hitRecovery);this.random=random;this.audioRandom=audioRandom;this.friendlyFire=friendlyFire;this.players=new Map();this.phase='waiting';this.round=0;this.score={T:0,CT:0};this.time=0;this.serverTick=0;this.endAt=0;this.buyEndAt=0;this.events=[];this.bomb={state:'none'};this.message='等待玩家加入';this.lossStreak={T:0,CT:0};this.lossBonus=ECONOMY.lossBase;this.projectiles=[];this.smokes=[];this.drops=[];this.nextDrop=0;}
  emit(e){if(grenadeProfile){if(e.type==='shot')applySmokeShot(this.smokes,e,this.time);else if(e.type==='explosion')applySmokeExplosion(this.smokes,e,this.time);}this.events.push({...e,time:this.time});if(this.events.length>1024)this.events.splice(0,this.events.length-1024);}
  sound(p,name,{position=null,volume=1,attenuation=.8,channel='auto',category='effects',private:personal=false,global=false,team=null,exceptId=null,priority=0}={}){
    if(!safeSound(name))return;
    const at=position||(p&&{x:p.x,y:p.y+.9,z:p.z});
    if(!at||!['x','y','z'].every(k=>Number.isFinite(at[k])))return;
    this.emit({type:'sound',id:p?.id||'world',name,from:{x:at.x,y:at.y,z:at.z},volume,attenuation,channel,category,private:personal,global,team,exceptId,priority});
  }
  radio(id,menu,slot){
    const p=this.players.get(id);
    if(!p?.alive||!allowsPlayerActions(this.phase)||!Number.isInteger(menu)||!Number.isInteger(slot)||!RADIO_MENUS[menu]?.[slot]||this.time<(p.nextRadioAt||0)||(p.radioCount||0)>=60)return false;
    p.nextRadioAt=this.time+1.5;p.radioCount=(p.radioCount||0)+1;
    const name=menu===2&&slot===0&&this.audioRandom()<.5?'radio/ct_affirm.wav':RADIO_MENUS[menu][slot];
    this.sound(p,name,{global:true,team:p.team,channel:'radio',category:'voice',priority:20});return true;
  }
  activate(p,key,now=this.time,transition=true){
    const changed=p.weapon!==key;
    const before=transition&&p.alive&&p.weapon!==key?hitboxAnimation(p,now):null;
    this.cancelGrenadeIntent(p,{preservePending:true});
    activate(p,key,now);
    p.poseFromSequence=before?.playerSequence||null;p.poseFromFrame=before?.playerFrame||0;p.poseChangedAt=now;p.poseFromTime=before?.playerAnimationTime??null;
    if(changed&&transition&&key==='knife')this.sound(p,'weapons/knife_deploy1.wav',{private:true,channel:'item'});
  }
  hasBothTeams(){return new Set([...this.players.values()].map(p=>p.team)).size===2;}
  waitForPlayers(){this.phase='waiting';this.endAt=0;this.buyEndAt=0;this.bomb={state:'none'};this.message='等待玩家加入';this.projectiles=[];this.smokes=[];this.drops=[];}
  add(id,name,team,character){
    if(!['T','CT'].includes(team))throw Error('请选择阵营');if(this.players.has(id))throw Error('已加入房间');
    if(this.players.size>=RULES.maxPlayers)throw Error('房间已满（最多10人）');
    if([...this.players.values()].filter(p=>p.team===team).length>=RULES.teamSize)throw Error('该阵营已满（最多5人）');
    const contested=this.hasBothTeams();
    const p={id,name:String(name||'玩家').replace(/[\x00-\x1f]/g,'').slice(0,16),team,character:selectCharacter(team,character),kills:0,deaths:0,money:ECONOMY.startMoney,input:blankInput(),lastInput:this.time,lastShot:-100,reloadAt:0,progress:0,alive:false,pendingMoney:0};
    this.players.set(id,p);this.spawn(p);
    if(this.phase==='waiting'||contested||this.phase==='ended'){p.alive=false;p.playedRound=0;}
    // Restart once when an unopposed room gains its first opposing player.
    if(!contested&&this.hasBothTeams()&&this.phase!=='waiting')this.begin();
    this.emit({type:'notice',text:`${p.name} 加入 ${team}`});return p;
  }
  spawn(p){const index=[...this.players.values()].filter(a=>a.team===p.team).indexOf(p),s=world.resolveSpawn(p.team,Math.max(0,index)%world.spawns[p.team].length);
    if(!p.alive||!p.inventory)freshLoadout(p);else saveActive(p);
    this.credit(p,p.pendingMoney||0,'round');p.pendingMoney=0;
    Object.assign(p,{x:s.x,z:s.z,y:s.y,vy:0,vx:0,vz:0,grounded:true,yaw:s.yaw,pitch:0,hp:100,alive:true,crouch:false,jumpHeld:false,jumpFatigue:0,duckElapsed:0,duckAmount:0,ducking:false,stepDistance:0,velocityModifier:1,hitRecoveryVersion:this.hitRecovery.version,shotsFired:0,nextShotAt:0,lastInputSeq:0,ackInputSeq:0,reloadAt:0,progress:0,action:'',lastShot:-100,fireHeld:false,burstRemaining:0,flashUntil:0,flashAmount:0,flashFade:0,zoom:90,resumeZoomAt:0,nextAttackAt:0,shieldRaised:false,playedRound:this.round,input:{...blankInput(),yaw:s.yaw}});
    delete p.playerLocomotion;this.#locomotion.delete(p);this.#grenadeJumps.delete(p);
    p.gaitDistance=0;if(advanceAnimation)p.nativeGaitPhase=0;p.gaitYaw=null;p.airTime=0;p.flinchAt=-100;p.flinchHead=false;
    this.#movementSounds.set(p.id,createMovementSoundState());p.radioCount=0;p.nextRadioAt=0;
    p.recoilSeed=this.random===Math.random?Math.floor(Math.random()*0x100000000):null;
    p.lastInput=this.time;
    this.#inputs.set(p.id,{queue:new Map(),sequenced:false,gapSince:null,skipThrough:0,grenadeIntent:null,actions:[],receivedOrder:0,lastOrder:0,grenadeReceiptSeq:0,grenadeReceiptAction:0});
    p.grenadeAckSeq=0;p.grenadeActionId=0;p.grenadeIntentStatus='';p.grenadeRejectedActionId=0;p.grenadeButtons=0;p.grenadeStrength=1;p.grenadeMode='overhand';
    p.appliedInputCommands=0;p.skippedInputCommands=0;p.lastAppliedInputSeq=0;
    this.activate(p,p.primary||p.pistol||'knife',this.time,false);refillAmmo(p);p.nextAttackAt=0;resetWeapon(p);
  }
  credit(p,amount,reason){if(!Number.isFinite(amount)||!amount)return;p.money=clampMoney(p.money,amount);this.emit({type:'money',id:p.id,amount,money:p.money,reason});}
  remove(id){const p=this.players.get(id);if(!p)return;this.dropBomb(p);this.players.delete(id);this.#inputs.delete(id);this.#movementSounds.delete(id);this.emit({type:'notice',text:`${p.name} 离开`});if(!this.players.size)this.waitForPlayers();}
  dropBomb(p){if(this.bomb.state==='carried'&&this.bomb.holder===p.id)this.bomb={state:'dropped',x:p.x,z:p.z,y:supportHeight(p.x,p.z,p.y)};}
  input(id,raw){
    const p=this.players.get(id),state=this.#inputs.get(id);if(!p||!state||!raw||typeof raw!=='object'||Array.isArray(raw))return false;
    const source=raw.input===undefined?raw:raw.input;
    if(!source||typeof source!=='object'||Array.isArray(source))return false;
    const round=raw.round===undefined?source.round:raw.round;
    if(round!==undefined&&round!==this.round)return false;
    if(raw.seq!==undefined||source.seq!==undefined){
      // Legacy single-input transport permits omitted round; batches never do.
      return this.inputBatch(id,[{...raw,round:round===undefined?this.round:round}])>0;
    }
    const input=sanitizedInput(source);
    if(isNeutralInput(input)){
      // Menu/blur is an immediate cancellation barrier. ACK advances at the next
      // simulation tick, not on receipt; late redundant copies cannot revive it.
      // Optional sender watermark also cancels datagrams still in flight.
      const cancel=raw.cancelThroughSeq===undefined?source.cancelThroughSeq:raw.cancelThroughSeq;
      if(state.sequenced||cancel!==undefined){this.cancelGrenadeIntent(p);if(p.grenadePhase!=='throw')resetGrenadeThrow(p);}
      const watermark=validInputSequence(cancel)&&cancel<=p.ackInputSeq+MAX_INPUT_QUEUE?cancel:0;
      state.skipThrough=Math.max(state.skipThrough,p.lastInputSeq,watermark);
      state.queue.clear();state.gapSince=null;
      p.input=input;p.jumpHeld=false;p.fireHeld=false;
      this.#flushInputActions(p,true);
      // Ordinary legacy trigger release must finish an already-started burst.
      // Sequenced menu/blur cancellation or an explicit watermark cancels it.
      if(state.sequenced||cancel!==undefined)p.burstRemaining=0;
    }else if(state.sequenced){return false;}
    else p.input=input;
    state.receivedOrder=++this.#receiptOrder;p.lastInput=this.time;return true;
  }
  inputBatch(id,commands,acceptedCommands=null){
    const p=this.players.get(id),state=this.#inputs.get(id);if(!p||!state||!Array.isArray(commands))return 0;
    let accepted=0;
    for(const raw of commands.slice(0,MAX_INPUT_BATCH)){
      const c=normalizeInputCommand(raw,this.round);
      if(!c||c.seq<=Math.max(p.ackInputSeq,state.skipThrough)||c.seq>p.ackInputSeq+MAX_INPUT_QUEUE||state.queue.has(c.seq)||state.queue.size>=MAX_INPUT_QUEUE)continue;
      state.queue.set(c.seq,{...c,receivedTick:this.serverTick,receivedOrder:++this.#receiptOrder});state.sequenced=true;
      p.lastInputSeq=Math.max(p.lastInputSeq,c.seq);p.lastInput=this.time;accepted++;if(Array.isArray(acceptedCommands))acceptedCommands.push(c);
    }
    return accepted;
  }
  queueInputAction(id,{round,seq},run){
    const p=this.players.get(id),state=this.#inputs.get(id);
    if(!p||!state||round!==this.round||(seq!==0&&!validInputSequence(seq))||seq>p.ackInputSeq+MAX_INPUT_QUEUE)throw Error('Invalid weapon input barrier');
    if(state.actions.length>=WEAPON_ACTION_LIMIT)throw Error('Weapon action queue full');
    if(!p.alive){run(false);return;}
    if(!allowsPlayerActions(this.phase)){run(seq<=p.ackInputSeq&&!state.actions.length);return;}
    state.actions.push({seq,round,run,tick:this.serverTick,order:++this.#receiptOrder});
  }
  #flushInputActions(p,cancel=false){
    const state=this.#inputs.get(p.id);if(!state)return;
    while(state.actions.length){const a=state.actions[0],invalid=cancel||!p.alive||a.round!==this.round||this.serverTick-a.tick>MAX_INPUT_AGE_TICKS;
      if(!invalid&&p.ackInputSeq<a.seq)break;
      state.actions.shift();a.run(!invalid);
    }
  }
  enableGrenadeIntents(id){const p=this.players.get(id);if(p)p.grenadeProtocol=GRENADE_PROTOCOL;}
  cancelGrenadeIntent(p,{preservePending=false}={}){
    this.#grenadeJumps.delete(p);
    const state=this.#inputs.get(p.id);
    if(state){delete state.grenadeLegacyLaunchAt;if(!preservePending&&state.pendingGrenadeLaunch){if(p.grenadeActionId===state.pendingGrenadeLaunch.actionId)p.grenadeIntentStatus='cancelled';delete state.pendingGrenadeLaunch;}}
    if(state?.grenadeIntent){
      const pending=state.grenadeIntent.held;state.grenadeIntent=null;
      if(p.grenadePhase!=='throw'||pending)p.grenadeIntentStatus='cancelled';
    }
    p.grenadeButtons=0;
    if(p.grenadePhase!=='throw'){p.grenadeStrength=1;p.grenadeMode='overhand';}
  }
  grenadeIntent(id,raw,{immediate=false,onAck=()=>{},onError=()=>{}}={}){
    const p=this.players.get(id),state=this.#inputs.get(id),c=normalizeGrenadeIntent(raw,this.round);
    if(!p||!state||p.grenadeProtocol!==GRENADE_PROTOCOL||!c)return null;
    if(!immediate){
      if(c.seq!==Math.max(p.grenadeAckSeq||0,state.grenadeReceiptSeq)+1)return null;
      const activeAction=state.grenadeIntent?.actionId||state.grenadeReceiptAction;
      // Explicit cancel is a safety barrier, like menu/blur, and may retire
      // queued intent sequences without waiting for a missing movement input.
      if((c.kind==='cancel'&&(!c.actionId||!activeAction||c.actionId===activeAction))||state.actions.length>=WEAPON_ACTION_LIMIT){
        state.grenadeReceiptSeq=c.seq;this.#flushInputActions(p,true);return this.grenadeIntent(id,{...c,kind:'cancel'},{immediate:true});
      }
    }
    // A later release cannot overtake an earlier queued equip/cancel. Resolve
    // the intent only after preceding reliable operations at their input fence.
    if(!immediate&&state.actions.length){
      const seq=Math.max(p.ackInputSeq,...state.actions.map(a=>a.seq));
      this.queueInputAction(id,{round:c.round,seq},allowed=>{try{const ack=this.grenadeIntent(id,allowed?c:{...c,kind:'cancel'},{immediate:true});if(ack)onAck(ack);}catch(error){onError(error);}});state.grenadeReceiptSeq=c.seq;if(c.kind==='press')state.grenadeReceiptAction=c.actionId;return null;
    }
    if(c.seq!==(p.grenadeAckSeq||0)+1)return null;
    p.grenadeAckSeq=c.seq;
    if(!immediate){state.grenadeReceiptSeq=c.seq;if(c.kind==='press')state.grenadeReceiptAction=c.actionId;}
    const reply=(status,reason='')=>({type:'grenadeAck',round:this.round,seq:c.seq,actionId:c.actionId,status,reason});
    const reject=reason=>{p.grenadeRejectedActionId=c.actionId;return reply('rejected',reason);};
    if(c.kind==='cancel'){
      if(c.actionId!==0&&state.grenadeIntent&&c.actionId!==state.grenadeIntent.actionId)return reject('stale-action');
      this.cancelGrenadeIntent(p);if(p.grenadePhase!=='throw'){resetGrenadeThrow(p);p.grenadeIntentStatus='cancelled';}
      return reply(p.grenadePhase==='throw'&&p.grenadeIntentStatus!=='cancelled'?'thrown':'cancelled');
    }
    if(c.kind==='press'){
      if(!p.alive||!allowsPlayerActions(this.phase)||p.weapon!==c.weapon||p.grenades[c.weapon]-(state.pendingGrenadeLaunch?.weapon===c.weapon?1:0)<=0||p.shieldRaised||p.action||state.grenadeIntent?.held||['pin','hold'].includes(p.grenadePhase))return reject('not-ready');
      const control=createThrowControl(c.buttons,this.time);
      state.grenadeIntent={actionId:c.actionId,weapon:c.weapon,held:true,released:false,aim:null,control,controlAt:this.time,edgeElapsed:0,edgeReceivedAt:this.time,clientClock:Number.isFinite(c.elapsed)};
      p.grenadeButtons=c.buttons;p.grenadeStrength=throwStrength(control,this.time);p.grenadeMode=throwMode(p.grenadeStrength);
      p.grenadeActionId=c.actionId;p.grenadeIntentStatus='pending';this.updateGrenadeIntent(p);
      return reply(p.grenadeIntentStatus);
    }
    const intent=state.grenadeIntent;
    if(!intent||intent.actionId!==c.actionId||intent.weapon!==c.weapon||!p.alive||p.weapon!==c.weapon)return reject('stale-action');
    if(intent.released)return reply(p.grenadeIntentStatus);
    if(Number.isFinite(c.elapsed)!==intent.clientClock||intent.clientClock&&c.elapsed+1e-8<intent.edgeElapsed){
      this.cancelGrenadeIntent(p);if(p.grenadePhase!=='throw')resetGrenadeThrow(p);p.grenadeIntentStatus='cancelled';return reject('invalid-clock');
    }
    if(intent.clientClock){intent.edgeElapsed=Math.max(intent.edgeElapsed,c.elapsed);intent.edgeReceivedAt=this.time;}
    const controlNow=grenadeControlTime(intent,this.time);
    intent.control=changeThrowButtons(intent.control,c.kind==='release'?0:c.buttons,controlNow);
    p.grenadeButtons=intent.control.buttons;p.grenadeStrength=throwStrength(intent.control,controlNow);p.grenadeMode=throwMode(p.grenadeStrength);
    if(c.kind==='buttons')return reply(p.grenadeIntentStatus);
    intent.held=false;intent.released=true;intent.aim={yaw:c.yaw,pitch:c.pitch};
    if(grenadeProfile?.trajectoryVersion===1){intent.releaseAt=this.time;intent.visualThrowAt=Math.max(this.time,p.grenadeStartedAt+GRENADE_TIMING.pinSeconds);intent.launchAt=intent.visualThrowAt+grenadeProfile.releaseDelaySeconds;intent.launchDeferred=false;if(c.afterInputSeq!==undefined)intent.releaseView={...intent.aim,afterInputSeq:c.afterInputSeq};}
    // A tap before deploy/recovery finishes is not queued into a future grenade.
    if(!['pin','hold'].includes(p.grenadePhase)){
      this.cancelGrenadeIntent(p);p.grenadeIntentStatus='cancelled';return reply('cancelled');
    }
    p.grenadeReleased=true;p.grenadeIntentStatus='released';return reply('released');
  }
  updateGrenadeIntent(p){
    const intent=this.#inputs.get(p.id)?.grenadeIntent;
    if(!intent||!intent.held||intent.released||['pin','hold'].includes(p.grenadePhase))return;
    if(p.weapon!==intent.weapon||!p.alive||!allowsPlayerActions(this.phase)){this.cancelGrenadeIntent(p);return;}
    if(this.shoot(p))p.grenadeIntentStatus='active';
  }
  #skipInput(p,through){
    if(through>p.ackInputSeq){p.skippedInputCommands+=through-p.ackInputSeq;p.ackInputSeq=through;}
  }
  #nextInput(p){
    const state=this.#inputs.get(p.id),neutral=()=>({...blankInput(),yaw:p.yaw,pitch:p.pitch});
    if(state.skipThrough){this.#skipInput(p,state.skipThrough);state.skipThrough=0;}
    if(!state.sequenced)return this.time-p.lastInput>LEGACY_INPUT_GRACE_SECONDS?neutral():p.input;
    // Stale prefix is explicitly skipped. Never fast-forward movement to drain
    // backlog: at most ONE non-stale command receives this tick's simulation.
    const queued=[...state.queue.values()].sort((a,b)=>a.seq-b.seq);
    for(const c of queued){
      if(this.serverTick-c.receivedTick<=MAX_INPUT_AGE_TICKS)break;
      state.queue.delete(c.seq);this.#skipInput(p,c.seq);state.gapSince=null;
    }
    const next=[...state.queue.values()].sort((a,b)=>a.seq-b.seq)[0];
    if(!next){state.gapSince=null;return neutral();}
    if(next.seq>p.ackInputSeq+1){
      state.gapSince??=this.serverTick;
      if(this.serverTick-state.gapSince<INPUT_REORDER_TICKS)return neutral();
      this.#skipInput(p,next.seq-1);
    }
    state.queue.delete(next.seq);state.gapSince=null;
    return next;
  }
  canBuy(p){return !!p?.alive&&['countdown','live'].includes(this.phase)&&this.time<=this.buyEndAt&&buyZoneAt(p);}
  buy(id,item){const p=this.players.get(id);if(!this.canBuy(p))throw Error('只能在购买时间内、己方购买区存活时购买');
    if(typeof item!=='string'||item.length>40)throw Error('无效商品');
    let cost=0,apply;
    if(own(GUNS,item)){
      const w=GUNS[item];if(!w.teams.includes(p.team))throw Error('该武器仅限另一阵营购买');if(own(p.inventory,item))throw Error('已经持有该武器');
      if(item==='elite'&&p.shield)throw Error('双枪不能与防弹盾同时持有');cost=w.price;
      apply=()=>{if(w.slot===1&&p.shield)this.releaseShield(p);const old=w.slot===1?p.primary:p.pistol;if(old)this.releaseGun(p,old);
        p.inventory[item]={ammo:w.clip,silenced:!!w.defaultSilenced,burstMode:false};if(w.slot===1)p.primary=item;else p.pistol=item;
        p.ammoPool[w.ammoType]??=0;this.activate(p,item,this.time);refillAmmo(p,[item]);};
    }else if(own(EQUIPMENT,item)){
      const e=EQUIPMENT[item];if(!e.teams.includes(p.team))throw Error('该装备仅限另一阵营购买');cost=equipmentPrice(item,p);
      if(GRENADE_IDS.includes(item)){if(p.grenades[item]>=e.limit)throw Error('该投掷物已达携带上限');apply=()=>p.grenades[item]++;}
      else if(item==='kevlar'){if(p.armour>=100)throw Error('护甲已满');apply=()=>{p.armour=100;};}
      else if(item==='assaultsuit'){if(p.armour>=100&&p.helmet)throw Error('护甲与头盔已齐全');apply=()=>{p.armour=100;p.helmet=true;};}
      else if(item==='defusekit'){if(p.defuseKit)throw Error('已持有拆弹器');apply=()=>{p.defuseKit=true;};}
      else if(item==='nightvision'){if(p.nightvision)throw Error('已持有夜视仪');apply=()=>{p.nightvision=true;};}
      else if(item==='shield'){if(p.shield)throw Error('已持有防弹盾');if(p.pistol==='elite')throw Error('防弹盾不能与双枪同时持有');apply=()=>{if(p.primary)this.releaseGun(p,p.primary);p.shield=true;this.activate(p,p.pistol||'knife',this.time);};}
    }
    if(!apply||!Number.isFinite(cost)||cost<=0)throw Error('未知商品');if(p.money<cost)throw Error('金钱不足');
    apply();this.credit(p,-cost,'purchase');this.emit({type:'purchase',id:p.id,item,cost});
    this.sound(p,item==='kevlar'||item==='assaultsuit'?'items/kevlar.wav':item==='nightvision'?'items/equip_nvg.wav':'items/gunpickup2.wav',{private:true,channel:'item'});return true;
  }
  equip(id,key){const p=this.players.get(id);if(!p?.alive||!['countdown','live','ended'].includes(this.phase))return false;
    const hasBomb=this.bomb.state==='carried'&&this.bomb.holder===id,owned=ownedWeapons(p,hasBomb);
    if(key==='last')key=p.previousWeapon;
    if(typeof key==='number'||/^[1-5]$/.test(String(key))){const slot=Number(key);if(slot===1)key=p.primary||(p.shield?p.pistol:null);else if(slot===2)key=p.pistol;else if(slot===3)key='knife';else if(slot===5)key=hasBomb?'c4':null;else{const gs=GRENADE_IDS.filter(g=>p.grenades[g]>0);key=gs[(gs.indexOf(p.weapon)+1)%gs.length];}}
    if(typeof key!=='string'||!owned.includes(key)||key===p.weapon)return false;this.#reserveReleasedGrenade(p);this.activate(p,key,this.time);return true;
  }
  reload(id){const p=this.players.get(id),w=GUNS[p?.weapon];if(p?.alive&&allowsPlayerActions(this.phase)&&w&&!p.reloadAt&&p.reserve>0&&p.ammo<w.clip){p.reloadStartedAt=this.time;p.reloadAt=this.time+(w.reloadStyle==='per-shell'?w.reloadStart:w.reload);if(w.reloadTimeline){p.reloadEndAt=0;p.reloadStage='intro';p.reloadShellsAdded=0;p.reloadCancelledAt=0;}p.zoom=90;p.resumeZoomAt=0;p.progress=0;p.burstRemaining=0;resetWeapon(p,{keepPunch:true});if(['aug','famas','mac10','mp5navy'].includes(p.weapon))p.accuracy=0;
    // Original ReloadSound has a 512-source-unit hearing radius; local MDL5004 owns local detail.
    this.sound(p,w.reloadStyle==='per-shell'?'weapons/generic_shot_reload.wav':'weapons/generic_reload.wav',{exceptId:p.id,attenuation:1000/512,channel:'item'});
  }}
  releaseGun(p,key){if(!own(GUNS,key)||!p.inventory[key])return;saveActive(p);const entry=p.inventory[key];
    this.drops.push({id:`drop-${++this.nextDrop}`,kind:'weapon',weapon:key,ammo:entry.ammo,silenced:!!entry.silenced,burstMode:!!entry.burstMode,x:p.x,y:p.y,z:p.z,ownerId:p.id,pickupAt:this.time+.5,endAt:this.time+180});
    delete p.inventory[key];if(p.primary===key)p.primary=null;if(p.pistol===key)p.pistol=null;this.drops=this.drops.slice(-64);
  }
  releaseShield(p){if(!p.shield)return;p.shield=false;p.shieldRaised=false;this.drops.push({id:`drop-${++this.nextDrop}`,kind:'shield',x:p.x,y:p.y,z:p.z,ownerId:p.id,pickupAt:this.time+.5,endAt:this.time+180});this.drops=this.drops.slice(-64);}
  drop(id){const p=this.players.get(id);if(!p?.alive||!allowsPlayerActions(this.phase))return false;if(p.shield){this.releaseShield(p);return true;}
    if(p.weapon==='c4'){this.dropBomb(p);this.activate(p,p.primary||p.pistol||'knife',this.time);return true;}if(!own(GUNS,p.weapon))return false;
    this.releaseGun(p,p.weapon);this.activate(p,p.primary||p.pistol||'knife',this.time);return true;
  }
  pickup(p){for(let i=this.drops.length-1;i>=0;i--){const d=this.drops[i];if(this.time<d.pickupAt||!this.canReach(p,d,.8))continue;
    if(d.kind==='defusekit'){if(p.team!=='CT'||p.defuseKit)continue;p.defuseKit=true;this.drops.splice(i,1);this.sound(p,'items/gunpickup2.wav',{private:true,channel:'item'});continue;}
    if(d.kind==='shield'){if(p.shield||p.primary||p.pistol==='elite')continue;p.shield=true;this.drops.splice(i,1);this.sound(p,'items/gunpickup2.wav',{private:true,channel:'item'});continue;}
    const w=GUNS[d.weapon];if(!w||p.inventory[d.weapon]||(w.slot===1&&(p.primary||p.shield))||(w.slot===2&&(p.pistol||(p.shield&&d.weapon==='elite'))))continue;
    saveActive(p);p.inventory[d.weapon]={ammo:d.ammo,silenced:d.silenced,burstMode:d.burstMode};p.ammoPool[w.ammoType]??=0;if(w.slot===1)p.primary=d.weapon;else p.pistol=d.weapon;
    this.drops.splice(i,1);this.activate(p,d.weapon,this.time);
    this.sound(p,'items/gunpickup2.wav',{private:true,channel:'item'});
  }}
  secondary(id){const p=this.players.get(id);if(!p?.alive||!allowsPlayerActions(this.phase)||this.time<(p.nextSecondaryAt||0)||p.reloadAt)return false;
    if(p.grenadePhase)return false;
    if(p.shield){p.shieldRaised=!p.shieldRaised;p.nextAttackAt=this.time+.4;p.nextSecondaryAt=this.time+.4;return true;}
    if(p.weapon==='knife')return this.knife(p,true);const w=GUNS[p.weapon];if(!w)return false;
    if(w.zoom){const levels=[90,...w.zoom];p.zoom=levels[(levels.indexOf(p.zoom)+1)%levels.length];p.nextSecondaryAt=this.time+.3;this.sound(p,'weapons/zoom.wav',{private:true,channel:'item',volume:.2});}
    else if(w.modes?.includes('silenced')){p.silenced=!p.silenced;p.modeLockAt=this.time+(p.weapon==='usp'?3:2);p.nextAttackAt=p.modeLockAt;p.nextSecondaryAt=p.modeLockAt;}
    else if(w.modes?.includes('burst')){p.burstMode=!p.burstMode;p.burstRemaining=0;p.nextSecondaryAt=this.time+.3;}else return false;
    saveActive(p);return true;
  }
  toggleNightvision(id){const p=this.players.get(id);if(p?.alive&&p.nightvision){p.nightvisionOn=!p.nightvisionOn;this.sound(p,p.nightvisionOn?'items/nvg_on.wav':'items/nvg_off.wav',{private:true,channel:'item'});}}
  begin(){if(!this.players.size){this.waitForPlayers();return;}const contested=this.hasBothTeams();
    this.round++;this.phase=contested?'countdown':'live';this.endAt=this.time+(contested?RULES.freezeSeconds:RULES.roundSeconds);this.buyEndAt=this.time+(contested?RULES.freezeSeconds:0)+ECONOMY.buySeconds;this.message=contested?'准备回合 · B 购买武器与装备':'回合进行中 · B 购买 / 1—5 切换装备';this.projectiles=[];this.smokes=[];this.drops=[];
    for(const p of this.players.values())this.spawn(p);
    this.#bombSounds=null;
    const t=[...this.players.values()].filter(p=>p.team==='T');this.bomb=t.length?{state:'carried',holder:t[(this.round-1)%t.length].id}:{state:'none'};this.emit({type:'round',round:this.round});
    if(!contested)this.sound(null,['radio/moveout.wav','radio/letsgo.wav','radio/locknload.wav','radio/com_go.wav'][Math.min(3,Math.floor(this.audioRandom()*4))],{position:{x:0,y:0,z:0},global:true,category:'voice',channel:'announcer',priority:30});
  }
  finish(team,reason,outcome='elimination'){if(this.phase!=='live'||!['T','CT'].includes(team))return false;
    const loser=opponent(team);if(this.lossStreak[team]>1)this.lossBonus=ECONOMY.lossReset;this.lossStreak[team]=0;this.lossStreak[loser]++;
    if(this.lossStreak[loser]>1&&this.lossBonus<ECONOMY.lossThreshold)this.lossBonus+=ECONOMY.lossIncrement;
    const winnerAmount=outcome==='bomb'?ECONOMY.winBomb:outcome==='defuse'?ECONOMY.winDefuse:outcome==='timeout'?ECONOMY.winTimeout:ECONOMY.winElimination;
    for(const p of this.players.values()){
      if(p.playedRound===this.round){const denied=outcome==='timeout'&&p.team==='T'&&p.alive;p.pendingMoney=denied?0:p.team===team?winnerAmount:this.lossBonus+(outcome==='defuse'&&p.team==='T'?ECONOMY.plantedLossBonus:0);}
      p.progress=0;p.action='';
    }
    this.phase='ended';this.endAt=this.time+6;this.score[team]++;this.message=`${team} 获胜 · ${reason}`;this.emit({type:'notice',text:this.message});
    this.sound(null,team==='CT'?'radio/ctwin.wav':'radio/terwin.wav',{position:{x:0,y:0,z:0},global:true,category:'voice',channel:'announcer',priority:30});return true;
  }
  damage(p,amount,killer,options={}){if(!p?.alive||!Number.isFinite(amount)||amount<=0)return 0;
    if(killer&&killer!==p&&killer.team===p.team&&!this.friendlyFire)return 0;
    const previousArmour=p.armour||0;
    const result=armourDamage(amount,previousArmour,p.helmet,options.hitgroup||'chest',options.armourRatio??1,!!options.blast);p.armour=result.armour;
    const healthDamage=Math.trunc(result.healthDamage);
    if(GUNS[options.kind]&&killer&&killer!==p){
      if(healthDamage>0||result.armourDamage>0){
        const head=options.hitgroup==='head',reacting=this.time-p.flinchAt>=0&&this.time-p.flinchAt<HIT_REACTION.duration;
        // Let a reaction finish under automatic fire; head hits can supersede a
        // body reaction. The same phase feeds rendered and historical hitboxes.
        if(!reacting||(head&&!p.flinchHead)){p.flinchAt=this.time;p.flinchHead=head;}
      }
      const large=!p.crouch&&options.hitgroup!=='legs'&&['scout','aug','sg550','galil','famas','awp','m3','m4a1','g3sg1','deagle','sg552','ak47'].includes(options.kind);
      if(!large)p.velocityModifier=.5;
      else if(Math.hypot(p.vx||0,p.vz||0,p.vy||0)<300*METRES_PER_UNIT){p.velocityModifier=.65;const dx=p.x-killer.x,dy=p.y-killer.y,dz=p.z-killer.z,len=Math.hypot(dx,dy,dz)||1;p.vx+=dx/len*170*METRES_PER_UNIT;p.vz+=dz/len*170*METRES_PER_UNIT;}
      const unprotected=options.hitgroup==='head'?!p.helmet:!p.armour;
      if(unprotected&&['head','chest','stomach'].includes(options.hitgroup))p.recoilPitch=Math.min(options.hitgroup==='head'?12:4,amount*(options.hitgroup==='head'?.5:.1))*Math.PI/180;
    }
    p.hp=Math.max(0,p.hp-healthDamage);p.progress=0;p.action='';this.emit({type:'damage',id:p.id,amount:healthDamage,armour:result.armourDamage,hitgroup:options.hitgroup,kind:options.kind});
    if(healthDamage>0||result.armourDamage>0){
      const n=1+Math.min(2,Math.floor(this.audioRandom()*3));
      const name=options.kind==='fall'?'player/pl_fallpain'+(1+Math.min(1,Math.floor(this.audioRandom()*2))+1)+'.wav':options.hitgroup==='head'?(p.helmet?'player/bhit_helmet-1.wav':`player/headshot${n}.wav`):previousArmour>0&&options.hitgroup!=='legs'?'player/bhit_kevlar-1.wav':`player/bhit_flesh-${n}.wav`;
      this.sound(p,name,{channel:'voice',priority:15});
    }
    if(p.hp<=0){p.alive=false;this.#flushInputActions(p,true);p.diedAt=this.time;p.deaths++;p.reloadAt=0;p.burstRemaining=0;this.cancelGrenadeIntent(p);resetGrenadeThrow(p);saveActive(p);
      if(p.shield)this.releaseShield(p);else {const best=p.primary||p.pistol;if(best)this.releaseGun(p,best);}
      if(p.defuseKit){this.drops.push({id:`drop-${++this.nextDrop}`,kind:'defusekit',x:p.x,y:p.y,z:p.z,pickupAt:this.time+.5,endAt:this.time+180});p.defuseKit=false;this.drops=this.drops.slice(-64);}this.dropBomb(p);
      if(killer){if(killer===p){killer.kills--;}else if(killer.team===p.team){killer.kills--;this.credit(killer,ECONOMY.teamKillPenalty,'teamkill');}else {killer.kills++;this.credit(killer,ECONOMY.killReward,'kill');}}
      this.emit({type:'kill',attacker:killer?.name||'环境',victim:p.name,team:killer?.team,weapon:options.kind||killer?.weapon});
      this.sound(p,['player/die1.wav','player/die2.wav','player/die3.wav','player/death6.wav'][Math.min(3,Math.floor(this.audioRandom()*4))],{channel:'auto',priority:15});
    }return healthDamage;
  }
  targetRay(p,d,range,expand=0,rewindTime=null,origin=null,exclude=new Set()){const o=origin||{x:p.x,y:p.y+eyeHeight(p),z:p.z},wall=trace(o,{x:o.x+d.x*range,y:o.y+d.y*range,z:o.z+d.z*range});let distance=range*wall.fraction,target=null,targetPose=null,hitgroup='chest';
    for(const q of this.players.values())if(q.alive&&q.id!==p.id&&!exclude.has(q.id)){const pose=rewindTime===null?q:(this.lagComp?.pose(q.id,rewindTime,this.round)||q);const h=world.movement.bodyHeight(pose),box={x1:pose.x-.3-expand,x2:pose.x+.3+expand,y1:pose.y,y2:pose.y+h,z1:pose.z-.3-expand,z2:pose.z+.3+expand};
      const bone=rayPlayer(o,d,pose,rewindTime??this.time,expand),hit=bone?bone.distance:rayBox(o,d,box);
      if(hit<distance){distance=hit;target=q;targetPose=pose;const y=o.y+d.y*hit-pose.y;hitgroup=bone?bone.hitgroup:y>h-.38?'head':y<h*.35?'legs':y<h*.58?'stomach':'chest';}}
    const to={x:o.x+d.x*distance,y:o.y+d.y*distance,z:o.z+d.z*distance};
    const surface=impactSurface(wall),impact=!target&&!wall.startSolid&&wall.fraction<1?{position:{...to},normal:{x:wall.normal[0],y:wall.normal[1],z:wall.normal[2]},material:surface.material,soundSurface:surface}:null;
    return {o,d,distance,target,targetPose,hitgroup,to,impact};
  }
  shieldBlocks(p,ray){const pose=ray.targetPose||p;return pose.shield&&pose.shieldRaised&&ray.hitgroup!=='legs'&&((-Math.sin(pose.yaw))*(-ray.d.x)+(-Math.cos(pose.yaw))*(-ray.d.z))>.4;}
  knife(p,secondary=false){if(!p.alive||!allowsPlayerActions(this.phase)||p.weapon!=='knife'||p.shieldRaised||this.time<(p.nextAttackAt||0))return false;
    const ray=this.targetRay(p,direction(p.yaw,p.pitch),(secondary?32:48)*METRES_PER_UNIT,.12),hit=!!ray.target;
    const base=secondary?65:this.time-p.lastShot>.8?20:15;p.nextAttackAt=this.time+(secondary?(hit?1.1:1):(hit?.4:.35));p.nextSecondaryAt=this.time+(secondary?(hit?1.1:1):.5);p.lastShot=this.time;p.meleeSecondary=secondary;
    let amount=base;if(secondary&&ray.target){const toVictim={x:ray.target.x-p.x,z:ray.target.z-p.z},len=Math.hypot(toVictim.x,toVictim.z)||1;if((toVictim.x*-Math.sin(ray.target.yaw)+toVictim.z*-Math.cos(ray.target.yaw))/len>.8)amount*=3;}
    if(hit&&!this.shieldBlocks(ray.target,ray))this.damage(ray.target,amount*(ray.hitgroup==='head'?4:ray.hitgroup==='stomach'?1.25:ray.hitgroup==='legs'?.75:1),p,{kind:'knife',hitgroup:ray.hitgroup,armourRatio:1.7});
    this.emit({type:'melee',id:p.id,secondary,from:ray.o,to:ray.to,hit,wall:!!ray.impact,blocked:!!ray.target&&this.shieldBlocks(ray.target,ray)});return true;
  }
  shoot(p,burstFollowup=false){if(!p?.alive||!allowsPlayerActions(this.phase)||p.shieldRaised)return false;
    if(p.weapon==='knife')return this.knife(p);
    if(GRENADE_IDS.includes(p.weapon)){
      if(this.time+1e-8<(p.nextAttackAt||0)||(p.grenadePhase&&p.grenadePhase!=='throw')||p.grenades[p.weapon]<=0)return false;
      // A real held attack after the throw cooldown can pull the next grenade
      // before WeaponIdle retires it. Do not redeploy or carry its old release.
      resetGrenadeThrow(p);
      p.grenadePhase='pin';p.grenadeStartedAt=this.time;p.grenadeReleased=false;return true;
    }
    const w=GUNS[p.weapon];if(!w||this.time<(p.nextAttackAt||0))return false;
    if(p.ammo<=0){if(!p.reloadAt&&this.time>=(p.nextDryFireAt||0)){p.nextDryFireAt=this.time+.2;this.sound(p,w.slot===2?'weapons/dryfire_pistol.wav':'weapons/dryfire_rifle.wav',{private:true,channel:'weapon',volume:.8});}return false;}
    const profile=consumeGunShot(p,this.time,burstFollowup,this.random);if(!profile)return false;
    const damage=cs2?w.damage:p.silenced&&p.weapon==='usp'?30:p.silenced&&p.weapon==='m4a1'?33:w.damage;
    const shotId=`${this.round}:${p.id}:${p.lastAppliedInputSeq||0}:${this.time}`,rewindTime=this.lagComp?.targetTime(p.id,p.lastAppliedInputSeq,this.time,this.round)??null;
    for(let pellet=0;pellet<w.pellets;pellet++){
      const d=pellet?spreadDirection(profile,this.random,'buckshot'):profile.direction;
      const properties=bulletProperties(w),excluded=new Set();let origin=null,range=(w.range||8192)*METRES_PER_UNIT,remaining=damage,travelled=0;
      for(let penetration=0;penetration<(w.pellets>1?1:properties.hits);penetration++){
      const ray=this.targetRay(p,d,range,0,rewindTime,origin,excluded),blocked=ray.target&&this.shieldBlocks(ray.target,ray);
      travelled+=ray.distance;
      let hitImpact=null;
      if(ray.target){
        const target=ray.target,armour=target.armour,hp=target.hp,helmet=target.helmet;
        if(!blocked){const rangeModifier=!cs2&&p.silenced&&p.weapon==='m4a1'?.95:w.rangeModifier;const falloff=w.rangeModel==='linear'?Math.max(0,1-ray.distance/METRES_PER_UNIT/(w.range||3000)):Math.pow(rangeModifier,ray.distance/METRES_PER_UNIT/500);
          this.damage(target,remaining*falloff*(ray.hitgroup==='head'?w.head:ray.hitgroup==='stomach'?1.25:ray.hitgroup==='legs'?.75:1),p,{kind:p.weapon,hitgroup:ray.hitgroup,armourRatio:w.armorRatio});}
        if((blocked&&(target.team!==p.team||this.friendlyFire))||target.hp<hp||target.armour<armour){
          const pose=ray.targetPose||target,effect=blocked?'shield':ray.hitgroup==='head'&&helmet?'helmet':armour>0&&ray.hitgroup!=='head'&&ray.hitgroup!=='legs'?'armour':'blood';
          hitImpact={targetId:target.id,effect,hitgroup:ray.hitgroup,position:{...ray.to},direction:{...d},offset:{x:ray.to.x-pose.x,y:ray.to.y-pose.y,z:ray.to.z-pose.z}};
          if(effect==='blood'){
            const wall=trace(ray.to,{x:ray.to.x+d.x*2.5,y:ray.to.y+d.y*2.5,z:ray.to.z+d.z*2.5});
            if(!wall.startSolid&&wall.fraction<1)hitImpact.wall={position:wall.end,normal:{x:wall.normal[0],y:wall.normal[1],z:wall.normal[2]}};
          }
        }
      }
      this.emit({type:'shot',id:p.id,weapon:p.weapon,silenced:!!p.silenced,burstMode:!!p.burstMode,shotId,shotOrdinal:p.shotsFired,inputSeq:p.lastAppliedInputSeq||0,round:this.round,rewindMs:rewindTime===null?0:(this.time-rewindTime)*1000,from:ray.o,to:ray.to,hit:!!ray.target&&!blocked,impact:ray.impact,...(hitImpact?{hitImpact}:{}),burst:profile.burst,recoilYaw:profile.recoilYaw,recoilPitch:profile.recoilPitch,spread:profile.spread});
      if(blocked||travelled>properties.distance||(!ray.target&&!ray.impact))break;
      range=(range-ray.distance)*(ray.target?.75:.5);if(range<=.01)break;
      remaining*=Math.pow(w.rangeModifier,ray.distance/METRES_PER_UNIT/500);
      if(ray.target){excluded.add(ray.target.id);origin={x:ray.to.x+d.x*.002,y:ray.to.y+d.y*.002,z:ray.to.z+d.z*.002};remaining*=.75;}
      else{origin=penetrationExit(ray.to,d,properties.power,ray.impact.material);remaining*=materialDamage(ray.impact.material);}
      if(!origin||remaining<1)break;
      }
    }
    saveActive(p);return true;
  }
  #reserveReleasedGrenade(p){
    if(grenadeProfile?.trajectoryVersion!==1)return;
    const state=this.#inputs.get(p.id),intent=state?.grenadeIntent;
    if(!intent?.released||state.pendingGrenadeLaunch||!p.grenadeReleased||!['pin','hold'].includes(p.grenadePhase)||this.time+1e-8<Math.max(intent.visualThrowAt??Infinity,p.grenadeStartedAt+GRENADE_TIMING.pinSeconds))return;
    // A released windup can survive an equip without blocking its ACK. Keep a
    // single inventory reservation; it is consumed only after actual creation.
    state.pendingGrenadeLaunch={...intent,round:this.round,jumpState:this.#grenadeJumps.get(p)};state.grenadeIntent=null;p.grenadeIntentStatus='released-pending';
  }
  #updatePendingGrenade(p){
    const state=this.#inputs.get(p.id),intent=state?.pendingGrenadeLaunch;
    if(!intent)return;
    if(!p.alive||intent.round!==this.round||!allowsPlayerActions(this.phase)){delete state.pendingGrenadeLaunch;return;}
    if(this.time+1e-8<intent.launchAt)return;
    const choice=selectGrenadeJumpPose(intent.jumpState,grenadeProfile,this.time,{canDefer:!intent.launchDeferred});
    if(choice.defer){intent.launchDeferred=true;intent.launchAt+=grenadeProfile.releaseDelaySeconds;return;}
    delete state.pendingGrenadeLaunch;
    const kind=intent.weapon,owner=applyGrenadeReleaseView(choice.pose?{...p,...choice.pose}:p,intent,choice.sampleInputSeq??(p.lastAppliedInputSeq||0),choice.sampledAt??this.time);
    const grenade=this.projectiles.length<GRENADE_LIMITS.active&&p.grenades[kind]>0?createGrenade(owner,kind,this.time,{strength:throwStrength(intent.control,grenadeControlTime(intent,this.time))}):null;
    if(!grenade){if(!state.grenadeIntent&&p.grenadeActionId===intent.actionId)p.grenadeIntentStatus='cancelled';return;}
    grenade.actionId=intent.actionId;grenade.round=this.round;p.grenades[kind]--;this.projectiles.push(grenade);
    if(!state.grenadeIntent&&p.grenadeActionId===intent.actionId)p.grenadeIntentStatus='thrown';
    // This detached commit must not touch the currently displayed gun/knife,
    // its deploy, recoil, reload, nextAttackAt, lastShot, scope or quick-switch.
    this.emit({type:'throw',id:p.id,kind,actionId:grenade.actionId,projectileId:grenade.id,round:this.round,strength:grenade.strength,mode:grenade.mode,launchSource:choice.source,sampledAt:choice.sampledAt??this.time,switchedBeforeLaunch:true});
    this.sound(p,'radio/ct_fireinhole.wav',{global:true,team:p.team,category:'voice',channel:'radio',priority:20});
  }
  updateGrenade(p,actualInput){
    const inputState=this.#inputs.get(p.id);
    if(!p.grenadePhase||!GRENADE_IDS.includes(p.weapon))return;
    const controlIntent=inputState?.grenadeIntent,control=controlIntent?.control;
    if(control){p.grenadeStrength=throwStrength(control,grenadeControlTime(controlIntent,this.time));p.grenadeMode=throwMode(p.grenadeStrength);}
    if(p.grenadePhase==='throw'){
      const retire=p.grenades[p.weapon]>0?GRENADE_TIMING.retireWithAmmoSeconds:GRENADE_TIMING.recoverSeconds;
      if(this.time+1e-8>=p.grenadeThrownAt+retire)this.activate(p,p.primary||p.pistol||'knife',this.time);
      return;
    }
    // Persistent weapon state: movement gaps/synthetic idle are neither release
    // nor cancellation. Intent-mode release travels on the reliable control lane.
    if(p.grenadeProtocol!==GRENADE_PROTOCOL&&actualInput&&!p.input.fire)p.grenadeReleased=true;
    const nextPhase=grenadeActionPhase(p.grenadeStartedAt,this.time,p.grenadeReleased);
    if(nextPhase==='pin')return;
    p.grenadePhase='hold';if(nextPhase!=='throw')return;
    const kind=p.weapon,intent=inputState?.grenadeIntent;
    let launchOwner=intent?.aim?{...p,...intent.aim}:p;
    if(grenadeProfile?.trajectoryVersion===1){
      // Position, velocity, eye and angles share one authoritative sample. Old
      // release-angle overrides remain confined to the v1/v2 compatibility path.
      launchOwner=p;
      if(intent){
        intent.launchAt??=Math.max(this.time,p.grenadeStartedAt+GRENADE_TIMING.pinSeconds)+grenadeProfile.releaseDelaySeconds;
        if(this.time+1e-8<intent.launchAt)return;
        const choice=selectGrenadeJumpPose(this.#grenadeJumps.get(p),grenadeProfile,this.time,{canDefer:!intent.launchDeferred});
        if(choice.defer){intent.launchDeferred=true;intent.launchAt+=grenadeProfile.releaseDelaySeconds;return;}
        if(choice.pose)launchOwner={...p,...choice.pose};
        launchOwner=applyGrenadeReleaseView(launchOwner,intent,choice.sampleInputSeq??(p.lastAppliedInputSeq||0),choice.sampledAt??this.time);
        intent.launchSampleSource=choice.source;intent.launchSampleTime=choice.sampledAt??this.time;
      }else if(inputState){inputState.grenadeLegacyLaunchAt??=this.time+grenadeProfile.releaseDelaySeconds;if(this.time+1e-8<inputState.grenadeLegacyLaunchAt)return;}
    }
    if(this.projectiles.length>=GRENADE_LIMITS.active){this.cancelGrenadeIntent(p);resetGrenadeThrow(p);return;}
    const grenade=createGrenade(launchOwner,kind,this.time,{strength:intent?.control?throwStrength(intent.control,grenadeControlTime(intent,this.time)):1});
    if(!grenade){this.cancelGrenadeIntent(p);resetGrenadeThrow(p);return;}
    grenade.actionId=intent?.actionId||0;grenade.round=this.round;
    this.#grenadeJumps.delete(p);p.grenades[kind]--;this.projectiles.push(grenade);p.grenadePhase='throw';p.grenadeThrownAt=this.time;
    p.grenadeIntentStatus='thrown';p.nextAttackAt=this.time+GRENADE_TIMING.recoverSeconds;p.lastShot=this.time;
    this.emit({type:'throw',id:p.id,kind,actionId:grenade.actionId,projectileId:grenade.id,round:this.round,strength:grenade.strength,mode:grenade.mode,...(grenadeProfile?.trajectoryVersion===1?{launchSource:intent?.launchSampleSource||'live',sampledAt:intent?.launchSampleTime??this.time}:{} )});
    this.sound(p,'radio/ct_fireinhole.wav',{global:true,team:p.team,category:'voice',channel:'radio',priority:20});
  }
  canReach(p,b,radius){if(Math.hypot(p.x-b.x,p.z-b.z)>=radius||Math.abs(p.y-(b.y||0))>1.3)return false;
    const o={x:p.x,y:p.y+eyeHeight(p),z:p.z},dx=b.x-o.x,dy=(b.y||0)+.2-o.y,dz=b.z-o.z,length=Math.hypot(dx,dy,dz);
    return length<.001||wallDistance(o,{x:dx/length,y:dy/length,z:dz/length})>length-.08;
  }
  use(p,dt){if(this.phase!=='live')return;let action='';const b=this.bomb;
    if((p.input.use||(p.weapon==='c4'&&p.input.fire))&&!p.moving&&!p.reloadAt&&isGrounded(p)){
      if(p.team==='T'&&b.state==='dropped'&&this.canReach(p,b,2)){this.bomb={state:'carried',holder:p.id};this.emit({type:'notice',text:`${p.name} 拾取炸弹`});}
      else if(p.team==='T'&&b.state==='carried'&&b.holder===p.id&&siteAt(p))action='plant';
      else if(p.team==='CT'&&b.state==='planted'&&this.canReach(p,b,2.3))action='defuse';
    }
    const starting=action!==p.action;
    if(starting)p.progress=0;p.action=action;p.progress=action?p.progress+dt:0;
    if(starting&&action==='defuse')this.sound(p,'weapons/c4_disarm.wav',{position:{x:b.x,y:b.y+.2,z:b.z},channel:'item',priority:20});
    if(action==='plant'&&p.progress>=RULES.plantSeconds){this.bomb={state:'planted',x:p.x,z:p.z,y:p.y,plantedAt:this.time,endAt:this.time+RULES.bombSeconds,site:siteAt(p).name,planter:p.id};p.progress=0;p.action='';if(p.weapon==='c4')this.activate(p,p.primary||p.pistol||'knife',this.time);this.emit({type:'notice',text:`炸弹已安放在 ${this.bomb.site} 点`});
      this.sound(p,'weapons/c4_plant.wav',{position:this.bomb,channel:'weapon',priority:20});
      this.sound(p,'radio/bombpl.wav',{global:true,category:'voice',channel:'announcer',priority:30});
    }
    if(action==='defuse'&&p.progress>=(p.defuseKit?RULES.defuseKitSeconds:RULES.defuseSeconds)){this.bomb.state='defused';this.emit({type:'soundStop',id:'world',channel:'voice'});this.sound(p,'weapons/c4_disarmed.wav',{position:b,channel:'item',priority:25});this.sound(p,'radio/bombdef.wav',{global:true,category:'voice',channel:'announcer',priority:30});this.finish('CT','成功拆除炸弹','defuse');}
  }
  updateBombSound(){
    const b=this.bomb;if(b.state!=='planted'||this.phase!=='live'){this.#bombSounds=null;return;}
    if(this.#bombSounds?.bomb!==b)this.#bombSounds={bomb:b,nextBeep:this.time+.5,nextWave:this.time,interval:Math.floor(RULES.bombSeconds/4),wave:0};
    const a=this.#bombSounds;
    if(this.time+1e-8>=a.nextWave){a.wave=Math.min(5,a.wave+1);a.nextWave=this.time+a.interval;a.interval*=.9;}
    if(this.time+1e-8>=a.nextBeep){a.nextBeep=this.time+1.4;this.sound(null,`weapons/c4_beep${a.wave}.wav`,{position:{x:b.x,y:b.y+.2,z:b.z},attenuation:[1.5,1,.8,.5,.2][a.wave-1],channel:'voice',priority:20});}
  }
  #playerCombat({p,command,preserveEdges},dt){
    const heldFire=p.fireHeld;
    updateWeapon(p,dt,this.time,preserveEdges);
    if(grenadeProfile?.trajectoryVersion===1){
      const latch=this.#grenadeJumps.get(p);
      if(latch?.punchPending){const sample=finalizeGrenadeJumpPunch(latch,p,this.time);if(sample)this.#grenadeJumps.set(p,sample);else this.#grenadeJumps.delete(p);}
      const pending=this.#inputs.get(p.id)?.pendingGrenadeLaunch;
      if(pending?.jumpState?.punchPending)pending.jumpState=finalizeGrenadeJumpPunch(pending.jumpState,p,this.time);
    }
    this.pickup(p);
    const w=GUNS[p.weapon];
    if(p.resumeZoomAt&&this.time>=p.resumeZoomAt){p.zoom=p.resumeZoom||90;p.resumeZoomAt=0;}
    if(updateReload(p,this.time))saveActive(p);
    if(this.phase==='live'){this.use(p,dt);if(this.phase!=='live')return false;}
    if(p.burstRemaining>0&&this.time+1e-8>=p.nextBurstAt){if(this.shoot(p,true))p.burstRemaining--;else p.burstRemaining=0;p.nextBurstAt=this.time+(weaponBehavior?.shotFollowupInterval?.(p)??.1);}
    this.updateGrenadeIntent(p);
    if(p.input.fire&&!p.action&&!(p.grenadeProtocol===GRENADE_PROTOCOL&&GRENADE_IDS.includes(p.weapon))&&(p.weapon==='knife'||GRENADE_IDS.includes(p.weapon)||w?.automatic||p.burstMode||!p.fireHeld))this.shoot(p);p.fireHeld=preserveEdges?heldFire:p.input.fire;
    this.updateGrenade(p,Boolean(command.seq)||(!preserveEdges&&this.time-p.lastInput<=LEGACY_INPUT_GRACE_SECONDS));
    this.#updatePendingGrenade(p);
    // Reload an empty active firearm even after the trigger is released.
    if(GUNS[p.weapon]&&p.ammo===0)this.reload(p.id);
    return true;
  }
  #resolveCombat(records,dt){
    // Movement retains its existing deterministic order. Only weapon operations
    // are merged by trusted server receipt order, with per-player input fences.
    for(let budget=records.length*(WEAPON_ACTION_LIMIT+1);budget>0;budget--){
      let chosen=null,action=null,invalid=false,priority=Infinity;
      for(const r of records){if(!r.p.alive)continue;const state=this.#inputs.get(r.p.id),a=state?.actions[0];
        const expired=a&&(a.round!==this.round||this.serverTick-a.tick>MAX_INPUT_AGE_TICKS),through=r.done?r.p.ackInputSeq:r.beforeAck,ready=a&&(expired||a.seq<=through);
        if(!ready&&r.done)continue;const value=ready?a.order:r.order,order=Number.isSafeInteger(value)&&value>0?value:Infinity;
        if(!chosen||order<priority||order===priority&&String(r.p.id)<String(chosen.p.id)){chosen=r;action=ready?a:null;invalid=expired;priority=order;}
      }
      if(!chosen)return true;
      if(action){this.#inputs.get(chosen.p.id).actions.shift();action.run(!invalid);}
      else {chosen.done=true;if(!this.#playerCombat(chosen,dt))return false;}
    }
    return true;
  }
  // One call is one authoritative 60Hz tick; transport/client dt is never used.
  step(){const dt=INPUT_DT;this.time+=dt;this.serverTick++;const all=[...this.players.values()];
    if(!all.length){this.waitForPlayers();return;}
    if(this.phase==='waiting'){this.begin();return;}
    if(this.phase==='ended'&&this.time>=this.endAt){this.begin();return;}
    if(this.phase==='countdown'){if(this.time>=this.endAt){this.phase='live';this.endAt=this.time+RULES.roundSeconds;this.buyEndAt=this.time+ECONOMY.buySeconds;this.message='回合进行中 · B 购买 / 1—5 切换装备';this.sound(null,['radio/moveout.wav','radio/letsgo.wav','radio/locknload.wav','radio/com_go.wav'][Math.min(3,Math.floor(this.audioRandom()*4))],{position:{x:0,y:0,z:0},global:true,category:'voice',channel:'announcer',priority:30});}return;}
    const combat=[];
    for(const p of all)if(p.alive){
      const command=this.#nextInput(p),beforeAck=p.ackInputSeq;p.input=command.input||command;
      const preserveEdges=!command.seq&&this.#inputs.get(p.id).sequenced,heldJump=p.jumpHeld;
      const locomotion=this.#locomotion.get(p)||createLocomotionState(p);
      const latchEnabled=grenadeProfile?.trajectoryVersion===1&&grenadeProfile.jumpLatchEnabled,latchActive=latchEnabled&&(p.grenadePhase==='pin'||p.grenadePhase==='hold')&&GRENADE_IDS.includes(p.weapon),pending=latchEnabled?this.#inputs.get(p.id)?.pendingGrenadeLaunch:null,jumpState=latchActive?this.#grenadeJumps.get(p):null,
        sampleJump=(latchActive||pending)&&(jumpState&&!jumpState.pose||pending?.jumpState&&!pending.jumpState.pose||p.grounded&&p.input.jump&&!heldJump),jumpBefore=sampleJump?captureGrenadePose(p,eyeHeight(p)):null;
      const beforeMove={x:p.x,y:p.y,z:p.z,vx:p.vx,vy:p.vy,vz:p.vz,grounded:p.grounded};movePlayer(p,p.input,dt,all);
      if(jumpBefore){const after=captureGrenadePose(p,eyeHeight(p),command.seq||p.lastAppliedInputSeq||0);if(latchActive){const state=recordGrenadeJump(jumpState,grenadeProfile,jumpBefore,after,this.time-dt,this.time,p.input.jump&&!heldJump);if(state)this.#grenadeJumps.set(p,state);else this.#grenadeJumps.delete(p);}if(pending)pending.jumpState=recordGrenadeJump(pending.jumpState,grenadeProfile,jumpBefore,after,this.time-dt,this.time,p.input.jump&&!heldJump);}
      else{if(jumpState&&(p.grounded||this.time-jumpState.cachedAt>grenadeProfile.jumpLatchWindowSeconds))this.#grenadeJumps.delete(p);if(pending?.jumpState&&(p.grounded||this.time-pending.jumpState.cachedAt>grenadeProfile.jumpLatchWindowSeconds))pending.jumpState=null;}
      const presentation=stepLocomotion(locomotion,p,dt);this.#locomotion.set(p,presentation.state);p.playerLocomotion=presentation.pose;
      // Advance native presentation exactly once from newly simulated travel.
      // Snapshot, equip and historical pose reads must remain side-effect free.
      advanceAnimation?.(p);
      for(const e of movementSoundStep(this.#movementSounds.get(p.id),{before:beforeMove,after:p,input:p.input,dt,surface:groundSoundSurface(p),random:this.audioRandom}))this.emit({...e,id:p.id,inputSeq:command.seq||0});
      if(p.landedSpeed>580*METRES_PER_UNIT)this.damage(p,(p.landedSpeed/METRES_PER_UNIT-580)*100/(1024-580),null,{kind:'fall',hitgroup:'legs'});
      // Synthetic idle is not a real button release. Preserve the edge latches
      // without firing/jumping, so loss cannot manufacture another press.
      if(preserveEdges)p.jumpHeld=heldJump;
      if(command.seq){p.ackInputSeq=command.seq;p.lastAppliedInputSeq=command.seq;p.appliedInputCommands++;}
      const inputState=this.#inputs.get(p.id);if(command.seq)inputState.lastOrder=command.receivedOrder;
      combat.push({p,command,preserveEdges,beforeAck,done:false,order:command.seq?command.receivedOrder:inputState.sequenced?inputState.lastOrder:inputState.receivedOrder});
    }
    if(!this.#resolveCombat(combat,dt))return;
    stepGrenades(this,dt);this.drops=this.drops.filter(d=>d.endAt>this.time);
    if(this.phase==='ended')return;
    this.updateBombSound();
    if(this.bomb.state==='planted'&&this.time>=this.bomb.endAt){this.emit({type:'soundStop',id:'world',channel:'voice'});this.sound(null,'weapons/c4_explode1.wav',{position:this.bomb,attenuation:.25,channel:'weapon',priority:40});this.bomb.state='exploded';this.finish('T','炸弹爆炸','bomb');return;}
    const present=team=>all.some(p=>p.team===team),alive=team=>all.some(p=>p.alive&&p.team===team);
    if(present('CT')&&!alive('CT'))this.finish('T','对方全灭');else if(present('T')&&!alive('T')&&this.bomb.state!=='planted')this.finish('CT','对方全灭');else if(this.time>=this.endAt&&this.bomb.state!=='planted')this.finish('CT','守住回合时间','timeout');
  }
  snapshot(viewerId=null){return {type:'state',version:'cs2-experimental-v1',experimental:true,worldContract:world.contract,weaponProfileId:weaponProfile.id,movementProfileId:world.contract.rulesVersion,grenadeProfileId:grenadeProfile?.id||'legacy-grenade-v1',ballisticsVersion:MAIN_BALLISTICS_VERSION,hitSlowdownVersion:HIT_SLOWDOWN_VERSION,hitRecoveryVersion:this.hitRecovery.version,collisionVersion:COLLISION_VERSION,jumpFatigueVersion:JUMP_FATIGUE_VERSION,scopeProtocol:SCOPE_VIEW_PROTOCOL,movementSync:MOVEMENT_SYNC,serverTick:this.serverTick,mapVersion:MAP_VERSION,time:this.time,phase:this.phase,round:this.round,score:{...this.score},endAt:this.endAt,buyEndAt:this.buyEndAt,message:this.message,bomb:{...this.bomb},projectiles:this.projectiles.map(g=>({id:g.id,kind:g.kind,x:g.x,y:g.y,z:g.z,bornAt:g.bornAt,resting:!!g.resting,actionId:g.actionId||0,round:g.round,ownerId:g.ownerId,...(grenadeProfile?.trajectoryVersion===1&&Number.isFinite(g.simulatedAt)?{simulatedAt:Math.min(this.time,Math.max(Number.isFinite(g.bornAt)?g.bornAt:0,g.simulatedAt))}:{})})),smokes:this.smokes.map(s=>structuredClone(s)),drops:this.drops.map(d=>({...d})),
      players:[...this.players.values()].map(player=>{
        const {input,lastInput,lastInputSeq,pendingMoney,grenadeButtons,grenadeStrength,grenadeMode,...p}=player,animation=hitboxAnimation(player,this.time);
        if(p.grenadePhase){Object.assign(p,{grenadeButtons,grenadeStrength,grenadeMode});if(grenadeProfile?.trajectoryVersion===1){const intent=this.#inputs.get(p.id)?.grenadeIntent;if(intent){p.grenadeLaunchAt=intent.launchAt||0;p.grenadeLaunchDeferred=!!intent.launchDeferred;p.grenadeVisualThrowAt=intent.visualThrowAt||0;}}}
        const pending=this.#inputs.get(p.id)?.pendingGrenadeLaunch;if(pending){p.pendingGrenadeActionId=pending.actionId;p.pendingGrenadeLaunchAt=pending.launchAt;}
        if(p.playerLocomotion)p.playerLocomotion=copyLocomotion(p.playerLocomotion);
        if(viewerId&&p.id!==viewerId){const {money,inventory,ammoPool,grenades,reserve,ammo,flashUntil,flashAmount,flashFade,defuseKit,nightvision,nightvisionOn,hitRecoveryVersion,...visible}=p;return {...visible,...animation};}
        return {...p,...animation,canBuy:this.canBuy(p),inventory:structuredClone(p.inventory),ammoPool:{...p.ammoPool},grenades:{...p.grenades}};
      })};}
}

 return new ExperimentalGame(options);
}
