import test from 'node:test';
import assert from 'node:assert/strict';
import {AUDIO_SETTINGS_KEY,DEFAULT_AUDIO_SETTINGS,normalizeAudioSettings,loadAudioSettings,saveAudioSettings} from '../public/audio-settings.js';

test('headphones default to HRTF; partial settings preserve base without accepting coercions',()=>{
  assert.equal(DEFAULT_AUDIO_SETTINGS.spatialMode,'hrtf');
  assert.deepEqual(normalizeAudioSettings(),DEFAULT_AUDIO_SETTINGS);
  const base={master:.6,effects:.2,voice:.5,enabled:false,spatialMode:'equalpower'};
  assert.deepEqual(normalizeAudioSettings({master:2,effects:-1,voice:NaN,enabled:'yes',spatialMode:'stereo'},base),
    {...base,master:1,effects:0});
  for(const value of [null,[],3,'bad'])assert.deepEqual(normalizeAudioSettings(value),DEFAULT_AUDIO_SETTINGS);
  assert.equal(normalizeAudioSettings({master:Infinity,voice:'1'}).master,.28);
});

test('settings round trip only the supported keys and safely handle unavailable storage',()=>{
  const entries=new Map(),storage={getItem:k=>entries.get(k),setItem:(k,v)=>entries.set(k,v)};
  const value={master:.5,effects:.7,voice:.3,enabled:true,spatialMode:'equalpower'};
  assert.equal(saveAudioSettings({...value,secret:'not stored'},storage),true);
  assert.deepEqual(loadAudioSettings(storage),value);
  assert.equal(JSON.parse(entries.get(AUDIO_SETTINGS_KEY)).secret,undefined);
  entries.set(AUDIO_SETTINGS_KEY,'{corrupt');assert.deepEqual(loadAudioSettings(storage),DEFAULT_AUDIO_SETTINGS);
  entries.set(AUDIO_SETTINGS_KEY,'null');assert.deepEqual(loadAudioSettings(storage),DEFAULT_AUDIO_SETTINGS);
  entries.set(AUDIO_SETTINGS_KEY,'{"master":-5,"spatialMode":"evil"}');
  assert.deepEqual(loadAudioSettings(storage),{...DEFAULT_AUDIO_SETTINGS,master:0});
  const blocked={getItem(){throw Error('denied');},setItem(){throw Error('quota');}};
  assert.deepEqual(loadAudioSettings(blocked),DEFAULT_AUDIO_SETTINGS);
  assert.equal(saveAudioSettings(value,blocked),false);assert.equal(saveAudioSettings(value,null),false);
});
