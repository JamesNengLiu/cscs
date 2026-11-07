import test from 'node:test';import assert from 'node:assert/strict';
import {isFreshNativeViewShot as shot} from '../public/cs2-native-viewmodel.js';
const now=100,previous={weapon:'awp',weaponShotToken:'old'},state={weapon:'awp',weaponShotToken:'new',weaponShotAt:99.99};
test('native firing presentation requires a fresh shot on the same deployed weapon',()=>{assert.equal(shot(state,previous,now,99),true);for(const p of [{},{weapon:'knife',weaponShotToken:'old'},{weapon:'awp',weaponShotToken:'new'}])assert.equal(shot(state,p,now,99),false);});
test('base tokens and stale/pre-deploy/future confirmations cannot fire a viewmodel on equip',()=>{for(const at of [-100,98,100.01,NaN,Infinity])assert.equal(shot({...state,weaponShotAt:at},previous,now,99),false);assert.equal(shot({...state,weaponShotAt:99.9},previous,now,99.95),false);assert.equal(shot({...state,weaponSwitchPredicted:true},previous,now,99),false);assert.equal(shot({...state,weaponShotToken:null},previous,now,99),false);});
