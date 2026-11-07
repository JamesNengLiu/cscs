// Compatibility for existing CS2 v1 authorities; keep their simulation unchanged.
// Browser-authored Source 2 experiment, using pinned vdata coefficients. The
// retail seed stream, recoil integrator and inaccuracy equations are not public
// in this package: these formulas are explicitly approximations, never the
// GoldSrc punch*2 or CS1.6 triangular spread/recovery path.
import {CS2_WEAPON_PROFILE_V1 as CS2_WEAPON_PROFILE} from './cs2-weapon-profile.js';
import {direction,clamp} from './math.js';
import {PITCH_LIMIT} from './view-settings.js';
const rad=Math.PI/180,tau=Math.PI*2;
const mode=p=>(p.zoom>0&&p.zoom<90)||p.silenced||p.burstMode?1:0;
const value=(v,index=0)=>Array.isArray(v)?v[index]??v[0]:v;
function seeded(seed){let n=seed>>>0;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
export function createCS2WeaponBehaviorV1(profile=CS2_WEAPON_PROFILE){
 if(profile?.id!==CS2_WEAPON_PROFILE.id)throw Error('Unsupported CS2 weapon behavior profile');
 const guns=profile.guns;
 const source=p=>guns[p.weapon]?.source;
 const coefficient=(p,key)=>Number(value(source(p)?.[key],mode(p)))||0;
 function shotInterval(p){const v=source(p);if(!v)return .4;return p.burstMode&&v.m_flCycleTimeWhenInBurstMode>0?v.m_flCycleTimeWhenInBurstMode:coefficient(p,'m_flCycleTime')||.4;}
 function deploySeconds(id){return guns[id]?.deploy??.75;}
 function recoveryTime(p){const v=source(p);if(!v)return .35;const a=p.crouch?v.m_flRecoveryTimeCrouch:v.m_flRecoveryTimeStand,b=p.crouch?v.m_flRecoveryTimeCrouchFinal:v.m_flRecoveryTimeStandFinal,start=v.m_nRecoveryTransitionStartBullet||0,end=v.m_nRecoveryTransitionEndBullet||start+1,t=clamp(((p.cs2RecoilIndex||0)-start)/Math.max(1,end-start),0,1);return Math.max(.03,a+(b-a)*t);}
 function inaccuracy(p,grounded){
  if(!source(p))return 0;
  const speed=Math.hypot(p.vx||0,p.vz||0)/profile.metresPerUnit,maxSpeed=value(guns[p.weapon].source.m_flMaxSpeed,mode(p))||250;
  const movement=clamp((speed/maxSpeed-.34)/(.95-.34),0,1);
  const base=coefficient(p,p.crouch?'m_flInaccuracyCrouch':'m_flInaccuracyStand');
  return clamp(base+coefficient(p,'m_flInaccuracyMove')*movement+(grounded?0:coefficient(p,'m_flInaccuracyJump'))+(p.cs2AccuracyPenalty||0)+(p.cs2JumpPenalty||0)+(p.cs2LandPenalty||0),0,1);
 }
 function weaponSpread(p,grounded){return coefficient(p,'m_flSpread')+inaccuracy(p,grounded);}
 function reset(p,{keepPunch=false}={},grounded=true){p.burstCount=0;p.accuracy=0;p.recoveryAt=0;p.recoilDirection=0;p.cs2RecoilIndex=0;p.cs2AccuracyPenalty=0;p.cs2JumpPenalty=0;p.cs2LandPenalty=0;p.cs2RecoilAngle=0;p.cs2WasGrounded=grounded;p.cs2RecoilDecayActive=false;if(!keepPunch){p.recoilPitch=0;p.recoilYaw=0;}p.spread=weaponSpread(p,grounded);}
 function update(p,dt,now,grounded=true){
  dt=Math.max(0,Math.min(.25,Number.isFinite(dt)?dt:0));
  const recover=Math.exp(-Math.LN10*dt/recoveryTime(p));p.cs2AccuracyPenalty=Math.max(0,(p.cs2AccuracyPenalty||0)*recover);p.cs2JumpPenalty=Math.max(0,(p.cs2JumpPenalty||0)*recover);p.cs2LandPenalty=Math.max(0,(p.cs2LandPenalty||0)*recover);
  if(p.cs2WasGrounded===true&&!grounded)p.cs2JumpPenalty=Math.max(p.cs2JumpPenalty,source(p)?.m_flInaccuracyJumpInitial||0);
  if(p.cs2WasGrounded===false&&grounded)p.cs2LandPenalty=Math.max(p.cs2LandPenalty,coefficient(p,'m_flInaccuracyLand'));
  p.cs2WasGrounded=grounded;
  p.cs2RecoilDecayActive=now-(p.lastShot??-100)>Math.max(.12,shotInterval(p)*1.1);
  if(p.cs2RecoilDecayActive){
   const decay=Math.exp(-dt*8);p.recoilYaw=(p.recoilYaw||0)*decay;p.recoilPitch=(p.recoilPitch||0)*decay;
   p.cs2RecoilIndex=Math.max(0,(p.cs2RecoilIndex||0)-dt*6);
  }
  if(guns[p.weapon]?.category==='pistol'&&!p.input?.fire)p.burstCount=0;
  p.spread=weaponSpread(p,grounded);
 }
 function spreadDirection(profile,random=Math.random){
  // Two independent circles retain inaccuracy and spread as separate terms.
  // Their radius/angle draws are deterministic between prediction/authority;
  // this does not assert equivalence to Valve's private seed-to-shot mapping.
  const safe=()=>clamp(Number(random())||0,0,1),r1=safe()*(profile.inaccuracy??profile.spread??0),a1=safe()*tau,r2=safe()*(profile.baseSpread??0),a2=safe()*tau;
  const x=Math.cos(a1)*r1+Math.cos(a2)*r2,y=Math.sin(a1)*r1+Math.sin(a2)*r2,{yaw,pitch}=profile,d=direction(yaw,pitch);
  d.x+=x*Math.cos(yaw)+y*Math.sin(yaw)*Math.sin(pitch);d.y+=y*Math.cos(pitch);d.z-=x*Math.sin(yaw)-y*Math.cos(yaw)*Math.sin(pitch);const n=Math.hypot(d.x,d.y,d.z)||1;return{x:d.x/n,y:d.y/n,z:d.z/n};
 }
 function kick(p){const v=source(p);if(!v)return;const index=Math.floor(p.cs2RecoilIndex||0),rng=seeded((v.m_nRecoilSeed||0)^Math.imul(index+1,0x9e3779b9)),magnitude=coefficient(p,'m_flRecoilMagnitude')+(rng()-.5)*2*coefficient(p,'m_flRecoilMagnitudeVariance'),angle=(coefficient(p,'m_flRecoilAngle')+(rng()-.5)*2*coefficient(p,'m_flRecoilAngleVariance'))*rad;
  p.cs2RecoilAngle=(p.cs2RecoilAngle||0)*.55+angle*.45;const impulse=Math.max(0,magnitude)*.04*rad;
  p.recoilPitch=clamp((p.recoilPitch||0)+Math.cos(p.cs2RecoilAngle)*impulse,0,12.5*rad);p.recoilYaw=clamp((p.recoilYaw||0)+Math.sin(p.cs2RecoilAngle)*impulse,-6*rad,6*rad);p.cs2RecoilIndex=index+1;
 }
 function shotProfile(p,random,now,follow,grounded){const baseSpread=coefficient(p,'m_flSpread'),accuracy=inaccuracy(p,grounded),profile={spread:baseSpread+accuracy,baseSpread,inaccuracy:accuracy,yaw:p.yaw+(p.recoilYaw||0),pitch:clamp(p.pitch+(p.recoilPitch||0),-PITCH_LIMIT,PITCH_LIMIT)};const d=spreadDirection(profile,random);
  p.cs2AccuracyPenalty=clamp((p.cs2AccuracyPenalty||0)+coefficient(p,'m_flInaccuracyFire'),0,1);p.burstCount=(p.burstCount||0)+1;p.cs2RecoilDecayActive=false;kick(p);p.burstSpread=profile.spread;p.spread=profile.spread;
  return{...profile,direction:d,burst:p.burstCount,recoilYaw:p.recoilYaw,recoilPitch:p.recoilPitch};
 }
 const sampleViewRecoil=(p,seconds=0)=>{const dt=clamp(Number(seconds)||0,0,1/60),decay=p.cs2RecoilDecayActive?Math.exp(-dt*8):1;return{recoilYaw:(p.recoilYaw||0)*decay,recoilPitch:(p.recoilPitch||0)*decay};};
 return Object.freeze({id:profile.recoilModel,profileId:profile.id,reset,update,weaponSpread,spreadDirection,shotProfile,shotInterval,deploySeconds,sampleViewRecoil,shotFollowupInterval:p=>source(p)?.m_flTimeBetweenBurstShots||.1});
}
