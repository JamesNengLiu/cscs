// Persistence is opt-in: the mixer itself never accesses browser storage.
export const AUDIO_SETTINGS_KEY='lan-strike.audio.v1';
export const DEFAULT_AUDIO_SETTINGS=Object.freeze({master:.28,effects:1,voice:1,spatialMode:'hrtf',enabled:true});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
export function normalizeAudioSettings(value={},base=DEFAULT_AUDIO_SETTINGS){
  value=object(value);base={...DEFAULT_AUDIO_SETTINGS,...object(base)};
  const result={...DEFAULT_AUDIO_SETTINGS};
  for(const key of ['master','effects','voice']){
    const fallback=Number.isFinite(base[key])?base[key]:DEFAULT_AUDIO_SETTINGS[key];
    result[key]=Math.max(0,Math.min(1,Number.isFinite(value[key])?value[key]:fallback));
  }
  result.spatialMode=['hrtf','equalpower'].includes(value.spatialMode)?value.spatialMode:
    ['hrtf','equalpower'].includes(base.spatialMode)?base.spatialMode:'hrtf';
  result.enabled=typeof value.enabled==='boolean'?value.enabled:typeof base.enabled==='boolean'?base.enabled:true;
  return result;
}
function defaultStorage(){try{return globalThis.localStorage;}catch{return null;}}
export function loadAudioSettings(storage=defaultStorage()){
  try{return normalizeAudioSettings(JSON.parse(storage?.getItem(AUDIO_SETTINGS_KEY)||'null'));}
  catch{return {...DEFAULT_AUDIO_SETTINGS};}
}
// Return false on disabled/quota/security storage; never block gameplay.
export function saveAudioSettings(settings,storage=defaultStorage()){
  try{if(!storage?.setItem)return false;storage.setItem(AUDIO_SETTINGS_KEY,JSON.stringify(normalizeAudioSettings(settings)));return true;}
  catch{return false;}
}
