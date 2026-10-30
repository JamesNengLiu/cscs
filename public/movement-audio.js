// PM_UpdateStepSound/PM_Jump/PM_CheckFalling reference: ReGameDLL_CS
// 4a50c42e85fd3778c2b7d24731c7d30c83bbab01, regamedll/pm_shared/pm_shared.cpp.
// Separate presentation state is advanced ONLY on newly simulated commands, never replay.
export function createMovementSoundState(){return {remaining:0,left:false,wadeSkip:0};}
const STEP_PREFIX={concrete:'step',metal:'metal',dirt:'dirt',vent:'duct',grate:'grate',tile:'tile',slosh:'slosh',wade:'wade',ladder:'ladder',snow:'snow'};
const rand=(random,n)=>Math.min(n-1,Math.max(0,Math.floor(random()*n)));
function step(tracker,material,volume,random){
  if(!Object.hasOwn(STEP_PREFIX,material))material='concrete';
  tracker.left=!tracker.left;
  let variant=(tracker.left?2:1)+rand(random,2)*2;
  if(material==='tile'&&rand(random,5)===0)variant=5;
  if(material==='wade'){
    const skip=tracker.wadeSkip;tracker.wadeSkip=(skip+1)%4;if(skip===0)return null;
    variant=(tracker.left?3:1)+rand(random,2);
  }
  return {material,variant,volume,sound:`player/pl_${STEP_PREFIX[material]}${variant}.wav`};
}
export function movementSoundStep(tracker,{before,after,input={},dt=1/60,surface={material:'concrete'},random=Math.random}){
  if(!tracker||!before||!after||!Number.isFinite(dt)||dt<0||dt>.1)return [];
  tracker.remaining=Math.max(0,tracker.remaining-dt);
  const events=[],emit=(kind,material,volume)=>{const s=step(tracker,material,volume,random);if(s)events.push({type:kind,...s,from:{x:after.x,y:after.y,z:after.z}});};
  const material=surface.material||'concrete',speed=Math.hypot(after.vx||0,after.vy||0,after.vz||0)*40;
  const jumping=before.grounded&&!after.grounded&&(after.vy||0)>0&&input.jump;
  const fall=(after.landedSpeed||0)*40;
  if(fall>=250){
    let volume=after.waterLevel>0?.5:fall>580?1:fall>290?.85:fall<350?0:.5;
    if(volume>0){emit('landing',material,volume);tracker.remaining=.3;}
  }else if(jumping){
    if(Math.hypot(before.vx||0,before.vz||0,before.vy||0)*40>=150){emit('jump',material,1);tracker.remaining=Math.max(tracker.remaining,.3);}
  }else if(tracker.remaining<=1e-9){
    if(speed<=150){tracker.remaining=.4;return events;}
    if(!after.grounded&&!after.onLadder)return events;
    const selected=after.onLadder?'ladder':after.waterLevel>=2?'wade':after.waterLevel===1?'slosh':material;
    let volume=selected==='ladder'?.35:selected==='wade'?.65:selected==='dirt'?.55:selected==='vent'?.7:.5;
    tracker.remaining=selected==='ladder'?.35:selected==='wade'?.6:.3;
    if(after.crouch||after.onLadder){tracker.remaining+=.1;if(after.crouch&&(after.duckElapsed||0)>.05)volume*=.35;}
    emit('footstep',selected,volume);
  }
  return events;
}
// Radio menus use fixed slots; the server validates slots/team/cooldown rather than trusting a WAV path.
export const RADIO_MENUS=Object.freeze([
  Object.freeze(['radio/ct_coverme.wav','radio/takepoint.wav','radio/position.wav','radio/regroup.wav','radio/followme.wav','radio/fireassis.wav']),
  Object.freeze(['radio/com_go.wav','radio/fallback.wav','radio/sticktog.wav','radio/com_getinpos.wav','radio/stormfront.wav','radio/com_reportin.wav']),
  Object.freeze(['radio/roger.wav','radio/ct_enemys.wav','radio/ct_backup.wav','radio/clear.wav','radio/ct_inpos.wav','radio/ct_reportingin.wav','radio/blow.wav','radio/negative.wav','radio/enemydown.wav']),
]);
export const RADIO_LABELS=Object.freeze([
  Object.freeze(['掩护我','你带头','守住这里','重新集结','跟我来','需要火力支援']),
  Object.freeze(['出发','后撤','保持队形','就位待命','进攻','报告情况']),
  Object.freeze(['收到','发现敌人','需要支援','区域安全','已就位','报告位置','炸弹即将爆炸','否定','敌人已被消灭']),
]);
