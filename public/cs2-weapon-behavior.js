import {CS2_WEAPON_PROFILE,CS2_WEAPON_PROFILE_V1} from './cs2-weapon-profile.js';
import {createCS2WeaponBehaviorV1} from './cs2-weapon-behavior-v1.js';
import {createCS2WeaponBehaviorV2} from './cs2-weapon-behavior-v2.js';
export function createCS2WeaponBehavior(profile=CS2_WEAPON_PROFILE){
 if(profile?.id===CS2_WEAPON_PROFILE_V1.id)return createCS2WeaponBehaviorV1(profile);
 if(profile?.id!==CS2_WEAPON_PROFILE.id)throw Error('Unsupported CS2 weapon behavior profile');
 const previous=createCS2WeaponBehaviorV1({...profile,id:CS2_WEAPON_PROFILE_V1.id});
 return createCS2WeaponBehaviorV2(profile,previous);
}
