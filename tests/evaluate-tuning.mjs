import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {RULES,WEAPONS,SPAWN_POINTS,supportHeight,groundHeight,movePlayer,resetWeapon,shotProfile,weaponSpread,updateWeapon} from '../public/shared.js';
const make=()=>{const s=SPAWN_POINTS.T[0];return {...s,y:supportHeight(s.x,s.z,s.y+.05),yaw:0,pitch:0,vx:0,vz:0,vy:0,weapon:'rifle',lastShot:-100};};
function stop(counter){const p=make();for(let i=0;i<24;i++)movePlayer(p,{f:-1,yaw:0},1/60);const start=p.z;let seconds=0;
  while(seconds<1&&p.vz>.1){movePlayer(p,counter?{f:1,yaw:0}:{yaw:0},1/120);seconds+=1/120;}return {seconds,metres:Math.abs(p.z-start),speedAtThreshold:Math.hypot(p.vx,p.vz)};
}
function rng(){let seed=1783;return ()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};}
function spray(mode){const p=make(),random=rng();resetWeapon(p);if(mode==='moving')p.vx=RULES.speed;const points=[];
  for(let i=0;i<30;i++){if(mode==='compensated'){p.yaw=-p.recoilYaw;p.pitch=-p.recoilPitch;}const s=shotProfile(p,random),d=s.direction;points.push({shot:i+1,x:d.x/-d.z*20,y:d.y/-d.z*20,spread:s.spread});}
  return {mode,rangeMetres:20,points,rmsMetres:Math.sqrt(points.reduce((n,p)=>n+p.x*p.x+p.y*p.y,0)/points.length)};
}
const resting=make();resetWeapon(resting);const spread={stationary:weaponSpread(resting)};resting.vx=RULES.speed;spread.running=weaponSpread(resting);resting.vx=0;resting.crouch=true;spread.crouching=weaponSpread(resting);resting.crouch=false;resting.y+=1;spread.airborne=weaponSpread(resting);
const release=stop(false),counter=stop(true),sprays=['stationary','moving','compensated'].map(spray);
assert.ok(counter.seconds<release.seconds&&counter.metres<release.metres);assert.ok(sprays[2].rmsMetres<sprays[0].rmsMetres);assert.ok(spread.running>spread.stationary);
const report={version:'0.3.0',kind:'deterministic prototype simulation, not CS1.5 reference or human playtest',rules: {speedMetresPerSecond:RULES.speed,groundAcceleration:RULES.groundAcceleration,releaseBrake:RULES.brake,counterBrake:RULES.counterBrake},stopFromFullSpeed:{release,counter},spreadRadians:spread,sprays};
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/tuning-report.json',JSON.stringify(report,null,2));
const width=1320,height=560,scale=76,centres=[220,660,1100],originY=340;
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#13212c"/><g font-family="Arial,sans-serif"><text x="30" y="38" fill="#efd1a0" font-size="24" font-weight="bold">LAN STRIKE v0.3 / RECOIL &amp; ACCURACY</text><text x="30" y="64" fill="#adc0c9" font-size="13">30-shot simulated bursts at 20 m | Identical seeded random spread | Original prototype tuning, NOT CS 1.5 calibration</text>`;
for(let i=0;i<sprays.length;i++){const s=sprays[i],cx=centres[i];svg+=`<rect x="${cx-195}" y="88" width="390" height="385" rx="9" fill="#21333e"/><text x="${cx}" y="120" text-anchor="middle" fill="#eee5cc" font-size="18">${s.mode.toUpperCase()}</text>`;
  for(let n=-2;n<=3;n++){const y=originY-n*scale;svg+=`<line x1="${cx-175}" y1="${y}" x2="${cx+175}" y2="${y}" stroke="#637983" opacity=".3"/>`;}
  svg+=`<line x1="${cx}" y1="145" x2="${cx}" y2="452" stroke="#7798a4" opacity=".5"/><circle cx="${cx}" cy="${originY}" r="8" fill="none" stroke="#fff"/>`;
  for(const p of s.points){const x=cx+p.x*scale,y=originY-p.y*scale;svg+=`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="4" fill="${i===2?'#83d2ab':'#e5ad62'}"/><text x="${(x+5).toFixed(2)}" y="${(y-4).toFixed(2)}" font-size="8" fill="#e0daca">${p.shot}</text>`;}
  svg+=`<text x="${cx}" y="496" text-anchor="middle" fill="#c6d6dc" font-size="14">RMS offset: ${s.rmsMetres.toFixed(3)} m</text>`;}
svg+=`<text x="30" y="537" fill="#9db3bc" font-size="12">COMPENSATED is ideal mathematical mouse compensation, not a measured player result. Crosshair centre is the aim origin.</text></g></svg>`;
await writeFile('artifacts/spray-comparison.svg',svg);
console.log(JSON.stringify({stopFromFullSpeed:report.stopFromFullSpeed,spreadRadians:spread,sprayRmsMetres:sprays.map(({mode,rmsMetres})=>({mode,rmsMetres}))},null,2));
