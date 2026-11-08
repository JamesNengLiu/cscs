// Only throw velocity/max carried speed/damage below are pinned vdata facts.
// Source 2 runtime grenade integration is not in this asset. All coefficients
// surrounding those facts remain explicit, reversible browser candidates.
export const CS2_GRENADE_PROFILE_V1=Object.freeze({
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
// Throw-strength mapping is a reversible candidate from controlled community
// measurements, not a retail-runtime extraction. Full strength is unchanged.
export const CS2_GRENADE_PROFILE_V2=Object.freeze({
 ...CS2_GRENADE_PROFILE_V1,id:'cs2-grenade-pilot-v2',
 strengthSpeedFloor:.3,strengthSpeedRange:.7,
 candidateFields:Object.freeze([...CS2_GRENADE_PROFILE_V1.candidateFields,'strengthSpeedFloor','strengthSpeedRange']),
 limitations:Object.freeze([...CS2_GRENADE_PROFILE_V1.limitations,'Underhand origin-height and retail strength transitions still require original trajectory samples.'])
});
// Independent browser implementation of the measured flight/contact model.
// Public vdata verifies the weapon values, not these runtime candidates.
export const CS2_GRENADE_PROFILE=Object.freeze({
 ...CS2_GRENADE_PROFILE_V2,id:'cs2-grenade-pilot-v3',trajectoryVersion:1,
 simulationStep:1/128,maxContacts:4,floorNormal:.7,restNormal:.1,projectileTTL:20,
 floorDampingSpeed:690*.0254,floorDampingDot:.5,
 componentStopEpsilon:.1*.0254,
 contactSlop:.0254/32,bounceBias:.0254/32,
 underhandDrop:12*.0254,releaseDelaySeconds:.1,
 jumpLatchEnabled:true,jumpLatchDelaySeconds:.1,jumpLatchWindowSeconds:.2,
 smokeThinkSeconds:.1,smokeRestOnly:true,
 candidateFields:Object.freeze([...CS2_GRENADE_PROFILE_V2.candidateFields,'simulationStep','maxContacts','floorNormal','restNormal','projectileTTL','floorDampingSpeed','floorDampingDot','componentStopEpsilon','contactSlop','bounceBias','underhandDrop','releaseDelaySeconds','jumpLatchEnabled','jumpLatchDelaySeconds','jumpLatchWindowSeconds','smokeThinkSeconds','smokeRestOnly']),
 limitations:Object.freeze(['No retail grenade runtime was extracted or copied.','Public terminal-position captures do not verify every intermediate retail tick, release cache or jump latch.','Release/latch windows and smoke minimum-fuse/think policy remain explicit browser candidates.','Static PHYS does not simulate moving props or breakable doors.'])
});
