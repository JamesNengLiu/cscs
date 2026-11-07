import {clamp} from './math.js';
import {PITCH_LIMIT} from './view-settings.js';
import {CALIBRATED_GUNS,cs2Coefficient,cs2WeaponMode,readCoreAccuracy,resetCoreAccuracy,advanceCoreAccuracy,addFireAccuracy} from './cs2-accuracy-reference.js';
import {createCS2RecoilTable} from './cs2-recoil-reference.js';
import {CS2_RECOIL_CALIBRATION,resetReferencePunch,advanceReferencePunch,addReferenceImpulse,rebaseReferencePunch,sampleReferencePunch} from './cs2-recoil-state.js';
const selected=new Set(CALIBRATED_GUNS),tables=new WeakMap();
function recoilTables(gun){let value=tables.get(gun.source);if(value)return value;const s=gun.source;value=[0,1].map(mode=>createCS2RecoilTable({seed:s.m_nRecoilSeed,angle:cs2Coefficient(s,'m_flRecoilAngle',mode),angleVariance:cs2Coefficient(s,'m_flRecoilAngleVariance',mode),magnitude:cs2Coefficient(s,'m_flRecoilMagnitude',mode),magnitudeVariance:cs2Coefficient(s,'m_flRecoilMagnitudeVariance',mode),automatic:gun.automatic}));tables.set(s,value);return value;}
export function referenceRecoilImpulse(gun,p,random=()=>.5){
 const pair=recoilTables(gun),index=gun.automatic?Math.trunc(Math.max(0,p.cs2RecoilIndex||0))%64:Math.min(63,Math.floor(clamp(Number(random())||0,0,1)*64));
 if(gun.id!=='awp')return pair[cs2WeaponMode(p)][index].impulse;
 const level=gun.zoom?.indexOf(p.zoom)??-1,fraction=level<0?0:(level+1)/gun.zoom.length,a=pair[0][index].impulse,b=pair[1][index].impulse;
 // Native AWP observations distinguish level1 (half blend) from level2.
 // The browser uses its own shared shot RNG to select the semi-auto entry;
 // equivalence to Valve's prediction-seed mapping remains unverified.
 return a.map((value,i)=>Math.fround(value+(b[i]-value)*fraction));
}
export function createCS2WeaponBehaviorV2(profile,previous){
 const guns=profile.guns,source=p=>guns[p.weapon]?.source,isSelected=p=>selected.has(p.weapon),coefficient=(p,key)=>cs2Coefficient(source(p),key,cs2WeaponMode(p));
 function previousExtraRecovery(p){const s=source(p),key=p.crouch?'Crouch':'Stand',a=s['m_flRecoveryTime'+key],b=s['m_flRecoveryTime'+key+'Final'],start=s.m_nRecoveryTransitionStartBullet||0,end=s.m_nRecoveryTransitionEndBullet||start+1;return Math.max(.03,a+(b-a)*clamp(((p.cs2RecoilIndex||0)-start)/Math.max(1,end-start),0,1));}
 function inaccuracy(p,grounded){const s=source(p);if(!s)return 0;const speed=Math.hypot(p.vx||0,p.vz||0)/profile.metresPerUnit,max=cs2Coefficient(s,'m_flMaxSpeed',cs2WeaponMode(p))||250,movement=clamp((speed/max-.34)/(.95-.34),0,1);
  // Movement/air extra terms retain the previous experiment until independent
  // native velocity samples establish them. The core above is calibrated.
  return clamp(readCoreAccuracy(s,p)+coefficient(p,'m_flInaccuracyMove')*movement+(grounded?0:coefficient(p,'m_flInaccuracyJump'))+(p.cs2JumpPenalty||0)+(p.cs2LandPenalty||0),0,1);
 }
 const weaponSpread=(p,grounded)=>isSelected(p)?coefficient(p,'m_flSpread')+inaccuracy(p,grounded):previous.weaponSpread(p,grounded);
 function reset(p,options={},grounded=true){previous.reset(p,options,grounded);if(isSelected(p))resetCoreAccuracy(source(p),p);if(!options.keepPunch)resetReferencePunch(p);}
 function update(p,dt,now,grounded=true,preserveHeldTrigger=false){
  dt=Math.max(0,Math.min(.25,Number.isFinite(dt)?dt:0));
  if(!isSelected(p)){
   if(p.cs2PunchVersion!==2)return previous.update(p,dt,now,grounded,preserveHeldTrigger);
   const pitch=p.recoilPitch,yaw=p.recoilYaw;previous.update(p,dt,now,grounded,preserveHeldTrigger);p.recoilPitch=pitch;p.recoilYaw=yaw;advanceReferencePunch(p,dt,now);return;
  }
  const s=source(p),extraRecovery=previousExtraRecovery(p);advanceCoreAccuracy(s,p,dt,now,previous.shotInterval(p),grounded);const extraDecay=Math.exp(-Math.LN10*dt/extraRecovery);
  p.cs2JumpPenalty=Math.max(0,(p.cs2JumpPenalty||0)*extraDecay);p.cs2LandPenalty=Math.max(0,(p.cs2LandPenalty||0)*extraDecay);
  if(p.cs2WasGrounded===true&&!grounded)p.cs2JumpPenalty=Math.max(p.cs2JumpPenalty,s.m_flInaccuracyJumpInitial||0);
  if(p.cs2WasGrounded===false&&grounded)p.cs2LandPenalty=Math.max(p.cs2LandPenalty,coefficient(p,'m_flInaccuracyLand'));p.cs2WasGrounded=grounded;
  p.cs2RecoilDecayActive=now-(p.lastShot??-100)>previous.shotInterval(p)*1.1;
  if(p.cs2PunchVersion===2)advanceReferencePunch(p,dt,now);else Object.assign(p,previous.sampleViewRecoil(p,dt));p.spread=weaponSpread(p,grounded);
 }
 function shotProfile(p,random,now,follow,grounded,kickRandom=random){
  if(!isSelected(p)){
   if(p.cs2PunchVersion===2)advanceReferencePunch(p,0,now);const result=previous.shotProfile(p,random,now,follow,grounded);if(p.cs2PunchVersion===2)rebaseReferencePunch(p,now);return result;
  }
  if(p.cs2PunchVersion===2)advanceReferencePunch(p,0,now);
  const baseSpread=coefficient(p,'m_flSpread'),accuracy=inaccuracy(p,grounded),result={spread:baseSpread+accuracy,baseSpread,inaccuracy:accuracy,yaw:p.yaw+CS2_RECOIL_CALIBRATION.rayScale*(p.recoilYaw||0),pitch:clamp(p.pitch+CS2_RECOIL_CALIBRATION.rayScale*(p.recoilPitch||0),-PITCH_LIMIT,PITCH_LIMIT)},ray=previous.spreadDirection(result,random),impulse=referenceRecoilImpulse(guns[p.weapon],p,kickRandom);
  addFireAccuracy(source(p),p);p.burstCount=(p.burstCount||0)+1;p.cs2RecoilDecayActive=false;addReferenceImpulse(p,impulse,now);p.burstSpread=result.spread;p.spread=result.spread;
  return{...result,direction:ray,burst:p.burstCount,recoilYaw:p.recoilYaw||0,recoilPitch:p.recoilPitch||0};
 }
 return Object.freeze({...previous,id:profile.recoilModel,profileId:profile.id,reset,update,weaponSpread,shotProfile,sampleViewRecoil:(p,seconds=0)=>p.cs2PunchVersion===2?sampleReferencePunch(p,seconds):previous.sampleViewRecoil(p,seconds)});
}
