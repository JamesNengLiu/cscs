import test from 'node:test';
import assert from 'node:assert/strict';
import {grenadeViewAction,grenadeClipVariant,grenadeViewTransition} from '../public/cs2-grenade-presentation.js';

test('grenade input strength selects the existing authored hold and throw clips',()=>{
 for(const [mode,hold,fire]of [['overhand','hold','fire'],['medium','holdMid','fire'],['underhand','holdLow','fireUnderhand']]){
  assert.equal(grenadeViewAction('pin',mode),'pin');assert.equal(grenadeViewAction('hold',mode),hold);assert.equal(grenadeViewAction('throw',mode),fire);
 }
 for(const suffix of ['hegrenade','flashbang','smoke']){
  const actions={hold:`viewmodel.grenade.throwcharge_high_${suffix}`,fire:`viewmodel.grenade.throw_overhand_${suffix}`};
  assert.equal(grenadeClipVariant('holdLow',actions),`viewmodel.grenade.throwcharge_low_${suffix}`);
  assert.equal(grenadeClipVariant('holdMid',actions),`viewmodel.grenade.throwcharge_mid_${suffix}`);
  assert.equal(grenadeClipVariant('fireUnderhand',actions),`viewmodel.grenade.throw_underhand_${suffix}`);
 }
 assert.equal(grenadeClipVariant('holdMid'),null);
 assert.equal(grenadeClipVariant('fireUnderhand',{fire:'viewmodel.rifle.fire_ak47'}),null);
 assert.equal(grenadeClipVariant('holdLow',{hold:'viewmodel.pistol.hold_pistol'}),null);
});
test('mode changes update holds without restarting the pin or replaying a committed throw',()=>{
 const pin={grenadePhase:'pin',grenadeMode:'overhand',grenadeAnimationToken:'1:1'},low={...pin,grenadeMode:'underhand'};
 assert.equal(grenadeViewTransition(low,pin),null);
 assert.equal(grenadeViewTransition({...low,grenadeAnimationToken:'1:2'},pin),'pin');
 assert.equal(grenadeViewTransition({...low,grenadePhase:'hold'},pin),'holdLow');
 assert.equal(grenadeViewTransition({grenadePhase:'hold',grenadeMode:'medium'},{grenadePhase:'hold',grenadeMode:'overhand'}),'holdMid');
 assert.equal(grenadeViewTransition({grenadePhase:'throw',grenadeMode:'underhand'},{grenadePhase:'hold',grenadeMode:'underhand'}),'fireUnderhand');
 assert.equal(grenadeViewTransition({grenadePhase:'throw',grenadeMode:'underhand'},{grenadePhase:'throw',grenadeMode:'overhand'}),null);
});
test('same-weapon cancellation exits looping poses and permits committed throws to finish',()=>{
 for(const phase of ['pin','hold'])assert.equal(grenadeViewTransition({grenadePhase:''},{grenadePhase:phase}),'idle');
 assert.equal(grenadeViewTransition({grenadePhase:''},{grenadePhase:'throw'}),null);
 assert.equal(grenadeViewTransition({grenadePhase:''},{grenadePhase:''}),null);
});
