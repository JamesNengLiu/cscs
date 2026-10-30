// Original relative names, not a claim of retail hashes or redistribution rights.
// Evidence, optional family semantics and local preparation: docs/cs16-audio-sources-2026-10-30.md.
export const SOUND_BUDGET = 512;
export const SHOT_SOUNDS = Object.freeze({
  glock18:'weapons/glock18-2.wav', usp:'weapons/usp_unsil-1.wav', p228:'weapons/p228-1.wav', deagle:'weapons/deagle-1.wav', elite:'weapons/elite_fire.wav', fiveseven:'weapons/fiveseven-1.wav',
  m3:'weapons/m3-1.wav', xm1014:'weapons/xm1014-1.wav', mac10:'weapons/mac10-1.wav', tmp:'weapons/tmp-1.wav', mp5navy:'weapons/mp5-1.wav', ump45:'weapons/ump45-1.wav', p90:'weapons/p90-1.wav',
  galil:'weapons/galil-1.wav', famas:'weapons/famas-1.wav', ak47:'weapons/ak47-1.wav', m4a1:'weapons/m4a1_unsil-1.wav', aug:'weapons/aug-1.wav', sg552:'weapons/sg552-1.wav',
  scout:'weapons/scout_fire-1.wav', awp:'weapons/awp1.wav', g3sg1:'weapons/g3sg1-1.wav', sg550:'weapons/sg550-1.wav', m249:'weapons/m249-1.wav',
});

// Keep paths literal: the offline preparer extracts these without evaluating JS.
export const ALL_SOUNDS = Object.freeze([
  // All 24 guns: server precache variants (not necessarily randomly selected by the retail client).
  'weapons/glock18-1.wav', 'weapons/glock18-2.wav', 'weapons/usp1.wav', 'weapons/usp2.wav', 'weapons/usp_unsil-1.wav',
  'weapons/p228-1.wav', 'weapons/deagle-1.wav', 'weapons/deagle-2.wav', 'weapons/elite_fire.wav', 'weapons/fiveseven-1.wav',
  'weapons/m3-1.wav', 'weapons/xm1014-1.wav', 'weapons/mac10-1.wav', 'weapons/tmp-1.wav', 'weapons/tmp-2.wav',
  'weapons/mp5-1.wav', 'weapons/mp5-2.wav', 'weapons/ump45-1.wav', 'weapons/p90-1.wav',
  'weapons/galil-1.wav', 'weapons/galil-2.wav', 'weapons/famas-1.wav', 'weapons/famas-2.wav', 'weapons/famas-burst.wav',
  'weapons/ak47-1.wav', 'weapons/ak47-2.wav', 'weapons/m4a1-1.wav', 'weapons/m4a1_unsil-1.wav', 'weapons/m4a1_unsil-2.wav',
  'weapons/aug-1.wav', 'weapons/sg552-1.wav', 'weapons/sg552-2.wav', 'weapons/scout_fire-1.wav', 'weapons/awp1.wav',
  'weapons/g3sg1-1.wav', 'weapons/sg550-1.wav', 'weapons/m249-1.wav', 'weapons/m249-2.wav',
  // Original local MDL5004 options plus server precached action sounds.
  'weapons/ak47_boltpull.wav', 'weapons/ak47_clipin.wav', 'weapons/ak47_clipout.wav',
  'weapons/aug_boltpull.wav', 'weapons/aug_boltslap.wav', 'weapons/aug_clipin.wav', 'weapons/aug_clipout.wav', 'weapons/aug_forearm.wav',
  'weapons/awp_clipin.wav', 'weapons/awp_clipout.wav', 'weapons/awp_deploy.wav', 'weapons/boltdown.wav', 'weapons/boltpull1.wav', 'weapons/boltup.wav',
  'weapons/clipin1.wav', 'weapons/clipout1.wav', 'weapons/slideback1.wav', 'weapons/sliderelease1.wav', 'weapons/357_cock1.wav',
  'weapons/de_clipin.wav', 'weapons/de_clipout.wav', 'weapons/de_deploy.wav',
  'weapons/elite_clipout.wav', 'weapons/elite_deploy.wav', 'weapons/elite_leftclipin.wav', 'weapons/elite_reloadstart.wav', 'weapons/elite_rightclipin.wav', 'weapons/elite_sliderelease.wav',
  'weapons/famas_clipin.wav', 'weapons/famas_clipout.wav', 'weapons/famas_forearm.wav', 'weapons/famas_boltpull.wav', 'weapons/famas_boltslap.wav',
  'weapons/fiveseven_clipin.wav', 'weapons/fiveseven_clipout.wav', 'weapons/fiveseven_slidepull.wav', 'weapons/fiveseven_sliderelease.wav',
  'weapons/g3sg1_clipin.wav', 'weapons/g3sg1_clipout.wav', 'weapons/g3sg1_slide.wav',
  'weapons/galil_boltpull.wav', 'weapons/galil_clipin.wav', 'weapons/galil_clipout.wav',
  'weapons/m249_boxin.wav', 'weapons/m249_boxout.wav', 'weapons/m249_chain.wav', 'weapons/m249_coverdown.wav', 'weapons/m249_coverup.wav',
  'weapons/m3_insertshell.wav', 'weapons/m3_pump.wav', 'weapons/reload1.wav', 'weapons/reload3.wav', 'weapons/generic_reload.wav', 'weapons/generic_shot_reload.wav',
  'weapons/m4a1_boltpull.wav', 'weapons/m4a1_clipin.wav', 'weapons/m4a1_clipout.wav', 'weapons/m4a1_deploy.wav', 'weapons/m4a1_silencer_off.wav', 'weapons/m4a1_silencer_on.wav',
  'weapons/mac10_boltpull.wav', 'weapons/mac10_clipin.wav', 'weapons/mac10_clipout.wav',
  'weapons/mp5_clipin.wav', 'weapons/mp5_clipout.wav', 'weapons/mp5_slideback.wav',
  'weapons/p228_clipin.wav', 'weapons/p228_clipout.wav', 'weapons/p228_slidepull.wav', 'weapons/p228_sliderelease.wav',
  'weapons/p90_boltpull.wav', 'weapons/p90_clipin.wav', 'weapons/p90_clipout.wav', 'weapons/p90_cliprelease.wav',
  'weapons/scout_bolt.wav', 'weapons/scout_clipin.wav', 'weapons/scout_clipout.wav',
  'weapons/sg550_boltpull.wav', 'weapons/sg550_clipin.wav', 'weapons/sg550_clipout.wav',
  'weapons/sg552_boltpull.wav', 'weapons/sg552_clipin.wav', 'weapons/sg552_clipout.wav',
  'weapons/ump45_boltslap.wav', 'weapons/ump45_clipin.wav', 'weapons/ump45_clipout.wav',
  'weapons/usp_clipin.wav', 'weapons/usp_clipout.wav', 'weapons/usp_silencer_off.wav', 'weapons/usp_silencer_on.wav', 'weapons/usp_slideback.wav', 'weapons/usp_sliderelease.wav',
  'items/cliprelease1.wav', 'weapons/zoom.wav', 'weapons/dryfire_pistol.wav', 'weapons/dryfire_rifle.wav',
  // Knife deploy / swing / body / wall are different events.
  'weapons/knife_deploy1.wav', 'weapons/knife_slash1.wav', 'weapons/knife_slash2.wav',
  'weapons/knife_hit1.wav', 'weapons/knife_hit2.wav', 'weapons/knife_hit3.wav', 'weapons/knife_hit4.wav', 'weapons/knife_stab.wav', 'weapons/knife_hitwall1.wav',
  // PM_PlayStepSound materials. Snow 5/6 are precached, only 1..4 selected in this PM reference.
  'player/pl_step1.wav', 'player/pl_step2.wav', 'player/pl_step3.wav', 'player/pl_step4.wav',
  'player/pl_metal1.wav', 'player/pl_metal2.wav', 'player/pl_metal3.wav', 'player/pl_metal4.wav',
  'player/pl_dirt1.wav', 'player/pl_dirt2.wav', 'player/pl_dirt3.wav', 'player/pl_dirt4.wav',
  'player/pl_duct1.wav', 'player/pl_duct2.wav', 'player/pl_duct3.wav', 'player/pl_duct4.wav',
  'player/pl_grate1.wav', 'player/pl_grate2.wav', 'player/pl_grate3.wav', 'player/pl_grate4.wav',
  'player/pl_tile1.wav', 'player/pl_tile2.wav', 'player/pl_tile3.wav', 'player/pl_tile4.wav', 'player/pl_tile5.wav',
  'player/pl_slosh1.wav', 'player/pl_slosh2.wav', 'player/pl_slosh3.wav', 'player/pl_slosh4.wav',
  'player/pl_wade1.wav', 'player/pl_wade2.wav', 'player/pl_wade3.wav', 'player/pl_wade4.wav',
  'player/pl_ladder1.wav', 'player/pl_ladder2.wav', 'player/pl_ladder3.wav', 'player/pl_ladder4.wav',
  'player/pl_snow1.wav', 'player/pl_snow2.wav', 'player/pl_snow3.wav', 'player/pl_snow4.wav', 'player/pl_snow5.wav', 'player/pl_snow6.wav',
  // Landing/jump/pain/death; inclusion is not a generic jump-voice playback rule.
  'player/pl_jump1.wav', 'player/pl_fallpain1.wav', 'player/pl_fallpain2.wav', 'player/pl_fallpain3.wav',
  'player/pl_pain2.wav', 'player/pl_pain4.wav', 'player/pl_pain5.wav', 'player/pl_pain6.wav', 'player/pl_pain7.wav',
  'player/die1.wav', 'player/die2.wav', 'player/die3.wav', 'player/death6.wav', 'player/pl_die1.wav', 'player/pl_shot1.wav',
  'player/bhit_helmet-1.wav', 'player/bhit_kevlar-1.wav', 'player/bhit_flesh-1.wav', 'player/bhit_flesh-2.wav', 'player/bhit_flesh-3.wav',
  'player/headshot1.wav', 'player/headshot2.wav', 'player/headshot3.wav', 'common/bodydrop3.wav', 'common/bodydrop4.wav', 'common/bodysplat.wav',
  // World bullet/ricochet and breakable material sounds. Do not use break sounds for every hit.
  'weapons/bullet_hit1.wav', 'weapons/bullet_hit2.wav', 'weapons/ric1.wav', 'weapons/ric2.wav', 'weapons/ric3.wav', 'weapons/ric4.wav', 'weapons/ric5.wav',
  'weapons/ric_metal-1.wav', 'weapons/ric_metal-2.wav', 'weapons/ric_conc-1.wav', 'weapons/ric_conc-2.wav',
  'debris/wood1.wav', 'debris/wood2.wav', 'debris/wood3.wav', 'debris/glass1.wav', 'debris/glass2.wav', 'debris/glass3.wav',
  'debris/metal1.wav', 'debris/metal2.wav', 'debris/metal3.wav', 'debris/concrete1.wav', 'debris/concrete2.wav', 'debris/concrete3.wav',
  'debris/bustcrate1.wav', 'debris/bustcrate2.wav', 'debris/bustglass1.wav', 'debris/bustglass2.wav',
  'debris/bustmetal1.wav', 'debris/bustmetal2.wav', 'debris/bustconcrete1.wav', 'debris/bustconcrete2.wav', 'debris/bustceiling.wav',
  'buttons/spark5.wav', 'buttons/spark6.wav',
  // Grenade pin, per-type bounce, blast and aftermath.
  'weapons/pinpull.wav', 'weapons/he_bounce-1.wav', 'weapons/grenade_hit1.wav', 'weapons/grenade_hit2.wav', 'weapons/grenade_hit3.wav',
  'weapons/hegrenade-1.wav', 'weapons/hegrenade-2.wav', 'weapons/flashbang-1.wav', 'weapons/flashbang-2.wav', 'weapons/sg_explode.wav',
  'weapons/debris1.wav', 'weapons/debris2.wav', 'weapons/debris3.wav', 'weapons/explode3.wav', 'weapons/explode4.wav', 'weapons/explode5.wav',
  // C4 click/plant, start-defuse, completed-defuse, five beep stages, blast.
  'weapons/c4_click.wav', 'weapons/c4_plant.wav', 'weapons/c4_disarm.wav', 'weapons/c4_disarmed.wav',
  'weapons/c4_beep1.wav', 'weapons/c4_beep2.wav', 'weapons/c4_beep3.wav', 'weapons/c4_beep4.wav', 'weapons/c4_beep5.wav', 'weapons/c4_explode1.wav',
  // Equipment/ammo, selection HUD and NVG. No hostage/VIP/rescue mechanics implied.
  'items/gunpickup2.wav', 'items/9mmclip1.wav', 'items/ammopickup2.wav', 'items/weapondrop1.wav', 'items/kevlar.wav', 'items/equip_nvg.wav', 'items/nvg_on.wav', 'items/nvg_off.wav',
  'common/wpn_select.wav', 'common/wpn_denyselect.wav', 'common/wpn_moveselect.wav', 'common/wpn_hudon.wav', 'common/wpn_hudoff.wav',
  // Round start/result/objective announcements. Lose uses the other team's win, not an invented lose.wav.
  'radio/locknload.wav', 'radio/letsgo.wav', 'radio/moveout.wav', 'radio/com_go.wav',
  'radio/ctwin.wav', 'radio/terwin.wav', 'radio/rounddraw.wav', 'radio/bombpl.wav', 'radio/bombdef.wav', 'radio/ct_fireinhole.wav',
  // Three original radio menus; MRAD_HITASSIST resolves to fireassis (not hitassist).
  'radio/ct_coverme.wav', 'radio/takepoint.wav', 'radio/position.wav', 'radio/regroup.wav', 'radio/followme.wav', 'radio/fireassis.wav',
  'radio/fallback.wav', 'radio/sticktog.wav', 'radio/com_getinpos.wav', 'radio/stormfront.wav', 'radio/com_reportin.wav',
  'radio/ct_affirm.wav', 'radio/roger.wav', 'radio/ct_enemys.wav', 'radio/ct_backup.wav', 'radio/clear.wav', 'radio/ct_inpos.wav',
  'radio/ct_reportingin.wav', 'radio/blow.wav', 'radio/negative.wav', 'radio/enemydown.wav',
]);

// Backwards-compatible iterable of auxiliary sounds; now includes all non-default-shot paths.
const defaultShots = new Set(Object.values(SHOT_SOUNDS));
export const ACTION_SOUNDS = Object.freeze(ALL_SOUNDS.filter(name => !defaultShots.has(name)));

// Flat optional families. Order of step 1..4 is filename order, NOT alternating-foot order.
// Parent owns timing, material/radio selection, spatialization, deduplication and authority.
const families = {
  'knife.deploy':['weapons/knife_deploy1.wav'],
  'knife.swing':['weapons/knife_slash1.wav','weapons/knife_slash2.wav'],
  'knife.body':['weapons/knife_hit1.wav','weapons/knife_hit2.wav','weapons/knife_hit3.wav','weapons/knife_hit4.wav'],
  'knife.stab':['weapons/knife_stab.wav'], 'knife.wall':['weapons/knife_hitwall1.wav'],
  'dryfire.pistol':['weapons/dryfire_pistol.wav'], 'dryfire.rifle':['weapons/dryfire_rifle.wav'], 'zoom':['weapons/zoom.wav'],
  'step.concrete':['player/pl_step1.wav','player/pl_step2.wav','player/pl_step3.wav','player/pl_step4.wav'],
  'step.metal':['player/pl_metal1.wav','player/pl_metal2.wav','player/pl_metal3.wav','player/pl_metal4.wav'],
  'step.dirt':['player/pl_dirt1.wav','player/pl_dirt2.wav','player/pl_dirt3.wav','player/pl_dirt4.wav'],
  'step.vent':['player/pl_duct1.wav','player/pl_duct2.wav','player/pl_duct3.wav','player/pl_duct4.wav'],
  'step.grate':['player/pl_grate1.wav','player/pl_grate2.wav','player/pl_grate3.wav','player/pl_grate4.wav'],
  'step.tile':['player/pl_tile1.wav','player/pl_tile2.wav','player/pl_tile3.wav','player/pl_tile4.wav','player/pl_tile5.wav'],
  'step.slosh':['player/pl_slosh1.wav','player/pl_slosh2.wav','player/pl_slosh3.wav','player/pl_slosh4.wav'],
  'step.wade':['player/pl_wade1.wav','player/pl_wade2.wav','player/pl_wade3.wav','player/pl_wade4.wav'],
  'step.ladder':['player/pl_ladder1.wav','player/pl_ladder2.wav','player/pl_ladder3.wav','player/pl_ladder4.wav'],
  'step.snow':['player/pl_snow1.wav','player/pl_snow2.wav','player/pl_snow3.wav','player/pl_snow4.wav'],
  'landing.pain':['player/pl_fallpain1.wav','player/pl_fallpain2.wav','player/pl_fallpain3.wav'],
  'player.pain':['player/pl_pain2.wav','player/pl_pain4.wav','player/pl_pain5.wav','player/pl_pain6.wav','player/pl_pain7.wav'],
  'player.death':['player/die1.wav','player/die2.wav','player/die3.wav','player/death6.wav'],
  'hit.flesh':['player/bhit_flesh-1.wav','player/bhit_flesh-2.wav','player/bhit_flesh-3.wav'],
  'hit.helmet':['player/bhit_helmet-1.wav'], 'hit.kevlar':['player/bhit_kevlar-1.wav'],
  'hit.head':['player/headshot1.wav','player/headshot2.wav','player/headshot3.wav'],
  'ricochet.generic':['weapons/ric1.wav','weapons/ric2.wav','weapons/ric3.wav','weapons/ric4.wav','weapons/ric5.wav'],
  'ricochet.metal':['weapons/ric_metal-1.wav','weapons/ric_metal-2.wav'],
  'ricochet.concrete':['weapons/ric_conc-1.wav','weapons/ric_conc-2.wav'],
  'impact.wood':['debris/wood1.wav','debris/wood2.wav','debris/wood3.wav'],
  'impact.glass':['debris/glass1.wav','debris/glass2.wav','debris/glass3.wav'],
  'impact.metal':['debris/metal1.wav','debris/metal2.wav','debris/metal3.wav'],
  'impact.concrete':['debris/concrete1.wav','debris/concrete2.wav','debris/concrete3.wav'],
  'grenade.pin':['weapons/pinpull.wav'], 'grenade.bounce.he':['weapons/he_bounce-1.wav'],
  'grenade.bounce.other':['weapons/grenade_hit1.wav','weapons/grenade_hit2.wav','weapons/grenade_hit3.wav'],
  'grenade.he':['weapons/hegrenade-1.wav','weapons/hegrenade-2.wav'],
  'grenade.flash':['weapons/flashbang-1.wav','weapons/flashbang-2.wav'], 'grenade.smoke':['weapons/sg_explode.wav'],
  'grenade.aftermath':['weapons/debris1.wav','weapons/debris2.wav','weapons/debris3.wav'],
  'c4.click':['weapons/c4_click.wav'], 'c4.plant':['weapons/c4_plant.wav'],
  'c4.defuseStart':['weapons/c4_disarm.wav'], 'c4.defused':['weapons/c4_disarmed.wav'],
  'c4.beeps':['weapons/c4_beep1.wav','weapons/c4_beep2.wav','weapons/c4_beep3.wav','weapons/c4_beep4.wav','weapons/c4_beep5.wav'],
  'c4.explosion':['weapons/c4_explode1.wav'],
  'pickup.weapon':['items/gunpickup2.wav'], 'pickup.ammo':['items/9mmclip1.wav','items/ammopickup2.wav'],
  'pickup.armor':['items/kevlar.wav'], 'pickup.nvg':['items/equip_nvg.wav'],
  'nvg.on':['items/nvg_on.wav'], 'nvg.off':['items/nvg_off.wav'],
  'round.start':['radio/moveout.wav','radio/letsgo.wav','radio/locknload.wav','radio/com_go.wav'],
  'round.ctWin':['radio/ctwin.wav'], 'round.tWin':['radio/terwin.wav'], 'round.draw':['radio/rounddraw.wav'],
  'round.bombPlanted':['radio/bombpl.wav'], 'round.bombDefused':['radio/bombdef.wav'],
  'radio.fireInHole':['radio/ct_fireinhole.wav'],
  'radio.menu1':['radio/ct_coverme.wav','radio/takepoint.wav','radio/position.wav','radio/regroup.wav','radio/followme.wav','radio/fireassis.wav'],
  'radio.menu2':['radio/com_go.wav','radio/fallback.wav','radio/sticktog.wav','radio/com_getinpos.wav','radio/stormfront.wav','radio/com_reportin.wav'],
  'radio.menu3':['radio/roger.wav','radio/ct_affirm.wav','radio/ct_enemys.wav','radio/ct_backup.wav','radio/clear.wav','radio/ct_inpos.wav','radio/ct_reportingin.wav','radio/blow.wav','radio/negative.wav','radio/enemydown.wav'],
};
// Every gun has shot.<weapon> (precache variants) and action.<weapon> (catalog action names).
for (const [id, name] of Object.entries(SHOT_SOUNDS)) {
  const stem = name.slice(8).replace(/(?:[-_].*|\d*\.wav)$/, '');
  families[`shot.${id}`] = ALL_SOUNDS.filter(n => n.startsWith(`weapons/${stem}`) && /(?:-\d|\d|_fire|-burst)\.wav$/.test(n) && !/_hit/.test(n));
  families[`action.${id}`] = ACTION_SOUNDS.filter(n => n.startsWith(`weapons/${stem}_`) && !families[`shot.${id}`].includes(n));
}
// Shared Glock/AWP action filenames do not carry the gun prefix.
families['action.glock18'] = ['weapons/clipin1.wav','weapons/clipout1.wav','weapons/slideback1.wav','weapons/sliderelease1.wav','weapons/357_cock1.wav'];
families['action.awp'] = ['weapons/awp_clipin.wav','weapons/awp_clipout.wav','weapons/awp_deploy.wav','weapons/boltpull1.wav','weapons/boltup.wav','weapons/boltdown.wav'];
families['action.xm1014'] = ['weapons/reload1.wav','weapons/reload3.wav','items/cliprelease1.wav'];
export const SOUND_GROUPS = Object.freeze(Object.fromEntries(Object.entries(families).map(([key, names]) => [key, Object.freeze(names)])));

// A path grammar, not a requirement that a WAV is currently available. No nested paths, querystrings or URLs.
export const safeSound = name => typeof name === 'string' && /^(?:weapons|player|items|radio|buttons|debris|ambience|common)\/[a-zA-Z0-9_-]+\.wav$/.test(name) && !/[\r\n]/.test(name);
export function gunSound(weapon, silenced=false) {
  if (!Object.hasOwn(SHOT_SOUNDS, weapon)) return undefined;
  return weapon === 'm4a1' && silenced ? 'weapons/m4a1-1.wav' : weapon === 'usp' && silenced ? 'weapons/usp1.wav' : SHOT_SOUNDS[weapon];
}
if (ALL_SOUNDS.length > SOUND_BUDGET || new Set(ALL_SOUNDS).size !== ALL_SOUNDS.length || !ALL_SOUNDS.every(safeSound)) throw new Error('Invalid sound catalog/budget');
