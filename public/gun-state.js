import {GUNS} from './arsenal.js';
import {shotProfile} from './weapons.js';
import {shotInterval,nextShotDeadline} from './weapon-feel.js';
import {recoilRandom} from './shot-random.js';
// Shared, bounded weapon state transition. No traces, damage, inventory writes,
// network access or presentation side effects. A client applies it only to a copy.
export function consumeGunShot(p,now,follow=false,random=Math.random){
  const w=GUNS[p.weapon];if(!w||now<(p.nextAttackAt||0)||p.ammo<=0)return null;
  const interval=shotInterval(p);
  if(!follow&&now<(p.nextShotAt||p.lastShot+interval)-1e-8)return null;
  if(p.reloadAt){if(w.reloadStyle==='per-shell'&&p.ammo>0)p.reloadAt=0;else return null;}
  p.ammo--;p.shotsFired=(p.shotsFired||0)+1;
  const profile=shotProfile(p,random,now,follow,recoilRandom(p.recoilSeed,p.shotsFired,p.weapon,random));
  if(!follow){p.nextShotAt=nextShotDeadline(p.nextShotAt||0,now,interval,w.automatic&&!p.burstMode&&p.fireHeld);p.nextSecondaryAt=p.nextShotAt;}p.lastShot=now;
  if(p.burstMode&&!follow&&['glock18','famas'].includes(p.weapon)){p.burstRemaining=Math.min(2,p.ammo);p.nextBurstAt=now+(p.weapon==='glock18'?.1:.05);}
  if(['awp','scout'].includes(p.weapon)&&p.zoom!==90){p.resumeZoom=p.zoom;p.zoom=90;p.resumeZoomAt=now+w.interval;}
  return profile;
}
