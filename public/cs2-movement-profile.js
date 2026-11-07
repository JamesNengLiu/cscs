// Isolated metre profile for the CS2 experiment. It uses the shared, tested
// 60 Hz movement solver; it is not Valve's subtick movement implementation.
import {LEGACY_METER_MOVEMENT_PROFILE} from './cs2-movement.js';
import {SOURCE_UNIT_METRES} from './experimental-world-contract.js';
import {CS2_WEAPON_PROFILE} from './cs2-weapon-profile.js';

const unit=SOURCE_UNIT_METRES;
export const CS2_MOVEMENT_RULES_VERSION='cs2-meter-movement-v1';
export const CS2_MOVEMENT_PROFILE=Object.freeze({
 id:CS2_MOVEMENT_RULES_VERSION,
 units:'metres',
 geometryMetresPerSourceUnit:unit,
 scope:'CS2 model hull and extracted weapon speeds; candidate player tuning in a shared 60 Hz solver, not retail 1:1 movement',
 rules:Object.freeze({
  ...LEGACY_METER_MOVEMENT_PROFILE.rules,
  radius:16*unit,bodyHeight:72*unit,
  // Model metadata does not specify duck hull/camera or engine ConVar values.
  // Keep these explicit candidates until a player config/retail replay verifies
  // them; do not infer the player movement solver from NPC movement settings.
  crouchHeight:54*unit,eye:64*unit,crouchEye:46*unit,stepHeight:18*unit,
  speed:250*unit,walkSpeed:130*unit,crouchSpeed:85*unit,
  groundAcceleration:5.5,airAcceleration:12,friction:5.2,stopSpeed:80*unit,
  gravity:800*unit,jumpSpeed:301.993377*unit,
  metresPerSpeedUnit:unit,walkFactor:.52,duckFactor:.34,airWishCap:30*unit,
  duckSeconds:.4
 }),
 weapons:CS2_WEAPON_PROFILE.weapons,
 evidence:Object.freeze({
  modelHull:Object.freeze({
   path:'agents/models/ctm_sas/ctm_sas.vmdl_c',
   sha256:'7312ab88d05bea67b06f3a945d06dc1e5fc5511d4849bc05bc05aec25380eb22',
   manifest:'6679288287140932208',
   field:'DATA.m_modelInfo.m_vHullMin/Max',
   min:Object.freeze([-16,-16,0]),max:Object.freeze([16,16,72]),
   interpretation:'Authored model hull, not an engine movement-service hull certification'
  }),
  weaponSpeeds:CS2_WEAPON_PROFILE.source
 }),
 verifiedFields:Object.freeze(['geometryMetresPerSourceUnit','modelHull','weapons.maxSpeed','weapons.maxSpeedScoped']),
 candidateFields:Object.freeze(['crouchHeight','eye','crouchEye','stepHeight','groundAcceleration','airAcceleration','friction','stopSpeed','gravity','jumpSpeed','walkFactor','duckFactor','airWishCap','duckSeconds']),
 limitations:Object.freeze([
  'Player hull radius/standing height follow the authored model bounds; retail engine runtime hulls are not extracted.',
  'Candidate camera, crouch and movement constants require retail player/replay validation.',
  'Fixed 60 Hz commands with 120 Hz collision subdivisions, not Source 2 subtick scheduling.',
  'The existing collision response, stamina, jump cap and hit-slowdown algorithms remain shared with the verified v1.0 adapter.'
 ])
});
