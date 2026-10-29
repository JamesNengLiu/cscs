export const crouchPressed=keys=>['KeyC','ControlLeft','ControlRight'].some(key=>keys.has(key));
// Each wheel detent is a real press/release pair sampled on consecutive simulation ticks.
// Admit both edges together; a full queue must never leave a held jump behind.
export function queueJumpPulse(queue,input,limit=8){
  if(input.jump||queue.length>limit-2)return false;
  queue.push({...input,jump:true},{...input,jump:false});return true;
}
