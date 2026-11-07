// CS2-only cosmetic landing roll. Keep the shared trigger/replay guard without
// changing movement, recoil, aiming, or the shared v1.0 presentation module.
import {createViewFeedback as createSharedViewFeedback,LANDING_FEEDBACK} from './view-feedback.js';
export {viewmodelMotion} from './view-feedback.js';

export const CS2_LANDING_FEEDBACK=Object.freeze({
  thresholdSource:LANDING_FEEDBACK.thresholdSource,
  legacyFeedbackSpeedScale:40,
  maxRollDegrees:.6,
  rollDegreesPerSourceSpeed:.0026,
  defaultStrength:.25,
  peakMs:45,
  durationMs:160,
  dedupeDurationMs:LANDING_FEEDBACK.durationMs,
});
const clamp01=value=>Math.max(0,Math.min(1,value));
const smooth=value=>{const x=clamp01(value);return x*x*x*(x*(x*6-15)+10);};
const zero=Object.freeze({roll:0});

export function createCS2ViewFeedback({legacy=false}={}){
  if(legacy)return createSharedViewFeedback();
  const gate=createSharedViewFeedback();
  let pulse=null;
  return {
    observe(before,after,{seq,round,now,enabled=true,strength=CS2_LANDING_FEEDBACK.defaultStrength}={}){
      // Runtime commands always carry these IDs. Reject missing IDs rather
      // than deduplicating every future landing as "undefined:undefined".
      if(!Number.isSafeInteger(seq)||seq<1||!Number.isSafeInteger(round)||round<0)return false;
      // The shared 350/40 = 8.75m/s calibration and its replay/cooldown policy
      // are intentional here; this visual change does not retune CS2 physics.
      if(!gate.observe(before,after,{seq,round,now,enabled,strength:0}))return false;
      const amount=clamp01(Number.isFinite(strength)?strength:CS2_LANDING_FEEDBACK.defaultStrength);
      const fall=after.landedSpeed*CS2_LANDING_FEEDBACK.legacyFeedbackSpeedScale;
      const degrees=Math.min(CS2_LANDING_FEEDBACK.maxRollDegrees,fall*CS2_LANDING_FEEDBACK.rollDegreesPerSourceSpeed*amount);
      pulse=degrees>0?{at:now,roll:degrees*Math.PI/180}:null;
      return true;
    },
    sample(now,enabled=true){
      // Sample the zero-amplitude shared gate only to preserve its disable and
      // expiry semantics. Its 220ms replay guard outlives the shorter visual.
      gate.sample(now,enabled);
      if(!enabled){pulse=null;return zero;}
      if(!pulse||!Number.isFinite(now))return zero;
      const age=now-pulse.at;
      if(age<0)return zero;
      if(age>=CS2_LANDING_FEEDBACK.durationMs){pulse=null;return zero;}
      const envelope=age<=CS2_LANDING_FEEDBACK.peakMs
        ?smooth(age/CS2_LANDING_FEEDBACK.peakMs)
        :1-smooth((age-CS2_LANDING_FEEDBACK.peakMs)/(CS2_LANDING_FEEDBACK.durationMs-CS2_LANDING_FEEDBACK.peakMs));
      return {roll:pulse.roll*clamp01(envelope)};
    },
    reset(){pulse=null;gate.reset();},
    diagnostics(){return {active:!!pulse,lastKey:gate.diagnostics().lastKey,policy:'cs2-landing-roll-v1',maxRollDegrees:CS2_LANDING_FEEDBACK.maxRollDegrees,peakMs:CS2_LANDING_FEEDBACK.peakMs,durationMs:CS2_LANDING_FEEDBACK.durationMs,dedupeDurationMs:CS2_LANDING_FEEDBACK.dedupeDurationMs};},
  };
}

// Drop-in names keep the CS2 client import small; shared bob is re-exported
// unchanged, including its separately controlled classic-mode camera roll.
export {createCS2ViewFeedback as createViewFeedback};
