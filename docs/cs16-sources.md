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

## Movement: jump and airborne duck

Player vertical movement uses the conventional gravity 800 source units/s²
([engine default](https://github.com/rehlds/ReHLDS/blob/master/rehlds/engine/sv_phys.cpp#L47))
and jump velocity `sqrt(2 * 800 * 45)` source units/s
([PM_JumpHeight](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/pm_shared/pm_shared.cpp#L2474-L2489)).
Divide accelerations and velocities by the map's 40-unit scale. Gravity is
applied in two half steps around vertical collision tracing, preserving an
approximately 45-unit ordinary jump across supported simulation frame rates.

[PM_Duck / PM_UnDuck](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/pm_shared/pm_shared.cpp#L1926-L2096)
keep the hull center fixed when changing stance in air. With the imported
72/36-unit standing/crouched movement hulls, this raises the feet by 18 units
when crouching after takeoff and lowers them by 18 when standing in air.
Grounded stance changes preserve feet position. Standing requires clearance
for the complete new hull, including below the feet and above the head.

This retains instantaneous stance changes and the project's horizontal
movement tuning; it does not port the full original movement engine or the
0.4-second grounded duck transition. `tests/jump-crouch.test.mjs` covers
vertical reach, collision clearance, repeated stance changes, the CT-spawn
stacked crates, and authoritative snapshot/input replay. These are local
simulation checks, not original-client or physical multi-machine comparisons.

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

## 2026-10-29：射击与移动手感修复

本节描述当前实现，优先于上文历史原型的近似项。服务端数值参照仍固定为 ReGameDLL_CS `4a50c42e85fd3778c2b7d24731c7d30c83bbab01`；客户端 HUD/FOV 同时参照 Valve HLSDK 和 CS16Client 的公开实现。后者不是 Valve 发布的 CS 零售客户端源码。

- `public/weapon-feel.js` / `weapon-kick.js`：24 把枪分别计算姿态精度、射击间隔、累计精度和后坐力；步枪/机枪/冲锋枪按逐枪 KickBack 数值和源分支顺序选择参数。镜头 punch 每次模拟更新均回正，不再与 0.4 秒的射击精度恢复共用计时。散布使用两个均匀随机数相加，并在瞄准方向的正交基底上偏移；同一发霰弹的所有弹丸共用开枪前的基底。Glock/FAMAS 后续连发、模式间隔与 AUG/SG552 的开镜射速单独处理。换弹重置精度并保留仍在衰减的镜头 punch。
- `game.mjs` / `inventory.mjs`：持续自动射击保留小于一 tick 的时间余数，避免 M4 每发被向上取整为 0.1 秒。点射或停火后重新开始计时，不补发积压子弹。武器保存自己的射击冷却，部署使用默认 0.75 秒 / AWP 1.45 秒，切枪不能清掉前一枪的冷却；AWP 的手动开镜要求继续保留。逐发装填也保留时间余数，避免长弹匣逐次累积 tick 误差。项目要求的空弹匣自动换弹继续保留。
- `public/movement.js`：接入持枪及开镜最大速度、静步/蹲行比例、地面摩擦与方向投影加速；空中无输入不刹车，蹲下不主动消除已有水平动量。增加连续跳跃疲劳、超速限制、0.4 秒地面蹲下视点过渡、玩家身体阻挡和踩人支撑。站立视点为 `(36 + 17) / 40`，蹲下为 `(18 + 12) / 40`；碰撞身高继续为 72 / 36 source units，普通跳跃高度仍为 45，跳后蹲的抬脚仍为 18。俯仰限制为 89 度。
- `public/view-settings.js` / `crosshair.js`：把 4:3 下的水平 FOV 换算成 Three.js 的纵向 FOV，宽屏扩展水平方向；开镜灵敏度乘以 `zoom / 90`，同时覆盖 AUG/SG552。准星居中，按 HUD 的逐枪最小距离和单发增量开合，与弹道散布及镜头 punch 分开；以时间归一化收缩，抑制本地预测与服务端确认造成的重复开合。默认不显示现代式命中标记。
- `public/bone-pose.js` / `hitboxes.mjs`：人物渲染与服务端命中盒共用原模型骨骼计算。战斗统一使用本地原版 urban 的 21 个骨骼包围盒，避免外观/特朗普面部选择改变战斗规则。射线转换到各骨骼局部空间判定，历史命中使用历史位置、朝向、姿态、武器与动作时间；原始射击/移动/蹲下/换弹/死亡序列和帧号进入快照，远端同一连续序列的帧号可插值。缺少模型时诊断明确报告 `fallback-body-boxes`，不把后备方盒算作骨骼命中盒。
- `ballistics.mjs`：按弹种设置穿透次数、能量和距离，支持穿人及有限厚度的掩体；盾牌终止穿透。退出实体的查询只使用原 BSP 点碰撞，不改地图几何。材质来自原有渲染面的纹理名称及物体元数据，原始贴花继续使用服务端表面位置和法线。中弹后加入参考武器分支的速度限制/击退和无防护部位的镜头 punch；生命伤害取整，刀的护甲系数为 1.7，加入摔落伤害及落地反馈。
- `public/game-audio.js` / `weapon-model.js`：分别使用各枪本地 WAV、消音模式枪声和 HRTF 方位衰减；解码缓存最多 128 项、同时播放最多 48 声、事件去重最多 256 项。支持脚步、跳跃、落地、刀、爆炸、手雷反弹以及模型事件 5004 的动作声音。原模型动作细分到消音/非消音、霰弹起始/插弹/结束、双枪左右、刀刺、持盾及 C4 按键。去除叠加在原始射击动画之外的统一枪身后坐力位移，避免双重震动。

### 可复核的数值与边界

- 自动化覆盖：逐枪射击、持续射速误差不超过一 tick、切枪不能绕过 AWP 冷却、霰弹基底一致、空中惯性、CT 箱子连续路线、斜坡、骨骼命中、穿人、穿透预算、受击/刀护甲、玩家碰撞、声音去重/缓存/方位、准星预测去重。
- 浏览器覆盖使用独立 headless Chrome/WebGL、原始本地素材和离线 Game 快照，没有启动监听服务或重启 3001。覆盖弹孔、移动射击、FOV、镜速、准星屏幕位置、消音器动作、WAV 解码播放、投掷准备与闪光淡出；这不等于真人听感或实体双机验收。
- 本地 CPU 探针：10 玩家持步枪射击，600 次 60 Hz 模拟步、每两步生成快照，去掉前 60 步后平均 4.69 ms、P95 8.26 ms、最大 33.07 ms。此项不含传输、延迟补偿历史记录/查询、GPU 与真实时间调度，不能用来声称 10 台实体设备的帧率。
- 当前随机数流不是 GoldSrc 的共享随机种子算法；客户端预测对随机横向后坐力仍需服务端校正。物理步阶、边缘摩擦、疲劳、玩家承载和源引擎所有异常分支未逐条移植。
- 穿透使用有界出口/厚度查询；纹理名称的材质分类仍有推断，不是原版 `materials.txt` 全表，也没有完整复制原引擎从实体内部继续追踪的特殊行为。可破坏实体仍保持现有静态地图碰撞。
- 模型骨骼计算共用，但统一战斗 rig、源 gait/controller 合成、完整动作状态机、弹壳、血花、全套材质特效仍有忠实度边界。烟雾和闪光叠加的既有近似没有被宣称修复。2 分 30 秒回合、缩短闪光与免费补弹保持项目已确认规则。
- 新声音资源仅位于被忽略的 `public/assets/sounds/`；本地清单记录来源 URL、字节数及 SHA-256，未完成官方零售校验。当前准备 134/135 个 WAV，`items/cliprelease1.wav` 缺失时跳过该声音，不阻断换弹动作。原版及派生素材不随本次代码提交。

本轮最终验证：`node --test --test-reporter=tap tests/*.test.mjs` 为 **581 通过、0 失败、0 跳过**；浏览器弹孔/移动射击 **4 项**、视野/镜速/准星/动作/声音/投掷物 **9 项**均通过。截图和测试收据仅在忽略的 `artifacts/`。

## 2026-10-29：滚轮连续跳镜头与快照开销修复（首轮）

在只读排查复现并获用户确认后，本轮只处理镜头起落衔接、落地贴地、快照骨骼重复计算。保留此前的灵敏度、左右手持枪、投掷物显示、爆炸与弹痕改动。

- `public/player-camera.js` 将真实空中运动、落地与地面上台阶的显示平滑分开：空中/落地不再保留整条跳跃曲线的指数追赶尾巴，连续下一跳不再延续上一次的镜头下沉。只对向上的地面台阶/起身保留基于时间的平滑。固定模拟步剩余时间最多投影一个 60 Hz tick，并用原始站/蹲碰撞体的 sweep 限制空中投影，避免穿入地板或天花板；斜坡通过实际接触平面计算步间高度变化，避免 120/144 Hz 下重新出现竖直阶梯感。投影只用于本机相机，武器射线/服务器位置不使用它。
- `public/movement.js` 复用接触查询结果，在判定着地及施加下一次跳跃冲量之前，先把脚底贴合接触面并清除向下速度。保留既有 0.04 单位接触容差、跳跃疲劳、跳蹲抬脚和玩家支撑；修复容差内悬空位置直接继承到下一跳的问题。客户端预测与服务端使用同一实现。
- `hitboxes.mjs` 将动画序列/帧号查询与骨骼/21 命中盒求值拆开。`Game.snapshot()` 用实际玩家对象查询动画，动画 WeakMap 缓存能够在同一 tick 的多个接收者之间复用；生成快照不再触发骨骼求值。真正的命中查询仍按需求值，位置、朝向、混合值及动画变化会使命中盒缓存失效，不跨历史姿态复用。

验证和边界：

- 自动化覆盖站立/按住蹲下的连续轮跳：30/60/120/144 FPS、每秒 10/30/90 个滚轮事件，检查下一跳上升时镜头不反向下沉、空中不能再次制造跳跃、地面/玩家支撑贴地、低天花板/地板限制以及普通跳与 CT 箱子完整路线。
- 原生 GPU 隔离 Chrome + 当前真实客户端 + 离线权威 Game 复用排查场景。普通轮跳 10/30/90 Hz 和按住 Ctrl 的 30 Hz 轮跳四组均检查到至少三次有效起跳，起跳后镜头回沉次数均为 0；本机受控窗口约 60 FPS，无页面错误。这是相机逻辑和本机受控渲染验证，不是实体双机网络帧率承诺。
- 同机相同 10 人状态、一轮给所有接收者生成快照并 JSON 编码的 CPU 探针，平均由约 11.2 ms 降至 1.9 ms；不含网络传输与客户端 GPU。确定性测试另验证同 tick 的十接收者快照只选择十次玩家动画、产生零次命中盒求值。
- 144 Hz 四条斜坡的镜头速度变化诊断均低于 0.16，原图几何、碰撞、纹理及玩法素材没有修改。此前偶发的爆炸压力长帧不混入本轮已确认的轮跳原因，也不据此擅改特效或画质。
- 重跑入口：`npm run test:wheel-jump`、`npm run test:wheel-jump:browser`。浏览器收据位于忽略的 `artifacts/wheel-jump-browser-report.json`。

修改包含共享运动与服务端快照模块，完整试玩需在获准后重启现有 3001 服务；本轮修复和隔离验证没有重启服务、另起游戏端口或推送远端。

本轮最终结果：628 项自动化测试通过、0 失败、0 跳过；原生 GPU 浏览器四组轮跳场景共确认 24 次有效起跳，反向回沉为 0，受控场景约 60 FPS；移动射击与弹痕浏览器 4 项回归通过。检查中没有素材/地图差异，未暂存、提交或推送这些新改动。


## 2026-10-29：坡阶跑动连跳与投掷碰撞二次修复

用户复测指出顿挫主要在坡道/台阶附近，并报告 T 出口往 A 门与小路拐角的弹墙烟落点异常。二次只读排查确认：首轮相机仍只对 Y 做前向投影，XZ 跟随固定物理步；60 Hz 渲染的 16.6/16.8 ms 交替会出现 XZ 的零步/双步。上坡地面平滑欠账在腾空时清空，又把新跳跃速度用于上一物理间隔的余数，单帧身体上升 .1192，相机却上升 .2463。同期原生 GPU 约 60 FPS、帧间隔最大 16.8 ms，因此这处复现主要是相机采样不连续，不是地图几何改变或 GPU 掉帧。

- `public/player-camera.js`、`public/client.js`：每个预测物理步保存完整 XYZ 和眼高，在同一前后步之间统一插值，不再向前推算新跳跃冲量。显示延迟一个 60 Hz 物理步（约 16.7 ms），鼠标朝向仍即时更新。离散上下台阶的高度偏移按物理步消退，起跳和落地保留连续偏移；普通可行走坡面不当作台阶。网络重放同步平移两个保留样本，与既有视觉校正配合；回合、非操作状态和大位移重置相机。相机点到当前实际眼位的 BSP trace 限制穿墙，服务器身体/射线不使用插值位置。
- `grenades.mjs`：参考 ReHLDS `3d88c1ba3c944d87ef47cce4716a726a19a8b646` 的 `SV_Physics_Bounce` / `SV_ClipVelocity`，普通空中撞墙保留切向速度，HE / 闪光、烟雾的法向反弹分别为 .3 / .2。修正既有 .45 通用反弹及每次碰撞误乘切向 .7/.8；加入已落地触碰 .8 摩擦、源速度阈值、地面二次 push、烟雾 .1 秒 think/.95 地面衰减与下一 think 起烟。统一 60 Hz 并保留余数。投出角度/速度、400 source units/s² 烟雾重力和点碰撞不改；放大后的显示模型不影响碰撞。详细来源、60/100 Hz 差异与保留近似见 `docs/grenades-fidelity.md`。
- 回归新增实际渲染 XYZ 诊断，覆盖四条坡道上下行、30/60/120/144 FPS 跑动轮跳、平地固定步零/双步采样、台阶后起跳、网络样本平移和独立烟雾碰撞金值。旧的“身体已上升则相机不得下沉”只比较不同显示时刻，不能单独证明插值连续；现改为同一显示轨迹的速度和连续性检查。

本轮未改变地图/素材，未重启已有 3001 服务，也未提交或推送。完整体验新的服务端投掷物物理需要重启现有服务。

本轮最终验证：完整自动化 **672 通过、0 失败、0 跳过**；原生 Apple M1 Pro / Metal 的真实客户端隔离浏览器 **7 组**通过（平地匀速、跑动轮跳、蹲下起身后轮跳、T/CT 坡道上下行）。平地稳定段渲染停帧为 0，坡道最大向上相机速度为约 7.59 world units/s，未复现旧版约 14.7 的起跳补位尖峰。1280×800 受控窗口约 60 FPS，客户端每帧 CPU 平均 .80–.98 ms，GPU 计时样本 .35–.74 ms；这不是实体多机或所有设备帧率测试。设置/左右手/滚轮/投掷物模型/真实 HE 爆炸的离线客户端集成另 **8 项**通过，无页面错误。收据只保留在忽略的 `artifacts/`。

## 2026-10-29：双闪连续拉环

用户要求携带两颗闪光时，第一颗投出后，在主武器掏出前再按住左键，直接准备第二颗。[社区逆向服务端实现 ReGameDLL_CS 的固定版本 `wpn_flashbang.cpp`](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/wpn_shared/wpn_flashbang.cpp) 的 `PrimaryAttack` / `WeaponIdle` 显示：投出后攻击冷却 .5 秒，还有库存时 idle 期限为 .75 秒；库存耗尽时为 .5 秒。idle 到期前的有效主攻击能再次拉环。

`game.mjs` 允许投出阶段在攻击冷却结束、仍有同类库存时重新进入 pin，重置拉环开始时间和松键锁存；仍按原有 .5 秒准备、按住保持、松开投出的流程消费第二颗。不调用额外的武器部署，也不跳过投出后的冷却。无新攻击则 .75 秒自动回主武器，耗尽则 .5 秒回枪。可靠鼠标边沿、输入丢失保护、切枪/菜单/死亡/回合取消继续生效；冷却前已经松开的短点不会缓存为意外的第二次投掷。

验证入口：`node --test tests/grenade-input.test.mjs tests/weapon-model.test.mjs` 与 `npm run test:double-flash:browser`。浏览器通过真实鼠标按下/松开驱动正式客户端、原模型与离线权威 Game，检查第二次拉环动画和持续保持、中间没有主武器、第二次松开只消费一颗及最后回枪。只使用 IPC，不加入已有房间或启动监听服务。

本轮结果：完整自动化 **686 通过、0 失败、0 跳过**；双闪实际鼠标/正式客户端动画的浏览器集成 **3 项**通过，无页面错误、无外部请求。此前修复已以 `fa873a4` 普通推送到 `origin/main` 并核对远端提交一致；双闪功能初次交付时作为本地修改保留，随后按用户明确要求重启现有 3001 服务供试玩；提交状态以 Git 历史为准。


### 切刀准星与提交验收

`public/client.js` 原先把 `knife` 与 `c4` 一起列入准星隐藏条件，导致切刀时即使已有刀的准星间距配置也不显示。移除刀的隐藏条件；狙击枪、开镜、死亡和购买菜单条件保留。隔离真实客户端检查 **4 项**通过，确认切刀及从开镜 AWP 切刀可恢复准星，手枪/狙击枪/死亡显示规则正常；仅在忽略的 `artifacts/` 保留本地收据。本项只改前端静态模块，刷新即可生效。

用户授权提交推送前，完整自动化复跑为 **686 通过、0 失败、0 跳过**，并检查双闪 **3 项**及准星 **4 项**浏览器验证收据。参考 ReGameDLL_CS 属于社区逆向还原的服务端游戏模块，含社区修复和扩展，不是 Valve 官方客户端源码，也不据此声称零售客户端完整一致。素材、凭据、依赖与本地收据不纳入提交，提交推送不重启现有服务。

## 2026-10-29：命中反馈与本机/远端移动显示

用户确认本机移动视角和其他玩家的显示都有不顺畅的感觉，同时命中对方缺少直观反馈。本轮处理服务器确认的命中特效/声音、输入包发送时机、人物动作分层及循环帧接缝。

- 命中参考社区逆向服务端 [ReGameDLL_CS `TraceAttack` / `Pain`](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/player.cpp)：区分未覆盖部位的血花、头盔火花和护甲受击声。`shot.hitImpact` 只由服务器实际射线、伤害/护甲结果或盾牌阻挡生成，携带目标、命中点、方向和相对脚底偏移，不包含伤害量或生命值。未命中、关闭友伤的同队命中不生成伤害效果。客户端按实际显示的远端位置定位瞬时效果，使用血肉/头盔/防弹衣 WAV 空间音效；挨打者保留原来的私有受击音与屏幕反馈。
- `public/player-hit-effects.js` 为独立程序生成纹理，最多 256 个瞬时粒子、64 个附近表面血迹、一个延迟创建的 instanced 绘制批次。血迹只使用服务器 BSP trace 命中的附近表面；重复弹丸对同一目标每枪合并一次反馈，回合清理并有固定寿命。灰色护甲碎屑是本项目为可辨识性增加的简化表现；不声称原版贴图、粒子或声音衰减逐像素一致。
- 本机输入原先在渲染帧中再用 `now-lastInputPacket >= 1000/60` 限流，16.6/16.7 ms 交替会推迟已经生成的物理命令。现改为有新物理命令的帧立即发送，空帧保留有界重发；固定 60 Hz 权威模拟、冗余历史与可靠按键边沿继续使用。验证逐帧检查每个产生输入的帧都有覆盖该序号的发送记录，而不是把零步/双步帧误算为独立网络包。
- 远端动作参考 Valve 官方 [Half-Life SDK Studio renderer](https://github.com/ValveSoftware/halflife/blob/master/cl_dll/StudioModelRenderer.cpp) 的下半身 gait 分层原则。地面腿部由实际移动距离推进，倒退时反向，空中由起跳经过时间推进；上半身保留瞄准/射击/换弹，并播放短暂原模型受击动作。修复移动开枪时整套姿势替换腿部步行，以及循环动画跨最后一帧时的停顿。显示与骨骼命中盒共用求值，历史命中记录同步保留步态状态。完整身体朝向、动态 controller 与零售客户端过渡仍有近似边界。

验证：完整自动化 **698 通过、0 失败、0 跳过**；真实键鼠/正式客户端的命中与移动集成 **5 项**、原生 GPU 坡阶/起身/连续轮跳 **7 组**通过，无页面错误。双离线玩家场景在 Apple M1 Pro / Metal、1280×800 下约 **60 FPS**，客户端 CPU 平均约 **1.00 ms**，其中动画约 **0.25 ms**，GPU 计时样本约 **0.48 ms**。单独九个远端动画人物的渲染夹具约 **60 FPS**，CPU 平均 **1.91 ms**、动画 **1.21 ms**、GPU 样本 **0.52 ms**，74 个绘制调用。CPU、GPU 与浏览器帧率分别计量；不是实体多机验收或所有设备的帧率保证。

入口：`npm run test:player-feedback`、`npm run test:wheel-jump:browser`。截图与测试收据只在忽略的 `artifacts/`。本轮没有修改地图/素材；初次交付时没有提交、推送或重启已有 3001 服务，随后按用户明确要求重启以加载新的服务器命中事件和步态元数据。


## 2026-10-29：第三人称跑姿、持枪与切枪纠正

用户指出其他玩家的全身动作异常。上一轮修改了动作组合与步态，没有替换模型/动作资源。本轮核实运行中的 3001 进程仍是此前实例，未加载上一轮新服务端元数据，因此不能将现有姿势问题全部归因于新步态。此前的连续性/命中盒一致性测试不能替代姿态正确性的视觉验收。

已定位并修正：

- 原有九组持枪姿势的参数轴用反：俯仰用了横向扭身轴。CS16Client 社区客户端固定参考为 `a238ef131803ed7592c4ba701499027c862889ee` 的 [`GameStudioModelRenderer.cpp`](https://github.com/FWGS/cs16-client/blob/a238ef131803ed7592c4ba701499027c862889ee/cl_dll/GameStudioModelRenderer.cpp)。源码的 `CalculatePitchBlend` 写第二混合轴，`CalculateYawBlend` 写第一轴；本地原模型九组姿势方向也确认了这一点。修复后抬枪/压枪沿纵向，扭身沿横向；手工 blendX/Y 检视仍可使用。
- 增加移动腿部朝向与逻辑瞄准朝向的配合：横移按速度选择 gait yaw，上半身按相对瞄准角补偿；倒退超过 120° 时反转步态，站立时身体缓慢追随视角。客户端显示、原始骨骼命中与历史记录使用同一方向。
- 切枪增加 .2 秒上半身姿势过渡，移动腿部继续推进；保留历史起始动作/帧及过渡时间。第三人称武器资源在新模型就绪后再替换旧模型，避免异步加载造成短暂空手。没有修改第三人称原始模型、骨骼、动作轨道、贴图或地图。

完整自动化 **702 通过、0 失败、0 跳过**；实际原模型九组中性场景姿态及旧轴对照已检查，正式客户端命中/移动/动画压力 **5 项**回归通过。中性场景用于检查方向与姿态，不代表实体多机或零售客户端完整复刻。可视收据为忽略的 `artifacts/player-poses-before.png`、`player-poses-after.png` 及对应 JSON。初次交付时未自动重启、提交或推送；随后按用户要求重启，加载新的动作元数据供试玩。


### 局域网访问配置与停服提交核验

仅本机试玩时，服务以 `HOST=127.0.0.1 PORT=3001 npm start` 启动，TCP/UDP 只监听回环地址，其他电脑不能通过主机的局域网 IP 接入。用户明确要求邀请朋友联机后，停止原实例并以 `HOST=0.0.0.0 PORT=3001 npm start` 启动同一个最新版本；TCP/UDP 均监听所有本机 IPv4 接口，供可信局域网设备通过 `https://<主机当前局域网IP>:3001` 访问，同时保留 localhost 访问。本次配置没有修改防火墙或设置公网转发；仅改变 URL 不会改变监听范围。

最终按用户要求停止服务，确认 3001 TCP/UDP 均无监听后进行提交。提交前远端 main 无新增提交，完整自动化再次 **702 通过、0 失败、0 跳过**；复核命中/移动 **5 项**、中性姿态 **9 组**与轮跳 **7 组**已有隔离浏览器收据。只纳入本轮代码、测试和文档，素材与本地收据继续隔离；提交推送后保持停服。

## 2026-10-30：手感审查后的第一批修复与回归

以 `d88f11b` 为基线，先修复输入、开火呈现和历史俯仰五项问题。移动物理、连续跳跃疲劳参数以及相机一个物理步的插值延迟留到试玩后再逐项校准；本批没有更换地图、模型或动作资源。

- `controls.js` 的实时输入改为当前轴向/朝向加有界按钮按下锁存。滚轮只保留一个待采样跳跃，不再将整份旧输入压入 FIFO；按下、松开、短点射及快速重按仍有对应的模拟步。原有 `queueJumpPulse` 只保留给显式物理测试，不再参与真实客户端输入。
- `gun-state.js` 供服务端和客户端副本共用既有开火状态转换。`shot-feedback.js` 重放未确认命令，并使用该命令的本地预测位置、速度、空中/下蹲状态。服务器为每次出生分配后坐力种子；同一枪的随机后坐力由双方独立计算，弹道散布、射线、命中与实际库存仍只由服务器决定。自定义随机数的旧测试夹具保持兼容。本项目的后坐力随机流并非 GoldSrc 原始共享随机算法，不能据此声称数值已完全复刻零售客户端。
- 本地声音、镜头反冲、枪身动作和枪口火光共用一次呈现。模型使用本地时间和逐枪 token；事件先到、状态先到以及霰弹重复事件均不重播同一枪。服务端事件不再把已经恢复中的本地镜头反冲直接写回旧峰值。菜单取消、被拒绝的预测、死亡、切枪与回合切换保留状态校正，并避免加入已有对局时播放历史枪声。
- 历史命中盒现在与画面一样插值 `pitch`。回归将两帧之间的实际显示姿势与历史姿势送入原始骨骼命中盒计算，逐个核对逆矩阵；没有修改回溯时限或命中伤害。
- 枪口火光改为时间脉冲，并保证新一枪至少呈现一帧，避免旧逻辑在 30 FPS 首帧先衰减后直接隐藏。帧率诊断新增 P99、最大帧间隔及最慢 1% 帧平均间隔换算的 FPS，仍为 240 帧有界窗口。

验证结果：

- 修改前完整自动化 **746 通过**；最终 **789 通过、0 失败、0 跳过**。新增覆盖 24 种枪延迟确认下的移动/起跳/下蹲、连发与半自动射击、后坐力和弹量一致性、状态/事件乱序、取消与拒绝、枪身去重、低帧率火光、输入锁存及历史骨骼一致性。
- `npm run test:feel:browser`：真实客户端、原生 Chrome、离线 Game 与 IPC。模拟 DOM 滚轮 90 Hz 时，开火命令按下至发送由基线单次约 **139.9 ms** 降至最终单次 **13.1 ms**；首条开火命令使用最新瞄准。最终各场景松键至发送为 **2.4–8.6 ms**。人为扣住返回确认 220 ms 时，枪身开火动作由约 **245.9 ms** 提前至 **15.1 ms**，火光在确认前可见，确认不重播模型。这些数值受采样相位影响，属于浏览器合成事件实验，不是实体鼠标到屏幕延迟。
- 原生浏览器双闪光弹回归通过：预测拉环/松开、第二颗继续拉环，以及 180/330/1200/3000 ms 输入丢失期间保持动作；平地及 T/CT 斜坡上下行的 **7 组**轮跳通过；血花、头盔/护甲声音、输入发送与移动射击等 **5 项**回归通过；第三人称 **9 组**持枪、跑姿和切枪场景通过并检查截图。
- Apple M1 Pro、1280×800、原生 GPU、一个本地视角加九个远端动画角色的同类渲染压力场景：基线及本批均约 **60.00 FPS**；本批 P99/最大帧间隔均约 **16.8 ms**，1% Low 约 **59.52 FPS**。CPU 平均从 **1.87 ms** 增至 **2.06 ms**，增加约 **0.20 ms**；CPU 动画约 **1.21 ms**，GPU 最后一次采样约 **0.50 ms**（基线约 0.53 ms，非全程 GPU 均值）。绘制调用/三角形保持 **74 / 25,765**。当前未见掉帧，但记录了新增预测的 CPU 开销；没有把渲染角色压力测试当成实体多人或高刷新率联机验收。

浏览器收据位于忽略的 `artifacts/`，基线实验保存在 `/tmp/cscs-feel-iteration/`，不纳入提交。交付时保持 3001 服务停止，未自动提交或推送。

### 同步远端音频更新与运行验证

本地 main 快进到 `004c532`，纳入 `a8df0f4` 的事件/空间音频及随后补充的声音资源。此前未提交的手感修复先做文件备份并临时保存，再恢复；`game.mjs` 与 `public/client.js` 的内容冲突已人工整合。保留新的空仓音效、音频路由、移动声音、设置与电台，同时继续使用共用开火转换、当前输入采样、枪械呈现去重及历史俯仰修复。预测枪声保留 Glock 连发模式选择；权威声音和命中粒子不重复播放命中声。

远端更新删除了素材忽略项，本地按开发约定恢复 `/public/assets/` 与 `/public/map-data.js` 的隔离；已在远端历史中的声音文件不改写、不移除。本地原有同路径声音与旧清单在更新前另行备份。

整合后完整自动化 **828 通过、0 失败、0 跳过**；原生浏览器滚轮/射击呈现回归通过，实际 WS 音频联调 **6 项**通过（316 个 WAV 无缺失），实际 HTTP/3 WebTransport/WSS 回退与故障恢复 **8 项**通过。音频及传输脚本含软件渲染，不用于推导 GPU/FPS 性能。随后使用 `HOST=127.0.0.1 PORT=3001 npm start` 短暂启动正式入口，以原生 GPU Chrome 实际进入地图、捕获鼠标、移动、开火、播放声音及打开菜单，确认使用 WebTransport、收到输入 ACK、预测枪声去重，无浏览器异常或缺失素材。验证后关闭服务；没有提交或推送本地改动。

## 2026-10-30：墙面碎屑、HE 视觉与统一购买菜单

- 墙面命中保留弹孔，同时增加六块按表面法线向外崩出的原创四面体碎屑，带旋转、重力下落与末段收缩；按木材、金属、玻璃及普通墙面染色。原尘点从约 .16 秒延长至 .24 秒并略放大，碎屑最长 .62 秒；192 个实例共用一个额外绘制批次，楼板/斜坡用撞击面解析距离防止回穿，不逐粒做 BSP trace。命中人物、盾牌、空气及天空不会产生墙面碎屑。方向参考公开 Valve HLSDK 的 [`EV_HLDM_GunshotDecalTrace`](https://github.com/ValveSoftware/halflife/blob/master/cl_dll/ev_hldm.cpp#L245) 同时调用撞击粒子与弹孔的组合方式；本实现使用程序几何，不声称复刻原引擎粒子算法。
- HE 火光、烟团尺寸乘以 1.7，扩大碎星散射，火光在烟团之后做加色混合，避免爆心被灰烟覆盖。仍复用原来的三种批次、16 次爆炸上限及两秒生命周期；本轮只改客户端呈现，不改手雷的伤害、作用范围、引信和轨迹。
- 购买菜单改为装备/投掷物、手枪、冲锋枪/重型、步枪、狙击步枪五列。1280×800 下完整显示 24 支枪与 8 件装备；窄屏在同一菜单内滚动，不再切分类。使用原创 SVG 类型轮廓辅助辨认，保留价格、阵营、库存、动态护甲报价及购买区/时间/资金/携带上限规则。物品按钮在快照更新时保持同一 DOM 节点；连续点击不同物品不再被原有全局 180 ms 门槛吞掉，实际资金与库存仍只由服务器更新。

完整自动化 **831 通过、0 失败、0 跳过**；购买菜单隔离页面与真实客户端回归通过（32 个物品同屏、三件不同装备立即连续购买、服务端金额确认、按钮稳定、阵营/库存限制、760×560 无横向溢出及返回游戏）；实际双浏览器/临时回环服务器的地图、购买、移动、跳跃、连射、换弹与退出回归通过。特效浏览器实景与截图检查通过，包含持久弹孔、运动中的碎屑、1200 次命中压力、回合清理及放大的 HE 火光/烟团。设置/菜单另有 **10 项**实际服务回归通过；该旧脚本仍按早期 .002 灵敏度和旧开镜倍率断言，本轮将其修正为既有的 .001 基准及 FOV 比例，游戏灵敏度代码没有修改。

Apple M1 Pro、1280×800 原生 GPU 单地图/单视角的合成视觉压力：每秒 20 次墙面命中、每 .9 秒一次 HE，基准与压力场景均约 **60.00 FPS**，P99/最大帧间隔约 **16.8 ms**、1% Low 约 **59.52 FPS**；CPU 平均从 **1.40 ms** 至 **1.42 ms**。GPU 最后一次采样从约 **.55 ms** 至 **.94 ms**，非全程均值；绘制从 **44** 到 **53** 次，符合最多九个额外批次（四种弹孔、尘点、碎屑、三种爆炸粒子）。这不是实体多机或所有硬件的帧率保证。菜单/原生特效收据在忽略的 `artifacts/` 中，不提交素材截图。3001 原有服务保持运行；本批为客户端更新，刷新页面即可加载。

随后按试玩反馈增强掉渣：每枪由六块增为八块，其中两块更大、更亮，其余六块提供较小的飞散碎片；提高崩出速度和切向散开幅度。尘点从四团增至五团，体积、亮度、不透明度提升，持续 .32 秒；碎屑最长 .8 秒。尘点/碎屑池仍为 128/192，几何与绘制批次数不增加。相关 **11 项**单元测试及原生 GPU 实景、单发约六米命中、连续特效压力回归通过，无浏览器异常；本机压力仍约 **60.00 FPS**，P99 约 **16.8 ms**，CPU 帧均值约 **1.55 ms**，GPU 最后采样约 **.83 ms**，压力绘制仍 **53** 次。离线视效夹具补齐移动 ACK，并在枪模完成首次渲染后采样，避免无回包填满输入队列或模型异步加载干扰回归判断；生产移动、射击及命中规则没有修改。单发截图收据为忽略的 `artifacts/shot-effects-single-impact.png`。

## 2026-10-30：主战武器恢复、横向限幅与镜头同步

用户限定本轮为六把步枪（AK、M4、AUG、SG552、Galil、FAMAS）、五把冲锋枪（MAC-10、MP5、TMP、UMP45、P90）及 AWP，并明确选择保留当前修正版浮点精度。自动精度公式与各枪基础散布、射速、伤害、穿透、反冲参数表、随机种子体系均保留。连狙、霰弹、Scout、M249 与手枪的既有轨迹和恢复行为暂不调整，后续不得将本节扩大解释为全武器原版复刻。

- 指定步枪/冲锋枪在成功开火后记录待释放状态，实际松键时将连射计数最多压到 15，并从该次松键开始等待 .4 秒；随后按参考每次到期只减一发，再等待 .0225 秒。计数归零时按用户所选 FIXES 分支恢复基础精度。计时使用 float32 与严格到期比较，避免边界帧与独立 C++ 参考不一致。服务器没有收到新命令而生成的中性空步不当作扳机松开，明确菜单取消仍能正常启动恢复。
- 指定自动枪按反冲当前运动方向执行横向上限，避免跳起扫射后落地/蹲下时，把反方向残留值突然夹回更小的新上限。没有改动已核对相符的 48 组 KickBack 参数。
- 上述枪与 AWP 的镜头直接采样预测弹道反冲，并用同一回正公式计算不足一物理步的时间余量，移除额外低通滤波拖尾。模拟状态不被显示采样修改；AWP 已正确的站立/蹲下/移动/空中散布、不开镜惩罚、冷却及切枪后的手动开镜要求保留。
- 快照标记 `ballisticsVersion=1`，供客户端选择同一套规则；未提供标记的旧服务端继续使用版本零路径。这使当前 3001 尚未重启时，刷新客户端也不会误用新版恢复和镜头规则。独立的短暂测试服务均已关闭，现有服务未重启，修复尚未提交/推送。

验证基线为修改前完整 **831 项**通过；本批完整 **880 项**通过，新增 **49 项**测试包括固定 ReGameDLL_CS `4a50c42e85fd3778c2b7d24731c7d30c83bbab01`、`REGAMEDLL_FIXES` 分支的 **111 组**独立 C++ 开火数值、**71 个**实际 C++ 恢复计时状态对十一把枪的检查，以及旧服务端兼容、断包不制造松键、打空自动换弹、浮点帧镜头采样和排除枪型保护。数值期望仅保存原创测试输入与数学输出，外围引擎接口为测试替身，没有提交参考源码或原版素材。另将本轮修改前的十二把排除枪型在 **48 组**场景的持枪、空中、持续射击及停火数值与修改后逐项比较，一致。

原生 Chrome、实际客户端与离线权威 Game 的回归通过：滚轮输入/开火确认去重保留；AK、M4、MP5、P90、FAMAS 连射后释放封顶、恢复归零、显示与预测反冲一致；FAMAS 松键后仍完成三连发；AWP 开镜射击、镜头归零、切到手枪再切回后的手动开镜均正常。实际 HTTP/3 WebTransport/WSS 回退 **8 项**回归通过，包含 300 ms 数据报中断恢复、1.25 秒投掷物数据报中断及可靠菜单取消。传输测试使用软件渲染，不用于宣称 GPU 帧率；本批没有新增模型、材质或绘制批次，也未进行实体多人手感验收。

## 2026-10-30：P2 第一批——枪口焰、命中层次与首次使用开销

本批限定客户端表现与资源准备。`game.mjs`、`weapons.js`、`weapon-feel.js`、`movement.js`、`gun-state.js`、`shot-feedback.js`、`ballistics.mjs`、`inventory.mjs` 的文件散列与本批开始前一致；客户端预测、移动、镜头反冲采样代码块也逐字一致。保留此前用户选择的浮点精度与主战武器恢复规则，不调整伤害、命中判定、射击节拍或角色动作状态机。

- 枪口焰从统一球体改为原创程序化四格纹理图集、一个透明平面绘制批次。步枪为较大的八向闪光，冲锋枪更紧凑，AWP 更大，M4/USP 消音时缩小并降低亮度；逐枪 token 决定旋转，不消耗弹道随机流。仍使用原模型 attachment 0 和原有前景深度通道，支持左右手，透明双面使用单次绘制。脉冲分别为步枪 32、冲锋枪 24、AWP 40、消音 16 ms，延续低帧率至少一帧的保证；没有加入曳光弹、额外镜头震动或动态灯光。
- 人物命中仍只由权威事件的 effect、hitgroup 和有效目标触发，并保留逐枪/逐目标去重。主要武器身体血花实例数按冲锋枪/步枪/AWP 分为 8/12/18，无遮蔽头部再增加四个；同时区分尺寸、扩散与短暂持续时间。护甲使用灰色碎屑，头盔使用较亮火花，盾牌保留通用跳弹样式；其余低频枪保留通用血肉/护具配置。总池仍为 256 个瞬态粒子加 64 个血迹，一个实例化批次，无血量或伤害数字泄漏。
- 增加最佳努力的空闲预热：优先提前构建、异步编译常用特效并初始化纹理，再准备当前枪模。预热队列最多 64 个任务、每次回调按约 4 ms 处理预算协作让出；单个驱动调用并不承诺硬实时上限。进入操作状态即停止排入下一项，预热不作为捕获鼠标或开枪的等待条件，失败只记录诊断并保留正常首次渲染路径。失效枪模任务会清理，模型缓存仍最多四个，不引入全武器常驻。枪模校验改为直接遍历原数组，避免将位置/法线/UV 等大数组合并后再校验；原始模型数据和校验要求保留。

新鲜浏览器上下文、Apple M1 Pro 原生 GPU、1280×800、本地客户端与离线 Game 的单次前后测量：首发墙面射击的 CPU 帧峰值约 **12.7 → 6.3 ms**，首次人物命中约 **4.1 → 2.4 ms**；重复射击约 **1.4–1.6 ms**。GPU 计时按查询归属阶段记录，帧间隔最大约 **16.8 ms**。本机没有在首次切枪阶段复现掉帧，存在模型加载等待，不能把观察窗口总时长解释为加载耗时。初始页面加载仍观察到较长任务，不据此声称所有启动卡顿或所有设备均已解决；该测量也不是操作系统/驱动完全冷缓存或实体多人实验。

修改前完整 **880 项**通过，修改后完整 **888 项**通过。新增八项覆盖枪口焰种类/消音、30/60/144 FPS 脉冲、权威命中分层及池上限、低频枪通用样式、预热暂停/去重/失效/溢出/失败处理。P2 原生场景确认了枪型与部位层次、缓存上限及预热无错误，另检查了真实枪模上正常开火首帧的原始枪口位置和左右手显示。截图读回仅在不计时的视觉阶段执行，生产循环没有加入像素读回或 `gl.finish()`。

此前修复的主战武器/滚轮输入/确认去重回归、七组平地和斜坡轮跳、双闪光弹与长按缺包、五项人物命中/移动/步态回归均通过。九个远端动画角色的原生渲染压力场景约 **60 FPS**、CPU 帧均值约 **1.96 ms**、GPU 最后一次采样约 **.50 ms**、绘制 **74 次**；GPU 点采样不等于全程均值，也不代表物理多机性能。

`npm run test:p2:presentation` 可复测；`artifacts/p2-presentation-before.json`、`after.json`、`visual.json`、`p2-muzzle-flashes.png`（放大示意）及真实枪模/命中截图均为忽略的本地收据，不提交素材。当前 3001 服务未重启，本批客户端文件刷新即可加载；代码未提交、未推送。

## 2026-10-30：P2 第二批——AWP 镜头响应、连续受击动作与积压快照

本批只处理确认到的三处问题，不扩大成完整 P2 或 CS 客户端一比一复刻。与本批开始前比较，`weapons.js`、`weapon-feel.js`、`movement.js`、`gun-state.js`、`prediction.js`、`snapshot-buffer.js`、`hitboxes.mjs`、`inventory.mjs`、`ballistics.mjs` 散列一致；客户端固定步长、弹道反冲采样和移动协调算法保留。没有新增模型、纹理、动态灯光或绘制批次。

- AWP 加入独立的本地镜头显示状态：右键开镜/二倍镜/退镜、预测开枪后的退镜，以及有效切枪/换弹/丢枪的退镜即时显示；灵敏度同步取显示中的镜头档位。没有将显示状态写入玩家的真实 zoom、弹药、射击冷却、移动速度或散布状态。服务器通过 `awp-view-v1` 声明支持，仍调用既有武器操作，再用可靠 `scopeAck` 确认实际结果。拒绝操作能回退，晚到确认不覆盖较新快照，同 tick 的旧快照不倒放确认；死亡、回合变化、武器变化和超时清理待定状态。待定控制最多 16 项。未声明协议的旧服务器保留原显示路径；其他带镜枪仍使用其完整原始 FOV 档位。
- AWP 射后切手枪再切回仍需手动开镜。普通射后的自动回镜由权威日程驱动；预测射击被拒绝可恢复之前的开镜显示。显示提速不能解释为服务器开枪、命中或移动也被提前执行。
- 连续受击时，原有 .16 秒受击反应不再每颗子弹都回到第一帧；头部命中可优先替换身体反应，反应结束后的下一次命中仍可正常触发。伤害、击退及受击减速代码未改。动作时相继续同时供显示和历史骨骼碰撞盒使用，没有加入只改画面、使模型与命中区域脱节的平滑层。
- 主客户端每帧开始只处理已收到的最新完整、有序快照。集中到达的过时中间快照不再反复执行移动协调、UI 和角色同步；命中事件、购买结果和可靠操作确认仍即时分发。每次实际到达的时间与字节数单独记录，合并不伪装成网络丢包。只保留一份待处理快照，断线清理；默认连接行为与无网络序号的旧夹具保持即时分发。默认 HOLD、插值边界与物理追赶上限保留，没有启用未经实体弱网验证的位置外推。

修改前 **888 项**自动化通过，修改后 **908 项**通过。新增二十项覆盖镜头三档、冷却连点、拒绝回退、确认/快照乱序、预测射击确认与拒绝、快速切枪、换弹/丢枪、身份/回合/旧服务器、队列上限、其他带镜枪 FOV、实际权威操作结果、快照合并/关闭/到达诊断，以及连续受击动作和共享骨骼碰撞盒。

原生 Chrome / Apple M1 Pro / 1280×800 / 生产客户端与离线权威 Game，在人为加入 **220 ms 单向控制延迟**时：首次开镜、二倍镜与手动退镜从修改前约 **242 / 264 / 264 ms** 降至约 **11 / 14 / 14 ms**；射后退镜从约 **223 ms** 降至 **34 ms**。这是浏览器事件到第一帧画面状态的单次本地实验，不是物理鼠标到屏幕光子的延迟，也不是正式 CS 的计时基准。确认前的真实 zoom 仍未改变；本地开镜灵敏度按 40/90 比例即时生效。350 ms 状态返回暂停后，11 份集中到达的快照合并为最新一份，其余正常到达仍被处理；到达诊断保留全部包。前后帧间隔均约 16.7 ms，未据此声称解决所有弱网停顿或提高所有机器的帧率。

主战枪恢复/反冲/FAMAS 连发/AWP 手动回镜、七组平地/斜坡/台阶轮跳、双闪与长按缺包、五项人物反馈/步态原生浏览器回归通过。九个远端动画角色场景约 **60 FPS**，CPU 帧均值约 **2.00 ms**，GPU 最后采样约 **.51 ms**，绘制仍 **74 次**；CPU 动画、GPU 单次查询和实体多机体验分别看待。实际 QUIC/WSS 回归包含数据报完全中断时的可靠开镜确认、WSS 回退后的开镜确认、300 ms 断包恢复、1.25 秒投掷物断包与可靠菜单取消；传输测试使用软件渲染，不用来报告 GPU 性能。

`npm run test:p2:response` 复测本轮原生场景；可选 `--before` 需通过 `P2_RESPONSE_BASELINE` 指定事先保存的三个旧 public 模块目录。`artifacts/p2-response-before.json`、`p2-response-after.json` 与其余测试收据保持忽略。本轮未改原版素材、未提交/推送、未重启现有 3001 服务；新 AWP 协议和连续受击动作需重启服务器后加载。后续 P2 可继续检查起停、蹲起和落地的动作衔接，不能把本轮的受击反应修复当成这些过渡已全部完成。

## 2026-10-30：P2 第三批——人物起停、蹲起和落地衔接

本批调整第三人称全身动作。`client.js`、`movement.js`、`prediction.js`、`player-camera.js`、`controls.js`、`weapons.js`、`weapon-feel.js`、`weapon-kick.js`、`gun-state.js`、`inventory.mjs`、`ballistics.mjs` 的散列与本批开始前一致。第一人称镜头、输入、速度/加速度/摩擦、碰撞体、跳跃、弹道/后坐力参数与随机流均保留。另将修改前保存的五组实际输入轨迹，以及已提交旧版 Game 与新版 Game 的四组坡道跳跃逐帧比较：**1320 帧**玩家快照在排除新增动作元数据并按实际 JSON 传输规范化后完全一致。

- 原实现按速度阈值直接添加/移除腿部 gait，蹲起直接切换序列和 .9/.45 的模型原点，落地直接从 jump 返回地面姿势。新增独立的 `playerLocomotion`，包含版本号和 duck/move/walk/air/airTime/origin 六个标量。状态在权威固定步之后单独更新，WeakMap 保存内部过渡信息，不写回物理字段。起停名义过渡约 .12/.15 秒，起身约 .12 秒；地面下蹲跟随已有 .4 秒物理视点进度。落地名义 .08 秒，60 Hz 下五步完成，防止原跳跃收腿姿势在接地后停留过久。
- 下半身按站立/蹲姿 idle、距离驱动的 run/walk/crouchrun 和 jump 混合；腿部相位继续由真实行走距离推进。上半身继续使用原始持枪、开枪、换弹、受击与切枪状态，站蹲对应序列按同一动作时间分别取样。仅在对应动作持续时插值其时间，避免换弹中蹲起因为序列名称改变而停一帧，也保留刀/M249 等站蹲 idle 周期不同的源动画。切枪记录原动作时间，原 .2 秒武器切换过渡继续保留。
- 在骨骼局部空间插值位置、用四元数 slerp 插值旋转，最后重建一次层级矩阵；不插值世界矩阵、不缩放人物。局部采样按上下身遮罩裁剪，采样器使用固定键复用，只在需要的过渡分支取样。第三人称武器仍按骨骼名称合并到最终姿势。
- 空中蹲起对原有 18 source units 的 hull 原点变化做模型原点补偿，保持身体中心衔接；角色真实坐标和跳蹲抬脚规则不变。连续跳跃保留上一跳的退出相位，下一跳短暂过渡，避免落地后立刻跳时腿部归零。起身受阻仍保持蹲姿；重生清理旧状态，大位移重置过渡，死亡不跨生命做平滑。
- 渲染、当前骨骼命中盒和历史回溯使用同一合成器及原点规则。快照与回溯插值同一组权威权重/动作时间，发布时只复制有限标量并隔离对象引用。命中追踪/伤害算法未改，过渡期间的骨骼命中位置随新姿势同步变化。未提供或非法的新版描述保留原显示路径，当前旧服务不必因刷新静态文件而误用新姿势。

修改前 **908 项**自动化通过；本批完整 **937 项**通过，零失败、零跳过。新增 **29 项**覆盖状态边界/复制/复位、空中原点补偿、重复起跳、起身受阻、原始稳定姿势端点、射击/换弹/受击的上下身分层、12 个本地人物骨架、骨骼刚性、30/60/144 FPS 同时刻相位一致性、真实渲染骨骼与历史命中盒跨站蹲序列边界的一致性，以及十人快照在真实数据报限额内的乱序分片还原。

原始骨架逐帧采样的切换边界中，最大脚部位移（内部游戏单位）约：起步 **.524 → .094**、停步 **.694 → .057**、起身 **.566 → .061**、落地 **.483 → .219**。这是特定输入轨迹的骨骼连续性指标，不是人物实际移动速度。原生 Chrome 中检查了 16 个原始模型/实际 p_weapon 对比视图；静态对比使用 CPU 骨骼变形和原生 GPU 光栅化，不拿它报告生产帧率。

另在生产客户端、原生 GPU、1280×800 中重放九个远端角色的起停/蹲起/落地/空中蹲起/连续跳跃。与禁用新层的同输入对照相比，各阶段 CPU 帧均值约从 **1.65–2.61 ms** 增至 **1.97–3.07 ms**，最终测量峰值 **4.4 ms**；帧间隔最大 **16.8 ms**，绘制同为 **66 次**，GPU 最后采样约 **.49 ms**。原有人物反馈九角色场景另测约 **60 FPS**、CPU 帧均值 **2.29 ms**、绘制 **74 次**。场景与时间窗口不同，不把这两组绘制数混为增减，也不将单次 GPU 查询视作平均 GPU 耗时。上述为本机回放，不代表实体九人网络测试或所有设备的帧率。

主战武器恢复/反冲、FAMAS 连发、AWP 快速切枪后手动开镜回归通过；实际 QUIC/WSS 的十项回归通过，含数据报中断时的开镜可靠确认、300 ms 断包恢复、1.25 秒投掷物断包、菜单取消与 WSS 回退。传输测试使用软件渲染，其结果不用于报告 GPU 帧率。

轮跳首次运行在 T 上坡捕获一次输入确认积压后的回拉：待确认输入约 23 条，协调距离约 .60，单帧水平显示速度超过原阈值；失败收据已保留。该场景没有远端人物，人物动作渲染链路未执行。已提交旧 Game 的同脚本对照通过；新版加到达记录、原始脚本两轮七路线复测均通过，未放宽断言，也未改移动/协调算法。当前不能据此宣称所有确认积压回拉已解决，仍需实体联机观察这类偶发情况。

复测入口为 `npm run test:p2:locomotion` 和 `npm run test:p2:locomotion:performance`，性能脚本可加 `--legacy` 做同轨迹对照。本地 `artifacts/locomotion-transitions.png`、`locomotion-browser-report.json`、`locomotion-performance-before.json` / `after.json` 等收据保持忽略，不提交原始素材或素材截图。现有 3001 服务未重启；新版权威动作状态需重启后体验。本轮代码尚未提交或推送。

## 2026-10-30：受击减速边界——速度门槛与起跳时序

本批按用户限定只修复两处逻辑，保留上一批尚未提交的人物动作衔接。大反应武器分类不变：以受击前 `vx/vy/vz` 的总速度作严格 `<300/40` 判断，满足时一起写入 .65 并施加原有击退；等于或超过门槛时保持原有速度和 modifier，不将之前已有的减速清为 1。小反应分支的 .5、伤害、护甲、受击角与受击动作条件保留。数值依据仍为固定 ReGameDLL_CS 版本的 `TakeDamage` / `TakeDamageImpulse`；这次没有把受击角改为叠加。

已处于受击减速状态、并从地面开始起跳的命令，在离地及既有连跳超速限制之前，完成一次**完整命令时长**的减速。碰撞子步只负责细分运动，不重复扣减；即使跳跃被低天花板挡回地面，同一命令也不会再扣一次。普通地面分支保留原时序和原公式；未受击起跳、滞空期间、跳跃高度/疲劳/重力及碰撞逻辑保留。

恢复仍为每个接地物理秒 +.6，速度乘法仍使用 `dt*60`；没有切换成 100 次/秒口径。地面 .5→1 仍为 50 个 60 Hz 步（约 .833 秒），.65→1 仍为 35 步（约 .583 秒）。起跳前补执行原本漏掉的那一次地面命令后，空中仍沿用原有不恢复、不施加地面减速的行为。服务端与预测共用同一移动函数。

快照增加 `hitSlowdownVersion=1`，客户端只有在新服务明确发布后才选择新起跳规则；缺少标记的旧服务设置本地版本 0，继续使用旧路径。节点仍未重启时，刷新静态客户端不会因此与旧服务产生受击起跳规则差异。该标记不改变输入队列/ACK 协议，也不改变 60 Hz 的物理频率。

修改前完整 **937 项**通过，修改后完整 **967 项**通过；新增 **30 项**覆盖水平/斜向/竖直合速度门槛、门槛上下及等于、原有减速的保留、小反应分支、起跳执行次序、完整命令仅执行一次、超速限制、低天花板、滞空、跳跃竖直轨迹、恢复曲线及预测协调。保存的地面恢复样本逐项一致；十组共 **1200 帧**的完整物理轨迹散列一致，包含未受击的平地/转向/蹲跳/四条坡道，以及显式旧服务模式下的受击轮跳。基线只保存项目自身的数值和输入，不包含原始素材或参考源码。

原生 Chrome、生产客户端与离线权威 Game 的受击起跳专项通过：相同初始水平速度 6.25、modifier=.5，首个 60 Hz 起跳命令在新版得到 **3.1875 / .51** 的速度/恢复值，旧服务兼容路径保持 **6.25 / .5**。两种路径的首帧预测位置与权威位置一致，观察窗口中的最大协调距离均为 0。该测试为隔离 IPC 回归，不等于实体网络时延测量。

主战武器恢复/反冲、FAMAS 连发、AWP 快速切枪后的手动开镜、原始七路线轮跳、人物反馈及真实 QUIC/WSS 回归通过。九角色原生 GPU 既有场景约 **60 FPS**，CPU 帧均值约 **2.19 ms**，GPU 最后采样约 **.50 ms**，绘制 **74 次**；传输测试的软渲染结果不用于报告 GPU 帧率。

本批对 `weapons.js`、`weapon-feel.js`、`weapon-kick.js`、`gun-state.js`、`prediction.js`、`player-camera.js`、`controls.js`、既有骨骼/动作分层及命中回溯模块、`inventory.mjs`、`ballistics.mjs` 的散列检查一致。客户端运行代码仅增加规则标记的接收；此前已修的枪口焰、命中反馈及人物动作没有重写。`npm run test:hit-slowdown:browser` 可复测专项；`artifacts/hit-slowdown-browser-report.json` 等收据保持忽略。现有 3001 服务未重启，体验新规则需重启服务并刷新客户端；本批没有提交或推送。

## 2026-10-31：人物首次加载——后台准备与主线程阻塞

本批只调整人物显示资源准备。`game.mjs`、`client.js`、`movement.js`、`prediction.js`、`player-camera.js`、`controls.js`、`weapons.js`、`weapon-feel.js`、`weapon-kick.js`、`gun-state.js`、`weapon-model.js`、`rigid-skinning.js`、`bone-pose.js`、两个人物动作合成模块、`hitboxes.mjs`、`lag-compensation.mjs`、`inventory.mjs`、`ballistics.mjs`、`server.mjs` 共二十个文件与本批开始前散列一致。没有改变射击/移动/命中/后坐力或骨骼求值公式，没有修改原始地图、模型 JSON、PNG 或导入器，也未引入 Wasm。

原人物路径在浏览器主线程同步执行 UTF-8 解码、JSON.parse、完整结构/样本遍历校验与深层冻结。隔离原生浏览器复现新玩家加入时的长任务：首个冷人物约 104 ms，其他冷人物约 91/96 ms，两人同时冷加入约 80/87 ms；对应最大帧间隔约 100/83/83/167 ms，输入命令最大间隔约 119/109/107/183 ms。不能将此前笼统的“解析 100–300 ms”直接当作实测值，卡顿来自整条同步准备链路。

- 默认由一个同源 module Worker 下载人物模型、验证原始转换文件 SHA256、解码/解析、执行原有完整校验并整理数据。原校验函数体逐字保留，仅共享导出名称改变；路径、64 MiB 模型/1 MiB manifest、样本/顶点/三角形/纹理预算与来源规则保留。manifest 仍是主线程的小数据路径。
- Worker 不把整个数值对象图复制回页面。渲染所需的小型描述与八个可转移 ArrayBuffer 一起返回：源动画整数保留 Int16 的原始数值，位置/法线/UV 保留 Float64，骨骼/索引使用无损整数；相同的 legacy tracks 和 blend-0 共享存储。约 14.2/16.1 MB 的人物 JSON 转为约 4.2/5.1 MB 数值缓冲区及小型描述，原文件下载字节没有减少。使用标准 JS Worker 与 [Transferable ArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)，没有更换素材格式或量化动画/几何。
- 主线程按约 3 ms 的协作预算还原原采样器使用的数组结构并冻结容器，跨渲染帧让出执行权。实测整理工作总计约 11–14 ms，分片峰值约 3.0–3.5 ms；预算不是驱动或 GC 的硬实时保证。数值视图仅由私有资源缓存持有，实例的顶点、法线、UV、索引和骨骼矩阵仍独立；不对非空 TypedArray 做无效的 Object.freeze。小型 p_weapon 保留原快速加载路径，避免切枪等待大型人物下载；超过 256 KiB 的预检只转交后台，不降低原有资源上限。
- 准备与还原各只处理一个活动任务，队列最多 32 项，小武器后台任务可优先；缓存仍最多十六个模型准备结果，纹理保留原引用计数。取消/离开/更换人物的旧完成结果仍由原 generation/owner 检查阻止安装。旧失败任务仅删除自己对应的缓存 Promise，避免误删后来相同键的新请求。
- Worker 构造/启动、崩溃、消息错误或超时可以回退到同一套哈希/结构校验与分片还原。Worker 已报告的坏素材不在主线程重新解析，仍显示原来的可诊断占位。Worker 不可用时 JSON.parse 仍有同步开销，不能把该回退计为完全无阻塞路径；实际浏览器强制禁用 Worker 的回退测试确认原始模型正常显示、转换哈希验证为真。

修改前完整 **967 项**自动化通过，修改后 **994 项**通过，零失败/零跳过。新增二十七项覆盖无损缓冲、所有权转移、位置保持/四元数/九混合矩阵一致、畸形目录、路径/字节/UTF8/SHA/原预算、Int16 转换前非法值拒绝、有限队列和优先级、各类 Worker 故障/超时回退、取消与缓存重试、以及小/大武器分流。真实 worker_threads 回归比对了十二个本地人物与二十四把第三人称武器的原始几何和骨骼结果，包含独立可变索引、角色替换/销毁以及实际字节篡改拒绝和随后成功重试；既有人物模块的十八项检查也全部通过。

原生 Chrome / Apple M1 Pro / 1280×800 / 临时回环静态服务与离线权威 Game，持续按住移动和射击，比较相同的五组新实体加入输入。首个远端人物出现前没有创建 Worker，故包含冷 Worker 启动；资源“冷”指新浏览器上下文的模型缓存，不是操作系统/驱动冷启动。结果如下：

| 场景 | 修改前最大帧间隔 | 修改后最大帧间隔 | 修改前/后模型准备等待 |
| --- | ---: | ---: | ---: |
| 首个冷人物 | 99.9 ms | 16.8 ms | 176.6 / 233.5 ms |
| 已缓存人物再加入 | 16.8 ms | 16.8 ms | 32.8 / 30.8 ms |
| 未缓存原始人物 | 83.4 ms | 16.8 ms | 179.7 / 214.7 ms |
| 未缓存自定义人物 | 83.3 ms | 16.8 ms | 190.5 / 230.5 ms |
| 两个冷人物同时加入 | 166.6 ms | 16.8 ms | 269.1 / 333.9 ms |

新路径五个窗口均没有主线程长任务，也没有主线程大于 1 MB 的 JSON.parse；只创建一个 Worker。修改后输入命令最大间隔约 35–37 ms，自动射击持续。可见前的准备等待在冷场景增加约 35–65 ms，这是将同步工作改为后台/协作调度后的取舍，不能据此宣称下载或所有首次可见时间变快。与生产同样的真实 HTTPS 服务也验证了人物使用 Worker，而非静默落入回退。

主战武器、AWP 快速切枪后的手动开镜、原始七路线轮跳、受击起跳/旧服务兼容、人物衔接及真实 QUIC/WSS 回归通过。既有九角色原生 GPU 场景约 60 FPS、CPU 帧均值约 2.26 ms、GPU 最后采样约 .50 ms、绘制仍 74 次。自动化、CPU/GPU、冷加入测量和实体多人验收分别解释；本次不是实体多机认证，也没有解决所有地图启动或 GPU 首次上传瓶颈。

`npm run test:player-loading` 可复测现代 Worker 路径及不可用回退；`--before` 需指定 `PLAYER_LOAD_BASELINE` 为预先保存的旧 player-model.js。本地 `artifacts/player-loading-before.json`、`player-loading-after.json` 与其他收据保持忽略，不提交原始素材或素材截图。只有前端静态资源变更，刷新客户端即可加载；现有 3001 服务未重启，代码未提交/推送。

## 2026-10-31：原计划第 9 项——空中碰撞、台阶与边缘摩擦

本批先固定可复现路径，再修改服务端和预测共用的移动求解。原先先走水平、再走竖直的空中检测，会在脚部正好越过 CT 箱顶时先撞箱侧并清掉水平速度；在低顶拐角则可能把实际侧撞判成顶撞。真实 Dust2 CT 主箱复现：脚部 `(18.85,-.005,-58.8)`、速度 `(-6.25,6,0)`、单步 `1/120` 秒，旧实现水平速度归零，新实现保留 -6.25，脚部升至箱顶之上。节点和原生浏览器都复现了修复前后差别，没有调整地图箱子、人物尺寸或跳跃参数。

规则依据为固定版本的 [PM_FlyMove / PM_WalkMove / PM_Friction](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/pm_shared/pm_shared.cpp)。本批独立实现所需的碰撞规则，没有导入参考 C++ 或替换技术栈；社区代码核对和自动化不等于零售客户端的一比一认证。

- 已在空中的运动以包含重力半步的三维向量统一扫掠，碰撞后继续走剩余时间，保留沿墙面/坡面的速度。最多四轮碰撞、五个面，停止阈值为 .1 source unit/s；两面夹角采用基础 PM_FlyMove 的未归一化交线规则，三面封堵停止。落到可行走坡面后重新确认脚下支撑并接地，防止沿坡投影得到的上升分量误触发一跳。
- 台阶尝试允许部分向上的净空：例如 .3 高的顶上余量足以通过 .2 高的台阶，不再要求完整 .45 高度均畅通。仍比较实际水平进度，超高台阶、低顶起身、96 source units 箱子不可跳越的限制保留；连续坡道的原下坡贴地逻辑保留。平地水平扫掠完全畅通时跳过无效的第二次抬高试走，减少重复检测。
- 接地时增加边缘摩擦：沿速度方向前探 16 source units、向下 34 units，确认为深落差后摩擦乘 2。使用当前站姿/蹲姿的 **body hull**，不是点射线；探测输入由原参考的 hull 中心转换成项目的脚部坐标。已有动态人体重叠在探测中视作支撑，正常移动仍允许分离。普通平地、四条连续坡道、浅台阶和 CT 上箱旁的低箱不会因此提前刹车；真实 96-unit 箱沿与内侧作了对照。起跳后不再扣地面边缘摩擦。

重力、普通地面加速度/摩擦/停止速度、武器跑速、跳跃高度/疲劳/超速限制均未调参；受击减速的速度门槛、完整命令起跳时序及每个接地物理秒 +.6 的恢复保留。修正落坡碰撞后，部分下落动量会投影为坡面切向速度，因此短暂水平速度可高于平地跑速；没有在此处新增平地限速器。原协议丢包测试中“所有帧位移不超过平地跑速”的假设因此不再适用：改为每一帧与**单条合法物理命令**的坐标及三轴速度逐项一致，并断言最多消费一条命令，继续防止重复包、重排与积压造成多步加速。未放宽轮跳的原有镜头速度断言。

快照增加 `collisionVersion=1`。新客户端在旧服务缺少该标记时使用显式版本 0 的原碰撞路径，避免现有服务尚未重启、仅刷新静态文件时预测规则不一致。新服务与新客户端共享同一求解器；输入队列、ACK、协调、镜头插值与 60 Hz 命令频率不变。旧客户端体验新规则仍需刷新。原有十组 1200 帧的轨迹散列继续校验旧服务路径；新版另外对四组共 480 帧的平地跑动/停步/转向/蹲跳校验与旧散列完全一致，原地面受击恢复曲线仍逐项一致。

修改前 **994 项**自动化通过，最终 **1030 项**通过，零失败/零跳过。新增 36 项覆盖空中擦墙、真实 CT 箱沿、低顶拐角、部分净空台阶、深浅边缘/蹲姿、交线与封堵、30/60/120/144 Hz、落坡接地、权威/预测一致和无障碍轨迹。40 个真实出生点、四个方向、每条 180 步，共 **160 条路径 / 28,800 步**的擦墙轮跳与站蹲切换未发现进入实体或非有限速度。既有完整 CT 箱堆跳蹲、四条下坡、轮跳和受击边界检查均保留。

原生 Chrome / Apple M1 Pro / 1280×800 / 离线权威 Game 的 CT 箱沿专项通过：第一条 60 Hz 命令的新旧客户端预测坐标分别与对应服务端精确一致，新版保留 -6.25 水平速度，旧服务兼容保持归零。最终两种路径观察窗口的最大协调距离均为 0；首轮旧路径曾有约 .03，亦在原阈值以内。最终七路线轮跳通过原镜头上升/水平速度与平地无停帧断言。主战武器恢复/反冲、FAMAS 三连发、AWP 快切后手动开镜、受击起跳及旧服务兼容、血液/头盔/护甲命中反馈通过。实际 QUIC/WSS 十二项回归通过，新增验证碰撞标记经过真实数据报分片重组仍为 1；后台人物 Worker 加载、断包恢复、可靠投掷松手和开镜确认等既有检查通过。传输测试使用软件渲染，其结果不用于 FPS 结论。

CPU 离线对照交替重放保存的修改前移动函数和最终函数，七组每组 40×120 条命令，批均耗时的中位数约从 **.031–.086 ms/命令** 变为 **.019–.063 ms/命令**。该统计包含实际新旧碰撞轨迹差异，不能当作单次 trace 的性能或帧率；平地个别批次的 p95 仍有波动。原生九角色既有场景约 **60 FPS**，帧间隔最大 **16.8 ms**，CPU 帧均值约 **2.40 ms**、峰值 **2.90 ms**，绘制仍 **74 次**。GPU 最后采样约 **1.86 ms**，它不是平均 GPU 耗时，也不据单次值与此前记录的差异推断性能变化。这些为本机自动化，不是实体多机验收或所有设备保证。

24 个受保护文件与本批开始前散列一致，包含地图/配置、枪械与反冲、镜头/输入/预测、人物/骨骼/动作合成及资源 Worker、命中回溯/弹道/库存/服务。运行代码仅修改共用碰撞、新求解模块及快照能力标记；没有调整受击恢复时间、额外相机追赶或跳跃疲劳。复测入口为 `node --test tests/movement-collision.test.mjs`、`npm run test:collision:browser`、原七路线 `npm run test:wheel-jump:browser` 与全量测试。CPU/浏览器收据位于被忽略的 `artifacts/collision-*`、`movement-collision-browser-report.json` 等，不提交地图、素材或截图。现有 3001 服务未重启；体验新规则需要重启并刷新客户端。本批尚未提交或推送。

## 2026-10-31：跳后落地——水平疲劳减速校准

本批在上一批尚未提交的箱沿/台阶修复上追加，不覆盖其改动。只读自查发现：原实现将跳跃疲劳乘到加速目标 `wishSpeed`，没有在落地后衰减已经具有的水平动量。依据固定版本 [PM_WalkMove / PM_ReduceTimers / PM_Accelerate](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/pm_shared/pm_shared.cpp)，改为地面普通摩擦与原受击减速之后、重新加速之前衰减当前 `vx/vz`；目标速度恢复为已有武器/步行/蹲姿速度。松开方向键时也会扣疲劳，重新转向与反向加速仍按原规则执行。

水平疲劳比例为 `max(0, 1 - jumpFatigue * .00019) ** (dt * 100)`，以常见 100 Hz / 10 ms 原版命令的参考强度归一化。这个按经过时间换算的方法也见于参考实现可选的 `stamina_restore_rate` 分支；本项目选定 100 的口径，保留现有 60 Hz 命令与碰撞子步。不是每个 120 Hz 子步都扣完整一次，也不试图复制原版不同 FPS 下不同强度的帧依赖行为。

跳跃疲劳仍按每物理秒 -1000 ms 恢复，起跳后仍置 1315.789429 ms，系数 .00019 保留。起跳帧先执行原已修复的完整命令受击减速及超速限制，再离地；离地后不额外执行地面水平疲劳，空中惯性/加速与竖直疲劳规则保留。没有修改受击 modifier 的恢复时间、武器跑速、普通摩擦/加速度、重力、跳跃高度、空中蹲起或镜头插值。实际移动速度改变会按原有规则影响移动散布和距离驱动步态，不代表改写了枪械散布或人物动作公式。

同一个隔离工况：初始 250 source units/s、疲劳剩余 650 ms，平地按住向前，不再次起跳。以下当前项目结果由真实 Dust2 平坦路段的共享移动函数计算；参考为独立的一维 100 Hz 数值模型，不是零售客户端录像。

| 落地后时间 | 修复前移动距离 | 修复后移动距离 | 100 Hz 参考距离 |
| --- | ---: | ---: | ---: |
| .10 秒 | 22.51 | 15.86 | 15.82 |
| .25 秒 | 56.66 | 31.53 | 31.64 |
| .50 秒 | 115.94 | 62.22 | 62.63 |

距离单位均为 source units。半秒末当前速度从 **242.875** 变为 **147.695**，参考约 **148.791**；疲劳计时均为 150 ms。60 Hz 命令在碰撞子步中的离散积分与 100 Hz 参考仍有小量差异，不能称逐帧严格相等。30/60/120/144/240 Hz 更新专项覆盖半秒距离与速度曲线，生产预测仍固定使用 60 Hz。

回归中的两类失败没有通过放宽碰撞或跳跃断言掩盖：

- CT 箱堆原脚本固定蹲走 1.6 秒后立刻跳第二次；校准后落地蹲行较慢，当时尚未接近上层箱沿。现在让脚本通过实际行走到原箱沿再跳，仍要求原主箱/上箱均能到达、全程不进入实体、不瞬移，最多增加两秒接近时间。独立的原起点跳箱、普通跳/跳蹲高度与 96-unit 箱不可越过的断言保留。
- 新速度轨迹暴露两处已有 BSP 浮点边界：近乎平行扫掠的法向位移不超过 1e-9 时，底层 trace 跳过 skin 回退，返回点可能舍入进 solid leaf；擦墙后约 1e-12 的残余速度也可能逐步舍入到实体边界。只在新版玩家扫掠包装中抑制不超过 1e-12 的坐标漂移，并让该极小法向接触从本次安全起点处理后续滑动。未修改地图数据、公共地图 trace、枪弹/投掷物追踪或上一批碰撞求解器。新增两项实际坐标复现；原 160 路线 / 28,800 步的擦墙轮跳检查再次通过。

快照增加 `jumpFatigueVersion=1`，客户端仅在服务明确发布后启用。缺少标记时显式版本 0 保留上一批的疲劳和玩家扫掠路径，避免仅刷新静态客户端与未重启服务产生预测分歧。旧碰撞/受击能力标记各自保留；没有更改输入队列、ACK、协调算法或网络物理频率。新原生浏览器专项验证首帧预测与服务端坐标精确一致：新版半秒 **62.219691**、旧服务兼容 **115.943557**，两种观察窗口的最大协调距离均为 0。

修改前完整 **1030 项**自动化通过，修改后 **1063 项**通过，零失败、零跳过。新增 33 项覆盖参考速度/距离曲线、更新率、松键/转向/蹲走、六类主战武器恢复至原跑速、空中/起跳不扣地面疲劳、竖直及连续跳跃时序、受击恢复独立性、快照/预测及两处精度边界。保存了本批开始前现代碰撞模式的十组共 1200 帧轨迹散列，在旧疲劳模式下完全一致；三组普通平地跑动/停步/转向在新版仍与旧基线完全一致。原受击恢复与起跳边界检查保留。

原生 Chrome / Apple M1 Pro / 1280×800，七路线轮跳的原镜头上升/水平速度及平地无停帧断言通过；主战武器恢复/反冲、FAMAS 三连发、AWP 快切后手动开镜、受击起跳与旧服务兼容、血液/头盔/护甲反馈通过。实际 QUIC/WSS **十三项**回归通过，新增确认疲劳版本标记经过真实数据报分片重组后仍为 1；既有人物后台加载、300 ms 断包恢复、可靠投掷物松手及 AWP 开镜确认检查保留。传输测试使用软件渲染，不用于 FPS 结论。

既有九远端人物原生 GPU 场景约 **60 FPS**，帧间隔最大 **16.8 ms**，CPU 帧均值约 **2.26 ms**、峰值 **2.80 ms**，绘制 **74 次**；GPU 最后采样约 **.51 ms**，不是平均 GPU 耗时。没有据不同运行窗口的数值变化宣称性能提升，也不将本机回放等同实体多机验收。25 个受保护文件与本批开始前散列一致，包括全部枪械/后坐力、地图/配置、镜头/输入/预测、人物骨骼/合成与资源 Worker、命中回溯/弹道/库存/服务及 `movement-collision.js`。

`node --test tests/jump-fatigue.test.mjs`、`npm run test:jump-fatigue:browser` 可复测专项，完整回归仍为 `npm test`。本地 `artifacts/jump-fatigue-*` 等收据保持忽略；数值基线只保存项目自身轨迹的散列，不包含地图、模型、图片或参考源码。现有 3001 服务未重启，体验新规则需要重启服务并刷新客户端。本批没有提交或推送。

## 2026-11-02：跳跃与落地修复验收

用户已在本机体验后确认效果，将上述空中碰撞、箱沿/台阶/边缘摩擦和落地水平疲劳减速作为同一批提交到 main。提交前完整复测 **1063 项**通过，零失败、零跳过。此前开发阶段的测试条件、测量限制及兼容说明保留。

本机 3001 服务已按用户要求重启，真实快照确认 `collisionVersion=1`、`jumpFatigueVersion=1`，HTTPS 与 WebTransport 就绪。本次提交和推送操作不再次重启服务。

## 2026-11-02：第 11／12 项——弱网连续性与长帧恢复

先复现后局部修复：保留合并快照中的显示历史、有界的平地短外推及安全缺口连接、限制恢复播放追赶，并持续恢复同生命的网络校正偏移。服务器每 tick 处理规则、输入重放、弹道/反冲及跳跃/落地公式保留。完整 **1103 项**回归与八组网络专项通过；原枪械、七路线轮跳、受击起跳和疲劳专项通过。原因、前后数据、保守边界与复测入口见 [网络连续性记录](network-continuity-2026-11-02.md)。本批为前端更新，现有服务未重启，代码尚未提交或推送。


## 2026-11-02：受击减速恢复时钟 A/B

原先暂缓的恢复计时已完成独立候选：A 保持每接地秒 +.6，B 按 100 次/秒参考口径恢复为每秒 +1；初值、门槛、击退、`dt*60` 阻尼、起跳顺序和空中规则保留。默认仍为 A，服务器启动参数统一选择，旧服务明确回退 A。候选并非完整 100Hz 运动曲线复刻；来源、计时与实际跑速差异、回退方式及回归边界见 [受击恢复 A/B 记录](hit-recovery-ab-2026-11-02.md)。

当前可选择的 A/B、性能/传输对照与后续顺序统一记录于 [A/B 清单与迭代路线](iteration-roadmap-2026-11-02.md)，避免将兼容分支和测试工具误算为待定玩家实验。


## 2026-11-02：保留 A/B 的大批次——表现、输入、声音与调度优化

用户授权在保留两组 A/B、不选择默认的情况下，继续完成已排期的软件优化。本批基于本地 main `a113782`，开始前 **1301 项**回归通过，结束时 **1380 项**全部通过，零失败、零跳过。代码留在工作区，未提交、未推送；3001 服务未重启。路线和后续验收见 [迭代清单](iteration-roadmap-2026-11-02.md)。

### 保留的数值与实验

本机相机 `baseline/responsive`、房间受击恢复 `baseline/reference100` 各保留两档及原默认，独立入口不变。新增个人表现/输入/音频偏好不替换这两组实验。本批四种组合的射击检查通过；两种相机的受击起跳检查都覆盖两种恢复时钟和旧服务器兼容路径。

弹道、枪械参数、反冲求值、共享移动、输入序号/ACK、位置协调、相机位置求解与命中回溯等 **23 个保护文件**与本批前 SHA256 一致，包括 `game.mjs`、`ballistics.mjs`、`arsenal.js`、`weapons.js`、`weapon-feel.js`、`movement.js`、`prediction.js`、`player-camera.js` 和骨骼求值模块。客户端显示层和调度的修改另有专项测试。没有增加原版素材、依赖或 Wasm。

### 1. 落地、摆动与枪械附加表现

- 硬着陆使用独立的显示侧倾，保留射击 pitch/yaw。固定版本 [ReGameDLL 的 PM_CheckFalling](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/pm_shared/pm_shared.cpp#L2749-L2793) 在有落地音量时写 punch 的 z 轴，不能简单理解为每次普通跳落地都压低视角。本项目选择 **350 source units/s** 门槛、**1.5°** 上限、默认强度 **.25**，25ms 起峰、220ms 结束；这些是保护当前已认可手感的克制设计值，不是逐帧复刻原客户端。普通跳约268、普通跳蹲约317，均不触发。反馈可关；同一次落地的后续预测纠正不重复触发，开菜单/死亡/换回合/大纠正会清理。
- YXZ 欧拉序中的 roll 不改变前向向量，已验证不同 yaw/pitch、反冲和侧倾组合的前向数值一致。实际地图4m落差验证开/关效果与归零；普通轮跳、箱沿和疲劳沿用原测试。
- 枪模摆动提供“当前 / 经典风格 / 关闭”，经典强度可调；**默认当前档的原 sin 数值保留**。可选经典侧倾按侧向速度、接地和强度计算，不写入移动或武器状态。经典档是风格化表现，不称原版 bob/roll 完整复刻。
- 弹壳最多64个、短促枪口烟最多16个，局部排队32、去重256；霰弹枪多粒射线只生成一次弹壳。弹壳使用只读枪模附件与左右手世界矩阵；附件缺失时使用保守位置。每个弹壳只做一次下方地面射线，随后用解析重力、一次反弹/接触和短生命周期更新。接触音使用已有声音，低音量，不增加音频素材。枪口烟约180ms，消音状态抑制，不带可见弹道线。
- 可选本机枪口照明默认关闭，单个35ms共享脉冲，通过已经预编译的材质程序作用于附近表面；不新增动态灯数量或绘制通道。弹壳/短烟默认开启，共两个实例批次，透明短烟使用单次绘制。新程序异步准备，未就绪时跳过附加表现，不等待资源再开枪；编译/纹理准备失败不会阻断主流程。

### 2. 材质命中与显示恢复

`impact-profile.js` 给石面、木头、金属、玻璃、土面不同的碎片形状、颜色、寿命与尘量。金属火花复用原碎片池的发光实例属性，仍使用原来的六个命中网格；单次总粒子数不超过原13个，尘/碎片容量仍为128/192。弹孔大小、四种孔洞、256容量和60秒存续保留。私有表现随机数不消耗弹道 RNG。空闲时不再逐帧扫描全部静态弹孔及未激活粒子。

服务端本就对全部枪械使用公共 punch 衰减，客户端之前只对主战枪直接采样，其他枪又叠了一层 `dt*20` 显示追赶。本批移除这层尾巴，统一采样已有衰减；全部枪械的参数和实际开火反冲保持原值。Glock 原有零 punch 保留。真实客户端补测 Glock、USP、Deagle、M3、Scout、G3SG1 单发恢复；主战连发、FAMAS 和 AWP 的已修路径继续检查。此前后置的低频武器完整弹道重做不与本批混入。

### 3. 鼠标和声音

原始输入为可选项，默认普通相对输入；通过 Pointer Lock 的 `unadjustedMovement` 请求，有明确的接受、旧接口无法确认、不支持后回退、权限失败状态。请求单飞，拒绝权限不反复抢鼠标。输入计数直接使用原值，保持 **.001 rad/count × 现有倍率** 及开镜标尺。菜单可填写 DPI，显示 counts/360° 与按填写值估算的 cm/360°；这些不是物理 DPI 或系统加速度的测量。[Pointer Lock 规范](https://w3c.github.io/pointerlock/) 只是接口依据，实际设备需要另验。

音频保留现有音量、HRTF/立体声模式、原距离衰减和事件去重。满声部时加入距离/音量/分类总线后的可听强度评估，避免远处很轻的声音挤掉前景枪声。监听器位置和方向未变时不重复写 AudioParam。

新增的“隔墙柔化”和“轻微环境尾音”均默认关闭。柔化是静态地图线段的温和近似，阻挡时增益约.62、低通1800Hz，不以可见性决定声音是否存在。共用预算最多每100ms八条射线、128缓存、150ms缓存期限；房间近似最多每秒采样一次。环境尾音为45/90ms的低强度双抽头，只接音效总线，语音/无线电/播报不接尾音。关闭声音、换回合和销毁会清理尾音，DSP 创建失败回退普通声路。这些不是 GoldSrc DSP 或真实声学复刻。

实际 Chrome OfflineAudioContext PCM 检查了声道旋转、距离、HRTF 前后差别、分类总线、柔化后仍有信号、环境尾音确实进入 PCM、语音不串入尾音。耳机听辨和参数偏好仍须真人体验。

### 4. 人物调度和加载回退

视锥调度使用以脚上方1m为中心、半径3m的保守球体。屏外只跳过渲染骨骼、调色板和武器姿态计算，人物位置、动作选择、动作时钟、换枪和逻辑状态继续更新；重新进入视野直接计算当前正确姿态。声音路由和服务端/历史命中盒不受此调度影响。隐藏后重入的真实矩阵与始终计算的角色对照相等。

同一新代码、同一路线、同一设备，将调度开关作为**测试控制变量**，并非新增玩家 A/B。Apple M1 Pro、原生 Chrome/WebGL、1280×800、像素比1、约120Hz回调，240帧窗口：

| 场景 | 调度关闭 CPU均值 / 动画均值 | 调度开启 CPU均值 / 动画均值 | GPU均值（关 / 开） | 绘制（关 / 开） |
| --- | ---: | ---: | ---: | ---: |
| 九人均在视野内 | 1.86 / 1.31 ms | 1.85 / 1.30 ms | .53 / .55 ms | 74 / 74 |
| 同九人在身后 | 1.19 / .65 ms | .66 / .21 ms | .51 / .47 ms | 74 / 48 |

屏内成本基本持平，屏外确有节省。地图本身已有纹理网格与视锥处理；本机 GPU 数据没有显示需要另行重分块或引入 PVS 的瓶颈，因此没有凭假设重写地图可见性。地图/低配设备的后续瓶颈需新证据判断。

正常 Worker 路径继续使用原生 JSON.parse、原校验与打包，性能不变。Worker 不可用的 Window 回退改为有界解码、协作解析、同约束分片校验和无损打包；小字符串和扁平样本数组的原生解析每次最多64KiB，绝不把完整14MB模型交回同步 JSON.parse。每约3ms让步，两片之间仍保证周期性真实渲染机会，支持时使用 [scheduler.yield](https://developer.chrome.com/blog/use-scheduler-yield?hl=en)；不以 Promise 微任务假装让出主线程。取消不发布未完成资源，路径/来源/UTF8/哈希/样本预算保留。

十二种实际模型逐项比对：解析结果和打包缓冲与原生路径**完全一致**。五种动态加入场景（首次冷、缓存、冷原始、冷自定义、同时冷加入）最长帧均约16.8ms，均无主线程大 JSON.parse 或长任务，输入和射击继续。模型准备等待分别约219 / 31 / 228 / 209 / 354ms；这是隔离浏览器资产缓存口径，不是整台机器冷启动。

强制 Worker 故障的实际浏览器验证：14.2MB urban 模型仍验证哈希、正确绘制；最长准备分片 **3.1ms**、还原分片约3ms、69个渲染回调、最大帧间隔 **16.8ms**、无大 JSON.parse 和长任务。另一组同源旧/新回退对照中，旧整段解析约30.3ms，新最长准备分片约3.5ms；旧总等待约.15s，新约1.29s。**回退为响应性支付了额外等待和 CPU 成本**，不能声称加载更快。默认 Worker 路径不受此取舍影响。试验阶段曾观察到“每片等一帧”导致数秒等待及“只用优先任务”造成渲染饥饿，最终版本同时检查准备分片和真实帧间隔，避免只看无长任务就宣布完成。

### 5. 交火预算与回归证据

九个可见人物，加每秒90次脚本远端射击表现和真实本机 M249 持续开火，开启弹壳、烟和本机照明。最终原生窗口 CPU 均值 **2.17ms**、P99 **2.60ms**；GPU均值 **.67ms**、P99 **.73ms**；83次绘制。弹壳64、短烟16、弹孔256、尘128、碎片192上限有效，shader错误为零。平均回调约120FPS，但 P99约10ms、最长约10.3ms、1% Low约98FPS，不能称每帧稳定120或实体144Hz验收。

高刷压力专项验证 GPU压力降分辨率、压力消退恢复、CPU压力保留清晰度、自动缩放不重分配主缓冲；其 GPU/CPU/回调指标分开记录。两种镜头的144Hz提交是合成时钟压力检查，实体120Hz附近的原生回调另列，不能混成真实144Hz结果。

复测入口：

- `npm test`：**1380/1380**；包括原1301项及新功能、解析、调度、DSP失败回退和资源生命周期检查。
- `node tools/verify-cooperative-assets.mjs`：十二个原始/自定义模型解析、校验及打包精确对照。
- `npm run test:player-loading`、`npm run test:player-feedback`、`npm run test:audio:spatial`：实际模型加载、人物重入/交火压力和原生音频。
- `COMBAT_SWEEP=1 npm run test:feel:browser`：原开火响应<40ms断言、主战反冲、AWP切枪手动开镜、六种其他枪、材质、硬着陆开关和原始输入。四组相机/恢复组合通过，最终镜头B/恢复B/全部可选表现再通过。
- 两种相机的七路线轮跳、受击起跳、箱沿碰撞、落地疲劳；两种相机弱网/150与350ms长帧；投掷/连续闪光/粉紫网格；高刷/渲染缓冲专项通过。投掷表现专项的软渲染结果仅作功能验证，不计入前述 GPU数据。

保留一次原生镜头B坡道样本的失败收据：权威位置协调后的追赶使总显示水平速度约8.93，触发原8m/s守卫；当时水平运动约5.25，叠加了已存在的有界纠正。运动、位置相机与协调源码与基线一致，旧源码对照和独立原阈值复跑均通过；最终A/B的144Hz提交和镜头B完整弱网专项也通过。没有放宽原守卫或按该样本改动武器/运动参数，复跑通过仍不替代真实无线/长局验收。

所有截图、模型数据、对照收据继续留在忽略的 `artifacts/` 或临时目录。收尾确认现有3001仍为原PID，健康检查成功，WebTransport就绪、恢复档位仍为 `reference100`；没有自动选择A/B默认、重启、提交或推送。

### 6. 仍需实体条件的验收

物理鼠标DPI/系统加速度、真实144Hz及低配设备、不同耳机的盲听、双机无线/十台实体客户端和长局体验，无法用本机脚本代替。下一步以这些实际证据判断强度、平台差异与 A/B 默认取舍；两档继续保留不会阻碍修复。


## 2026-11-03：头部与身体受击动作延长三分之一

按用户体验反馈，将存活角色的 head_flinch / gut_flinch 窗口由160ms延长到约213.3ms，动作采样速度改为原来的75%，幅度和源序列保留。`hitboxes.mjs` 导出共用 HIT_REACTION，`Game.damage` 的连续命中防重置窗口使用同一时长；头部仍可优先替换身体反应，身体命中不会提前打断头部反应。

显示帧与 playerAnimationTime 同步放慢，历史命中盒使用同一采样节奏，避免只改画面造成命中区域脱节。姿态变化会让命中盒随新姿态同步更新；未更改伤害、散布/反冲、受击减速与恢复、移动、血花/火花寿命或强度。死亡优先级保留，受击结束后换弹/射击继续使用原始动作时间，不增加操作锁定。

增加八项覆盖头/身体持续时间与75%采样、213ms前的连续命中防重置、延长区间的头部优先、显示/历史骨骼一致、死亡与换弹/射击恢复；旧连续受击测试的末次命中移到新窗口之后。专项75项、完整1388项全部通过，零失败/跳过；隔离原生浏览器的血花/头盔/护甲、移动开火、九人物及持续交火压力检查通过，无shader错误。原11个射击、移动、镜头、粒子、动作合成及回溯模块与本轮前散列一致。

仅修改共享受击时序及对应测试，保留前一大批次未提交工作。现有3001服务PID保持25150，未重启；本次服务器动作时序需下一次授权重启后生效。未提交或推送。


## 2026-11-03：提交授权与回归复核

用户已授权将此前本地受击恢复候选、本批表现/输入/声音/调度与加载优化、以及受击动作延长提交并推送main。上文“未提交/未推送”为各批次验证完成时的历史状态；发布结果以main实际提交为准。本次重新检查变更/暂存范围，完整1388项回归通过；未将原版/派生素材、凭据或本地测试收据纳入提交。提交和推送不重启现有3001服务。


## 2026-11-03：AWP 开枪后快切吞弹——输入与武器动作顺序

用户报告 AWP 本机已经开枪，立刻切刀/手枪/投掷物后弹药未扣、目标不受伤。基于 main `032f8ed` 稳定复现：即便 WSS 保证包到达顺序，inputCritical 也只将射击命令放入60Hz队列，随后 equip 却在收包时立即改变当前武器；到模拟开火时，旧 AWP 已被换掉。前端的射击预测只是画面/音效，无法替服务器产生子弹。因此不是弹道飞行途中消失，也不是应该在前端补扣弹药。

修复保持原有一次输入一次物理步：

- hello 用 `weaponActionProtocol=1` 发布能力。新客户端在切枪、丢枪、换弹和副模式请求中携带当前回合、`afterInputSeq` 和最新八条已有未确认输入。原关键边沿仍走可靠通道；重复副本不能覆盖已接收输入，也不会重复开火。旧服务/旧客户端消息保持兼容；修复需要新服务并刷新客户端。
- 同一帧先点击后切枪、而点击尚未采样时，客户端把武器动作保留到原来的固定采样之后，不强造物理步，也不等待服务器ACK再发请求。队列最多16项，菜单、死亡和回合切换会清理。
- 服务端按输入水位执行武器动作，射击命令完成实际扣弹、射线和伤害之后才切枪，再返回真实scopeAck。输入前缀因丢失被跳过时，已满足的旧动作会先于下一条更新的输入执行，避免反过来把新刀/道具的输入解释成AWP开火。仍然每tick最多模拟一条非过期输入，不快进移动或伪造ACK。
- 队列最多16项，水位遵守原128命令窗口，等待遵守原30tick时限；死亡/取消拒绝待执行动作，换回合/离开丢弃旧队列。执行错误由原消息错误通道处理，不带出模拟循环。

保留实际武器冷却、散布/反冲、伤害、移动/跳跃、投掷物拉环和快切后的手动开镜要求。FAMAS三连发快切保留已经射出的首发，只取消尚未发出的后续连发。没有修改 `gun-state.js`、`weapons.js`、`weapon-feel.js`、`movement.js`、`input-protocol.js`、`controls.js`、`awp-view.js`、`shot-feedback.js`、`prediction.js`、`player-camera.js` 或 `inventory.mjs` 的公式和实现。

验证：

- 修复前保存源码对照与原生浏览器六场景均复现：听到/看到预测开火，服务器AWP射击为0，弹药10，目标1000HP。修复后的六场景（切刀、手枪、手雷、同帧切刀/手雷、切回AWP）均为一次实际AWP射击，弹药9，目标886HP，切回不自动开镜。100ms人为保持服务器tick只是暴露原竞态的测试控制，不是物理延迟测量。
- 新增36项覆盖主战步枪/冲锋枪、FAMAS、开火/松手/切枪、可靠副本与丢包缺口、先收副本不被后副本重写、冷却拒绝、取消/死亡/回合清理、队列容量/超时、恶意参数执行错误、原射线/伤害/反冲/冷却精确对照，以及同帧和第二次点击的固定采样顺序。完整 **1424项**全部通过，零失败/跳过。
- 真实Chrome HTTP/3/QUIC：数据报全丢时，可靠开火与切刀仍扣一发并实际伤害，切回保持未开镜；真实WSS回退同样通过。原碰撞/疲劳/恢复版本、人物Worker、移动ACK、丢包/重复/乱序/300ms断流、1250ms手雷松手与菜单取消等合计17项检查通过。传输检查使用软件渲染，不作为GPU/FPS验收。

复测：`node --test tests/weapon-action-order.test.mjs`、`node tests/awp-order-browser.mjs`、`npm run test:webtransport`。原生前后对照的 `--before` 必须显式设置 `AWP_ORDER_BASELINE` 为保存的旧client.js；收据留在忽略目录。本轮未启动/重启3001服务，修改未提交或推送。


## 2026-11-03：移动目标回溯、同 tick 公平性、回合缓存和投掷取消

用户授权修复 review 确认的四项问题，优先处理移动目标判定与先入房优势。以本地已有但未提交的 AWP 输入顺序修复为基线，保存19个相关模块；开始前完整1424项通过。未启动3001，未接入或修改同事主机，不调整武器或玩家数值来补胜率。

### 画面时间随每条命令固定

新增 `rendered-input-view.js`，在场景实际提交之后保存其回合、远端共享播放时间和插值延迟。收到新快照可能先推进缓冲游标，但未提交新场景前不会改写这个已显示时间。固定输入样本保存 `viewTime`、`interpDelayMs`、`viewAgeMs`，可靠关键边沿、数据报重传、武器操作携带的输入副本都使用同一份冻结元数据。短时间产生多个固定样本时也保留它们实际对应的画面，避免在重传或切枪时重新读一个更晚的游标。快照缓冲只新增轻量只读 view getter，插值/外推/平滑公式保留。

服务器以每条命令的元数据为准，兼容旧包级字段；只有 `Game.inputBatch` 真正接收通过的规范化命令才登记回溯时间，非法、旧回合、超窗口和重复包不再污染新登记。首次有效副本保持不可变，后续副本不能重新选择已登记的目标时刻。

校验继续使用服务器测得 RTT、50–160ms插值范围、原60ms未来容差及200ms绝对回溯上限；加入有界的已提交帧龄和固定命令序号年龄，避免正常的长帧和冗余批次因登记较晚而被当成错误时间。帧龄最多200ms，不改变物理时间；快照时钟可能包含测得的下行年龄，验证范围相应覆盖这一不确定性。边界只允许1ns的浮点误差，最终仍夹在精确的200ms范围内，不接受任意位置、速度、伤害或未来模拟步。

### 同 tick 按服务器实际接收顺序结算

每条首次接收的有效输入及排队武器操作获得私有、可信的接收次序，客户端不能指定。每tick仍只取每人一条非过期输入，先按原确定性顺序完成所有角色的一个固定移动步，再在每人的输入/武器操作因果约束内，按服务端接收次序合并结算武器与伤害。后收到的同tick攻击不再因为玩家更早入房而抢先击杀；死亡仍会否决尚未执行的攻击，不默认增加同tick互杀或死亡后补枪。

已确认水位的排队武器操作也在这个固定战斗边界执行，不增加等待ACK的往返。失包前缀被跳过时，旧操作仍先于更新的输入执行；射击后的切枪仍等实际射击结算。未交火移动轨迹保持原样；因 PvP 命中产生的速度变化统一影响下一移动步，避免按实体遍历顺序让部分玩家在本tick已移动、部分却先被减速。受击减速/恢复、跳跃/疲劳、摩擦/加速、武器跑速和所有枪械参数未改。

### 回合隔离和投掷取消

回合单调推进时同时清理历史帧及所有连接的命令视图登记，保留实测 RTT；新回合序号1不会被旧回合缓存挡住。旧回合原始包、非法序号及未被实际接收的命令不参与登记。无论新回合先收到命令还是先保存历史帧，都不再丢掉刚登记的新时间。

后到的手雷拉环/松手意图与已有的排队切枪共用因果队列，按实际执行后回ACK。先切刀再松手不会反过来投出手雷；已实际生成的投掷物不会因切枪回收。收包时预留连续意图序号，执行时再推进确认，取消会退掉待执行序号，避免下一颗手雷被旧序号卡住。明确取消和队列满是安全取消屏障，不必依赖随后那份中性移动包才停手；陈旧actionId不取消另一颗有效手雷。菜单、死亡、回合切换及重复松手都有独立回归。

### 回归与范围

最终完整 **1498项**全部通过，零失败/零跳过，较基线新增74项。包含实际原始骨骼与 snapshotBuffer 的移动头/身体命中、30/60Hz快照的真实侧跑头部骨骼采样、关键包/数据报/武器副本先到的组合、跨回合短/长生命周期、恶意时间/序号/优先级、重复/缺口、同tick先入房与先收包的交叉、排队刀副攻击与枪的竞争、全部三种投掷物及取消/死亡/超时边界。

`tools/verify-fairness-regression.mjs` 必须显式提供本轮前保存的 Game 源码，不伪造基线。与共享的未改移动/枪械/库存模块对照：八个未交火移动场景共 **1920步**完全一致，含平地、蹲起、轮跳、斜坡及玩家接触；24把枪共 **5760步**枪械状态、反冲和无存活目标的真实世界射线完全一致。此对照隔离了有意改变的 PvP 结算相位，不把它当作实际命中率测量。

真实 Chrome 原生 QUIC/WSS、公用生产服务器/连接代码、临时回环端口：八组入房顺序×接收顺序互射、八组移动头部×包先后/重传、八组投掷取消先后，共 **24场景通过**，目标时间误差为0；客户端投掷存量、实际投出数、扣弹和伤害均核实。对战tick人为保持，确保双方输入已到才推进一步；这不是物理鼠标时延或实体局域网胜率认证。

生产客户端原生浏览器六组 AWP 快切仍为一发、弹药9、目标886HP，切回不自动开镜。新增核对可靠开火样本恰好使用上一次已提交场景时间，同序号在批次/切枪副本中的时间、插值和帧龄逐项一致。既有真实QUIC/WSS十七项，包括完全断数据报期间快切、可靠松手、网络连续性、人物Worker与诊断导出通过。

射击/反冲、FAMAS、两种镜头受击起跳、疲劳、箱沿、双闪/拉环、投掷切换及粉紫网格回归通过。高刷CPU/GPU压力分类、主缓冲复用、降分辨率及恢复通过。九可见渲染角色、每秒90次脚本远端射击加本机M249，全部附加表现开启：CPU均值约2.16ms/P99约2.60ms，GPU均值约.67ms/P99约.73ms，83次绘制。约120Hz回调的P99仍约10.3ms，不能称稳定实体144Hz，也不当作九台实体机器吞吐。

轮跳原阈值保留：首轮相机A平地样本出现一次8.917的总显示速度，伴随约.452的位置协调、实际物理速度约5.255；保留失败收据。旧客户端对照、新A独立复跑、新B原生及144Hz提交原断言均通过，未修改预测纠正/相机/移动参数或放宽8的守卫。CPU前后精确轨迹也保持一致；独立复跑不能替代双机无线长局。

复测入口：`npm test`、`node tests/fairness-transport.mjs`、`node tests/awp-order-browser.mjs`、`node tools/verify-fairness-regression.mjs --baseline-game <明确保存的game.mjs>`。服务hello及健康接口增加 `inputViewProtocol=1`、`combatOrderVersion=1`，诊断导出带版本和已显示画面时间，便于核实实际部署。

四项修复及先前 AWP 修复仍在本地工作区，未提交、推送或部署。3001保持关闭，临时测试实例均关闭。应用全部修复需要主机运行新服务、双方刷新；低RTT仍有自然优势，超过原200ms回溯窗口仍有残余误差。后续以同枪同甲、相同设置的“谁当主机×谁先入房”四组合和双端诊断评估，不宣称两人胜率必然变成50%。


## 2026-11-03：AWP与公平性修复发布授权

用户明确授权将AWP快切与四项公平性修复一起提交，并普通推送至远程main。发布前再次完整回归1498项通过，变更仅包含本批源码、测试、工具及文档；素材、凭据和本地收据不纳入提交。上文“未提交/未推送”为各批次实现完成时状态，远端是否同步以实际Git核验结果为准。本次操作不启动或重启服务。主机拉取新提交并重启后，应在健康接口看到 `inputViewProtocol=1`、`combatOrderVersion=1` 及新revision，双方刷新再进行同枪同甲联机对照。


## 2026-11-03：连续 Q 快切误用旧快照

现场只读确认同事主机运行 `40861e5`、两名 QUIC 玩家，提供的 `client.js` 与本地该版本散列一致。健康采样的 tick 间隔没有明显阻塞；这不能代替用户客户端的帧时间测量。未加入、操作或重启其对局。

Q 原先在客户端用 `lastWeapon` 将意图翻译为绝对武器；该缓存只在收到权威快照时更新。原生生产客户端与离线 Game 对照在扣住服务器推进/回包期间复现：两次 Q 发出 `knife, knife`，数字键 3 后马上 Q 发出 `3, knife`，均停在刀上。三组中开枪均扣一发并造成伤害，因此本问题是快切目标失效，不能据此重新认定为吞弹或宣称整幅画面卡帧。

Q 现发送 `equip last`，沿原有输入水位屏障依次执行，服务端在执行时解析上一个武器。上一把已丢弃或投掷耗尽时，携带原客户端的有效历史候选作为回退；仅在相对切换失败后尝试，仍由原有存活、阶段及所有权规则裁决。没有移除开枪先于切枪的保护，没有提前移动模拟、改冷却、弹道、反冲或伤害。

验证：完整 **1507项通过、0失败、0跳过**；新增九项覆盖同水位/跨水位相对快切、数字键接Q、冷却及回镜、耗尽投掷物回退与无效/未持有候选拒绝。原生浏览器三组旧版均复现，修改后三组均回到AWP，扣弹为9、目标由1000降到886、切回不开镜、原冷却保留，逐命令画面时间副本仍一致。原AWP六场景与真实QUIC/WSS公平性二十四场景通过；十五个保护文件与本轮前散列一致，包括移动、弹道、反冲、预测、相机、回溯及武器动作排队。`scope-actions.mjs`仅增加合法历史候选的传递/回退。

复测：`node tests/quick-switch-browser.mjs`；旧版对照须显式指定 `QUICK_SWITCH_BASELINE=/absolute/saved/client.js node tests/quick-switch-browser.mjs --before`。原始收据留在忽略的 `artifacts/` 与临时目录，不提交。

本轮未提交、推送或部署，本机3001保持关闭，对方服务未修改。枪模仍沿用权威快照驱动，本轮没有新增本地切枪预测；更新后需真人确认剩余网络显示时延与操作衔接。


### 连续Q修复的发布授权与复核

用户授权将本轮连续Q快切修复提交并普通推送main。发布前重新获取远端main状态并完整复测，1507项通过、零失败/跳过；提交仅包含本批源码、测试和说明，不包含素材、凭据或原始测试收据。上节“未提交、推送”为实现阶段状态，发布完成以实际Git及远端提交号核验为准。本次不启动或重启服务；同事更新并重启服务后，双方刷新页面，再验证连续QQ、3接Q及AWP扣弹/伤害/手动开镜。


## 2026-11-03：开枪后切刀的本地显示响应

以最新发布 `c482d5e` 为基线。前次连续Q修复保证了相对切换顺序，但枪模仍由权威快照驱动；开枪声音、反冲先在本地呈现，刀模要等输入屏障执行及结果返回，形成先后仰、再掏刀的等待。隔离生产客户端、原生Chrome、离线Game将服务器推进/回包暂停220ms：两组旧版在暂停结束时均仍显示已缓存的AWP，恢复服务器后才显示刀。该实验确认显示依赖，不把它当作实体网络或实际掉帧测量。

本轮增加有界的本地枪/刀显示预测：按键后先选本地模型，服务器仍按原输入屏障先结算子弹，再实际装备武器。显示序号与开镜序号独立；可靠确认和快照水位共同退休预测，防止中间快照重复执行Q。拒绝、死亡、回合、菜单、断线及超时回退保留。显示预测只覆盖枪/刀间切换，投掷物与C4沿用原选择、拉环、松手机制。旧服务未提供 `weaponSwitchViewProtocol=1` 时沿用权威显示；新版hello和健康接口均提供该标记，必须重启主机并刷新客户端后启用。

发出切枪屏障后，后续本地开枪预测不再对旧枪制造连射或FAMAS补发；屏障前那一枪及其反冲继续保留。切回同一枪会开始本地掏枪动作，不等待中间刀快照，也不在确认时重播旧开火动作。显示模型与特效按当前显示武器对应，刀上不挂旧枪口焰。没有更改服务器移动、弹道、后坐力、伤害、冷却或回溯规则，也没有增加模型素材、渲染批次或Wasm。

验证：完整 **1519通过、零失败/跳过**，新增12项覆盖显示不可变性、旧服务兼容、QQ中间快照、ACK先后、拒绝/死亡/回合/超时、工具回退、容量上限、预测枪械屏障与实际扣弹后确认。原生两个响应场景在服务器仍暂停时已显示刀；已缓存刀模的脚本按键到模型安装分别约 **13.4/15.7ms**，保留原40ms守卫。此为本机两次样本，不是物理输入到屏幕或冷缓存指标；冷模型仍走原异步加载流程。连续Q三组、原AWP六组、枪模缓存与粉紫网格17场景及快速异步覆盖检查通过。

真实QUIC/WSS除原24项公平性场景外，新增8组连续Q确认/水位场景，覆盖两种传输、两种入房顺序、同水位与跨水位切换；握手确实启用显示协议，装备确认依次为刀/AWP、弹量9、目标受伤、冷却保留、切回不开镜。14个移动、弹道、枪械、预测协调、相机和回溯保护模块与基线散列一致。CPU/GPU帧率及实体局域网手感未据此推断为全面达标。

复测入口：`node tests/weapon-switch-response-browser.mjs`、`node tests/quick-switch-browser.mjs`、`node tests/awp-order-browser.mjs`、`node tests/fairness-transport.mjs`。响应旧版须显式指定 `SWITCH_RESPONSE_BASELINE=/absolute/saved/client.js node tests/weapon-switch-response-browser.mjs --before`。收据、截图仍留在忽略目录。本轮未提交或推送，未重启现有服务，也未改动同事在线服务；本机3001核对无监听。


### 切枪显示响应修复的发布授权与复核

用户授权本轮本地切枪显示响应修复提交并普通推送main。发布前重新获取远端main并复测，1519项全部通过、零失败/跳过；变更仅包含本批源码、测试及说明，素材、凭据和原始测试收据不纳入提交。上节“未提交或推送”为实现阶段状态，发布完成以实际Git及远端提交号核验为准。本次不重启服务；同事更新后需重启主机，健康接口应提供 `weaponSwitchViewProtocol=1` 与新revision，双方刷新后再体验AWP开枪切刀、QQ与手动开镜。


## 2026-11-03：切刀后反冲重复上扬——命令时钟连续性

用户在已发布 `c23e662` 上确认刀已出现后视角会再抬一次。前轮只读检查已定位：`shot-feedback` 在收到换枪快照时清空全部未确认历史，持刀时又停止预测采样，镜头退回较旧的权威punch。公开参考的切刀部署不清零punch，正常余震应继续按原衰减回正；本轮没有将切刀做成清除后坐力。

业务逻辑仅修改 `public/shot-feedback.js`：换枪时退休旧枪动作，但保留有界的命令时钟；私有历史标记武器，旧枪命令不能在新枪上预测开火。持刀和道具期间也推进残余punch，复用原衰减函数，且不计算枪械散布/地面接触。真实受击造成的新punch仍从权威状态进入，没有用“取前一帧较小值”掩盖新冲击。回合、死亡、菜单取消和历史容量边界保留。

完整 **1535项通过、0失败/跳过**，较本轮前增加16项。覆盖不同待确认长度的切刀/手枪连续性、重复快照、60/120/144/240Hz分数步采样、道具/刀不补发旧枪、新手枪真实按下、受击新冲击、回合/死亡/取消及容量。原24枪延迟确认下枪械状态/反冲/弹量/射速检查继续通过。

原生Chrome、生产客户端、持续推进的离线Game，仅下行交付合成0/60/120ms延迟；每档覆盖切刀、QQ、手枪及不切枪对照，共12组。明确保存的旧模块重现额外上扬，修复版12组均通过原0.05°重复上扬检查，正常初始反冲及回正归零保留；每组均一发AWP、弹量9、目标1000降至886，快切仍手动开镜。逐帧采样放在生产frame提交镜头之后，不把网络回调暂存值当成已绘制角度。服务器持续推进时，第二次Q若已确认开火，可合法不再携带该旧命令；仍检查操作水位不落后开火，且未确认时必须携带可靠副本。

额外回归：切枪显示响应2组、QQ3组、原AWP6组、实际QUIC/WSS32组通过；两种位置镜头各7条平地/坡阶轮跳原守卫通过。18个保护模块散列不变，包含服务器/Game、输入/武器操作屏障、弹道和反冲数值、库存、移动、位置预测/相机、命中回溯及切枪显示。浏览器下行延迟为合成条件，分数步检查不是实体高刷验收，不据此保证所有设备或无线长局表现。

复测入口：`node --test tests/recoil-continuity.test.mjs`、`node tests/recoil-continuity-browser.mjs`；旧模块对照显式指定 `RECOIL_CONTINUITY_BASELINE=/absolute/saved/shot-feedback.js node tests/recoil-continuity-browser.mjs --before`。原始曲线、截图和失败诊断留在忽略目录/临时目录，不提交素材或收据。

本轮未提交或推送，现有本机3001保持原进程；健康检查及静态前端响应与工作区字节比对通过。本次无需服务端更新，刷新本机页面即可体验。两项A/B和默认值保持。


### 2026-11-04：反冲连续性修复的发布授权与复核

用户已体验并认可效果，授权将本轮切刀后额外上扬修复提交并普通推送main。发布前重新获取远端main状态并完整复测，1535项通过、零失败/跳过；提交只包含本批前端模块、两项回归脚本及说明，不纳入素材、凭据或原始测试收据。上节“未提交或推送”为实现阶段记录，发布完成以实际Git及远端提交号核验为准。本次不重启服务；同事更新后刷新页面即可加载本轮前端修复，先前显示协议仍需主机已运行支持 `weaponSwitchViewProtocol=1` 的服务。


## 2026-11-04：AK 原地整梭散布再校准

用户确认场景为原地站立、不压枪、按住左键打完整弹匣。以 `1ddf87a` 为基线，先保存20个相关模块并完整复测1535项通过。继续采用用户已选择的浮点精度口径，未改回非FIXES的整数公式。

核对固定参考 [AK47开火](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/wpn_shared/wpn_ak47.cpp#L68-L159)、[玩家FireBullets3](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/cbase.cpp#L1253-L1275)及同版本util.cpp的共享随机函数。已有精度/后坐力数值与选定口径一致；朝向/仰角坐标基底也通过独立Three矩阵核对，没有修改。确认的差异在散布随机采样：旧版四个独立随机数相加，参考玩家分支使用同一seed及相邻三个seed的共享随机值。玩家分支不进行单位圆拒绝采样，不能套用NPC/霰弹的拒绝分支。

本轮只让AK使用兼容的32位共享散布采样核。JS按数值规则独立实现，数值种子常量注明来源；原参考C++文件不纳入仓库。种子仍从本项目服务端世界随机源产生，不接受客户端指定，且保留每次四次外部随机调用，避免改变回退反冲流的消费顺序。没有重做原版用户命令seed序列或本项目的反冲随机流，其余枪仍使用已验收路径。

独立编译固定参考随机函数，对完整256个seed的XY输出逐个一致；512个little-endian float32值的SHA256为 `13bc010fe6e1b417c648642118abad9a4fe1458287bfbd73a4571310474b5a3f`。标准化随机偏移的均方根由独立分布理论的0.577350提高为参考的0.628498，约+8.86%；单位半径外概率从约2.51%变为12/256=4.6875%，两个轴存在约0.05569的相关性。这里是随机散布核的统计，不能解释为每一梭弹孔宽高固定增加该比例，也没有将散布系数直接乘大。

实际保存旧Game、weapons、gun-state模块的离线对照：24枪5760步的弹量、精度、反冲、射速/冷却、换弹与移动状态逐项一致；23把非AK武器的实际世界射线一致，仅AK随机落点按本轮目标变化。20m分析平面的站立30发轨迹另存于忽略的收据中。原生生产客户端在Dust2约16.56m垂直墙面实测：原地站立、鼠标没有转向/压枪，实际30发、预测30发、弹量0，首/末发散布0.0055/0.034375，整梭射速误差仍小于一tick，弹孔与原枪模正常。

最终完整 **1552项通过、零失败/跳过**，新增17项覆盖全部seed、分布尾部、12组朝向/仰角、随机调用数、AK首次开火和30发浮点精度曲线。主战手感/射击响应、反冲连续性12组、切枪响应2组、QQ3组、AWP6组、实际QUIC/WSS32组及两种镜头各7条轮跳通过。20个保护模块中只有weapons.js变化，其余19个（包括射击预测衔接、移动、相机、服务器结算、武器操作屏障、库存及回溯）散列一致。上述为数值/合成条件与本机浏览器验证，不是零售客户端逐帧对照或实体多人命中率认证。

复测：`npm test`、`node tests/ak-spread-browser.mjs`、`node tools/evaluate-ak-spread.mjs --baseline-dir /absolute/saved-directory`。基线目录必须显式提供原game.mjs、public_weapons.js及public_gun-state.js，不能用当前模块伪造旧版本。参考源码、编译程序、曲线、截图和测试收据保持忽略，不提交原版素材。

本轮未提交/推送，现有服务未重启。本次weapons模块同时用于服务端，需主机重启并刷新客户端后才会加载新的实际AK散布；仅刷新页面不能更新已经运行的Node模块。


## 2026-11-04：AK 射线反冲补齐引擎角度链路

用户授权按完整参考链路校正AK射线，并验证不同距离整梭，保留镜头、移动及既有快切/反冲衔接。本批基线是已体验的AK共享采样工作区（不是Git HEAD的旧独立采样）；先保存22个相关模块，完整1552项通过。上轮随机散布核的约8.86%差异只描述随机偏移，不能证明整梭射线已经对齐。

确认链路：[PM_CheckParameters](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/pm_shared/pm_shared.cpp)将cmd.viewangles与衰减后punch相加；[ReHLDS SV_RunCmd](https://github.com/rehlds/ReHLDS/blob/master/rehlds/engine/sv_user.cpp)回写pmove.angles到pev.v_angle，再运行PlayerPostThink；[AK47Fire](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/wpn_shared/wpn_ak47.cpp)在计算子弹向量时再加punch。原地存活射击的这条路径相当于raw+2*punch。此前项目从raw只加一次，枪械参数通过并没有覆盖这个引擎衔接。

业务逻辑仍只改weapons.js：仅AK的pre-shot射线yaw/pitch补第二份punch。原punch强度、衰减、随机变向、精度公式、射速、弹量和输入角度保留；镜头和移动仍取既有状态。AK合成射线角度按参考直接交给向量变换，不再次套鼠标俯仰上限；镜头输入上限与其他枪原有路径保留。没有把双份反冲写回玩家状态，也没有变更输入/ACK/切枪屏障、命中回溯或显示预测协议。

独立参考验证：在/tmp编译固定版本PM_CheckParameters及共享随机函数，并按所核对的引擎回写/武器加法计算GoldSrc基底，保存60组数值输入输出（含±87°附近、不同yaw、双轴punch和不同帧长）。仓库只存数值夹具及来源/源码SHA，不存参考C++。每例同时检查实际射线与未加倍的camera/player punch。另对32梭960条实际Game射线，把已经衰减的pre-shot状态交给独立C++空间链路，逐条一致，最大方向分量误差约1.32e-7；此空间对照不再次推进衰减时间，也不是完整零售客户端录像。

新旧版本使用相同32梭输入、反冲随机流和散布seed，在垂直于初始朝向的测试平面投影960个落点。样本包络如下（米，最高点相对初始瞄点，非固定的原版尺寸上限）：

| 距离 | 校正前最高点 | 校正后最高点 | 校正前总宽 | 校正后总宽 |
| --- | --- | --- | --- | --- |
| 10m | 1.13 | 1.98 | 1.12 | 1.62 |
| 20m | 2.26 | 3.95 | 2.25 | 3.24 |
| 30m | 3.38 | 5.93 | 3.37 | 4.86 |

真实BSP原生浏览器另取平地站立、中央射线到墙10/20/30m三组站位，原地不压枪各打完整30发：实际/预测均30、弹量0、首末散布与射速保留。测试站位检查射击锥内近障碍，实际命中事件也检查近箱干扰。BSP原墙面可能倾斜或存在顶缘，数值包络统一取前述受控平面，不能把近处箱子或斜墙弹孔当作20m平面测量。

最终完整 **1612项通过、零失败/跳过**；新增60项独立参考角度/射线验证。24枪5760步的反冲/弹量/精度/射速与移动状态一致，23把非AK实际射线一致；主战手感、反冲衔接12组、切刀响应2组、QQ3组、原AWP6组、实际QUIC/WSS32组、两种镜头各7条滚轮跳全部通过。22个保护模块里只有weapons.js改变，其余21个（含client、punch规则、移动、位置相机、服务器结算、采样核、AWP与快切模块）散列一致。CPU逻辑、原生浏览器、参考数值与实体多人/高刷验收分开看待。

复测入口：`node --test tests/ak-ray.test.mjs`、`node tests/ak-ray-browser.mjs`、`node tools/evaluate-ak-ray.mjs --baseline-dir /absolute/saved-ray-baseline`。该基线必须包含真实保存的Game、weapons、gun-state及source-spread模块；采样核与当前相同，才能隔离本次射线改动。原始CPP、曲线、截图和收据保持忽略。

本轮未提交/推送，3001保持本轮开始时的原服务进程；需主机重启、客户端刷新后加载新的实际AK射线。两项A/B及默认值保留，本批只校正AK，不扩大为全武器或零售客户端一比一复刻。

## 2026-11-04 全枪械射线与散布采样扩展

用户已体验并认可上述 AK 校正，随后明确授权覆盖其余所有枪械。本批扩展的是开火前的射线角度传递和散布采样；既定浮点精度、各枪精度系数、反冲状态、恢复、射速、伤害、镜头、移动和快切协议保持现状。

逐一核对固定参考 `4a50c42e85fd3778c2b7d24731c7d30c83bbab01` 的 24 个 `wpn_shared/wpn_*.cpp`：全部枪械均使用 `v_angle + punchangle` 建立开火基向量；公共 `weapons.cpp::FireRemaining` 对 Glock/FAMAS 的后续连发也如此。沿用上节已核验的 PMove → ReHLDS `v_angle` 链路，因此项目全部 24 把枪的世界射线统一使用 raw aim 加两份 **pre-shot punch**，合成后的射线角度不再被鼠标俯仰限制裁切。这个值不写回玩家或镜头，也不把本枪刚产生的 KickBack 加进本枪子弹。

- 22 把单弹丸枪走 `cbase.cpp::FireBullets3` 的玩家共享种子 XY 采样，包括所有步枪、冲锋枪、手枪、狙击枪和 M249。服务器取种子，仍消耗四次外层随机调用，保护既有后备反冲流；共享采样常量和算法与已认可的 AK 完全相同。
- M3/XM1014 按 `FireBuckshots`（原 `FireBullets` 的 buckshot 分支同样如此）独立筛选每颗弹丸的三角分布，拒绝 `x²+y² > 1` 的角落，首颗和后续 8/5 颗弹丸走同一规则。全部弹丸共用这一枪开火前的基向量，弹量和反冲只结算一次。为防异常注入 RNG 阻塞模拟，连续 32 次拒绝后采用中心点；正常随机分布几乎不会触发该保底。
- Glock/FAMAS 后续连发继续使用原有 `.05` / 首发缓存散布，重新取当时已有的 pre-shot punch，不额外施加首发 KickBack。消音、开镜及各枪既有数值保持。
- 刀、投掷物和旧灰盒武器的路径不混入本次修正。`MAIN_BALLISTICS_VERSION` 所标识的既有 12 枪恢复/反冲规则也不扩大；全枪射线校正与该规则分开验证。

参考入口：[24 枪目录](https://github.com/rehlds/ReGameDLL_CS/tree/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/wpn_shared)、[公共连发](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/weapons.cpp)、[单发/霰弹采样](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/cbase.cpp)。数字夹具记录逐文件哈希、引擎角度复制来源哈希和临时独立 C++ 程序哈希，不提交参考源码或素材。

### 数值与保护验证

- 修改前完整 **1612 项通过**。本轮完整 **1810 项通过，零失败/跳过**。新增 192 组独立 C++ 射线夹具覆盖 24 枪、站/蹲/移动/空中、上下接近垂直、消音、开镜以及 Glock/FAMAS 两次 follow-up；另测真实 Game 全颗霰弹、圆周边界、拒绝重采样、退化随机源限额和被拒射击零副作用。
- 用保存的旧开火模块作反向检查，新夹具在每把非 AK 枪上都能检出旧射线偏差（共 183 组失败），已认可 AK 则全部通过，避免新测试仅复述实现而未发现旧问题。
- 保存用户认可的 AK 版本为明确基线，实际 Game 各枪站立/下蹲共 48 梭、**46,080 个模拟步**。24 枪的弹量、精度、恢复、射速、反冲状态和移动状态逐步相同；两组 AK 的全部实际射线逐条完全相同。共 **1264 次开火、1462 条弹丸射线**，并输出 10/20/30m 垂直于初始朝向平面的样本包络。
- 这 1462 条实际射线全部另交独立 C++ 空间/采样参考计算，最大方向分量误差约 **1.35e-7**。传入的是开火前已衰减状态，因此不重复推进衰减时间；不是零售客户端逐帧录制。
- 同一保存基线与当前 `shot-feedback` 在约 117ms 延迟快照下另作 **46,080 步**差分：逐步的预测返回、权威补播返回、预测弹量/反冲和诊断状态完全一致。镜头、移动、反冲表、客户端预测、AWP/快切模块保持原字节。
- 保留原 `excluded-weapon-baseline.json`，不重生成或覆盖历史期望；原来保护的精度、反冲、弹量和恢复列仍逐项对照。原射线列因本次明确授权改变，改由独立数字夹具和实际 Game 射线验证承担，避免把旧错误落点继续作为目标。

原生 Chrome 的生产客户端、原始本地模型和离线 Game 在 BSP 墙面验证 **30 组整弹匣**：24 枪加 Glock/FAMAS 连发、USP/M4 消音和 AUG/SG552 开镜。共 **779 次实际开火、878 条弹丸**，各枪全部扣至零，射击序号的显示覆盖完整、原地不压枪，浏览器错误为零。透明诊断包装只记录原有 `sample/observe/confirm` 的返回，不改写结果。首轮夹具曾把 `predicted` 当作实际射击次数，发现 P228/SG552 可能由权威先播放，因而改为分别统计实际发数、预测、权威补播和显示序号覆盖；最终记录 2 次权威先播放，以及 1 次额外推测/重播调用，不能据此宣称全枪预测永不纠正或绝无额外动画。本批逐步差分保护预测原行为，AWP 的特定吞弹/确认去重/快切仍由原专项负责。

最终原专项回归全部通过：主战枪手感/恢复与单枪镜头、反冲衔接 **12 组**、切刀显示响应 **2 组**、连续 Q **3 组**、AWP 开火排序 **6 组**；实际 QUIC/WSS 公平性 **32 组**，测试服务已关闭；两种镜头下滚轮连续跳各 **7 条路线**，浏览器错误为零。现有 3001 服务仍是原进程。这些是逻辑、原生浏览器及隔离传输验证，本批未重新测量 GPU 帧率或进行实体多人验收。

复测入口：`node --test tests/weapon-rays.test.mjs`、`node tools/evaluate-weapon-rays.mjs --baseline-dir /absolute/saved-accepted-ak-checkpoint`、`node tests/weapon-rays-browser.mjs`。历史 `evaluate-ak-ray.mjs` / `evaluate-ak-spread.mjs` 保护“其余 23 枪射线不变”，仅适用于当时 AK 专项阶段；本次不放宽其历史守卫，全枪扩展使用新入口。

精度系数是这批独立空间参考的输入，本轮不据此宣称所有旧低频武器的全部系数、随机反冲种子流、GoldSrc 命令时序和浏览器预测均已复刻。原始参考 C++、对照数据、截图和测试收据仍保持忽略；两项 A/B 及默认值保留。本轮未提交、推送或重启现有 3001 服务，实际服务器需重启才会加载其余枪械的新射线逻辑。

### 2026-11-04：AK 与全枪械校正的统一提交

用户分别体验并认可 AK 与其余枪械的校正，已要求重启本机服务加载全枪校正，随后明确授权将两阶段成果一起提交并普通推送到远端 `main`。本次以 `1ddf87a` 为提交基线；提交前获取远端 `main`，没有新增提交或待合并冲突。上文“未提交/未重启”保留对应开发阶段的状态，以本节和 Git 记录为当前交付依据。

提交前重新通过完整 **1810 项**、48 组 **46,080 步**状态与同量延迟预测对照、**1462 条**实际射线的独立 C++ 验证；原生 AK **10/20/30m** 三组整梭、全枪 **30 组整弹匣**（779 次实际开火、878 条弹丸）、主战手感、反冲衔接 12 组、显示响应 2 组、连续 Q 3 组、AWP 6 组、QUIC/WSS 32 组及两种镜头各 7 条轮跳路线均通过。此次全枪夹具记录 1 次权威先播放与 1 次额外推测/重播调用，继续分别记录预测与实际开火，不将显示覆盖测试解释为预测零纠正。隔离传输测试实例已关闭。

本次提交范围仅为 18 个代码、数字参考夹具、测试及文档文件。素材、截图、参考源码、凭据、依赖与原始测试收据均不纳入。13 个受保护运行模块与开发前保存基线保持字节一致，已认可的 AK 轨迹精确保持。提交前复验期间运行代码没有改动；本机游戏服务保持此前已加载全枪校正的进程，本次提交/推送过程不重启服务。
