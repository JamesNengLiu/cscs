// Core accuracy/recovery, checked against independent native CS2 entity and
// FireBullets observations. Movement/air spread terms remain separately
// identified by the caller; this is not a port of Source 2 player movement.
import {clamp} from './math.js';
export const CALIBRATED_GUNS=Object.freeze(['ak47','m4a1','awp']);
export const cs2Coefficient=(source,key,mode=0)=>Number(Array.isArray(source[key])?source[key][mode]??source[key][0]:source[key])||0;
export function cs2WeaponMode(p){return(p.zoom>0&&p.zoom<90)||p.silenced||p.burstMode?1:0;}
export function accuracyBaseline(source,p){return cs2Coefficient(source,p.crouch?'m_flInaccuracyCrouch':'m_flInaccuracyStand',cs2WeaponMode(p));}
export function accuracyRecoverySeconds(source,p,grounded=true,index=p.cs2RecoilIndex||0){
 const key=p.crouch?'Crouch':'Stand',initial=source['m_flRecoveryTime'+key],final=source['m_flRecoveryTime'+key+'Final'],start=source.m_nRecoveryTransitionStartBullet||0,end=source.m_nRecoveryTransitionEndBullet||start+1;
 // Airborne precision still uses the previous experiment's extra terms.
 // Keep its recovery compatible too; applying the native air time without
 // migrating the native air baseline would mix only half of that model.
 if(!grounded)return Math.max(.03,initial+(final-initial)*clamp((Math.max(0,index)-start)/Math.max(1,end-start),0,1));
 // Recovery observes the old float index, converted to an integer, before the
 // independent float index decays. The protocol shot ordinal never decays.
 const fraction=clamp((Math.trunc(Math.max(0,index))-start)/Math.max(1,end-start),0,1);
 return Math.max(.03,initial+(final-initial)*fraction);
}
export function readCoreAccuracy(source,p){return Number.isFinite(p.cs2AccuracyValue)?Math.max(0,p.cs2AccuracyValue):accuracyBaseline(source,p);}
export function resetCoreAccuracy(source,p){p.cs2AccuracyValue=accuracyBaseline(source,p);p.cs2AccuracyPenalty=0;p.cs2RecoilIndex=0;}
export function advanceCoreAccuracy(source,p,dt,now,interval,grounded=true){
 const time=clamp(Number(dt)||0,0,.25),target=accuracyBaseline(source,p),current=readCoreAccuracy(source,p),recovery=accuracyRecoverySeconds(source,p,grounded);
 // Becoming less accurate clamps immediately. Becoming more accurate (e.g.
 // crouching or scoping) recovers from the previous total, not an instant base
 // substitution plus a separately decaying excess penalty.
 p.cs2AccuracyValue=target>=current?target:target+(current-target)*Math.exp(-Math.LN10*time/recovery);
 p.cs2AccuracyPenalty=Math.max(0,p.cs2AccuracyValue-target);
 if(now-(p.lastShot??-100)>interval*1.1){p.cs2RecoilIndex=Math.max(0,(p.cs2RecoilIndex||0)*Math.exp(-2*Math.LN10*time));if(p.cs2RecoilIndex<.1)p.cs2RecoilIndex=0;}
 return recovery;
}
export function addFireAccuracy(source,p){p.cs2AccuracyValue=clamp(readCoreAccuracy(source,p)+cs2Coefficient(source,'m_flInaccuracyFire',cs2WeaponMode(p)),0,1);p.cs2AccuracyPenalty=Math.max(0,p.cs2AccuracyValue-accuracyBaseline(source,p));p.cs2RecoilIndex=(p.cs2RecoilIndex||0)+1;}
