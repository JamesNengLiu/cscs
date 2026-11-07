// Only throw velocity/max carried speed/damage below are pinned vdata facts.
// Source 2 runtime grenade integration is not in this asset. All coefficients
// surrounding those facts remain explicit, reversible browser candidates.
export const CS2_GRENADE_PROFILE=Object.freeze({
 id:'cs2-grenade-pilot-v1',metresPerUnit:.0254,
 source:Object.freeze({path:'scripts/weapons.vdata_c',sha256:'4542882b7e92295e183a9dbb1b4781222d349855173321886faa19b82d7f4b6e',manifest:'6679288287140932208'}),
 weapons:Object.freeze({hegrenade:Object.freeze({throwVelocity:750,maxSpeed:245,damage:99}),flashbang:Object.freeze({throwVelocity:750,maxSpeed:245,damage:50}),smokegrenade:Object.freeze({throwVelocity:750,maxSpeed:245,damage:50})}),
 throwVelocityScale:.9,inheritedVelocityScale:1.25,gravityScale:.4,elasticity:.45,
 radius:2*.0254,throwClearance:22*.0254,throwBackoff:6*.0254,
 restSpeed:20*.0254,fuseSeconds:1.5,smokeSeconds:18,smokeRadius:3.8,smokeHeight:3.2,
 verifiedFields:Object.freeze(['weapons.throwVelocity','weapons.maxSpeed','weapons.damage']),
 candidateFields:Object.freeze(['throwVelocityScale','inheritedVelocityScale','gravityScale','elasticity','radius','throwClearance','throwBackoff','restSpeed','fuseSeconds','smokeSeconds','smokeRadius','smokeHeight','pitchRemap','playerBounce','blastRadius','flashFacingAndTiming']),
 limitations:Object.freeze(['No retail grenade runtime/ConVar simulation was extracted.','No CS2 subtick throw timing, breakable doors or movable props in this pilot.','Collision follows real Source 2 PHYS surfaces; the integration/timing candidates require retail trajectory validation.'])
});
