// Experimental adapter: preserves the proven v1.0 algorithm with the CS2 world.
import {RULES} from './cs2-client-world.js';
import {trace,collides} from './cs2-client-world.js';
import {maxMoveSpeed} from './cs2-client-world.js';
const finitePose=p=>p&&['x','y','z','vx','vy','vz'].every(k=>Number.isFinite(p[k]));
const height=p=>p.crouch?RULES.crouchHeight:RULES.bodyHeight;
function stableGround(p){return finitePose(p)&&p.alive!==false&&p.grounded===true&&Math.abs(p.vy)<.01&&!p.ducking&&(!Number.isFinite(p.duckAmount)||p.duckAmount===0||p.duckAmount===1);}
function safeGroundSegment(from,to,players){
 if(!stableGround(from)||!stableGround(to)||from.id!==to.id||!!from.crouch!==!!to.crouch||Math.abs(to.y-from.y)>.002)return false;
 const h=height(from),sweep=trace(from,to,h);if(sweep.startSolid||sweep.fraction<1||collides(to.x,to.z,RULES.radius,to.y,h))return false;
 const support=trace(to,{...to,y:to.y-.04},h);
 if(support.startSolid||support.fraction===1||support.normal[1]<.99||Math.abs(support.end.y-to.y)>.002)return false;
 // Reject a segment near another body, including one entering from the side.
 for(const p of players||[]){if(!p.alive||p.id===from.id)continue;const r=RULES.radius*2+.1;
  if(p.y<Math.max(from.y,to.y)+h&&p.y+height(p)>Math.min(from.y,to.y)&&p.x>=Math.min(from.x,to.x)-r&&p.x<=Math.max(from.x,to.x)+r&&p.z>=Math.min(from.z,to.z)-r&&p.z<=Math.max(from.z,to.z)+r)return false;
 }
 return true;
}
export function remoteExtrapolationSafe(from,to,context,players=[]){
 if(!Number.isFinite(context.dtSeconds)||context.dtSeconds<=0||context.dtSeconds>.050000001)return false;
 const previous=context.previous;if(!stableGround(previous)||!!previous.crouch!==!!from.crouch)return false;
 const speed=Math.hypot(from.vx,from.vz),prior=Math.hypot(previous.vx,previous.vz);
 if(speed<.1||speed>maxMoveSpeed(from)+.05||(prior>=.1&&(from.vx*previous.vx+from.vz*previous.vz)<speed*prior*.95))return false;
 return safeGroundSegment(from,to,players);
}
export function remoteGapSafe(from,to,context,players=[]){
 if(!Number.isFinite(context.dtSeconds)||context.dtSeconds<=0||context.dtSeconds>.5)return false;
 if(Number.isFinite(from.jumpFatigue)&&Number.isFinite(to.jumpFatigue)&&to.jumpFatigue>Math.max(0,from.jumpFatigue-context.dtSeconds*1000)+20)return false;
 const distance=Math.hypot(to.x-from.x,to.z-from.z);
 return distance<=Math.max(maxMoveSpeed(from),maxMoveSpeed(to))*context.dtSeconds+.05&&safeGroundSegment(from,to,players);
}
// Keep the existing small-error behavior. Larger recovery is allowed only for
// same-life delayed/skipped authority, never an explicit teleport or new spawn.
export function predictionCorrectionLimit(before,after,{previousAuthority,authority,intervalSeconds=0,activeRecovery=false,correction}={}){
 if(!previousAuthority||!authority||!before?.alive||!after?.alive||previousAuthority.id!==authority.id||previousAuthority.team!==authority.team||previousAuthority.alive!==authority.alive||previousAuthority.playedRound!==authority.playedRound||previousAuthority.recoilSeed!==authority.recoilSeed||authority.teleport||authority.discontinuity||['teleportId','teleportSeq','spawnId','spawnSeq','lifeId'].some(key=>previousAuthority[key]!==authority[key])||(before.id!==undefined&&before.id!==authority.id)||(after.id!==undefined&&after.id!==authority.id))return .5;
 // A short delivery interruption can leave several metres of valid predicted
 // travel to recover. Evidence and a finite distance cap distinguish this from
 // a teleport; a long interruption must still take the normal hard reset.
 if(!Number.isFinite(intervalSeconds)||intervalSeconds<0||intervalSeconds>1.1)return .5;
 const skipped=Math.max(0,(authority.skippedInputCommands||0)-(previousAuthority.skippedInputCommands||0));
 const gap=intervalSeconds>.075?Math.min(1,intervalSeconds):0;
 const speed=Math.max(maxMoveSpeed(after),Math.hypot(before.vx||0,before.vz||0));
 const error=Math.hypot(before.x-after.x,before.y-after.y,before.z-after.z);
 const retained=correction&&['x','y','z'].every(key=>Number.isFinite(correction[key]))?Math.hypot(correction.x,correction.y,correction.z):null;
 // Keep an already authorised offset while fresh small corrections arrive.
 // It must not be cut back to the initial allowance on the next normal state.
 // Missing metadata retains the previous API's bounded two-metre fallback.
 const continuing=activeRecovery&&error<=.5?(retained===null?(correction===undefined?2:.5):Math.min(8,retained+error+.01)):.5;
 const evidenceBudget=Math.max(.5,Math.min(8,speed*Math.max(gap,Math.min(1,skipped/60))*1.25+.1));
 // A second evidenced interruption authorises its NEW error, not a replacement
 // limit for the still-decaying old offset. Carry that already valid offset
 // only when this error fits its own evidence; unexplained jumps stay hard.
 const compound=(gap>0||skipped>0)&&error<=evidenceBudget&&retained!==null&&(activeRecovery||retained<=.5)?Math.min(8,retained+error+.01):.5;
 // The next trustworthy applied-pair replay can undo part of the initial
 // outage error. Keeping a SMALLER carry spends no new recovery allowance.
 // Do not let a large reversal cross the whole old envelope, expand it, or
 // revive a vector outside the already authorised absolute cap.
 const remainder=activeRecovery&&retained!==null&&retained<=8&&error<=retained?Math.hypot(before.x+correction.x-after.x,before.y+correction.y-after.y,before.z+correction.z-after.z):Infinity;
 const reducing=Number.isFinite(remainder)&&retained!==null&&remainder<=retained?retained:.5;
 return Math.max(evidenceBudget,continuing,compound,reducing);
}

// An authorised recovery offset shows the view away from the authoritative
// player, while shots still originate from the authoritative position. Bound
// how long that can last: the decay speed never falls below what clears the
// largest offset of the current recovery within RECOVERY_SETTLE_SECONDS.
// Offsets up to 1.25 m keep the previous speed, so ordinary corrections are
// unchanged; only the metres-wide outage recoveries become faster.
export const RECOVERY_SETTLE_SECONDS=.5;
export function recoveryDecaySpeed(moveSpeed,peakOffset=0){
 const base=Math.max(2.5,Math.min(6,(Number.isFinite(moveSpeed)?moveSpeed:0)*.9));
 return Number.isFinite(peakOffset)&&peakOffset>0?Math.max(base,peakOffset/RECOVERY_SETTLE_SECONDS):base;
}
