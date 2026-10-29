import test from 'node:test';
import assert from 'node:assert/strict';
import {MOUSE_SENSITIVITY,SCOPED_SENSITIVITY,normalizeSensitivity,createMouseSettings,mouseTurnFactor} from '../public/mouse-settings.js';
import {GUNS} from '../public/arsenal.js';
const storage=initial=>{const values=new Map(initial==null?[]:[[MOUSE_SENSITIVITY.storageKey,initial]]);return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};};
test('sensitivity 1 halves the previous base turn rate and both axes share a multiplier',()=>{
  const settings=createMouseSettings(storage());assert.equal(settings.value,1);assert.equal(settings.radiansPerPixel,.001);
  settings.set(.5);assert.equal(settings.radiansPerPixel,.0005);settings.set(2);assert.equal(settings.radiansPerPixel,.002);
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
test('scoped sensitivity has its own saved value and defaults without changing the existing preference',()=>{
  const s=storage('1.5'),normal=createMouseSettings(s),scoped=createMouseSettings(s,SCOPED_SENSITIVITY);
  assert.equal(normal.value,1.5);assert.equal(scoped.value,1);scoped.set(.35);
  assert.equal(normal.value,1.5);assert.equal(createMouseSettings(s,SCOPED_SENSITIVITY).value,.35);
  normal.set(2);assert.equal(scoped.value,.35);scoped.reset();assert.equal(normal.value,2);
  assert.equal(createMouseSettings(s,SCOPED_SENSITIVITY).value,1);
});
test('scoped sensitivity includes FOV scaling for both sniper and rifle zoom levels',()=>{
  const s=storage(),normal=createMouseSettings(s),scoped=createMouseSettings(s,SCOPED_SENSITIVITY);
  normal.set(1.5);scoped.set(.4);const base=normal.radiansPerPixel;
  for(const w of Object.values(GUNS)){
    assert.equal(mouseTurnFactor(normal,scoped,{alive:true,weapon:w.id,zoom:90}),base,w.id);
    for(const zoom of w.zoom||[])assert.equal(mouseTurnFactor(normal,scoped,{alive:true,weapon:w.id,zoom}),base*(.4*zoom/90),`${w.id} ${zoom}`);
  }
  assert.equal(mouseTurnFactor(normal,scoped,null),base);
  for(const zoom of [undefined,0,NaN])assert.equal(mouseTurnFactor(normal,scoped,{alive:true,weapon:'awp',zoom}),base);
  assert.equal(mouseTurnFactor(normal,scoped,{alive:false,weapon:'awp',zoom:40}),base);
  scoped.reset();assert.equal(mouseTurnFactor(normal,scoped,{alive:true,weapon:'awp',zoom:10}),base*(10/90));
});
test('scoped sensitivity recovers corrupt values and still works when browser storage is unavailable',()=>{
  const s=storage('2');s.setItem(SCOPED_SENSITIVITY.storageKey,'broken');
  assert.equal(createMouseSettings(s,SCOPED_SENSITIVITY).value,1);assert.equal(createMouseSettings(s).value,2);
  const scoped=createMouseSettings(undefined,SCOPED_SENSITIVITY);scoped.set(.5);assert.equal(scoped.value,.5);assert.equal(scoped.saved,false);
  scoped.set(999);assert.equal(scoped.value,5);scoped.set('');assert.equal(scoped.value,5);scoped.reset();assert.equal(scoped.value,1);
});
