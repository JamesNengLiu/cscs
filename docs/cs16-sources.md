# CS 1.6 factual reference for the browser prototype

Checked on 2026-10-27 against the local ReGameDLL_CS checkout at
`/Users/james/.hermes/profiles/gameproduct/cache/scratch/cs16-regamedll-20261027`.
Its `HEAD` was verified as `4a50c42e85fd3778c2b7d24731c7d30c83bbab01`.
All source links below pin that revision. The JavaScript is independently written
from numeric facts and observed rules, not a wholesale translation of C++ bodies.
ReGameDLL is a community reference, not Valve certification. Neither this source
review nor these unit tests establishes 1:1 retail CS 1.6 or GoldSrc behavior.

## Public exports and units

| Module | Exports |
| --- | --- |
| `public/arsenal.js` | `GUNS`, `EQUIPMENT`, `KNIFE`, `ARSENAL_SOURCE` |
| `public/economy.js` | `ECONOMY`, `clampMoney(current, delta = 0)`, `lossReward(lossStreak)` |
| `public/armour.js` | `armourDamage(damage, armour, helmet, hitgroup = 'chest', weaponRatio = 1, blast = false)` |

`GUNS` contains exactly 24 canonical IDs. It excludes the knife, grenades and
equipment. `EQUIPMENT` contains kevlar, assaultsuit, defusekit, nightvision, shield,
hegrenade, flashbang and smokegrenade. `KNIFE` is a separate free, non-purchasable
record. All exported configuration records have null prototypes and are deeply
frozen, including nested team/mode/zoom arrays. Unknown IDs, `__proto__`, and
`constructor` cannot resolve inherited purchase records. Consumers should still
check existence and eligibility before accepting a purchase.

Money is whole dollars; `interval`, `reload` and economy durations are seconds.
`maxSpeed` is GoldSrc units/second, not browser world units/second. `zoom` contains
the scoped FOV stages in degrees, excluding the normal FOV of 90. `slot` uses the
requested inventory numbers 1 = primary, 2 = pistol, 3 = knife; source HUD item
slot indices can be zero-based. Names/categories are readable project labels.

## Verified weapon facts and their limits

Prices, magazine sizes, reserve caps, ammunition prices/pack sizes and grenade
limits come from [weapontype.h](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/weapontype.h#L86-L319).
Ammo names and weapon-to-ammo mappings were checked against
[WeaponInfo and AmmoInfo](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/weapontype.cpp#L220-L287).
`reserve` is maximum backpack ammunition, excluding the loaded clip. It is not
the ammunition supplied with a purchase. Guns using the same `ammoType` share a
backpack pool; `556NatoBox` is distinct from `556Nato`. The source's `45ACP` casing
variant is normalized to `45acp`.

Allowed purchase teams come from the non-assassination branches of
[CanBuyWeaponByMaptype](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/weapontype.cpp#L596-L725),
not from the misleading team column of `g_weaponStruct`. Glock and USP can both
be bought by either team; Elites are T-only and Five-SeveN is CT-only. Restrictions
are buying rules, not restrictions on picking up opponents' dropped weapons.
Assassination/VIP maps have additional restrictions not represented by `teams`.

Base damage, ordinary range modifiers, magazine reload durations and unzoomed
speeds come from [weapons.h](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/weapons.h#L512-L2091).
Intervals, scoped FOVs, fire modes and pellet counts were checked in each gun's
[wpn_shared source](https://github.com/rehlds/ReGameDLL_CS/tree/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/wpn_shared).
The ordinary `rangeModifier` is an exponential factor per 500 GoldSrc units,
as used by [FireBullets3](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/cbase.cpp#L1264-L1440).
Damage is a base value before distance, penetration, hitgroup and armour effects.

Important interpretation rules:

- Pistol intervals include the subtraction inside their firing functions:
  Glock/USP/P228/Five-SeveN 0.15, Deagle 0.225, Elites 0.075 seconds. Elites uses
  the original non-`REGAMEDLL_FIXES` branch; the fixes branch changes it to 0.122.
  See [ELITEFire](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/wpn_shared/wpn_elite.cpp#L94-L110).
- Primary scalar values mean normal, unzoomed, unsilenced fire. `modes` is
  descriptive metadata, not an implemented alternate-fire controller. Silenced
  USP damage is 30 instead of 34. Silenced M4A1 damage/range modifier is 33/0.95
  instead of 32/0.97. These variants are in `weapons.h` and the respective firing
  functions; they must be applied by a mode-aware caller.
- Glock burst trigger interval is 0.5 seconds. FAMAS burst trigger interval is
  0.55 seconds, with first-shot damage 34 instead of 30. The pinned source's
  [FireRemaining](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/weapons.cpp#L813-L877)
  uses base damage for follow-up shots: Glock 25 and FAMAS 30. Glock follow-ups
  use range modifier 0.9 rather than the first shot's 0.75. The weapon functions
  schedule the first follow-up at 0.1 seconds for Glock and 0.05 for FAMAS;
  `FireRemaining` schedules a subsequent follow-up at 0.1 seconds. Engine frame
  scheduling and client prediction are not reproduced here.
- AUG and SG552 use a 0.135-second interval while scoped, versus 0.0825 unscoped.
  Scoped movement caps are SG552 200, Scout 220, AWP/G3SG1/SG550 150. AUG keeps
  its 240 cap. `maxSpeed` and `interval` retain the unzoomed values.
- `automatic` means **normal-mode held-trigger repeat**, not the physical firing
  mechanism. It is false for pistols and true for every primary, including M3,
  Scout and AWP: those weapon functions have no pistol-style release gate, and
  [ItemPostFrame](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/weapons.cpp#L1060-L1150)
  calls primary attack again while the trigger is held and the cooldown permits.
  Glock burst bypasses the semi-auto release gate and needs a mode override.
  Frame scheduling, bolt animations and zoom resumption are still separate work.
- M3 fires 9 pellets, XM1014 6; `damage: 20` is per pellet. Shotguns use linear
  trace-fraction falloff, not `FireBullets3`'s exponential model. Their
  `rangeModel: 'linear'` and `range` expose the verified trace lengths 3000/3048.
  Their `rangeModifier: 1` is a flagged adapter placeholder and must not be
  interpreted as no falloff. The source truncates each pellet's linear damage
  to an integer. See [FireBullets/FireBuckshots](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/cbase.cpp#L1117-L1254).
- Shotgun `reload` means **per-shell** delay: M3 0.45, XM1014 0.3, with
  `reloadStyle: 'per-shell'` and `reloadStart: 0.55`. It is not an empty-to-full
  duration. Interruptions, final pump animation and idle scheduling require a
  reload state machine. See [DefaultShotgunReload](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/weapons.cpp#L1574-L1635)
  and each shotgun's `Reload`/`WeaponIdle`.

The five fields `spread`, `moveSpread`, `airSpread`, `heatSpread`, `recovery` are
**unverified browser tuning approximations** for every gun, exposed in
`gun.unverifiedFields` and `ARSENAL_SOURCE.approximateFields`. They are not claimed
to be extracted CS accuracy or recoil. Spread fields are angular half-widths in
radians; a possible browser model adds the movement/air terms and
`heat * heatSpread` to the base. Heat can increase by one per shot and decay by
`recovery` units/second. No such model or recoil simulation is implemented here.
The category-shared numbers are not validated against retail gameplay.

## Knife, equipment and buying

The knife is issued without a purchase in
[GiveDefaultItems](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/player.cpp#L1819-L1834).
[Knife constants](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/weapons.h#L1176-L1185)
are swing 15, alternate fast-swing constant 20, stab 65, backstab multiplier 3,
swing/stab reach 48/32 GoldSrc units, movement 250, armour multiplier 1.7.
`fastSwingDamage: 20` records a constant; activation timing is explicitly
unverified, and must not be presented as a proven first-swing rule. Knife
[hit/miss, shield and backstab logic](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/wpn_shared/wpn_knife.cpp#L270-L590)
is not implemented by this data record.

Equipment list prices and limits are verified. `limit: 1` for kevlar/assaultsuit
means one armour state, not a prohibition on replenishing damaged armour. Buying
either replenishes armour to 100; assaultsuit also provides a helmet. In
[BuyItem](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/client.cpp#L1292-L1570),
assaultsuit costs only $350 if the player has full kevlar without a helmet, or
$650 to replenish damaged armour when a helmet is already owned; otherwise
$1,000. Full armour plus helmet is rejected. These conditional prices are not
computed by the dictionary. CT kit purchase also requires a bomb map. Shield is
CT-only, replaces/drops the primary and is incompatible with Dual Elites;
nightvision ownership is separate from its activation. The grenade limits are
one HE, two flashes, one smoke.

[CanPlayerBuy](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/player.cpp#L4645-L4722)
requires alive status, buy-zone presence, remaining buy time, a non-VIP player,
and a team allowed to buy on the map. The source uses the round-start timestamp;
that timestamp is reset when
[freeze ends](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/multiplay_gamerules.cpp#L2790-L2830).
[BuyGunAmmo](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/client.cpp#L2328-L2366)
charges a full pack price even when the last pack is clipped by the reserve cap;
there is no prorated partial-pack price. The catalogue does not enforce any of
these transaction/state rules.

## Economy: exact reference distinctions

The [cvar definitions](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/game.cpp#L28-L47)
are `mp_buytime=1.5` minutes, `mp_freezetime=6` seconds, `mp_roundtime=5` minutes,
`mp_c4timer=45` seconds, `mp_startmoney=800`. The current project exports use
90/6/150/45 seconds. **Round duration 150 seconds (2 minutes 30 seconds) is an
explicit project override of the reference 300 seconds. Starting money 10,000
is an explicit project override of the original 800.** Suggested 1.75-minute
rounds and 35-second bombs are not the defaults in this checkout. No server
cvars or services are changed here.

| Export | Dollars | Meaning |
| --- | ---: | --- |
| `killReward` | 300 | Ordinary enemy kill, including knife; no later-game weapon-specific rewards |
| `teamKillPenalty` | -3300 | Signed teammate-kill delta |
| `winElimination` | 3250 | Either team's elimination win on a bomb map |
| `winEliminationOtherMaps` | 3000 | Generic CT/T win on a non-bomb map |
| `winBomb` | 3500 | T objective detonation win |
| `winDefuse` | 3250 | CT objective defuse win |
| `winTimeout` | 3250 | CT target-saved timeout on a bomb map |
| `plantReward` / `defuseReward` | 0 / 0 | No separate individual cash payment |
| `plantedLossBonus` | 800 | Added to T's team account in the bomb-defused outcome |

Constants are in [RewardAccount](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/gamerules.h#L119-L159).
Actual outcome selection matters: [Target_Bombed, Target_Defused, Round_Cts and Round_Ts](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/multiplay_gamerules.cpp#L1272-L1385)
select different values, and generic 3000 is not the bomb-map elimination reward.
[PlayerKilled](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/multiplay_gamerules.cpp#L3970-L4060)
has a separate VIP-kill reward of 2500, outside this bomb-map API.

No `AddAccount` payment occurs in the checked
[plant completion path](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/wpn_shared/wpn_c4.cpp#L165-L243)
or [defuse completion path](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/ggrenade.cpp#L1087-L1164).
The defuser receives three score points; the planter receives three when the
bomb [successfully explodes](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/ggrenade.cpp#L1532-L1546).
These are not dollars. The $800 planted-loss team bonus is awarded on defuse,
not an immediate personal $300 plant payment. Defusing takes
[10 seconds without a kit, 5 with one](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/ggrenade.cpp#L1027-L1070).

### Losing rounds are stateful

[RestartRound](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/multiplay_gamerules.cpp#L1903-L2024)
maintains a **shared** `m_iLoserBonus` and a consecutive-loss counter per team.
The winner's counter resets to zero, and the loser's increments. There is no
modern decrement-by-one loss-counter rule. If the winner had more than one loss
before that win, the shared bonus resets to 1500. Otherwise it keeps its previous
value. If either updated counter exceeds one and the shared bonus is **below
3000**, 500 is added; this is a pre-add threshold, not a post-add clamp.

This yields two important trajectories:

- From a complete reset: 1400, 1900, 2400, 2900, **3400**, then 3400.
- After a team breaks a streak longer than one: the newly losing team gets
  **1500**, then 2000, 2500, **3000**, then 3000 if it keeps losing.

`lossMax: 3400` is the largest reachable initial-streak payout;
`lossThreshold: 3000` is the source comparison threshold; `lossReset: 1500`
records the comeback reset. Alternating single losses retain the shared value.
`lossReward(n)` is intentionally limited to the **initial uninterrupted**
trajectory, with `n` including the current loss. It returns 0 for no losses or
invalid input. It cannot implement historical shared state from a single count.
Do not call it on every new streak and describe the result as exact original
economy. A round controller must retain both counters and the shared bonus,
using the transition rules above. Draw/reset/escape-map handling also belongs to
that controller.

On a bomb-map timeout,
[Target_Saved](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/multiplay_gamerules.cpp#L2889-L2920)
marks **living Ts** as receiving no team-account money next round. Dead Ts can
receive the loss bonus. The shared loss counters still change. This is not a
general penalty for surviving every lost round. Hostage timeout has its own
CT denial case. Team payouts are applied at the next restart, subject to the
per-player denial flag, rather than necessarily at the win announcement.

[AddAccount](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/player.cpp#L3544-L3592)
caps normal money at 16000 and floors it at zero. `clampMoney` additionally
sanitizes a possibly malformed current balance first, truncates finite numeric
dollars toward zero, and treats non-numeric/nonfinite inputs as zero. Numeric
strings are not coerced. These invalid-input rules are JS safety policy, not
claims about C++ integer conversion. The function returns a new numeric balance
and never mutates arguments.

## Armour calculation

The base health fraction and armour cost are both 0.5 in
[player.h](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/player.h#L66-L67).
`GUNS[id].armorRatio` is the **multiplier of that base fraction**, not a percentage
of damage absorbed. For example AK-47 uses 1.55, giving health fraction 0.775.
The multipliers are in
[TakeDamage's weapon switch](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/player.cpp#L1185-L1224).

For an ordinary covered hit with incoming damage D and ratio R, desired health
damage is D × 0.5 × R; desired armour expenditure is half the damage prevented.
If available armour cannot pay that expenditure, each remaining armour point
prevents two health damage and armour drops to zero. For example 100 damage
at R=1 with 100 armour yields 50 health damage/25 armour spent; with only 10
armour it yields 80 health damage/10 spent. This is derived from the
[ordinary depletion branch](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/player.cpp#L1254-L1286).

The input is **already hitgroup-multiplied**. The source
[TraceAttack](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/player.cpp#L715-L794)
uses head ×4, stomach ×1.25, legs ×0.75 and chest/arms ×1.
[IsArmored](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/player.cpp#L9335-L9359)
covers generic/chest/stomach/arms and a helmeted head; legs are unprotected.
The JS accepts numeric source hitgroups 0–7 and descriptive strings; unknown
groups receive no protection. `helmet` must be boolean true to cover the head.

`blast: true` follows the early
[DMG_EXPLOSION/DMG_BLAST branch](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/player.cpp#L927-L1098).
That branch forces the generic hitgroup, ignores the weapon multiplier, and
uses health ratio 0.5 and armour expenditure 0.25 × D. **On depletion it instead
subtracts only the remaining armour from incoming damage.** Thus 100 damage/10
armour yields 90 health damage. Exactly 25 armour yields 50 health damage, while
24.9 yields 75.1: the source has a discontinuity at the sufficient-armour
boundary. The later `flBonus *= 2` blast code is bypassed by the earlier return;
it must not be blindly applied to this explosion path.

The returned `{ healthDamage, armourDamage, armour }` preserves fractional
values and reports actual armour spent, not the source's sometimes-truncated
HUD/log damage. The result is frozen. Negative/nonfinite damage or armour becomes
zero; invalid weapon ratios default to 1, finite ratios are bounded to [0, 2].
No hostile objects are converted with `valueOf`/`toString`. These input bounds
are defensive JS behavior. VIP extra protection, shield modifiers/blocked hits,
friendly-fire reduction, fall/drowning exclusions, blast radius/occlusion and
integer health/HUD effects require other gameplay systems.

## Integration status and verification

These five new files provide reference data, pure numeric helpers and their own
tests. They do not wire the game, server, shop UI or grenade controllers. Other
work must enforce authoritative purchases, shared ammo, armour replenishment,
shotgun reload stages, alternate fire, scoped movement, penetration, knife
traces, shield blocking, nightvision effects, grenade simulation, and the
stateful reward/timeout rules described above. Hostage, VIP and escape scenarios
have additional rewards that are outside these bomb-map constants.

Run only this task's tests with `node --test tests/arsenal.test.mjs`. They cover
all gun/equipment prices and team flags, all canonical IDs, numeric weapon and
ammo facts, immutable/prototype-safe catalogues, provenance/approximation
labels, money caps, loss-helper scope, and armour hitgroup/depletion/explosion
boundaries. They do not establish browser gameplay or retail-engine parity.
