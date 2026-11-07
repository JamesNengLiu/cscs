// Transitional rig adapter. The existing canonical rig and historical pose
// evaluator are reused without tying collision to cosmetic player selection.
import * as canonical from './hitboxes.mjs';
export const HIT_REACTION=canonical.HIT_REACTION;
export function createHitboxRuntime(adapter=null){
 const runtime=adapter||canonical;
 for(const key of ['rayPlayer','hitboxAnimation','hitboxDiagnostics'])if(typeof runtime[key]!=='function')throw Error('Incomplete experimental hitbox adapter');
 return{rayPlayer:runtime.rayPlayer,hitboxAnimation:runtime.hitboxAnimation,hitboxDiagnostics:runtime.hitboxDiagnostics,HIT_REACTION:runtime.HIT_REACTION||HIT_REACTION,...(typeof runtime.advanceAnimation==='function'?{advanceAnimation:runtime.advanceAnimation.bind(runtime)}:{})};
}
