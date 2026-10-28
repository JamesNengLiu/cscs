import {RULES,WEAPONS,SPAWN_POINTS,blankInput,sanitizedInput,movePlayer,eyeHeight,rayBox,wallDistance,trace,siteAt,supportHeight,isGrounded,resetWeapon,updateWeapon,shotProfile,MAP_VERSION,buyZoneAt,direction} from './public/shared.js';
import {GUNS,EQUIPMENT} from './public/arsenal.js';
import {allowsPlayerActions} from './public/round-state.js';
import {selectCharacter} from './public/characters-config.js';
import {ECONOMY,clampMoney,equipmentPrice} from './public/economy.js';
import {armourDamage} from './public/armour.js';
import {freshLoadout,saveActive,refillAmmo,activate,ownedWeapons,GRENADE_IDS} from './inventory.mjs';
import {createGrenade,stepGrenades,GRENADE_LIMITS} from './grenades.mjs';
const own=(o,k)=>typeof k==='string'&&Object.hasOwn(o,k);
const opponent=team=>team==='T'?'CT':'T';
export class Game {
  constructor({random=Math.random,friendlyFire=false}={}){this.random=random;this.friendlyFire=friendlyFire;this.players=new Map();this.phase='waiting';this.round=0;this.score={T:0,CT:0};this.time=0;this.endAt=0;this.buyEndAt=0;this.events=[];this.bomb={state:'none'};this.message='等待玩家加入';this.lossStreak={T:0,CT:0};this.lossBonus=ECONOMY.lossBase;this.projectiles=[];this.smokes=[];this.drops=[];this.nextDrop=0;}
  emit(e){this.events.push({...e,time:this.time});if(this.events.length>1024)this.events.splice(0,this.events.length-1024);}
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
    Object.assign(p,{x:s.x,z:s.z,y:s.y,vy:0,vx:0,vz:0,grounded:true,yaw:s.yaw,pitch:0,hp:100,alive:true,crouch:false,jumpHeld:false,lastInputSeq:0,ackInputSeq:0,reloadAt:0,progress:0,action:'',lastShot:-100,fireHeld:false,burstRemaining:0,flashUntil:0,flashAmount:0,zoom:90,resumeZoomAt:0,nextAttackAt:0,shieldRaised:false,playedRound:this.round,input:{...blankInput(),yaw:s.yaw}});
    p.y=supportHeight(p.x,p.z,s.y+.05);p.lastInput=this.time;
    activate(p,p.primary||p.pistol||'knife',this.time);refillAmmo(p);p.nextAttackAt=0;resetWeapon(p);
  }
  credit(p,amount,reason){if(!Number.isFinite(amount)||!amount)return;p.money=clampMoney(p.money,amount);this.emit({type:'money',id:p.id,amount,money:p.money,reason});}
  remove(id){const p=this.players.get(id);if(!p)return;this.dropBomb(p);this.players.delete(id);this.emit({type:'notice',text:`${p.name} 离开`});if(!this.players.size)this.waitForPlayers();}
  dropBomb(p){if(this.bomb.state==='carried'&&this.bomb.holder===p.id)this.bomb={state:'dropped',x:p.x,z:p.z,y:supportHeight(p.x,p.z,p.y)};}
  input(id,raw){const p=this.players.get(id);if(!p)return;if(raw?.round!==undefined&&raw.round!==this.round)return;
    if(raw?.seq!==undefined){if(!Number.isSafeInteger(raw.seq)||raw.seq<=p.lastInputSeq||raw.seq>2147483647)return;p.lastInputSeq=raw.seq;}
    p.input=sanitizedInput(raw);p.lastInput=this.time;
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
        p.ammoPool[w.ammoType]??=0;activate(p,item,this.time);refillAmmo(p,[item]);};
    }else if(own(EQUIPMENT,item)){
      const e=EQUIPMENT[item];if(!e.teams.includes(p.team))throw Error('该装备仅限另一阵营购买');cost=equipmentPrice(item,p);
      if(GRENADE_IDS.includes(item)){if(p.grenades[item]>=e.limit)throw Error('该投掷物已达携带上限');apply=()=>p.grenades[item]++;}
      else if(item==='kevlar'){if(p.armour>=100)throw Error('护甲已满');apply=()=>{p.armour=100;};}
      else if(item==='assaultsuit'){if(p.armour>=100&&p.helmet)throw Error('护甲与头盔已齐全');apply=()=>{p.armour=100;p.helmet=true;};}
      else if(item==='defusekit'){if(p.defuseKit)throw Error('已持有拆弹器');apply=()=>{p.defuseKit=true;};}
      else if(item==='nightvision'){if(p.nightvision)throw Error('已持有夜视仪');apply=()=>{p.nightvision=true;};}
      else if(item==='shield'){if(p.shield)throw Error('已持有防弹盾');if(p.pistol==='elite')throw Error('防弹盾不能与双枪同时持有');apply=()=>{if(p.primary)this.releaseGun(p,p.primary);p.shield=true;activate(p,p.pistol||'knife',this.time);};}
    }
    if(!apply||!Number.isFinite(cost)||cost<=0)throw Error('未知商品');if(p.money<cost)throw Error('金钱不足');
    apply();this.credit(p,-cost,'purchase');this.emit({type:'purchase',id:p.id,item,cost});return true;
  }
  equip(id,key){const p=this.players.get(id);if(!p?.alive||!['countdown','live','ended'].includes(this.phase))return false;
    const hasBomb=this.bomb.state==='carried'&&this.bomb.holder===id,owned=ownedWeapons(p,hasBomb);
    if(key==='last')key=p.previousWeapon;
    if(typeof key==='number'||/^[1-5]$/.test(String(key))){const slot=Number(key);if(slot===1)key=p.primary||(p.shield?p.pistol:null);else if(slot===2)key=p.pistol;else if(slot===3)key='knife';else if(slot===5)key=hasBomb?'c4':null;else{const gs=GRENADE_IDS.filter(g=>p.grenades[g]>0);key=gs[(gs.indexOf(p.weapon)+1)%gs.length];}}
    if(typeof key!=='string'||!owned.includes(key)||key===p.weapon)return false;activate(p,key,this.time);return true;
  }
  reload(id){const p=this.players.get(id),w=GUNS[p?.weapon];if(p?.alive&&allowsPlayerActions(this.phase)&&w&&!p.reloadAt&&p.reserve>0&&p.ammo<w.clip){p.reloadAt=this.time+(w.reloadStyle==='per-shell'?w.reloadStart:w.reload);p.zoom=90;p.resumeZoomAt=0;p.progress=0;p.burstRemaining=0;}}
  releaseGun(p,key){if(!own(GUNS,key)||!p.inventory[key])return;saveActive(p);const entry=p.inventory[key];
    this.drops.push({id:`drop-${++this.nextDrop}`,kind:'weapon',weapon:key,ammo:entry.ammo,silenced:!!entry.silenced,burstMode:!!entry.burstMode,x:p.x,y:p.y,z:p.z,ownerId:p.id,pickupAt:this.time+.5,endAt:this.time+180});
    delete p.inventory[key];if(p.primary===key)p.primary=null;if(p.pistol===key)p.pistol=null;this.drops=this.drops.slice(-64);
  }
  releaseShield(p){if(!p.shield)return;p.shield=false;p.shieldRaised=false;this.drops.push({id:`drop-${++this.nextDrop}`,kind:'shield',x:p.x,y:p.y,z:p.z,ownerId:p.id,pickupAt:this.time+.5,endAt:this.time+180});this.drops=this.drops.slice(-64);}
  drop(id){const p=this.players.get(id);if(!p?.alive||!allowsPlayerActions(this.phase))return false;if(p.shield){this.releaseShield(p);return true;}
    if(p.weapon==='c4'){this.dropBomb(p);activate(p,p.primary||p.pistol||'knife',this.time);return true;}if(!own(GUNS,p.weapon))return false;
    this.releaseGun(p,p.weapon);activate(p,p.primary||p.pistol||'knife',this.time);return true;
  }
  pickup(p){for(let i=this.drops.length-1;i>=0;i--){const d=this.drops[i];if(this.time<d.pickupAt||!this.canReach(p,d,.8))continue;
    if(d.kind==='defusekit'){if(p.team!=='CT'||p.defuseKit)continue;p.defuseKit=true;this.drops.splice(i,1);continue;}
    if(d.kind==='shield'){if(p.shield||p.primary||p.pistol==='elite')continue;p.shield=true;this.drops.splice(i,1);continue;}
    const w=GUNS[d.weapon];if(!w||p.inventory[d.weapon]||(w.slot===1&&(p.primary||p.shield))||(w.slot===2&&(p.pistol||(p.shield&&d.weapon==='elite'))))continue;
    saveActive(p);p.inventory[d.weapon]={ammo:d.ammo,silenced:d.silenced,burstMode:d.burstMode};p.ammoPool[w.ammoType]??=0;if(w.slot===1)p.primary=d.weapon;else p.pistol=d.weapon;
    this.drops.splice(i,1);activate(p,d.weapon,this.time);
  }}
  secondary(id){const p=this.players.get(id);if(!p?.alive||!allowsPlayerActions(this.phase)||this.time<(p.nextSecondaryAt||0)||p.reloadAt)return false;
    if(p.shield){p.shieldRaised=!p.shieldRaised;p.nextAttackAt=this.time+.4;p.nextSecondaryAt=this.time+.4;return true;}
    if(p.weapon==='knife')return this.knife(p,true);const w=GUNS[p.weapon];if(!w)return false;
    if(w.zoom){const levels=[90,...w.zoom];p.zoom=levels[(levels.indexOf(p.zoom)+1)%levels.length];p.nextSecondaryAt=this.time+.3;}
    else if(w.modes?.includes('silenced')){p.silenced=!p.silenced;p.nextAttackAt=this.time+2;p.nextSecondaryAt=this.time+2;}
    else if(w.modes?.includes('burst')){p.burstMode=!p.burstMode;p.burstRemaining=0;p.nextSecondaryAt=this.time+.3;}else return false;
    saveActive(p);return true;
  }
  toggleNightvision(id){const p=this.players.get(id);if(p?.alive&&p.nightvision)p.nightvisionOn=!p.nightvisionOn;}
  begin(){if(!this.players.size){this.waitForPlayers();return;}const contested=this.hasBothTeams();
    this.round++;this.phase=contested?'countdown':'live';this.endAt=this.time+(contested?RULES.freezeSeconds:RULES.roundSeconds);this.buyEndAt=this.time+(contested?RULES.freezeSeconds:0)+ECONOMY.buySeconds;this.message=contested?'准备回合 · B 购买武器与装备':'回合进行中 · B 购买 / 1—5 切换装备';this.projectiles=[];this.smokes=[];this.drops=[];
    for(const p of this.players.values())this.spawn(p);
    const t=[...this.players.values()].filter(p=>p.team==='T');this.bomb=t.length?{state:'carried',holder:t[(this.round-1)%t.length].id}:{state:'none'};this.emit({type:'round',round:this.round});
  }
  finish(team,reason,outcome='elimination'){if(this.phase!=='live'||!['T','CT'].includes(team))return false;
    const loser=opponent(team);if(this.lossStreak[team]>1)this.lossBonus=ECONOMY.lossReset;this.lossStreak[team]=0;this.lossStreak[loser]++;
    if(this.lossStreak[loser]>1&&this.lossBonus<ECONOMY.lossThreshold)this.lossBonus+=ECONOMY.lossIncrement;
    const winnerAmount=outcome==='bomb'?ECONOMY.winBomb:outcome==='defuse'?ECONOMY.winDefuse:outcome==='timeout'?ECONOMY.winTimeout:ECONOMY.winElimination;
    for(const p of this.players.values()){
      if(p.playedRound===this.round){const denied=outcome==='timeout'&&p.team==='T'&&p.alive;p.pendingMoney=denied?0:p.team===team?winnerAmount:this.lossBonus+(outcome==='defuse'&&p.team==='T'?ECONOMY.plantedLossBonus:0);}
      p.progress=0;p.action='';
    }
    this.phase='ended';this.endAt=this.time+6;this.score[team]++;this.message=`${team} 获胜 · ${reason}`;this.emit({type:'notice',text:this.message});return true;
  }
  damage(p,amount,killer,options={}){if(!p?.alive||!Number.isFinite(amount)||amount<=0)return 0;
    if(killer&&killer!==p&&killer.team===p.team&&!this.friendlyFire)return 0;
    const result=armourDamage(amount,p.armour||0,p.helmet,options.hitgroup||'chest',options.armourRatio??1,!!options.blast);p.armour=result.armour;
    p.hp=Math.max(0,p.hp-result.healthDamage);p.progress=0;p.action='';this.emit({type:'damage',id:p.id,amount:result.healthDamage,armour:result.armourDamage});
    if(p.hp<=0){p.alive=false;p.deaths++;p.reloadAt=0;p.burstRemaining=0;saveActive(p);
      if(p.shield)this.releaseShield(p);else {const best=p.primary||p.pistol;if(best)this.releaseGun(p,best);}
      if(p.defuseKit){this.drops.push({id:`drop-${++this.nextDrop}`,kind:'defusekit',x:p.x,y:p.y,z:p.z,pickupAt:this.time+.5,endAt:this.time+180});p.defuseKit=false;this.drops=this.drops.slice(-64);}this.dropBomb(p);
      if(killer){if(killer===p){killer.kills--;}else if(killer.team===p.team){killer.kills--;this.credit(killer,ECONOMY.teamKillPenalty,'teamkill');}else {killer.kills++;this.credit(killer,ECONOMY.killReward,'kill');}}
      this.emit({type:'kill',attacker:killer?.name||'环境',victim:p.name,team:killer?.team,weapon:options.kind||killer?.weapon});
    }return result.healthDamage;
  }
  targetRay(p,d,range,expand=0){const o={x:p.x,y:p.y+eyeHeight(p),z:p.z},wall=trace(o,{x:o.x+d.x*range,y:o.y+d.y*range,z:o.z+d.z*range});let distance=range*wall.fraction,target=null,hitgroup='chest';
    for(const q of this.players.values())if(q.alive&&q.id!==p.id){const h=eyeHeight(q)+.2,box={x1:q.x-.3-expand,x2:q.x+.3+expand,y1:q.y,y2:q.y+h,z1:q.z-.3-expand,z2:q.z+.3+expand},hit=rayBox(o,d,box);
      if(hit<distance){distance=hit;target=q;const y=o.y+d.y*hit-q.y;hitgroup=y>h-.38?'head':y<h*.35?'legs':y<h*.58?'stomach':'chest';}}
    const to={x:o.x+d.x*distance,y:o.y+d.y*distance,z:o.z+d.z*distance};
    const impact=!target&&!wall.startSolid&&wall.fraction<1?{position:{...to},normal:{x:wall.normal[0],y:wall.normal[1],z:wall.normal[2]}}:null;
    return {o,d,distance,target,hitgroup,to,impact};
  }
  shieldBlocks(p,ray){return p.shield&&p.shieldRaised&&ray.hitgroup!=='legs'&&((-Math.sin(p.yaw))*(-ray.d.x)+(-Math.cos(p.yaw))*(-ray.d.z))>.4;}
  knife(p,secondary=false){if(!p.alive||!allowsPlayerActions(this.phase)||p.weapon!=='knife'||p.shieldRaised||this.time<(p.nextAttackAt||0))return false;
    const ray=this.targetRay(p,direction(p.yaw,p.pitch),(secondary?32:48)/40,.12),hit=!!ray.target;
    const base=secondary?65:this.time-p.lastShot>.8?20:15;p.nextAttackAt=this.time+(secondary?(hit?1.1:1):(hit?.4:.35));p.nextSecondaryAt=this.time+(secondary?1:.5);p.lastShot=this.time;
    let amount=base;if(secondary&&ray.target){const toVictim={x:ray.target.x-p.x,z:ray.target.z-p.z},len=Math.hypot(toVictim.x,toVictim.z)||1;if((toVictim.x*-Math.sin(ray.target.yaw)+toVictim.z*-Math.cos(ray.target.yaw))/len>.8)amount*=3;}
    if(hit&&!this.shieldBlocks(ray.target,ray))this.damage(ray.target,amount*(ray.hitgroup==='head'?4:ray.hitgroup==='stomach'?1.25:ray.hitgroup==='legs'?.75:1),p,{kind:'knife',hitgroup:ray.hitgroup,armourRatio:1});
    this.emit({type:'melee',id:p.id,secondary,from:ray.o,to:ray.to,hit});return true;
  }
  shoot(p,burstFollowup=false){if(!p?.alive||!allowsPlayerActions(this.phase)||p.shieldRaised)return false;
    if(p.weapon==='knife')return this.knife(p);
    if(GRENADE_IDS.includes(p.weapon)){
      if(this.time<(p.nextAttackAt||0)||this.projectiles.length>=GRENADE_LIMITS.active||p.grenades[p.weapon]<=0)return false;
      const kind=p.weapon,grenade=createGrenade(p,kind,this.time);if(!grenade)return false;p.grenades[kind]--;this.projectiles.push(grenade);p.nextAttackAt=this.time+.5;this.emit({type:'throw',id:p.id,kind});
      if(!p.grenades[kind])activate(p,p.primary||p.pistol||'knife',this.time);return true;
    }
    const w=GUNS[p.weapon];if(!w||this.time<(p.nextAttackAt||0)||p.ammo<=0)return false;
    const interval=p.burstMode&&p.weapon==='glock18'?.5:p.burstMode&&p.weapon==='famas'?.55:w.interval;
    if(!burstFollowup&&this.time-p.lastShot<interval-1e-8)return false;
    if(p.reloadAt){if(w.reloadStyle==='per-shell'&&p.ammo>0)p.reloadAt=0;else return false;}
    p.lastShot=this.time;p.ammo--;const profile=shotProfile(p,this.random),damage=p.silenced&&p.weapon==='usp'?30:p.silenced&&p.weapon==='m4a1'?33:w.damage;
    for(let pellet=0;pellet<w.pellets;pellet++){
      const d=pellet?direction(p.yaw+(p.recoilYaw||0)+(this.random()*2-1)*profile.spread,p.pitch+(p.recoilPitch||0)+(this.random()*2-1)*profile.spread):profile.direction;
      const ray=this.targetRay(p,d,(w.range||8192)/40),blocked=ray.target&&this.shieldBlocks(ray.target,ray);
      if(ray.target&&!blocked){const rangeModifier=p.silenced&&p.weapon==='m4a1'?.95:w.rangeModifier;const falloff=w.rangeModel==='linear'?Math.max(0,1-ray.distance*40/(w.range||3000)):Math.pow(rangeModifier,ray.distance*40/500);
        this.damage(ray.target,damage*falloff*(ray.hitgroup==='head'?w.head:ray.hitgroup==='stomach'?1.25:ray.hitgroup==='legs'?.75:1),p,{kind:p.weapon,hitgroup:ray.hitgroup,armourRatio:w.armorRatio});}
      this.emit({type:'shot',id:p.id,weapon:p.weapon,from:ray.o,to:ray.to,hit:!!ray.target&&!blocked,impact:ray.impact,burst:profile.burst,recoilYaw:profile.recoilYaw,recoilPitch:profile.recoilPitch,spread:profile.spread});
    }
    if(p.burstMode&&!burstFollowup&&['glock18','famas'].includes(p.weapon)){p.burstRemaining=Math.min(2,p.ammo);p.nextBurstAt=this.time+(p.weapon==='glock18'?.1:.05);}
    if(['awp','scout'].includes(p.weapon)&&p.zoom!==90){p.resumeZoom=p.zoom;p.zoom=90;p.resumeZoomAt=this.time+w.interval;}
    saveActive(p);return true;
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
    if(action!==p.action)p.progress=0;p.action=action;p.progress=action?p.progress+dt:0;
    if(action==='plant'&&p.progress>=RULES.plantSeconds){this.bomb={state:'planted',x:p.x,z:p.z,y:p.y,endAt:this.time+RULES.bombSeconds,site:siteAt(p).name,planter:p.id};p.progress=0;p.action='';if(p.weapon==='c4')activate(p,p.primary||p.pistol||'knife',this.time);this.emit({type:'notice',text:`炸弹已安放在 ${this.bomb.site} 点`});}
    if(action==='defuse'&&p.progress>=(p.defuseKit?RULES.defuseKitSeconds:RULES.defuseSeconds)){this.bomb.state='defused';this.finish('CT','成功拆除炸弹','defuse');}
  }
  step(dt=1/RULES.tick){dt=Math.max(0,Math.min(.1,Number.isFinite(dt)?dt:0));this.time+=dt;const all=[...this.players.values()];
    if(!all.length){this.waitForPlayers();return;}
    if(this.phase==='waiting'){this.begin();return;}
    if(this.phase==='ended'&&this.time>=this.endAt){this.begin();return;}
    if(this.phase==='countdown'){if(this.time>=this.endAt){this.phase='live';this.endAt=this.time+RULES.roundSeconds;this.buyEndAt=this.time+ECONOMY.buySeconds;this.message='回合进行中 · B 购买 / 1—5 切换装备';}return;}
    for(const p of all)if(p.alive){
      if(this.time-p.lastInput>.5)p.input={...blankInput(),yaw:p.yaw,pitch:p.pitch};
      movePlayer(p,p.input,dt);p.ackInputSeq=p.lastInputSeq;updateWeapon(p,dt,this.time);this.pickup(p);
      const w=GUNS[p.weapon];
      if(p.resumeZoomAt&&this.time>=p.resumeZoomAt){p.zoom=p.resumeZoom||90;p.resumeZoomAt=0;}
      if(p.reloadAt&&this.time>=p.reloadAt&&w){const n=Math.min(w.clip-p.ammo,p.reserve,w.reloadStyle==='per-shell'?1:Infinity);p.ammo+=n;p.reserve-=n;p.reloadAt=w.reloadStyle==='per-shell'&&p.ammo<w.clip&&p.reserve>0?this.time+w.reload:0;saveActive(p);}
      if(this.phase==='live'){this.use(p,dt);if(this.phase!=='live')return;}
      if(p.burstRemaining>0&&this.time>=p.nextBurstAt){if(this.shoot(p,true))p.burstRemaining--;else p.burstRemaining=0;p.nextBurstAt=this.time+(p.weapon==='glock18'?.1:.05);}
      if(p.input.fire&&!p.action&&(p.weapon==='knife'||(w?.automatic&&!p.burstMode)||!p.fireHeld))this.shoot(p);p.fireHeld=p.input.fire;
      // Reload an empty active firearm even after the trigger is released.
      if(GUNS[p.weapon]&&p.ammo===0)this.reload(p.id);
    }
    stepGrenades(this,dt);this.drops=this.drops.filter(d=>d.endAt>this.time);
    if(this.phase==='ended')return;
    if(this.bomb.state==='planted'&&this.time>=this.bomb.endAt){this.bomb.state='exploded';this.finish('T','炸弹爆炸','bomb');return;}
    const present=team=>all.some(p=>p.team===team),alive=team=>all.some(p=>p.alive&&p.team===team);
    if(present('CT')&&!alive('CT'))this.finish('T','对方全灭');else if(present('T')&&!alive('T')&&this.bomb.state!=='planted')this.finish('CT','对方全灭');else if(this.time>=this.endAt&&this.bomb.state!=='planted')this.finish('CT','守住回合时间','timeout');
  }
  snapshot(viewerId=null){return {type:'state',version:'0.5.0',movementSync:'ack-replay-v1',mapVersion:MAP_VERSION,time:this.time,phase:this.phase,round:this.round,score:{...this.score},endAt:this.endAt,buyEndAt:this.buyEndAt,message:this.message,bomb:{...this.bomb},projectiles:this.projectiles.map(g=>({id:g.id,kind:g.kind,x:g.x,y:g.y,z:g.z})),smokes:this.smokes.map(s=>({...s})),drops:this.drops.map(d=>({...d})),
      players:[...this.players.values()].map(({input,lastInput,lastInputSeq,pendingMoney,...p})=>{
        if(viewerId&&p.id!==viewerId){const {money,inventory,ammoPool,grenades,reserve,ammo,flashUntil,flashAmount,defuseKit,nightvision,nightvisionOn,...visible}=p;return visible;}
        return {...p,canBuy:this.canBuy(p),inventory:structuredClone(p.inventory),ammoPool:{...p.ammoPool},grenades:{...p.grenades}};
      })};}
}
