// Keep the time of the scene actually submitted, rather than a playback cursor
// which a newly arrived snapshot may already have advanced before the next draw.
export function createRenderedInputView(){
 let round=null,viewTime=null,interpDelayMs=null,submittedAt=0;
 return {
  present(nextRound,view,nowMs=performance.now()){if(!Number.isSafeInteger(nextRound)||!Number.isFinite(view?.playbackTimeMs)||!Number.isFinite(view?.delayMs)||!Number.isFinite(nowMs))return;round=nextRound;viewTime=view.playbackTimeMs/1000;interpDelayMs=view.delayMs;submittedAt=nowMs;},
  command(currentRound,nowMs=performance.now()){return round===currentRound&&viewTime!==null?{viewTime,interpDelayMs,viewAgeMs:Math.round(Math.max(0,Math.min(200,nowMs-submittedAt))*1000)/1000}:{};},
  reset(){round=viewTime=interpDelayMs=null;},
  diagnostics:()=>({round,viewTime,interpDelayMs})
 };
}
