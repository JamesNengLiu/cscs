import {SHOT_SOUNDS} from './sound-catalog.js';
// Reviewed community client a238ef131803ed7592c4ba701499027c862889ee,
// cl_dll/events/event_*.cpp + include/events.h. Not a claim of retail binary identity.
const VARIANTS=Object.freeze({
  ak47:['weapons/ak47-1.wav','weapons/ak47-2.wav'],m249:['weapons/m249-1.wav','weapons/m249-2.wav'],
  galil:['weapons/galil-1.wav','weapons/galil-2.wav'],famas:['weapons/famas-1.wav','weapons/famas-2.wav'],
  sg552:['weapons/sg552-1.wav','weapons/sg552-2.wav'],tmp:['weapons/tmp-1.wav','weapons/tmp-2.wav'],
  mp5navy:['weapons/mp5-1.wav','weapons/mp5-2.wav'],deagle:['weapons/deagle-1.wav','weapons/deagle-2.wav'],
});
const index=(random,n)=>{const value=random();return Number.isFinite(value)?Math.min(n-1,Math.max(0,Math.floor(value*n))):0;};
export function gunAudioProfile(event,random=Math.random){
  if(!event||!Object.hasOwn(SHOT_SOUNDS,event.weapon))return null;
  let list=VARIANTS[event.weapon]||[SHOT_SOUNDS[event.weapon]];
  if(event.weapon==='m4a1')list=event.silenced?['weapons/m4a1-1.wav']:['weapons/m4a1_unsil-1.wav','weapons/m4a1_unsil-2.wav'];
  else if(event.weapon==='usp')list=event.silenced?['weapons/usp1.wav','weapons/usp2.wav']:['weapons/usp_unsil-1.wav'];
  else if(event.weapon==='glock18')list=[event.burstMode?'weapons/glock18-1.wav':'weapons/glock18-2.wav'];
  return {name:list[index(random,list.length)],volume:1,attenuation:.8,pitch:Number.isInteger(event.soundPitch)&&event.soundPitch>=94&&event.soundPitch<=109?event.soundPitch:94+index(random,16)};
}
