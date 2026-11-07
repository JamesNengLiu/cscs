// Shared bounded visual field. Authority owns the event clocks and lifetime;
// bullet holes and HE pulses affect density only, never hitscan or collision.
export const SMOKE_FIELD_VERSION='cs2-smoke-field-pilot-v1';
export const SMOKE_FIELD_LIMITS=Object.freeze({volumes:32,visibleVolumes:4,holes:4,clears:2,samples:8,holeSeconds:.35,clearSeconds:1.2,holeRadius:.2,clearRadius:4.2});
const finite=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<100000);
// Density apertures are visual only. Millimetre coordinates and short stable
// identities keep a full 32-volume snapshot inside the bounded wire budget.
const point=p=>({x:Math.round(p.x*1000)/1000,y:Math.round(p.y*1000)/1000,z:Math.round(p.z*1000)/1000});
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function segmentKey(a,b){let hash=2166136261;for(const p of [a,b])for(const k of ['x','y','z']){hash^=Math.round(p[k]*1000);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16);}
function identity(text){let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16);}
export function smokeEnvelope(volume,now){if(!volume||!Number.isFinite(now))return 0;return clamp((now-volume.bornAt)/.65,0,1)*clamp((volume.endAt-now)/2,0,1);}
export function createSmokeVolume({id,x,y,z,bornAt,endAt,radius=3.8,height=3.2}={}){
 if(typeof id!=='string'||id.length>128||!finite({x,y,z})||!Number.isFinite(bornAt)||!Number.isFinite(endAt)||endAt<=bornAt||endAt-bornAt>30||!Number.isFinite(radius)||radius<=0||radius>8||!Number.isFinite(height)||height<=0||height>8)return null;
 return{id,x,y,z,bornAt,endAt,radius,height,fieldVersion:SMOKE_FIELD_VERSION,holes:[],clears:[]};
}
function closestDistance(a,b,p){const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,length=dx*dx+dy*dy+dz*dz,t=length?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy+(p.z-a.z)*dz)/length,0,1):0;return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t,p.z-a.z-dz*t);}
export function pruneSmokeFields(smokes,now){if(!Array.isArray(smokes)||!Number.isFinite(now))return;for(const v of smokes.slice(0,SMOKE_FIELD_LIMITS.volumes)){v.holes=(v.holes||[]).filter(h=>Number.isFinite(h.endAt)&&h.endAt>now).slice(-SMOKE_FIELD_LIMITS.holes);v.clears=(v.clears||[]).filter(h=>Number.isFinite(h.endAt)&&h.endAt>now).slice(-SMOKE_FIELD_LIMITS.clears);}}
export function applySmokeShot(smokes,event,now){
 if(!Array.isArray(smokes)||!finite(event?.from)||!finite(event?.to)||!Number.isFinite(now))return 0;pruneSmokeFields(smokes,now);let affected=0;
 const shotId=String(event.shotId??event.eventId??'').slice(0,128);if(!shotId)return 0;const id=identity(shotId)+':'+segmentKey(event.from,event.to);
 for(const v of smokes.slice(0,SMOKE_FIELD_LIMITS.volumes)){if(v.endAt<=now||v.bornAt>now||v.fieldVersion!==SMOKE_FIELD_VERSION)continue;const center={x:v.x,y:v.y+(v.height||3.2)*.45,z:v.z};if(closestDistance(event.from,event.to,center)>Math.max(v.radius,v.height||3.2))continue;
  if(v.holes.some(h=>h.id===id))continue;v.holes.push({id,from:point(event.from),to:point(event.to),bornAt:now,endAt:now+SMOKE_FIELD_LIMITS.holeSeconds,radius:SMOKE_FIELD_LIMITS.holeRadius});v.holes=v.holes.slice(-SMOKE_FIELD_LIMITS.holes);affected++;
 }return affected;
}
export function applySmokeExplosion(smokes,event,now){
 if(event?.kind!=='hegrenade'||!Array.isArray(smokes)||!finite(event)||!Number.isFinite(now))return 0;pruneSmokeFields(smokes,now);let affected=0;const eventId=String(event.id??event.eventId??'').slice(0,128);if(!eventId)return 0;const id=identity(eventId);
 for(const v of smokes.slice(0,SMOKE_FIELD_LIMITS.volumes)){if(v.endAt<=now||v.bornAt>now||v.fieldVersion!==SMOKE_FIELD_VERSION||Math.hypot(v.x-event.x,v.y-event.y,v.z-event.z)>v.radius+SMOKE_FIELD_LIMITS.clearRadius)continue;if(v.clears.some(h=>h.id===id))continue;v.clears.push({id,position:point(event),bornAt:now,endAt:now+SMOKE_FIELD_LIMITS.clearSeconds,radius:SMOKE_FIELD_LIMITS.clearRadius});v.clears=v.clears.slice(-SMOKE_FIELD_LIMITS.clears);affected++;}return affected;
}
export function smokeDensity(volume,position,now){
 if(!finite(position))return 0;const envelope=smokeEnvelope(volume,now);if(!envelope)return 0;const scale=.2+.8*envelope,rx=volume.radius*scale,ry=(volume.height||3.2)*.55*scale,dy=position.y-volume.y-(volume.height||3.2)*.45;const distance=Math.hypot((position.x-volume.x)/rx,dy/ry,(position.z-volume.z)/rx);let density=clamp((1-distance)*3,0,1)*envelope;
 for(const h of (volume.holes||[]).slice(-SMOKE_FIELD_LIMITS.holes)){if(h.endAt<=now)continue;const strength=clamp((h.endAt-now)/(h.endAt-h.bornAt),0,1),d=closestDistance(h.from,h.to,position)/h.radius;density*=1-Math.exp(-d*d*2)*strength;}
 for(const h of (volume.clears||[]).slice(-SMOKE_FIELD_LIMITS.clears)){if(h.endAt<=now)continue;const strength=Math.sin(clamp((now-h.bornAt)/(h.endAt-h.bornAt),0,1)*Math.PI),d=Math.hypot(position.x-h.position.x,position.y-h.position.y,position.z-h.position.z)/h.radius;density*=1-clamp((1-d)*3,0,1)*strength;}
 return clamp(density,0,1);
}
