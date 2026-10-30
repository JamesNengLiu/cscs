// Presentation weights only. The authoritative effect/group remains decisive.
import {GUNS} from './arsenal.js';
import {usesMainWeaponRules} from './weapon-feel.js';
export function hitFeedbackProfile(event={}){
  const hit=event.hitImpact||{},blood=hit.effect==='blood',spark=['helmet','shield'].includes(hit.effect);
  const main=usesMainWeaponRules({weapon:event.weapon}),kind=main?(event.weapon==='awp'?'heavy':GUNS[event.weapon]?.category==='smg'?'light':'rifle'):'legacy';
  if(!main||hit.effect==='shield')return {kind:'legacy',count:spark?12:blood?10:6,puffs:spark?0:2,puffMin:.22,puffRange:.16,dropMin:.035,dropRange:spark?.025:.035,life:spark?.2:.32,puffLife:.25,spread:2,outward:.4,stretch:spark?3:1};
  const head=hit.hitgroup==='head',heavy=kind==='heavy',light=kind==='light';
  if(spark)return {kind,count:heavy?16:light?12:14,puffs:0,puffMin:0,puffRange:0,dropMin:heavy?.04:.03,dropRange:.025,life:.2,puffLife:.2,spread:heavy?2.8:light?1.7:2.2,outward:heavy?.7:.45,stretch:heavy?4:3};
  if(!blood)return {kind,count:heavy?10:light?6:8,puffs:1,puffMin:.16,puffRange:.08,dropMin:.03,dropRange:.03,life:.28,puffLife:.18,spread:heavy?2.4:1.6,outward:.4,stretch:1};
  return {kind,count:(heavy?18:light?8:12)+(head?4:0),puffs:heavy?3:2,puffMin:(heavy?.28:light?.18:.22)*(head?1.1:1),puffRange:heavy?.16:light?.1:.12,dropMin:heavy?.04:.03,dropRange:heavy?.04:.03,life:heavy?.36:.3,puffLife:heavy?.25:.22,spread:heavy?2.8:light?1.6:2.1,outward:heavy?.8:light?.3:.5,stretch:1};
}
