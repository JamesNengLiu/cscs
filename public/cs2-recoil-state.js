// Numerical browser adapter, not Valve's private angle evaluator. The angle
// coefficients below were fitted only on the first 15 native AK shots, then
// checked on held-out sprays and pauses; see the calibration document for
// residuals and censored external-hit cases. Velocity decay is independently
// observed at 4.5/s. All public state is scalar so prediction cannot alias it.
const RAD=Math.PI/180,STEP=1/128,ANGLE_EXP=8.239,ANGLE_LINEAR=17.908*RAD,VELOCITY_EXP=4.5;
const FULL_ANGLE=Math.exp(-ANGLE_EXP*STEP),FULL_VELOCITY=Math.exp(-VELOCITY_EXP*STEP),FULL_LINEAR=ANGLE_LINEAR*STEP;
export const CS2_RECOIL_CALIBRATION=Object.freeze({id:'native-data-angle-approximation-v2',maxStep:STEP,angleExponential:ANGLE_EXP,angleLinearDegrees:17.908,velocityExponential:VELOCITY_EXP,rayScale:2,exactRetailAngleEvaluator:false});
const finite=(x,fallback=0)=>Number.isFinite(x)?x:fallback;
const validClock=(p,at)=>Number.isFinite(at)&&(!Number.isFinite(p.cs2PunchTime)||at>=p.cs2PunchTime-1e-9);
const monotonicClock=(p,at)=>Math.max(at,finite(p.cs2PunchTime,at));
export function integrateReferencePunch(pitch,yaw,pitchVelocity,yawVelocity,seconds){
 let x=finite(pitch),y=finite(yaw),vx=finite(pitchVelocity),vy=finite(yawVelocity),remaining=Math.max(0,finite(seconds));
 if(remaining>=5)return{recoilPitch:0,recoilYaw:0,cs2RecoilPitchVelocity:0,cs2RecoilYawVelocity:0};
 while(remaining>1e-12){const dt=Math.min(STEP,remaining),whole=dt===STEP,angleFactor=whole?FULL_ANGLE:Math.exp(-ANGLE_EXP*dt),velocityFactor=whole?FULL_VELOCITY:Math.exp(-VELOCITY_EXP*dt),linear=whole?FULL_LINEAR:ANGLE_LINEAR*dt;
  x*=angleFactor;y*=angleFactor;const length=Math.hypot(x,y),factor=length>linear?1-linear/length:0;x*=factor;y*=factor;
  const nx=vx*velocityFactor,ny=vy*velocityFactor;x+=(vx+nx)*dt*.5;y+=(vy+ny)*dt*.5;vx=nx;vy=ny;remaining-=dt;
 }
 return{recoilPitch:x,recoilYaw:y,cs2RecoilPitchVelocity:vx,cs2RecoilYawVelocity:vy};
}
function base(p,at){
 const has=Number.isFinite(p.cs2PunchBaseAt),external=has&&(p.recoilPitch!==p.cs2PunchEvaluatedPitch||p.recoilYaw!==p.cs2PunchEvaluatedYaw);
 if(!has||external)return{pitch:finite(p.recoilPitch),yaw:finite(p.recoilYaw),pitchVelocity:finite(p.cs2RecoilPitchVelocity),yawVelocity:finite(p.cs2RecoilYawVelocity),at:finite(p.cs2PunchTime,at)};
 return{pitch:p.cs2PunchBasePitch,yaw:p.cs2PunchBaseYaw,pitchVelocity:p.cs2PunchBasePitchVelocity,yawVelocity:p.cs2PunchBaseYawVelocity,at:p.cs2PunchBaseAt};
}
function writeBase(p,at){p.cs2PunchBaseAt=at;p.cs2PunchBasePitch=finite(p.recoilPitch);p.cs2PunchBaseYaw=finite(p.recoilYaw);p.cs2PunchBasePitchVelocity=finite(p.cs2RecoilPitchVelocity);p.cs2PunchBaseYawVelocity=finite(p.cs2RecoilYawVelocity);p.cs2PunchTime=at;p.cs2PunchEvaluatedPitch=p.cs2PunchBasePitch;p.cs2PunchEvaluatedYaw=p.cs2PunchBaseYaw;}
export function resetReferencePunch(p){p.cs2PunchVersion=0;p.cs2RecoilPitchVelocity=0;p.cs2RecoilYawVelocity=0;delete p.cs2PunchBaseAt;delete p.cs2PunchTime;delete p.cs2PunchEvaluatedPitch;delete p.cs2PunchEvaluatedYaw;}
export function advanceReferencePunch(p,dt,now){
 if(!validClock(p,now))return;
 const at=monotonicClock(p,now),external=Number.isFinite(p.cs2PunchBaseAt)&&(p.recoilPitch!==p.cs2PunchEvaluatedPitch||p.recoilYaw!==p.cs2PunchEvaluatedYaw);
 if(external){
  // Preserve the existing hit/other-gun angle assignment at its current tick,
  // while advancing the independent residual velocity to the same clock.
  const previous=integrateReferencePunch(p.cs2PunchBasePitch,p.cs2PunchBaseYaw,p.cs2PunchBasePitchVelocity,p.cs2PunchBaseYawVelocity,Math.max(0,at-p.cs2PunchBaseAt));p.cs2RecoilPitchVelocity=previous.cs2RecoilPitchVelocity;p.cs2RecoilYawVelocity=previous.cs2RecoilYawVelocity;writeBase(p,at);return;
 }
 if(!Number.isFinite(p.cs2PunchBaseAt)){p.cs2PunchTime=at-Math.max(0,finite(dt));writeBase(p,p.cs2PunchTime);}
 const b=base(p,at);Object.assign(p,integrateReferencePunch(b.pitch,b.yaw,b.pitchVelocity,b.yawVelocity,Math.max(0,at-b.at)));p.cs2PunchTime=at;p.cs2PunchEvaluatedPitch=p.recoilPitch;p.cs2PunchEvaluatedYaw=p.recoilYaw;
 if(Math.hypot(p.recoilPitch,p.recoilYaw,p.cs2RecoilPitchVelocity,p.cs2RecoilYawVelocity)<1e-8){p.recoilPitch=p.recoilYaw=p.cs2RecoilPitchVelocity=p.cs2RecoilYawVelocity=0;writeBase(p,at);}
}
export function addReferenceImpulse(p,sourceImpulseDegrees,now){
 if(!validClock(p,now)||!Number.isFinite(sourceImpulseDegrees?.[0])||!Number.isFinite(sourceImpulseDegrees?.[1]))return;
 now=monotonicClock(p,now);
 if(p.cs2PunchVersion===2)advanceReferencePunch(p,0,now);
 else{p.cs2RecoilPitchVelocity=0;p.cs2RecoilYawVelocity=0;}
 // Source pitch is positive down; browser pitch is positive up. Yaw retains
 // the existing source-axis transform. Do not fold the ray's x2 into camera.
 p.cs2RecoilPitchVelocity=finite(p.cs2RecoilPitchVelocity)-sourceImpulseDegrees[0]*RAD;p.cs2RecoilYawVelocity=finite(p.cs2RecoilYawVelocity)+sourceImpulseDegrees[1]*RAD;p.cs2PunchVersion=2;writeBase(p,now);
}
export function rebaseReferencePunch(p,now){if(validClock(p,now))writeBase(p,monotonicClock(p,now));}
export function sampleReferencePunch(p,seconds=0){
 const dt=Math.max(0,Math.min(1/60,finite(seconds))),clock=finite(p.cs2PunchTime,finite(p.cs2PunchBaseAt)),b=base(p,clock),at=clock+dt,result=integrateReferencePunch(b.pitch,b.yaw,b.pitchVelocity,b.yawVelocity,Math.max(0,at-b.at));
 return{...result,cs2PunchTime:at,cs2PunchEvaluatedPitch:result.recoilPitch,cs2PunchEvaluatedYaw:result.recoilYaw};
}
