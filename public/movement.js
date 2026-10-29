import {RULES,WEAPONS} from './config.js';
import {clamp} from './math.js';
import {groundHeight,collides,isGrounded,trace} from './map.js';
import {PITCH_LIMIT} from './view-settings.js';
export function eyeHeight(p){return p.crouch?.75:RULES.eye-(RULES.eye-.75)*(p.duckAmount||0);}
export function bodyHeight(p){return p.crouch?RULES.crouchHeight:RULES.bodyHeight;}
export function maxMoveSpeed(p){
  let speed=WEAPONS[p.weapon]?.maxSpeed||250;
  if(p.zoom>0&&p.zoom<90){const scoped={awp:150,scout:220,g3sg1:150,sg550:150,sg552:200};speed=scoped[p.weapon]||speed;}
  if(p.shieldRaised)speed=180;
  return speed/40;
}
export function blankInput(){return {f:0,s:0,yaw:0,pitch:0,fire:false,jump:false,crouch:false,walk:false,use:false};}
export function sanitizedInput(raw={}){raw=raw&&typeof raw==='object'?raw:{};return {
  f:clamp(Number(raw.f)||0,-1,1),s:clamp(Number(raw.s)||0,-1,1),yaw:clamp(Number(raw.yaw)||0,-10000,10000),pitch:clamp(Number(raw.pitch)||0,-PITCH_LIMIT,PITCH_LIMIT),
  fire:raw.fire===true,jump:raw.jump===true,crouch:raw.crouch===true,walk:raw.walk===true,use:raw.use===true};}
function updateStance(p,crouch,dt,players){
  if(crouch&&!p.crouch&&supported(p,players)&&dt>0){
    p.duckElapsed=Math.min(.4,(p.duckElapsed||0)+dt);const t=p.duckElapsed/.4;p.duckAmount=t*t*(3-2*t);p.ducking=true;if(p.duckElapsed<.4-1e-8)return;
  }
  if(!crouch){p.duckElapsed=0;p.duckAmount=0;p.ducking=false;}
  if(crouch===!!p.crouch){p.duckAmount=p.crouch?1:0;return;}
  const height=crouch?RULES.crouchHeight:RULES.bodyHeight;
  // Feet stay planted on the ground; airborne hull changes preserve the center.
  // Reversing this shift when standing prevents repeated ducking from adding height.
  const y=supported(p,players)?p.y:p.y+(bodyHeight(p)-height)/2;
  const bodyBlocked=players.some(q=>q.alive&&q.id!==p.id&&Math.abs(p.x-q.x)<RULES.radius*2-.001&&Math.abs(p.z-q.z)<RULES.radius*2-.001&&y<q.y+bodyHeight(q)-.001&&y+height>q.y+.001);
  if(!bodyBlocked&&!collides(p.x,p.z,RULES.radius,y,height)){p.y=y;p.crouch=crouch;p.duckAmount=crouch?1:0;p.ducking=false;}
}
export function traceMovement(start,end,height,players=[],self=null){
  let best=trace(start,end,height);
  for(const q of players){
    if(!q.alive||q===self||(self?.id!=null&&q.id===self.id))continue;
    const min=[q.x-RULES.radius*2,q.y-height,q.z-RULES.radius*2],max=[q.x+RULES.radius*2,q.y+bodyHeight(q),q.z+RULES.radius*2];
    const a=[start.x,start.y,start.z],b=[end.x,end.y,end.z];
    if(a.every((v,i)=>v>min[i]+.001&&v<max[i]-.001))continue; // Existing overlaps may separate.
    let lo=0,hi=1,normal=[0,0,0];
    for(let i=0;i<3;i++){
      const d=b[i]-a[i];if(Math.abs(d)<1e-9){if(a[i]<min[i]||a[i]>max[i]){hi=-1;break;}continue;}
      let near=(min[i]-a[i])/d,far=(max[i]-a[i])/d,sign=-1;if(near>far){[near,far]=[far,near];sign=1;}
      if(near>=lo){lo=near;normal=[0,0,0];normal[i]=sign;}hi=Math.min(hi,far);if(lo>hi)break;
    }
    if(lo<=hi&&lo>=0&&lo<best.fraction&&normal.some(Boolean)){
      const fraction=Math.max(0,lo-.0001/(Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2])||1));
      best={fraction,normal,startSolid:false,model:null,player:q.id,end:{x:a[0]+(b[0]-a[0])*fraction,y:a[1]+(b[1]-a[1])*fraction,z:a[2]+(b[2]-a[2])*fraction}};
    }
  }return best;
}
function groundContact(p,players,height=bodyHeight(p)){
  if((p.vy||0)>.01)return null;
  const hit=traceMovement(p,{...p,y:p.y-.04},height,players,p);
  return !hit.startSolid&&hit.fraction<1&&hit.normal[1]>.7?hit:null;
}
function supported(p,players){return Boolean(groundContact(p,players));}
function settle(p,hit){
  if(p.vy<0)p.landedSpeed=Math.max(p.landedSpeed||0,-p.vy);
  p.y=hit.end.y;p.vy=0;
}
function slide(start,velocity,dt,height,players,self){
  let pos={x:start.x,y:start.y,z:start.z},v=[...velocity],remaining=dt;const planes=[];
  for(let bump=0;bump<4&&remaining>1e-8;bump++){
    const hit=traceMovement(pos,{x:pos.x+v[0]*remaining,y:pos.y+v[1]*remaining,z:pos.z+v[2]*remaining},height,players,self);
    if(hit.startSolid)return {pos,velocity:[0,0,0],blocked:true};
    pos=hit.end;if(hit.fraction===1)break;remaining*=1-hit.fraction;planes.push(hit.normal);
    for(const normal of planes){const into=v.reduce((sum,c,i)=>sum+c*normal[i],0);if(into<0)v=v.map((c,i)=>c-into*normal[i]);}
    if(planes.some(n=>v.reduce((sum,c,i)=>sum+c*n[i],0)<-1e-7))v=[0,0,0];
  }
  return {pos,velocity:v};
}
function substep(p,input,dt,players){
  const height=bodyHeight(p),contact=groundContact(p,players,height);let grounded=Boolean(contact);
  // The contact tolerance must agree with the actual feet position before a
  // fresh jump impulse, including a new wheel pulse on the landing tick.
  if(contact)settle(p,contact);
  const f=clamp(Number(input.f)||0,-1,1),s=clamp(Number(input.s)||0,-1,1),n=Math.max(1,Math.hypot(f,s));
  const wx=(-Math.sin(p.yaw)*f+Math.cos(p.yaw)*s)/n,wz=(-Math.cos(p.yaw)*f-Math.sin(p.yaw)*s)/n;
  const speed=maxMoveSpeed(p)*(p.crouch||p.ducking?.333:input.walk?.52:1),wish=Math.hypot(wx,wz);
  p.jumpFatigue=Math.max(0,(p.jumpFatigue||0)-dt*1000);
  if(input.jump&&!p.jumpHeld&&grounded){
    const current=Math.hypot(p.vx,p.vz),limit=maxMoveSpeed(p)*1.2;
    if(current>limit){p.vx*=limit*.8/current;p.vz*=limit*.8/current;}
    p.vy=RULES.jumpSpeed*(1-p.jumpFatigue*.00019);p.jumpFatigue=1315.789429;grounded=false;
  }p.jumpHeld=!!input.jump;
  if(grounded){
    const current=Math.hypot(p.vx,p.vz),drop=Math.max(current,RULES.stopSpeed)*RULES.friction*dt;
    const factor=current?Math.max(0,current-drop)/current:0;p.vx*=factor;p.vz*=factor;
    if(p.velocityModifier<1){const mod=Math.min(1,p.velocityModifier+dt*.6);p.vx*=mod**(dt*60);p.vz*=mod**(dt*60);p.velocityModifier=mod;}
  }
  if(wish>1e-6){
    const nx=wx/wish,nz=wz/wish,wishSpeed=speed*wish*(grounded?1-p.jumpFatigue*.00019:1);
    const add=(grounded?wishSpeed:Math.min(30/40,wishSpeed))-(p.vx*nx+p.vz*nz);
    if(add>0){const acceleration=(grounded?RULES.groundAcceleration:RULES.airAcceleration)*wishSpeed*dt,change=Math.min(add,acceleration);p.vx+=nx*change;p.vz+=nz*change;}
  }
  p.walk=!!input.walk;
  const start={x:p.x,y:p.y,z:p.z},velocity=[p.vx,0,p.vz];let horizontal=slide(start,velocity,dt,height,players,p);
  if(grounded){
    const up=traceMovement(start,{...start,y:start.y+RULES.stepHeight},height,players,p);
    if(!up.startSolid&&up.fraction===1){const step=slide(up.end,velocity,dt,height,players,p);
      const down=traceMovement(step.pos,{...step.pos,y:start.y-.04},height,players,p);
      if(!down.startSolid&&down.fraction<1&&down.normal[1]>.7){
        const progress=r=>Math.hypot(r.pos.x-start.x,r.pos.z-start.z);
        if(progress(step)>progress(horizontal)+1e-6)horizontal={...step,pos:down.end};
      }}
  }
  p.x=horizontal.pos.x;p.y=horizontal.pos.y;p.z=horizontal.pos.z;
  p.vx=horizontal.velocity[0];p.vz=horizontal.velocity[2];
  if(grounded&&p.vy<=0){const down=traceMovement(p,{...p,y:p.y-RULES.stepHeight-.04},height,players,p);
    if(!down.startSolid&&down.fraction<1&&down.normal[1]>.7){p.y=down.end.y;p.vy=0;}else grounded=false;}
  if(!grounded||p.vy>0){const halfGravity=RULES.gravity*dt/2;p.vy-=halfGravity;
    const vertical=traceMovement(p,{...p,y:p.y+p.vy*dt},height,players,p);
    if(!vertical.startSolid)p.y=vertical.end.y;
    if(vertical.fraction<1&&vertical.normal[1]>.7&&p.vy<0)p.landedSpeed=-p.vy;
    p.vy=vertical.fraction<1?0:p.vy-halfGravity;}
  const support=groundContact(p,players,height);p.grounded=Boolean(support);if(support)settle(p,support);
  const travel=Math.hypot(p.x-start.x,p.z-start.z),forward=(p.x-start.x)*-Math.sin(p.yaw)+(p.z-start.z)*-Math.cos(p.yaw);
  let gaitYaw=Number.isFinite(p.gaitYaw)?p.gaitYaw:p.yaw;
  if(Math.hypot(p.vx,p.vz)>.125)gaitYaw=Math.atan2(-p.vx,-p.vz);
  else gaitYaw+=Math.atan2(Math.sin(p.yaw-gaitYaw),Math.cos(p.yaw-gaitYaw))*Math.min(1,dt*4);
  const relative=Math.atan2(Math.sin(p.yaw-gaitYaw),Math.cos(p.yaw-gaitYaw));
  if(Math.abs(relative)>Math.PI*2/3)gaitYaw+=Math.PI;
  p.gaitYaw=Math.atan2(Math.sin(gaitYaw),Math.cos(gaitYaw));
  if(p.grounded)p.gaitDistance=(p.gaitDistance||0)+travel*(forward<-travel*.5?-1:1);
  p.airTime=p.grounded?0:(p.airTime||0)+dt;
  p.groundPlayer=p.grounded? support.player||null:null;p.moving=Math.hypot(p.vx,p.vz)>.12;
}
export function movePlayer(p,input,dt,players=[]){
  p.yaw=Number.isFinite(input.yaw)?input.yaw:p.yaw||0;p.pitch=clamp(Number.isFinite(input.pitch)?input.pitch:p.pitch||0,-PITCH_LIMIT,PITCH_LIMIT);
  p.vx=Number.isFinite(p.vx)?p.vx:0;p.vz=Number.isFinite(p.vz)?p.vz:0;p.vy=Number.isFinite(p.vy)?p.vy:0;p.y=Number.isFinite(p.y)?p.y:groundHeight(p.x,p.z);
  updateStance(p,!!input.crouch,clamp(dt,0,.1),players);
  const duration=clamp(dt,0,.1),count=Math.max(1,Math.ceil(duration*120));
  p.landedSpeed=0;
  for(let i=0;i<count;i++)substep(p,input,duration/count,players);
}
