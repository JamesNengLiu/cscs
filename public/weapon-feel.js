// Independently authored numeric rules. Reference and limits: docs/cs16-sources.md.
import {GUNS} from './arsenal.js';
import {KICK} from './weapon-kick.js';
const rad=Math.PI/180,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Explicit rollout scope: six rifles, five SMGs and AWP. Missing local version
// means current rules; network clients mark older snapshots with version zero.
export const MAIN_BALLISTICS_VERSION=1;
const MAIN_AUTOMATICS=new Set(['ak47','m4a1','aug','sg552','galil','famas','mac10','mp5navy','tmp','ump45','p90']);
export const usesMainAutoRules=p=>p?.ballisticsVersion!==0&&MAIN_AUTOMATICS.has(p?.weapon);
export const usesMainWeaponRules=p=>p?.ballisticsVersion!==0&&(MAIN_AUTOMATICS.has(p?.weapon)||p?.weapon==='awp');
const AUTO={
  ak47:[3,200,.35,1.25,.2],m4a1:[3,220,.3,1,.2],aug:[3,215,.3,1,.2],sg552:[3,220,.3,1,.2],
  galil:[3,200,.35,1.25,.2],famas:[3,215,.3,1,.2],m249:[3,175,.4,.9,.2],
  mac10:[3,200,.6,1.65,.15],mp5navy:[2,220.1,.45,.75,0],tmp:[3,200,.55,1.4,.2],ump45:[2,210,.5,1,0],p90:[2,175,.45,1,.2],
};
// Initial/max accuracy, minimum accuracy, time window, deterioration, air/move/duck/stand factors.
const PISTOL={
  glock18:[.9,.6,.325,.275,1,.165,.075,.1],usp:[.92,.6,.3,.275,1.2,.225,.08,.1],
  p228:[.9,.6,.325,.3,1.5,.255,.075,.15],deagle:[.9,.55,.4,.35,1.5,.25,.115,.13],
  elite:[.88,.55,.325,.275,1.3,.175,.08,.1],fiveseven:[.92,.725,.275,.25,1.5,.255,.075,.15],
};
export const baseAccuracy=id=>AUTO[id]?.[4]??PISTOL[id]?.[0]??(id==='sg550'?.9:id==='g3sg1'?.2:0);
export const deploySeconds=id=>id==='awp'?1.45:.75;
export function shotInterval(p){
  if(p.burstMode&&p.weapon==='glock18')return .5;
  if(p.burstMode&&p.weapon==='famas')return .55;
  if(['aug','sg552'].includes(p.weapon)&&p.zoom>0&&p.zoom<90)return .135;
  return GUNS[p.weapon]?.interval??.4;
}
export function nextShotDeadline(previous,now,interval,continuous=true){
  // Keep the fractional tick remainder during sustained fire; never catch up a pause.
  return (continuous&&previous>now-1/60-1e-7&&previous<=now+1e-7?previous:now)+interval;
}
export function advanceAccuracy(p,now,follow=false){
  if(follow)return;
  const id=p.weapon,n=(p.burstCount||0)+1,a=AUTO[id],q=PISTOL[id];
  if(a)p.accuracy=Math.min(n**a[0]/a[1]+a[2],a[3]);
  else if(q){
    const old=Number.isFinite(p.accuracy)?p.accuracy:q[0];
    p.accuracy=p.lastShot>-50?clamp(old-(q[2]-(now-p.lastShot))*q[3],q[1],q[0]):q[0];
  }else if(['g3sg1','sg550'].includes(id))p.accuracy=p.lastShot>-50?Math.min(.98,(now-p.lastShot)*(id==='g3sg1'?.3:.35)+(id==='g3sg1'?.55:.65)):.98;
}
export function accuracySpread(p,grounded){
  const id=p.weapon,v=Math.hypot(p.vx||0,p.vz||0)*40,air=!grounded;
  const a=Number.isFinite(p.accuracy)?p.accuracy:baseAccuracy(id),q=PISTOL[id];
  if(q){
    let factors=q.slice(4);
    if(id==='usp'&&p.silenced)factors=[1.3,.25,.125,.15];
    if(id==='glock18'&&p.burstMode)factors=[1.2,.185,.095,.3];
    return factors[air?0:v>0?1:p.crouch?2:3]*(1-a);
  }
  let s;
  switch(id){
    case 'ak47':s=air?.04+.4*a:v>140?.04+.07*a:.0275*a;break;
    case 'm4a1':s=air?.035+.4*a:v>140?.035+.07*a:(p.silenced?.025:.02)*a;break;
    case 'aug':s=air?.035+.4*a:v>140?.035+.07*a:.02*a;break;
    case 'sg552':s=air?.035+.45*a:v>140?.035+.075*a:.02*a;break;
    case 'galil':s=air?.04+.3*a:v>140?.04+.07*a:.0375*a;break;
    case 'famas':s=(air?.03+.3*a:v>140?.03+.07*a:.02*a)+(p.burstMode?0:.01);break;
    case 'm249':s=air?.045+.5*a:v>140?.045+.095*a:.03*a;break;
    case 'mac10':s=(air?.375:.03)*a;break;
    case 'tmp':s=(air?.25:.03)*a;break;
    case 'mp5navy':s=(air?.2:.04)*a;break;
    case 'ump45':s=(air?.24:.04)*a;break;
    case 'p90':s=(air?.3:v>170?.115:.045)*a;break;
    case 'awp':s=air?.85:v>140?.25:v>10?.1:p.crouch?0:.001;break;
    case 'scout':s=air?.2:v>170?.075:p.crouch?0:.007;break;
    case 'g3sg1':s=(air?.45:v>0?.15:p.crouch?.035:.055)+(p.zoom===90?.025:0);return (1-a)*s;
    case 'sg550':s=air?.45*(1-a):v>0?.15:(p.crouch?.04:.05)*(1-a);break;
    case 'm3':case 'xm1014':return .0675;
    default:return null;
  }
  if(GUNS[id]?.category==='sniper'&&(!p.zoom||p.zoom===90))s+=id==='awp'?.08:.025;
  return s;
}
export function applyKick(p,grounded,random=Math.random){
  const id=p.weapon,table=KICK[id],n=p.burstCount||1;
  if(table){
    const moving=Math.hypot(p.vx||0,p.vz||0)>1e-5;
    const airFirst=['m249','mac10','mp5navy','tmp','ump45','p90'].includes(id);
    const tuple=table[airFirst&&!grounded?1:moving?0:!grounded?1:p.crouch?2:3];
    const [up,side,upStep,sideStep,maxUp,maxSide,flip]=tuple;
    p.recoilPitch=Math.min(maxUp*rad,(p.recoilPitch||0)+(up+(n===1?0:n*upStep))*rad);
    const yaw=(p.recoilYaw||0)+(p.recoilDirection===1?1:-1)*(side+(n===1?0:n*sideStep))*rad;
    p.recoilYaw=usesMainAutoRules(p)
      ?p.recoilDirection===1?Math.min(maxSide*rad,yaw):Math.max(-maxSide*rad,yaw)
      :clamp(yaw,-maxSide*rad,maxSide*rad);
    if(Math.floor(random()*(flip+1))===0)p.recoilDirection=p.recoilDirection===1?0:1;
  }else{
    let kick=id==='glock18'?0:2;
    if(id==='m3')kick=grounded?4+Math.floor(random()*3):8+Math.floor(random()*4);
    if(id==='xm1014')kick=grounded?3+Math.floor(random()*3):7+Math.floor(random()*4);
    if(id==='g3sg1'||id==='sg550'){
      kick=.75+random()*(id==='g3sg1'?1:.5)-(p.recoilPitch||0)/rad*.25;
      p.recoilYaw=(p.recoilYaw||0)+(random()-.5)*1.5*rad;
    }
    p.recoilPitch=(p.recoilPitch||0)+kick*rad;
  }
}
export function decayPunch(p,dt){
  const length=Math.hypot(p.recoilYaw||0,p.recoilPitch||0),degrees=length/rad;
  const factor=length?Math.max(0,degrees-(10+degrees*.5)*dt)/degrees:0;
  p.recoilYaw=(p.recoilYaw||0)*factor;p.recoilPitch=(p.recoilPitch||0)*factor;
}
// Sample the remaining fraction of a fixed prediction tick analytically, rather
// than adding another low-pass tail after the actual ballistic punch has ended.
export function sampleViewRecoil(p,seconds=0){
  const recoil={recoilYaw:Number.isFinite(p?.recoilYaw)?p.recoilYaw:0,recoilPitch:Number.isFinite(p?.recoilPitch)?p.recoilPitch:0};
  decayPunch(recoil,Number.isFinite(seconds)?clamp(seconds,0,1/60):0);return recoil;
}
