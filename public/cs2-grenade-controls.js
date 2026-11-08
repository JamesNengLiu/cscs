// CS2-only input candidates. Valve documents the dual-release tolerance but
// does not publish its duration; these two windows remain reversible tuning.
export const CS2_GRENADE_CONTROLS=Object.freeze({id:'cs2-grenade-buttons-v1',pinSeconds:.5,recoverSeconds:.5,retireWithAmmoSeconds:.75,dualSettleSeconds:.1,dualReleaseGraceSeconds:.1,maxActionSeconds:3600});
// DOM timestamps retain the physical edge spacing when a browser long frame
// queues several mouse events. Use them only on this local control clock;
// animation readiness and authoritative launch continue to use their own clocks.
export function grenadeEventTime(timestamp,now){
 if(!Number.isFinite(now)||now<0)return 0;
 const stamp=Number.isFinite(timestamp)?timestamp/1000:NaN;
 return stamp>0&&stamp<=now+.001&&stamp>=Math.max(0,now-CS2_GRENADE_CONTROLS.maxActionSeconds)?Math.min(stamp,now):now;
}
export const validThrowButtons=(buttons,{released=false}={})=>Number.isInteger(buttons)&&buttons>=(released?0:1)&&buttons<=3;
const strengthFor=buttons=>buttons===1?1:buttons===2?0:.5;
export function createThrowControl(buttons,now){
 if(!validThrowButtons(buttons)||!Number.isFinite(now))return null;
 return {buttons,changedAt:now,dualStartedAt:buttons===3?now:null,dualReleasedAt:null,dualSettled:false,strength:strengthFor(buttons)};
}
export function throwStrength(control,now){
 if(!control)return 1;
 if(!control.buttons)return control.strength;
 const at=Number.isFinite(now)?Math.max(control.changedAt,now):control.changedAt;
 if(control.buttons===3||control.dualSettled&&control.dualReleasedAt!==null&&at-control.dualReleasedAt<=CS2_GRENADE_CONTROLS.dualReleaseGraceSeconds+1e-8)return .5;
 return strengthFor(control.buttons);
}
export function changeThrowButtons(control,buttons,now){
 if(!control||!control.buttons||!validThrowButtons(buttons,{released:true})||!Number.isFinite(now)||buttons===control.buttons)return control;
 const at=Math.max(control.changedAt,now),strength=throwStrength(control,at);
 if(!buttons)return {...control,buttons:0,changedAt:at,strength};
 if(buttons===3)return {...control,buttons,changedAt:at,dualStartedAt:at,dualReleasedAt:null,dualSettled:false,strength:.5};
 const leavingDual=control.buttons===3,settled=leavingDual&&at-control.dualStartedAt>=CS2_GRENADE_CONTROLS.dualSettleSeconds-1e-8;
 return {...control,buttons,changedAt:at,dualStartedAt:null,dualReleasedAt:settled?at:null,dualSettled:settled,strength:strengthFor(buttons)};
}
export function throwMode(strength){return strength>=.75?'overhand':strength<=.25?'underhand':'medium';}
