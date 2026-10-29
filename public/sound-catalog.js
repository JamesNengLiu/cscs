export const SHOT_SOUNDS=Object.freeze({
  glock18:'weapons/glock18-2.wav',usp:'weapons/usp_unsil-1.wav',p228:'weapons/p228-1.wav',deagle:'weapons/deagle-1.wav',elite:'weapons/elite_fire.wav',fiveseven:'weapons/fiveseven-1.wav',
  m3:'weapons/m3-1.wav',xm1014:'weapons/xm1014-1.wav',mac10:'weapons/mac10-1.wav',tmp:'weapons/tmp-1.wav',mp5navy:'weapons/mp5-1.wav',ump45:'weapons/ump45-1.wav',p90:'weapons/p90-1.wav',
  galil:'weapons/galil-1.wav',famas:'weapons/famas-1.wav',ak47:'weapons/ak47-1.wav',m4a1:'weapons/m4a1_unsil-1.wav',aug:'weapons/aug-1.wav',sg552:'weapons/sg552-1.wav',
  scout:'weapons/scout_fire-1.wav',awp:'weapons/awp1.wav',g3sg1:'weapons/g3sg1-1.wav',sg550:'weapons/sg550-1.wav',m249:'weapons/m249-1.wav',
});
export const ACTION_SOUNDS=Object.freeze(['weapons/m4a1-1.wav','weapons/usp1.wav','weapons/zoom.wav','weapons/dryfire_pistol.wav','weapons/dryfire_rifle.wav',
  'weapons/knife_slash1.wav','weapons/knife_slash2.wav','weapons/knife_hit1.wav','weapons/knife_stab.wav','weapons/knife_hitwall1.wav','weapons/he_bounce-1.wav',
  'weapons/hegrenade-1.wav','weapons/flashbang-1.wav','weapons/sg_explode.wav','player/pl_step1.wav','player/pl_step2.wav','player/pl_step3.wav','player/pl_step4.wav',
  'player/pl_jump1.wav','player/pl_fallpain1.wav','player/pl_pain2.wav','player/bhit_helmet-1.wav','player/bhit_kevlar-1.wav','player/bhit_flesh-1.wav']);
export const safeSound=name=>typeof name==='string'&&/^(weapons|player|items)\/[a-zA-Z0-9_-]+\.wav$/.test(name);
export function gunSound(weapon,silenced=false){return weapon==='m4a1'&&silenced?'weapons/m4a1-1.wav':weapon==='usp'&&silenced?'weapons/usp1.wav':SHOT_SOUNDS[weapon];}
