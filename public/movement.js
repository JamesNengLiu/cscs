import {RULES} from './config.js';
import {clamp} from './math.js';
import {groundHeight,collides,isGrounded,trace} from './map.js';
export function eyeHeight(p){return p.crouch?.75:RULES.eye;}
export function bodyHeight(p){return p.crouch?RULES.crouchHeight:RULES.bodyHeight;}
export function blankInput(){return {f:0,s:0,yaw:0,pitch:0,fire:false,jump:false,crouch:false,walk:false,use:false};}
export function sanitizedInput(raw={}){raw=raw&&typeof raw==='object'?raw:{};return {
  f:clamp(Number(raw.f)||0,-1,1),s:clamp(Number(raw.s)||0,-1,1),yaw:clamp(Number(raw.yaw)||0,-10000,10000),pitch:clamp(Number(raw.pitch)||0,-1.45,1.45),
  fire:raw.fire===true,jump:raw.jump===true,crouch:raw.crouch===true,walk:raw.walk===true,use:raw.use===true};}
function updateStance(p,crouch){
  if(crouch===!!p.crouch)return;
  const height=crouch?RULES.crouchHeight:RULES.bodyHeight;
  // Feet stay planted on the ground; airborne hull changes preserve the center.
  // Reversing this shift when standing prevents repeated ducking from adding height.
  const y=isGrounded(p)?p.y:p.y+(bodyHeight(p)-height)/2;
  if(!collides(p.x,p.z,RULES.radius,y,height)){p.y=y;p.crouch=crouch;}
}
function slide(start,velocity,dt,height){
  let pos={x:start.x,y:start.y,z:start.z},v=[...velocity],remaining=dt;const planes=[];
  for(let bump=0;bump<4&&remaining>1e-8;bump++){
    const hit=trace(pos,{x:pos.x+v[0]*remaining,y:pos.y+v[1]*remaining,z:pos.z+v[2]*remaining},height);
    if(hit.startSolid)return {pos,velocity:[0,0,0],blocked:true};
    pos=hit.end;if(hit.fraction===1)break;remaining*=1-hit.fraction;planes.push(hit.normal);
    for(const normal of planes){const into=v.reduce((sum,c,i)=>sum+c*normal[i],0);if(into<0)v=v.map((c,i)=>c-into*normal[i]);}
    if(planes.some(n=>v.reduce((sum,c,i)=>sum+c*n[i],0)<-1e-7))v=[0,0,0];
  }
  return {pos,velocity:v};
}
function substep(p,input,dt){
  let grounded=isGrounded(p);const height=bodyHeight(p);
  const f=clamp(Number(input.f)||0,-1,1),s=clamp(Number(input.s)||0,-1,1),n=Math.max(1,Math.hypot(f,s));
  const wx=(-Math.sin(p.yaw)*f+Math.cos(p.yaw)*s)/n,wz=(-Math.cos(p.yaw)*f-Math.sin(p.yaw)*s)/n;
  const speed=p.crouch?RULES.crouchSpeed:input.walk?RULES.walkSpeed:RULES.speed;
  let accel=grounded?RULES.groundAcceleration:RULES.airAcceleration;
  if(grounded&&Math.hypot(wx,wz)<.001)accel=RULES.brake;
  else if(grounded&&p.vx*wx+p.vz*wz<-.05)accel=RULES.counterBrake;
  const dx=wx*speed-p.vx,dz=wz*speed-p.vz,distance=Math.hypot(dx,dz),change=Math.min(distance,accel*dt);
  if(distance>1e-6){p.vx+=dx/distance*change;p.vz+=dz/distance*change;}
  if(input.jump&&!p.jumpHeld&&grounded){p.vy=RULES.jumpSpeed;grounded=false;}p.jumpHeld=!!input.jump;
  const start={x:p.x,y:p.y,z:p.z},velocity=[p.vx,0,p.vz];let horizontal=slide(start,velocity,dt,height);
  if(grounded){
    const up=trace(start,{...start,y:start.y+RULES.stepHeight},height);
    if(!up.startSolid&&up.fraction===1){const step=slide(up.end,velocity,dt,height);
      const down=trace(step.pos,{...step.pos,y:start.y-.04},height);
      if(!down.startSolid&&down.fraction<1&&down.normal[1]>.7){
        const progress=r=>Math.hypot(r.pos.x-start.x,r.pos.z-start.z);
        if(progress(step)>progress(horizontal)+1e-6)horizontal={...step,pos:down.end};
      }}
  }
  p.x=horizontal.pos.x;p.y=horizontal.pos.y;p.z=horizontal.pos.z;
  p.vx=horizontal.velocity[0];p.vz=horizontal.velocity[2];
  if(grounded&&p.vy<=0){const down=trace(p,{...p,y:p.y-RULES.stepHeight-.04},height);
    if(!down.startSolid&&down.fraction<1&&down.normal[1]>.7){p.y=down.end.y;p.vy=0;}else grounded=false;}
  if(!grounded||p.vy>0){const halfGravity=RULES.gravity*dt/2;p.vy-=halfGravity;
    const vertical=trace(p,{...p,y:p.y+p.vy*dt},height);
    if(!vertical.startSolid)p.y=vertical.end.y;p.vy=vertical.fraction<1?0:p.vy-halfGravity;}
  p.grounded=isGrounded(p);p.moving=Math.hypot(p.vx,p.vz)>.12;
}
export function movePlayer(p,input,dt){
  p.yaw=Number.isFinite(input.yaw)?input.yaw:p.yaw||0;p.pitch=clamp(Number.isFinite(input.pitch)?input.pitch:p.pitch||0,-1.45,1.45);
  p.vx=Number.isFinite(p.vx)?p.vx:0;p.vz=Number.isFinite(p.vz)?p.vz:0;p.vy=Number.isFinite(p.vy)?p.vy:0;p.y=Number.isFinite(p.y)?p.y:groundHeight(p.x,p.z);
  updateStance(p,!!input.crouch);
  const duration=clamp(dt,0,.1),count=Math.max(1,Math.ceil(duration*120));
  for(let i=0;i<count;i++)substep(p,input,duration/count);
}
