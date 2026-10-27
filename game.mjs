import {RULES,WEAPONS,SPAWNS,SPAWN_POINTS,blankInput,sanitizedInput,movePlayer,eyeHeight,rayBox,wallDistance,siteAt,groundHeight,supportHeight,isGrounded,resetWeapon,updateWeapon,shotProfile,MAP_VERSION} from './public/shared.js';
export class Game {
  constructor({random=Math.random}={}){this.random=random;this.players=new Map();this.phase='waiting';this.round=0;this.score={T:0,CT:0};this.time=0;this.endAt=0;this.events=[];this.bomb={state:'none'};this.message='等待双方玩家加入';}
  emit(e){this.events.push({...e,time:this.time});}
  add(id,name,team){
    if(!['T','CT'].includes(team))throw Error('请选择阵营');
    if(this.players.size>=RULES.maxPlayers)throw Error('房间已满（最多10人）');
    if([...this.players.values()].filter(p=>p.team===team).length>=RULES.teamSize)throw Error('该阵营已满（最多5人）');
    const p={id,name:String(name||'玩家').replace(/[\x00-\x1f]/g,'').slice(0,16),team,kills:0,deaths:0,
      weapon:'rifle',input:blankInput(),lastInput:this.time,lastShot:-100,reloadAt:0,progress:0};
    this.players.set(id,p);this.spawn(p);p.alive=false;
    this.emit({type:'notice',text:`${p.name} 加入 ${team}`});return p;
  }
  spawn(p){const index=[...this.players.values()].filter(a=>a.team===p.team).indexOf(p),s=SPAWN_POINTS[p.team][Math.max(0,index)%SPAWN_POINTS[p.team].length];
    Object.assign(p,{x:s.x,z:s.z,y:s.y,vy:0,vx:0,vz:0,grounded:true,yaw:s.yaw,pitch:0,
      hp:100,alive:true,crouch:false,jumpHeld:false,lastInputSeq:0,ackInputSeq:0,reloadAt:0,progress:0,action:'',lastShot:-100,
      ammo:WEAPONS[p.weapon].clip,reserve:WEAPONS[p.weapon].reserve,input:{...blankInput(),yaw:s.yaw}});
    p.y=supportHeight(p.x,p.z,s.y+.05);p.lastInput=this.time;resetWeapon(p);
  }
  remove(id){const p=this.players.get(id);if(!p)return;
    if(this.bomb.state==='carried'&&this.bomb.holder===id)this.bomb={state:'dropped',x:p.x,z:p.z,y:supportHeight(p.x,p.z,p.y)};
    this.players.delete(id);this.emit({type:'notice',text:`${p.name} 离开`});
  }
  input(id,raw){const p=this.players.get(id);if(!p)return;
    if(raw?.round!==undefined&&raw.round!==this.round)return;
    if(raw?.seq!==undefined){if(!Number.isSafeInteger(raw.seq)||raw.seq<=p.lastInputSeq||raw.seq>2147483647)return;p.lastInputSeq=raw.seq;}
    p.input=sanitizedInput(raw);p.lastInput=this.time;
  }
  reload(id){const p=this.players.get(id);if(p?.alive&&this.phase==='live'&&!p.reloadAt&&p.reserve>0&&p.ammo<WEAPONS[p.weapon].clip){p.reloadAt=this.time+WEAPONS[p.weapon].reload;p.progress=0;}}
  equip(id,key){const p=this.players.get(id);if(p&&typeof key==='string'&&Object.hasOwn(WEAPONS,key)&&['waiting','countdown','ended'].includes(this.phase)){p.weapon=key;p.ammo=WEAPONS[key].clip;p.reserve=WEAPONS[key].reserve;resetWeapon(p);}}
  begin(){this.round++;this.phase='countdown';this.endAt=this.time+4;this.message='准备回合 · 1/2/3 选择武器';
    for(const p of this.players.values())this.spawn(p);
    const t=[...this.players.values()].filter(p=>p.team==='T');this.bomb={state:'carried',holder:t[(this.round-1)%t.length].id};
    this.emit({type:'round',round:this.round});
  }
  finish(team,reason){if(this.phase!=='live')return;this.phase='ended';this.endAt=this.time+6;this.score[team]++;this.message=`${team} 获胜 · ${reason}`;
    for(const p of this.players.values()){p.progress=0;p.action='';p.input=blankInput();}
    this.emit({type:'notice',text:this.message});
  }
  damage(p,amount,killer){if(!p.alive)return;p.hp=Math.max(0,p.hp-amount);p.progress=0;p.action='';
    this.emit({type:'damage',id:p.id,amount});
    if(p.hp===0){p.alive=false;p.deaths++;p.reloadAt=0;if(killer)killer.kills++;
      if(this.bomb.state==='carried'&&this.bomb.holder===p.id)this.bomb={state:'dropped',x:p.x,z:p.z,y:supportHeight(p.x,p.z,p.y)};
      this.emit({type:'kill',attacker:killer?.name||'环境',victim:p.name,team:killer?.team});}
  }
  shoot(p){if(!p.alive||this.phase!=='live')return;const w=WEAPONS[p.weapon];if(p.reloadAt||this.time-p.lastShot<w.interval||p.ammo<=0)return;
    p.lastShot=this.time;p.ammo--;
    const profile=shotProfile(p,this.random),d=profile.direction;
    const o={x:p.x,y:p.y+eyeHeight(p),z:p.z};let distance=wallDistance(o,d),target=null,head=false;
    for(const q of this.players.values())if(q.alive&&q.team!==p.team){
      const h=eyeHeight(q)+0.2,box={x1:q.x-.3,x2:q.x+.3,y1:q.y,y2:q.y+h,z1:q.z-.3,z2:q.z+.3};
      const hit=rayBox(o,d,box);if(hit<distance){distance=hit;target=q;head=o.y+d.y*hit>q.y+h-.38;}
    }
    this.emit({type:'shot',id:p.id,from:o,to:{x:o.x+d.x*distance,y:o.y+d.y*distance,z:o.z+d.z*distance},hit:!!target,burst:profile.burst,recoilYaw:profile.recoilYaw,recoilPitch:profile.recoilPitch,spread:profile.spread});
    if(target)this.damage(target,Math.round(w.damage*(head?w.head:1)),p);
  }
  canReach(p,b,radius){if(Math.hypot(p.x-b.x,p.z-b.z)>=radius||Math.abs(p.y-(b.y||0))>1.3)return false;
    const o={x:p.x,y:p.y+eyeHeight(p),z:p.z},dx=b.x-o.x,dy=(b.y||0)+.2-o.y,dz=b.z-o.z,length=Math.hypot(dx,dy,dz);
    return length<.001||wallDistance(o,{x:dx/length,y:dy/length,z:dz/length})>length-.08;
  }
  use(p,dt){let action='';const b=this.bomb;
    if(p.input.use&&!p.moving&&!p.reloadAt&&isGrounded(p)){
      if(p.team==='T'&&b.state==='dropped'&&this.canReach(p,b,2)){this.bomb={state:'carried',holder:p.id};this.emit({type:'notice',text:`${p.name} 拾取炸弹`});}
      else if(p.team==='T'&&b.state==='carried'&&b.holder===p.id&&siteAt(p))action='plant';
      else if(p.team==='CT'&&b.state==='planted'&&this.canReach(p,b,2.3))action='defuse';
    }
    if(action!==p.action)p.progress=0;p.action=action;p.progress=action?p.progress+dt:0;
    if(action==='plant'&&p.progress>=RULES.plantSeconds){this.bomb={state:'planted',x:p.x,z:p.z,y:p.y,endAt:this.time+RULES.bombSeconds,site:siteAt(p).name};p.progress=0;p.action='';this.emit({type:'notice',text:`炸弹已安放在 ${this.bomb.site} 点`});}
    if(action==='defuse'&&p.progress>=RULES.defuseSeconds){this.bomb.state='defused';this.finish('CT','成功拆除炸弹');}
  }
  step(dt=1/RULES.tick){this.time+=dt;const all=[...this.players.values()];
    if(!all.some(p=>p.team==='T')||!all.some(p=>p.team==='CT')){this.phase='waiting';this.bomb={state:'none'};this.message='等待双方玩家加入';for(const p of all)p.alive=false;return;}
    if(this.phase==='waiting'){this.begin();return;}
    if(this.phase==='ended'){if(this.time>=this.endAt)this.begin();return;}
    if(this.phase==='countdown'){if(this.time>=this.endAt){this.phase='live';this.endAt=this.time+RULES.roundSeconds;this.message='回合进行中';}return;}
    for(const p of all)if(p.alive){
      if(this.time-p.lastInput>0.5)p.input={...blankInput(),yaw:p.yaw,pitch:p.pitch};
      movePlayer(p,p.input,dt);p.ackInputSeq=p.lastInputSeq;updateWeapon(p,dt,this.time);
      if(p.reloadAt&&this.time>=p.reloadAt){const n=Math.min(WEAPONS[p.weapon].clip-p.ammo,p.reserve);p.ammo+=n;p.reserve-=n;p.reloadAt=0;}
      this.use(p,dt);if(this.phase!=='live')return;
      if(p.input.fire&&!p.action)this.shoot(p);
    }
    if(this.bomb.state==='planted'&&this.time>=this.bomb.endAt){this.bomb.state='exploded';this.finish('T','炸弹爆炸');return;}
    const alive=team=>all.some(p=>p.alive&&p.team===team);
    if(!alive('CT'))this.finish('T','对方全灭');
    else if(!alive('T')&&this.bomb.state!=='planted')this.finish('CT','对方全灭');
    else if(this.time>=this.endAt&&this.bomb.state!=='planted')this.finish('CT','守住回合时间');
  }
  snapshot(){return {type:'state',version:'0.3.0',movementSync:'ack-replay-v1',mapVersion:MAP_VERSION,time:this.time,phase:this.phase,round:this.round,score:this.score,endAt:this.endAt,message:this.message,bomb:this.bomb,
    players:[...this.players.values()].map(({input,lastInput,lastShot,lastInputSeq,...p})=>p)};}
}
