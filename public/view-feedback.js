// Cosmetic roll leaves the view's forward ray unchanged (YXZ Euler order).
// Ground-jump speed is ~268 source units/s; ordinary crouch-jumps stay below 350.
export const LANDING_FEEDBACK=Object.freeze({thresholdSource:350,maxRollDegrees:1.5,peakMs:25,durationMs:220});
export function createViewFeedback(){
 let pulse=null,lastKey=null,lastAt=-Infinity,lastRound=null;const zero=Object.freeze({roll:0});
 return {
  observe(before,after,{seq,round,now,enabled=true,strength=.25}={}){
   if(!enabled||!Number.isFinite(now)||!before||!after||after.alive===false)return false;
   const fall=(after.landedSpeed||0)*40,key=`${round}:${seq}`;
   if(!Number.isFinite(fall)||before.grounded||!after.grounded||fall<LANDING_FEEDBACK.thresholdSource||lastKey===key||round===lastRound&&now-lastAt>=0&&now-lastAt<LANDING_FEEDBACK.durationMs)return false;
   lastKey=key;lastAt=now;lastRound=round;pulse={at:now,roll:Math.min(LANDING_FEEDBACK.maxRollDegrees,fall*.013*Math.max(0,Math.min(1,Number.isFinite(strength)?strength:.25)))*Math.PI/180};return true;
  },
  sample(now,enabled=true){
   if(!enabled||!pulse||!Number.isFinite(now)){if(!enabled)pulse=null;return zero;}
   const age=now-pulse.at;if(age<0)return zero;if(age>=LANDING_FEEDBACK.durationMs){pulse=null;return zero;}
   const x=age/LANDING_FEEDBACK.durationMs,envelope=age<LANDING_FEEDBACK.peakMs?age/LANDING_FEEDBACK.peakMs:(1-x)/(1-LANDING_FEEDBACK.peakMs/LANDING_FEEDBACK.durationMs);
   return {roll:pulse.roll*Math.max(0,envelope)**2};
  },
  reset(){pulse=null;lastKey=null;lastAt=-Infinity;lastRound=null;},diagnostics:()=>({active:!!pulse,lastKey})
 };
}
export function viewmodelMotion(player,now,{bob='current',bobStrength=.35}={}){
 const speed=Math.min(1,Math.hypot(player?.vx||0,player?.vz||0)/6.25);
 if(bob==='off')return {y:0,side:0,roll:0,cameraRoll:0};
 if(bob!=='classic')return {y:Math.abs(Math.sin(now*.007))*speed*.006,side:Math.sin(now*.007)*speed*.006,roll:0,cameraRoll:0};
 const strength=Math.max(0,Math.min(1,bobStrength)),cycle=(now/1000%.8)/.8,phase=cycle<.5?Math.PI*cycle/.5:Math.PI+Math.PI*(cycle-.5)/.5;
 const y=(.3+.7*Math.sin(phase))*speed*.055*strength;
 const side=Math.sin(phase*.5)*speed*.018*strength;
 const lateral=(player?.vx||0)*Math.cos(player?.yaw||0)-(player?.vz||0)*Math.sin(player?.yaw||0);
 return {y,side,roll:-side*.5,cameraRoll:Math.max(-1,Math.min(1,lateral/5))*Math.PI/180*strength*(player?.grounded?1:0)};
}
