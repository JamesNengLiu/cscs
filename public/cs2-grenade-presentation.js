// Animation selection only; this module does not change the player camera,
// projectile authority or the shared 1.0 weapon presentation.
export function grenadeViewAction(phase,mode='overhand'){
 if(phase==='pin')return 'pin';
 if(phase==='hold')return mode==='underhand'?'holdLow':mode==='medium'?'holdMid':'hold';
 if(phase==='throw')return mode==='underhand'?'fireUnderhand':'fire';
 return 'idle';
}
export function grenadeClipVariant(action,actions={}){
 if((action==='holdLow'||action==='holdMid')&&actions.hold?.includes('throwcharge_high_'))return actions.hold.replace('throwcharge_high_',action==='holdLow'?'throwcharge_low_':'throwcharge_mid_');
 if(action==='fireUnderhand'&&actions.fire?.includes('throw_overhand_'))return actions.fire.replace('throw_overhand_','throw_underhand_');
 return null;
}
export function grenadeViewTransition(current,previous){
 const phase=current.grenadePhase||'',old=previous.grenadePhase||'';
 if(phase&&phase!==old)return grenadeViewAction(phase,current.grenadeMode);
 if(phase==='pin'&&current.grenadeAnimationToken!==undefined&&current.grenadeAnimationToken!==previous.grenadeAnimationToken)return 'pin';
 if(phase==='hold'&&current.grenadeMode!==previous.grenadeMode)return grenadeViewAction(phase,current.grenadeMode);
 // Cancelled holds must not leave a looping pin/hold pose on the same weapon.
 // A committed throw is allowed to finish its original animation.
 if(!phase&&(old==='pin'||old==='hold'))return 'idle';
 return null;
}
