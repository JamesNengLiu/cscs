import test from 'node:test';
import assert from 'node:assert/strict';
import {MOUSE_SENSITIVITY,normalizeSensitivity,createMouseSettings} from '../public/mouse-settings.js';
const storage=initial=>{const values=new Map(initial==null?[]:[[MOUSE_SENSITIVITY.storageKey,initial]]);return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};};
test('sensitivity defaults preserve the previous radians-per-pixel and both axes share a multiplier',()=>{
  const settings=createMouseSettings(storage());assert.equal(settings.value,1);assert.equal(settings.radiansPerPixel,.002);
  settings.set(.5);assert.equal(settings.radiansPerPixel,.001);settings.set(2);assert.equal(settings.radiansPerPixel,.004);
});
test('sensitivity clamps finite bounds, quantizes steps, and rejects malformed/nonfinite values',()=>{
  assert.equal(normalizeSensitivity(-10),.1);assert.equal(normalizeSensitivity(999),5);assert.equal(normalizeSensitivity(1.234),1.25);
  for(const input of ['',null,undefined,{},NaN,Infinity,'Infinity','broken'])assert.equal(normalizeSensitivity(input),1);
  assert.equal(normalizeSensitivity('',.75),.75);assert.equal(normalizeSensitivity(' 0.35 '),.35);
});
test('sensitivity saves and loads, reset persists and does not touch the quality key',()=>{
  const s=storage('1.5');s.setItem('lan-strike-quality','sharp');const a=createMouseSettings(s);assert.equal(a.value,1.5);a.set(2.5);
  const b=createMouseSettings(s);assert.equal(b.value,2.5);b.reset();assert.equal(createMouseSettings(s).value,1);assert.equal(s.getItem('lan-strike-quality'),'sharp');
});
test('corrupt saved values recover to defaults; finite legacy values stay bounded',()=>{
  for(const value of ['','NaN','undefined','{}'])assert.equal(createMouseSettings(storage(value)).value,1);
  assert.equal(createMouseSettings(storage('999')).value,5);assert.equal(createMouseSettings(storage('-1')).value,.1);
});
test('unavailable or quota-limited storage never prevents in-session settings from working',()=>{
  for(const s of [undefined,{getItem(){throw Error('denied');},setItem(){throw Error('denied');}},{getItem:()=>null,setItem(){throw Error('quota');}}]){
    const a=createMouseSettings(s);a.set(.65);assert.equal(a.value,.65);assert.equal(a.saved,false);a.reset();assert.equal(a.value,1);
  }
});
