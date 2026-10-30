export const crouchPressed=keys=>['KeyC','ControlLeft','ControlRight'].some(key=>keys.has(key));
// Continuous axes always use the latest sample. Each button retains at most one
// unconsumed press, rather than queuing old aim/movement behind wheel detents.
export function createInputSampler(){
  const names=['fire','jump','crouch','walk','use'];
  let buttons,lastAxes,wheelPending=false;
  function reset(){buttons=Object.fromEntries(names.map(n=>[n,{physical:false,press:false,sampled:false}]));lastAxes={f:0,s:0};wheelPending=false;}
  function observe(input){for(const name of names){const b=buttons[name],down=Boolean(input[name]);if(down&&!b.physical)b.press=true;b.physical=down;}}
  reset();
  return {
    reset,observe,
    wheel(input){observe(input);if(input.jump)return false;wheelPending=true;return true;},
    sample(input){
      observe(input);if(wheelPending&&!buttons.jump.physical)buttons.jump.press=true;wheelPending=false;
      const result={...input};let critical=input.f!==lastAxes.f||input.s!==lastAxes.s;
      for(const name of names){const b=buttons[name],before=b.sampled;
        if(b.sampled&&(!b.physical||b.press))b.sampled=false;
        else if(b.press){b.sampled=true;b.press=false;}
        else b.sampled=b.physical;
        result[name]=b.sampled;critical||=before!==b.sampled;
      }
      lastAxes={f:input.f,s:input.s};return {input:result,critical};
    },
    diagnostics:()=>({pendingPresses:names.filter(n=>buttons[n].press),wheelPending}),
  };
}
// Each wheel detent is a real press/release pair sampled on consecutive simulation ticks.
// Admit both edges together; a full queue must never leave a held jump behind.
// Low-level compatibility helper for explicit simulation fixtures, not live input.
export function queueJumpPulse(queue,input,limit=8){
  if(input.jump||queue.length>limit-2)return false;
  queue.push({...input,jump:true},{...input,jump:false});return true;
}
