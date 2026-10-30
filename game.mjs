import {RULES,WEAPONS,SPAWN_POINTS,blankInput,sanitizedInput,movePlayer,eyeHeight,rayBox,wallDistance,trace,siteAt,supportHeight,isGrounded,resetWeapon,updateWeapon,MAP_VERSION,buyZoneAt,direction} from './public/shared.js';
import {GUNS,EQUIPMENT} from './public/arsenal.js';
import {spreadDirection} from './public/weapons.js';
import {rayPlayer,hitboxAnimation,hitboxDiagnostics} from './hitboxes.mjs';
import {bulletProperties,materialAt,penetrationExit,materialDamage,groundSoundSurface,soundMaterialAt} from './ballistics.mjs';
import {createMovementSoundState,movementSoundStep,RADIO_MENUS} from './public/movement-audio.js';
import {safeSound} from './public/sound-catalog.js';
import {allowsPlayerActions} from './public/round-state.js';
import {selectCharacter} from './public/characters-config.js';
import {ECONOMY,clampMoney,equipmentPrice} from './public/economy.js';
import {armourDamage} from './public/armour.js';
import {freshLoadout,saveActive,refillAmmo,activate,ownedWeapons,GRENADE_IDS} from './inventory.mjs';
import {createGrenade,stepGrenades,GRENADE_LIMITS} from './grenades.mjs';
import {MOVEMENT_SYNC,INPUT_DT,MAX_INPUT_QUEUE,MAX_INPUT_BATCH,MAX_INPUT_AGE_TICKS,INPUT_REORDER_TICKS,LEGACY_INPUT_GRACE_SECONDS,normalizeInputCommand,isNeutralInput,validInputSequence} from './public/input-protocol.js';
import {GRENADE_TIMING,resetGrenadeThrow,grenadeActionPhase} from './public/grenade-state.js';
import {GRENADE_PROTOCOL,normalizeGrenadeIntent} from './public/grenade-intent.js';
import {consumeGunShot} from './public/gun-state.js';
import {SCOPE_VIEW_PROTOCOL} from './public/awp-view.js';
import {MAIN_BALLISTICS_VERSION} from './public/weapon-feel.js';
const own=(o,k)=>typeof k==='string'&&Object.hasOwn(o,k);
const opponent=team=>team==='T'?'CT':'T';
export class Game {
  #inputs=new Map();
  #movementSounds=new Map();
  #bombSounds=null;
  constructor({random=Math.random,audioRandom=Math.random,friendlyFire=false}={}){this.random=random;this.audioRandom=audioRandom;this.friendlyFire=friendlyFire;this.players=new Map();this.phase='waiting';this.round=0;this.score={T:0,CT:0};this.time=0;this.serverTick=0;this.endAt=0;this.buyEndAt=0;this.events=[];this.bomb={state:'none'};this.message='等待玩家加入';this.lossStreak={T:0,CT:0};this.lossBonus=ECONOMY.lossBase;this.projectiles=[];this.smokes=[];this.drops=[];this.nextDrop=0;}
  emit(e){this.events.push({...e,time:this.time});if(this.events.length>1024)this.events.splice(0,this.events.length-1024);}
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
    this.cancelGrenadeIntent(p);
    activate(p,key,now);
    p.poseFromSequence=before?.playerSequence||null;p.poseFromFrame=before?.playerFrame||0;p.poseChangedAt=now;
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
  spawn(p){const index=[...this.players.values()].filter(a=>a.team===p.team).indexOf(p),s=SPAWN_POINTS[p.team][Math.max(0,index)%SPAWN_POINTS[p.team].length];
    if(!p.alive||!p.inventory)freshLoadout(p);else saveActive(p);
    this.credit(p,p.pendingMoney||0,'round');p.pendingMoney=0;
    Object.assign(p,{x:s.x,z:s.z,y:s.y,vy:0,vx:0,vz:0,grounded:true,yaw:s.yaw,pitch:0,hp:100,alive:true,crouch:false,jumpHeld:false,jumpFatigue:0,duckElapsed:0,duckAmount:0,ducking:false,stepDistance:0,velocityModifier:1,shotsFired:0,nextShotAt:0,lastInputSeq:0,ackInputSeq:0,reloadAt:0,progress:0,action:'',lastShot:-100,fireHeld:false,burstRemaining:0,flashUntil:0,flashAmount:0,flashFade:0,zoom:90,resumeZoomAt:0,nextAttackAt:0,shieldRaised:false,playedRound:this.round,input:{...blankInput(),yaw:s.yaw}});
    p.gaitDistance=0;p.gaitYaw=null;p.airTime=0;p.flinchAt=-100;p.flinchHead=false;
    this.#movementSounds.set(p.id,createMovementSoundState());p.radioCount=0;p.nextRadioAt=0;
    p.recoilSeed=this.random===Math.random?Math.floor(Math.random()*0x100000000):null;
    p.y=supportHeight(p.x,p.z,s.y+.05);p.lastInput=this.time;
    this.#inputs.set(p.id,{queue:new Map(),sequenced:false,gapSince:null,skipThrough:0,grenadeIntent:null});
    p.grenadeAckSeq=0;p.grenadeActionId=0;p.grenadeIntentStatus='';p.grenadeRejectedActionId=0;
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
      // Ordinary legacy trigger release must finish an already-started burst.
      // Sequenced menu/blur cancellation or an explicit watermark cancels it.
      if(state.sequenced||cancel!==undefined)p.burstRemaining=0;
    }else if(state.sequenced){return false;}
    else p.input=input;
    p.lastInput=this.time;return true;
  }
  inputBatch(id,commands){
    const p=this.players.get(id),state=this.#inputs.get(id);if(!p||!state||!Array.isArray(commands))return 0;
    let accepted=0;
    for(const raw of commands.slice(0,MAX_INPUT_BATCH)){
      const c=normalizeInputCommand(raw,this.round);
      if(!c||c.seq<=Math.max(p.ackInputSeq,state.skipThrough)||c.seq>p.ackInputSeq+MAX_INPUT_QUEUE||state.queue.has(c.seq)||state.queue.size>=MAX_INPUT_QUEUE)continue;
      state.queue.set(c.seq,{...c,receivedTick:this.serverTick});state.sequenced=true;
      p.lastInputSeq=Math.max(p.lastInputSeq,c.seq);p.lastInput=this.time;accepted++;
    }
    return accepted;
  }
  enableGrenadeIntents(id){const p=this.players.get(id);if(p)p.grenadeProtocol=GRENADE_PROTOCOL;}
  cancelGrenadeIntent(p){
    const state=this.#inputs.get(p.id);
    if(state?.grenadeIntent){
      const pending=state.grenadeIntent.held;state.grenadeIntent=null;
      if(p.grenadePhase!=='throw'||pending)p.grenadeIntentStatus='cancelled';
    }
  }
  grenadeIntent(id,raw){
    const p=this.players.get(id),state=this.#inputs.get(id),c=normalizeGrenadeIntent(raw,this.round);
    if(!p||!state||p.grenadeProtocol!==GRENADE_PROTOCOL||!c||c.seq!==(p.grenadeAckSeq||0)+1)return null;
    p.grenadeAckSeq=c.seq;
    const reply=(status,reason='')=>({type:'grenadeAck',round:this.round,seq:c.seq,actionId:c.actionId,status,reason});
    const reject=reason=>{p.grenadeRejectedActionId=c.actionId;return reply('rejected',reason);};
    if(c.kind==='cancel'){
      if(c.actionId!==0&&state.grenadeIntent&&c.actionId!==state.grenadeIntent.actionId)return reject('stale-action');
      this.cancelGrenadeIntent(p);if(p.grenadePhase!=='throw'){resetGrenadeThrow(p);p.grenadeIntentStatus='cancelled';}
      return reply(p.grenadePhase==='throw'&&p.grenadeIntentStatus!=='cancelled'?'thrown':'cancelled');
    }
    if(c.kind==='press'){
      if(!p.alive||!allowsPlayerActions(this.phase)||p.weapon!==c.weapon||!p.grenades[c.weapon]||p.shieldRaised||p.action||state.grenadeIntent?.held||['pin','hold'].includes(p.grenadePhase))return reject('not-ready');
      state.grenadeIntent={actionId:c.actionId,weapon:c.weapon,held:true,released:false,aim:null};
      p.grenadeActionId=c.actionId;p.grenadeIntentStatus='pending';this.updateGrenadeIntent(p);
      return reply(p.grenadeIntentStatus);
    }
    const intent=state.grenadeIntent;
    if(!intent||intent.actionId!==c.actionId||intent.weapon!==c.weapon||!p.alive||p.weapon!==c.weapon)return reject('stale-action');
    if(intent.released)return reply(p.grenadeIntentStatus);
    intent.held=false;intent.released=true;intent.aim={yaw:c.yaw,pitch:c.pitch};
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
        p.inventory[item]={ammo:w.clip,silenced:false,burstMode:false};if(w.slot===1)p.primary=item;else p.pistol=item;
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
    if(typeof key!=='string'||!owned.includes(key)||key===p.weapon)return false;this.activate(p,key,this.time);return true;
  }
  reload(id){const p=this.players.get(id),w=GUNS[p?.weapon];if(p?.alive&&allowsPlayerActions(this.phase)&&w&&!p.reloadAt&&p.reserve>0&&p.ammo<w.clip){p.reloadStartedAt=this.time;p.reloadAt=this.time+(w.reloadStyle==='per-shell'?w.reloadStart:w.reload);p.zoom=90;p.resumeZoomAt=0;p.progress=0;p.burstRemaining=0;resetWeapon(p,{keepPunch:true});if(['aug','famas','mac10','mp5navy'].includes(p.weapon))p.accuracy=0;
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
        const head=options.hitgroup==='head',reacting=this.time-p.flinchAt>=0&&this.time-p.flinchAt<.16;
        // Let a reaction finish under automatic fire; head hits can supersede a
        // body reaction. The same phase feeds rendered and historical hitboxes.
        if(!reacting||(head&&!p.flinchHead)){p.flinchAt=this.time;p.flinchHead=head;}
      }
      const large=!p.crouch&&options.hitgroup!=='legs'&&['scout','aug','sg550','galil','famas','awp','m3','m4a1','g3sg1','deagle','sg552','ak47'].includes(options.kind);
      p.velocityModifier=large?.65:.5;
      if(large&&Math.hypot(p.vx||0,p.vz||0,p.vy||0)<300/40){const dx=p.x-killer.x,dy=p.y-killer.y,dz=p.z-killer.z,len=Math.hypot(dx,dy,dz)||1;p.vx+=dx/len*170/40;p.vz+=dz/len*170/40;}
      const unprotected=options.hitgroup==='head'?!p.helmet:!p.armour;
      if(unprotected&&['head','chest','stomach'].includes(options.hitgroup))p.recoilPitch=Math.min(options.hitgroup==='head'?12:4,amount*(options.hitgroup==='head'?.5:.1))*Math.PI/180;
    }
    p.hp=Math.max(0,p.hp-healthDamage);p.progress=0;p.action='';this.emit({type:'damage',id:p.id,amount:healthDamage,armour:result.armourDamage,hitgroup:options.hitgroup,kind:options.kind});
    if(healthDamage>0||result.armourDamage>0){
      const n=1+Math.min(2,Math.floor(this.audioRandom()*3));
      const name=options.kind==='fall'?'player/pl_fallpain'+(1+Math.min(1,Math.floor(this.audioRandom()*2))+1)+'.wav':options.hitgroup==='head'?(p.helmet?'player/bhit_helmet-1.wav':`player/headshot${n}.wav`):previousArmour>0&&options.hitgroup!=='legs'?'player/bhit_kevlar-1.wav':`player/bhit_flesh-${n}.wav`;
      this.sound(p,name,{channel:'voice',priority:15});
    }
    if(p.hp<=0){p.alive=false;p.diedAt=this.time;p.deaths++;p.reloadAt=0;p.burstRemaining=0;this.cancelGrenadeIntent(p);resetGrenadeThrow(p);saveActive(p);
      if(p.shield)this.releaseShield(p);else {const best=p.primary||p.pistol;if(best)this.releaseGun(p,best);}
      if(p.defuseKit){this.drops.push({id:`drop-${++this.nextDrop}`,kind:'defusekit',x:p.x,y:p.y,z:p.z,pickupAt:this.time+.5,endAt:this.time+180});p.defuseKit=false;this.drops=this.drops.slice(-64);}this.dropBomb(p);
      if(killer){if(killer===p){killer.kills--;}else if(killer.team===p.team){killer.kills--;this.credit(killer,ECONOMY.teamKillPenalty,'teamkill');}else {killer.kills++;this.credit(killer,ECONOMY.killReward,'kill');}}
      this.emit({type:'kill',attacker:killer?.name||'环境',victim:p.name,team:killer?.team,weapon:options.kind||killer?.weapon});
      this.sound(p,['player/die1.wav','player/die2.wav','player/die3.wav','player/death6.wav'][Math.min(3,Math.floor(this.audioRandom()*4))],{channel:'auto',priority:15});
    }return healthDamage;
  }
  targetRay(p,d,range,expand=0,rewindTime=null,origin=null,exclude=new Set()){const o=origin||{x:p.x,y:p.y+eyeHeight(p),z:p.z},wall=trace(o,{x:o.x+d.x*range,y:o.y+d.y*range,z:o.z+d.z*range});let distance=range*wall.fraction,target=null,targetPose=null,hitgroup='chest';
    for(const q of this.players.values())if(q.alive&&q.id!==p.id&&!exclude.has(q.id)){const pose=rewindTime===null?q:(this.lagComp?.pose(q.id,rewindTime,this.round)||q);const h=pose.crouch?.9:1.8,box={x1:pose.x-.3-expand,x2:pose.x+.3+expand,y1:pose.y,y2:pose.y+h,z1:pose.z-.3-expand,z2:pose.z+.3+expand};
      const bone=rayPlayer(o,d,pose,rewindTime??this.time,expand),hit=bone?bone.distance:rayBox(o,d,box);
      if(hit<distance){distance=hit;target=q;targetPose=pose;const y=o.y+d.y*hit-pose.y;hitgroup=bone?bone.hitgroup:y>h-.38?'head':y<h*.35?'legs':y<h*.58?'stomach':'chest';}}
    const to={x:o.x+d.x*distance,y:o.y+d.y*distance,z:o.z+d.z*distance};
    const impact=!target&&!wall.startSolid&&wall.fraction<1?{position:{...to},normal:{x:wall.normal[0],y:wall.normal[1],z:wall.normal[2]},material:materialAt(to,wall.normal,wall.model),soundSurface:soundMaterialAt(to,wall.normal,wall.model)}:null;
    return {o,d,distance,target,targetPose,hitgroup,to,impact};
  }
  shieldBlocks(p,ray){const pose=ray.targetPose||p;return pose.shield&&pose.shieldRaised&&ray.hitgroup!=='legs'&&((-Math.sin(pose.yaw))*(-ray.d.x)+(-Math.cos(pose.yaw))*(-ray.d.z))>.4;}
  knife(p,secondary=false){if(!p.alive||!allowsPlayerActions(this.phase)||p.weapon!=='knife'||p.shieldRaised||this.time<(p.nextAttackAt||0))return false;
    const ray=this.targetRay(p,direction(p.yaw,p.pitch),(secondary?32:48)/40,.12),hit=!!ray.target;
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
    const damage=p.silenced&&p.weapon==='usp'?30:p.silenced&&p.weapon==='m4a1'?33:w.damage;
    const shotId=`${this.round}:${p.id}:${p.lastAppliedInputSeq||0}:${this.time}`,rewindTime=this.lagComp?.targetTime(p.id,p.lastAppliedInputSeq,this.time,this.round)??null;
    for(let pellet=0;pellet<w.pellets;pellet++){
      const d=pellet?spreadDirection(profile,this.random):profile.direction;
      const properties=bulletProperties(w),excluded=new Set();let origin=null,range=(w.range||8192)/40,remaining=damage,travelled=0;
      for(let penetration=0;penetration<(w.pellets>1?1:properties.hits);penetration++){
      const ray=this.targetRay(p,d,range,0,rewindTime,origin,excluded),blocked=ray.target&&this.shieldBlocks(ray.target,ray);
      travelled+=ray.distance;
      let hitImpact=null;
      if(ray.target){
        const target=ray.target,armour=target.armour,hp=target.hp,helmet=target.helmet;
        if(!blocked){const rangeModifier=p.silenced&&p.weapon==='m4a1'?.95:w.rangeModifier;const falloff=w.rangeModel==='linear'?Math.max(0,1-ray.distance*40/(w.range||3000)):Math.pow(rangeModifier,ray.distance*40/500);
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
      remaining*=Math.pow(w.rangeModifier,ray.distance*40/500);
      if(ray.target){excluded.add(ray.target.id);origin={x:ray.to.x+d.x*.002,y:ray.to.y+d.y*.002,z:ray.to.z+d.z*.002};remaining*=.75;}
      else{origin=penetrationExit(ray.to,d,properties.power,ray.impact.material);remaining*=materialDamage(ray.impact.material);}
      if(!origin||remaining<1)break;
      }
    }
    saveActive(p);return true;
  }
  updateGrenade(p,actualInput){
    const inputState=this.#inputs.get(p.id);
    if(!p.grenadePhase||!GRENADE_IDS.includes(p.weapon))return;
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
    if(this.projectiles.length>=GRENADE_LIMITS.active){this.cancelGrenadeIntent(p);resetGrenadeThrow(p);return;}
    const kind=p.weapon,intent=inputState?.grenadeIntent,grenade=createGrenade(intent?.aim?{...p,...intent.aim}:p,kind,this.time);
    if(!grenade){this.cancelGrenadeIntent(p);resetGrenadeThrow(p);return;}
    grenade.actionId=intent?.actionId||0;grenade.round=this.round;
    p.grenades[kind]--;this.projectiles.push(grenade);p.grenadePhase='throw';p.grenadeThrownAt=this.time;
    p.grenadeIntentStatus='thrown';p.nextAttackAt=this.time+GRENADE_TIMING.recoverSeconds;p.lastShot=this.time;
    this.emit({type:'throw',id:p.id,kind,actionId:grenade.actionId,projectileId:grenade.id,round:this.round});
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
  // One call is one authoritative 60Hz tick; transport/client dt is never used.
  step(){const dt=INPUT_DT;this.time+=dt;this.serverTick++;const all=[...this.players.values()];
    if(!all.length){this.waitForPlayers();return;}
    if(this.phase==='waiting'){this.begin();return;}
    if(this.phase==='ended'&&this.time>=this.endAt){this.begin();return;}
    if(this.phase==='countdown'){if(this.time>=this.endAt){this.phase='live';this.endAt=this.time+RULES.roundSeconds;this.buyEndAt=this.time+ECONOMY.buySeconds;this.message='回合进行中 · B 购买 / 1—5 切换装备';this.sound(null,['radio/moveout.wav','radio/letsgo.wav','radio/locknload.wav','radio/com_go.wav'][Math.min(3,Math.floor(this.audioRandom()*4))],{position:{x:0,y:0,z:0},global:true,category:'voice',channel:'announcer',priority:30});}return;}
    for(const p of all)if(p.alive){
      const command=this.#nextInput(p);p.input=command.input||command;
      const preserveEdges=!command.seq&&this.#inputs.get(p.id).sequenced,heldJump=p.jumpHeld,heldFire=p.fireHeld;
      const beforeMove={x:p.x,y:p.y,z:p.z,vx:p.vx,vy:p.vy,vz:p.vz,grounded:p.grounded};movePlayer(p,p.input,dt,all);
      for(const e of movementSoundStep(this.#movementSounds.get(p.id),{before:beforeMove,after:p,input:p.input,dt,surface:groundSoundSurface(p),random:this.audioRandom}))this.emit({...e,id:p.id,inputSeq:command.seq||0});
      if(p.landedSpeed>580/40)this.damage(p,(p.landedSpeed*40-580)*100/(1024-580),null,{kind:'fall',hitgroup:'legs'});
      // Synthetic idle is not a real button release. Preserve the edge latches
      // without firing/jumping, so loss cannot manufacture another press.
      if(preserveEdges)p.jumpHeld=heldJump;
      if(command.seq){p.ackInputSeq=command.seq;p.lastAppliedInputSeq=command.seq;p.appliedInputCommands++;}
      updateWeapon(p,dt,this.time,preserveEdges);this.pickup(p);
      const w=GUNS[p.weapon];
      if(p.resumeZoomAt&&this.time>=p.resumeZoomAt){p.zoom=p.resumeZoom||90;p.resumeZoomAt=0;}
      if(p.reloadAt&&this.time+1e-8>=p.reloadAt&&w){const n=Math.min(w.clip-p.ammo,p.reserve,w.reloadStyle==='per-shell'?1:Infinity);p.ammo+=n;p.reserve-=n;p.reloadAt=w.reloadStyle==='per-shell'&&p.ammo<w.clip&&p.reserve>0?p.reloadAt+w.reload:0;saveActive(p);}
      if(this.phase==='live'){this.use(p,dt);if(this.phase!=='live')return;}
      if(p.burstRemaining>0&&this.time+1e-8>=p.nextBurstAt){if(this.shoot(p,true))p.burstRemaining--;else p.burstRemaining=0;p.nextBurstAt=this.time+.1;}
      this.updateGrenadeIntent(p);
      if(p.input.fire&&!p.action&&!(p.grenadeProtocol===GRENADE_PROTOCOL&&GRENADE_IDS.includes(p.weapon))&&(p.weapon==='knife'||GRENADE_IDS.includes(p.weapon)||w?.automatic||p.burstMode||!p.fireHeld))this.shoot(p);p.fireHeld=preserveEdges?heldFire:p.input.fire;
      this.updateGrenade(p,Boolean(command.seq)||(!preserveEdges&&this.time-p.lastInput<=LEGACY_INPUT_GRACE_SECONDS));
      // Reload an empty active firearm even after the trigger is released.
      if(GUNS[p.weapon]&&p.ammo===0)this.reload(p.id);
    }
    stepGrenades(this,dt);this.drops=this.drops.filter(d=>d.endAt>this.time);
    if(this.phase==='ended')return;
    this.updateBombSound();
    if(this.bomb.state==='planted'&&this.time>=this.bomb.endAt){this.emit({type:'soundStop',id:'world',channel:'voice'});this.sound(null,'weapons/c4_explode1.wav',{position:this.bomb,attenuation:.25,channel:'weapon',priority:40});this.bomb.state='exploded';this.finish('T','炸弹爆炸','bomb');return;}
    const present=team=>all.some(p=>p.team===team),alive=team=>all.some(p=>p.alive&&p.team===team);
    if(present('CT')&&!alive('CT'))this.finish('T','对方全灭');else if(present('T')&&!alive('T')&&this.bomb.state!=='planted')this.finish('CT','对方全灭');else if(this.time>=this.endAt&&this.bomb.state!=='planted')this.finish('CT','守住回合时间','timeout');
  }
  snapshot(viewerId=null){return {type:'state',version:'0.5.0',ballisticsVersion:MAIN_BALLISTICS_VERSION,scopeProtocol:SCOPE_VIEW_PROTOCOL,movementSync:MOVEMENT_SYNC,serverTick:this.serverTick,mapVersion:MAP_VERSION,time:this.time,phase:this.phase,round:this.round,score:{...this.score},endAt:this.endAt,buyEndAt:this.buyEndAt,message:this.message,bomb:{...this.bomb},projectiles:this.projectiles.map(g=>({id:g.id,kind:g.kind,x:g.x,y:g.y,z:g.z,bornAt:g.bornAt,resting:!!g.resting,actionId:g.actionId||0,round:g.round,ownerId:g.ownerId})),smokes:this.smokes.map(s=>({...s})),drops:this.drops.map(d=>({...d})),
      players:[...this.players.values()].map(player=>{
        const {input,lastInput,lastInputSeq,pendingMoney,...p}=player,animation=hitboxAnimation(player,this.time);
        if(viewerId&&p.id!==viewerId){const {money,inventory,ammoPool,grenades,reserve,ammo,flashUntil,flashAmount,flashFade,defuseKit,nightvision,nightvisionOn,...visible}=p;return {...visible,...animation};}
        return {...p,...animation,canBuy:this.canBuy(p),inventory:structuredClone(p.inventory),ammoPool:{...p.ammoPool},grenades:{...p.grenades}};
      })};}
}
