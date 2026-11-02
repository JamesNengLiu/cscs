import {RULES} from './config.js';
import {trace,collides} from './map.js';
import {maxMoveSpeed} from './movement.js';
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
export function predictionCorrectionLimit(before,after,{previousAuthority,authority,intervalSeconds=0,activeRecovery=false}={}){
 if(!previousAuthority||!authority||!before?.alive||!after?.alive||previousAuthority.id!==authority.id||previousAuthority.team!==authority.team||previousAuthority.alive!==authority.alive||previousAuthority.playedRound!==authority.playedRound||previousAuthority.recoilSeed!==authority.recoilSeed||authority.teleport||previousAuthority.teleportId!==authority.teleportId||previousAuthority.teleportSeq!==authority.teleportSeq||(previousAuthority.spawnId??previousAuthority.spawnSeq??previousAuthority.lifeId)!==(authority.spawnId??authority.spawnSeq??authority.lifeId))return .5;
 const skipped=Math.max(0,(authority.skippedInputCommands||0)-(previousAuthority.skippedInputCommands||0));
 const gap=Number.isFinite(intervalSeconds)&&intervalSeconds>.075?Math.min(.35,intervalSeconds):0;
 const speed=Math.max(maxMoveSpeed(after),Math.hypot(before.vx||0,before.vz||0));
 const continuing=activeRecovery&&Math.hypot(before.x-after.x,before.y-after.y,before.z-after.z)<.5;
 return Math.max(continuing?2:.5,Math.min(2,speed*Math.max(gap,skipped/60)*1.25+.1));
}
