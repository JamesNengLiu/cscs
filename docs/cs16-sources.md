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
