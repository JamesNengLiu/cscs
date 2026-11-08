import {direction} from './public/math.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const point=p=>p&&['x','y','z'].every(key=>Number.isFinite(p[key]));
const optionalFinite=(value,fallback=0)=>value===undefined?fallback:Number.isFinite(value)?value:NaN;
function tracedPoint(world,from,to,radius){
 const hit=world.collision.trace(from,to,0,{radius,channel:'grenade'});
 return hit&&!hit.startSolid&&Number.isFinite(hit.fraction)&&hit.fraction>=0&&hit.fraction<=1&&point(hit.end)?hit.end:null;
}

// CS2 launch candidate, independently expressed from the published field and
// measurement evidence. Runtime creation owns ids, inventory and all clocks.
// owner is one coherent authoritative pose/velocity sample; no client world
// coordinates or desired projectile velocity enter this function.
export function buildCS2GrenadeLaunch(world,profile,owner,kind,{strength=1}={}){
 if(!world?.collision?.trace||typeof world.movement?.eyeHeight!=='function'||!point(owner)||
  !Number.isFinite(strength)||strength<0||strength>1||!profile?.weapons?.[kind])return null;
 const unit=profile.metresPerUnit,radius=profile.radius,clearance=profile.throwClearance,backoff=profile.throwBackoff,
  inherited=profile.inheritedVelocityScale,speedBase=profile.weapons[kind].throwVelocity*profile.throwVelocityScale*unit,
  floor=profile.strengthSpeedFloor,range=profile.strengthSpeedRange,drop=profile.underhandDrop??12*unit,punchScale=profile.aimPunchScale??1;
 if(![unit,radius,clearance,backoff,inherited,speedBase,floor,range,drop,punchScale].every(Number.isFinite)||
  unit<=0||radius<0||clearance<0||backoff<0||inherited<0||speedBase<=0||floor<0||range<0||drop<0||punchScale<0||punchScale>2)return null;
 const yaw=optionalFinite(owner.yaw),pitch=optionalFinite(owner.pitch),recoilYaw=optionalFinite(owner.recoilYaw),recoilPitch=optionalFinite(owner.recoilPitch),
  vx=optionalFinite(owner.vx),vy=optionalFinite(owner.vy),vz=optionalFinite(owner.vz),eyeHeight=owner.grenadeEyeHeight===undefined?world.movement.eyeHeight(owner):owner.grenadeEyeHeight;
 if(![yaw,pitch,recoilYaw,recoilPitch,vx,vy,vz,eyeHeight].every(Number.isFinite)||eyeHeight<0)return null;
 const aimYaw=(yaw%(2*Math.PI)+recoilYaw*punchScale%(2*Math.PI))%(2*Math.PI),sourcePitch=-clamp(pitch+recoilPitch*punchScale,-Math.PI/2,Math.PI/2)*180/Math.PI,
  throwPitch=-10+sourcePitch*(sourcePitch<0?80/90:100/90),forward=direction(aimYaw,-throwPitch*Math.PI/180),speed=speedBase*(strength===1?1:floor+range*strength),
  eye={x:owner.x,y:owner.y+eyeHeight,z:owner.z},lowered={x:eye.x,y:eye.y-drop*(1-strength),z:eye.z};
 // The vertical safety sweep is an explicit browser safeguard around window
 // sills and tight geometry; its exact retail behavior remains unverified.
 const source=strength===1?eye:tracedPoint(world,eye,lowered,radius);
 if(!source)return null;
 const end=tracedPoint(world,source,{x:source.x+forward.x*clearance,y:source.y+forward.y*clearance,z:source.z+forward.z*clearance},radius);
 if(!end)return null;
 const origin={x:end.x-forward.x*backoff,y:end.y-forward.y*backoff,z:end.z-forward.z*backoff};
 if(!tracedPoint(world,origin,origin,radius))return null;
 return {...origin,vx:forward.x*speed+clamp(vx,-50,50)*inherited,vy:forward.y*speed+clamp(vy,-50,50)*inherited,vz:forward.z*speed+clamp(vz,-50,50)*inherited};
}

const POSE_FIELDS=['x','y','z','vx','vy','vz','yaw','pitch','recoilYaw','recoilPitch','duckAmount','grenadeEyeHeight'];
export function captureGrenadePose(player,eyeHeight,sampleInputSeq=player.lastAppliedInputSeq||0){
 return {x:player.x,y:player.y,z:player.z,vx:player.vx,vy:player.vy,vz:player.vz,yaw:player.yaw,pitch:player.pitch,
  recoilYaw:optionalFinite(player.recoilYaw),recoilPitch:optionalFinite(player.recoilPitch),duckAmount:optionalFinite(player.duckAmount),crouch:!!player.crouch,grounded:!!player.grounded,grenadeEyeHeight:eyeHeight,sampleInputSeq};
}
// Candidate jump latch. Its samples come only from the unchanged server
// movement solver. Interpolation locates the requested time inside a real step;
// no retail jump speed is injected or imposed on the player.
export function recordGrenadeJump(state,profile,before,after,from,to,jumpPressed=false){
 if(!profile?.jumpLatchEnabled||!Number.isFinite(from)||!Number.isFinite(to)||to<from)return null;
 const delay=profile.jumpLatchDelaySeconds,window=profile.jumpLatchWindowSeconds;
 if(!Number.isFinite(delay)||delay<0||!Number.isFinite(window)||window<0)return null;
 if(jumpPressed&&before.grounded&&!after.grounded&&after.vy>0)state={jumpAt:from,targetAt:from+delay,cachedAt:null,pose:null};
 if(!state)return null;
 if(after.grounded)return null;
 if(state.pose)return to-state.cachedAt<=window+1e-8?state:null;
 if(to+1e-8<state.targetAt)return state;
 if(from>state.targetAt+1e-8)return null; // Missing history is never fabricated.
 const fraction=to>from?clamp((state.targetAt-from)/(to-from),0,1):1,pose={crouch:fraction<.5?before.crouch:after.crouch,grounded:false};
 for(const key of POSE_FIELDS){
  if(!Number.isFinite(before[key])||!Number.isFinite(after[key]))return null;
  const delta=key==='yaw'?Math.atan2(Math.sin(after[key]-before[key]),Math.cos(after[key]-before[key])):after[key]-before[key];
  pose[key]=before[key]+delta*fraction;
 }
 const sampledSequence=fraction>1e-8?after.sampleInputSeq:before.sampleInputSeq,sampleInputSeq=Number.isSafeInteger(sampledSequence)&&sampledSequence>=0?sampledSequence:0;
 return {...state,cachedAt:state.targetAt,pose,sampleInputSeq,punchPending:true,punchStepEnd:to,punchFraction:fraction,punchFromPitch:before.recoilPitch,punchFromYaw:before.recoilYaw};
}
// Complete the new sample after this same step's sole weapon update. No future
// combat tick can rewrite a cached aim, and the player's actual punch is read
// without mutation. These fields live only in the private server latch state.
export function finalizeGrenadeJumpPunch(state,player,now){
 if(!state?.punchPending||!state.pose||!Number.isFinite(now)||Math.abs(state.punchStepEnd-now)>1e-8)return state;
 const pitch=optionalFinite(player.recoilPitch),yaw=optionalFinite(player.recoilYaw);
 if(![pitch,yaw,state.punchFromPitch,state.punchFromYaw,state.punchFraction].every(Number.isFinite))return null;
 const fraction=clamp(state.punchFraction,0,1);
 return {...state,punchPending:false,pose:{...state.pose,recoilPitch:state.punchFromPitch+(pitch-state.punchFromPitch)*fraction,recoilYaw:state.punchFromYaw+(yaw-state.punchFromYaw)*fraction}};
}
export function selectGrenadeJumpPose(state,profile,now,{canDefer=true}={}){
 if(!profile?.jumpLatchEnabled||!state||!Number.isFinite(now))return {source:'live',pose:null};
 if(state.pose&&!state.punchPending&&now+1e-8>=state.cachedAt&&now-state.cachedAt<=profile.jumpLatchWindowSeconds+1e-8)return {source:'jump-latch',pose:state.pose,sampledAt:state.cachedAt,sampleInputSeq:state.sampleInputSeq};
 if(canDefer&&!state.pose&&now+1e-8<state.targetAt&&now-state.jumpAt<=profile.jumpLatchDelaySeconds+1e-8)return {source:'pending-jump',pose:null,defer:true};
 return {source:'live',pose:null};
}
// Reliable release is also a view observation. It may fill a datagram outage,
// but can neither rewind a newer applied input nor alter an older jump cache.
// The sequence is a view watermark only: it never fences/advances movement.
export function applyGrenadeReleaseView(owner,intent,sampleInputSeq,sampledAt){
 const view=intent?.releaseView;
 if(!view||!Number.isSafeInteger(view.afterInputSeq)||view.afterInputSeq<0||!Number.isFinite(view.yaw)||!Number.isFinite(view.pitch)||!Number.isSafeInteger(sampleInputSeq)||sampleInputSeq<0||sampleInputSeq>view.afterInputSeq||
   !Number.isFinite(sampledAt)||!Number.isFinite(intent.releaseAt)||intent.releaseAt>sampledAt+1e-8)return owner;
 return {...owner,yaw:view.yaw,pitch:view.pitch};
}
