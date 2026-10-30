# CS1.6 original-name audio catalog and local sources — 2026-10-30

Scope: catalog, ignored local audio preparation, and validation only. Event authority, timing, directional panning, local/remote routing and gameplay integration belong to the parent worker. A filename being catalogued or a WAV decoding successfully is not proof of a complete 1:1 CS1.6 client implementation.

## Result and boundaries

- 24 guns retain their existing default names and `gunSound(weapon, silenced)` behavior. Suppressed USP/M4A1, alternate precached firing files, model action options, knife, 10 footstep families, player hits/deaths, world impacts, grenades, C4, equipment and radio are covered.
- 316 explicit, unique WAV paths after parent integration added the evidenced remote shotgun reload file `weapons/generic_shot_reload.wav`; hard resource-name budget 512, shared between JS and Python. Final local preparation reached 316 ready / 0 missing, plus materials.txt. Exact SHA256/URLs/PCM metadata and ready/missing lists: ignored `public/assets/sounds/manifest.json`; the scoped worker's earlier 315-file receipt remains historical. Final integration: [cs16-audio-integration-2026-10-30.md](cs16-audio-integration-2026-10-30.md).
- No hostage/VIP/rescue sounds or mechanics were added. There is no invented `lose.wav`: a losing team hears the actual winning-team announcement. No generated/placeholder game audio was installed.
- Community mirrors and the Half-Life sound archive are not authenticated retail resources. Original relative names, matching hashes across mirrors and successful WAV decoding do not establish retail provenance or redistribution rights. Resources remain ignored, for authorized local testing only; do not upload or bundle them in a source release.

## Fixed source evidence

Reviewed 2026-10-30 (Asia/Shanghai). No C++ implementation was copied into the runtime.

1. ReGameDLL_CS fixed commit `4a50c42e85fd3778c2b7d24731c7d30c83bbab01` (commit patch date 2026-09-17). This is a community reverse-engineered GameDLL with FIXES/ADD/API extensions, not Valve's published retail CS client source.
   - [PM_PlayStepSound, PM_MapTextureTypeStepType, PM_CatagorizeTextureType, PM_UpdateStepSound](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/pm_shared/pm_shared.cpp#L169-L495).
   - [materials.txt loading and lookup](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/pm_shared/pm_shared.cpp#L68-L167), [material codes/constants](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/pm_shared/pm_materials.h#L31-L47).
   - [24 gun precache paths](https://github.com/rehlds/ReGameDLL_CS/tree/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/wpn_shared): `wpn_<id>.cpp` (MP5: `wpn_mp5navy.cpp`). These show available variants, not the proprietary client's exact random/event selection.
   - [knife deploy/slash/body/wall precache](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/wpn_shared/wpn_knife.cpp#L39-L47), [knife hit selection](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/wpn_shared/wpn_knife.cpp#L321-L458).
   - [player helmet/flesh/armor/head and deaths](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/player.cpp#L540-L638).
   - [radio menus](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/client.cpp#L2180-L2318), [equipment, C4, movement sound precaches](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/client.cpp#L3961-L4071).
   - [grenade bounce sounds](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/ggrenade.cpp#L770-L787), [defuse start/completion](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/ggrenade.cpp#L1027-L1120), [C4 beep stages](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/ggrenade.cpp#L1420-L1475).
   - [world ricochets](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/world.cpp#L353-L362), [breakable damage materials](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/func_break.cpp#L405-L470), [destruction sounds](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/func_break.cpp#L680-L740).
2. Valve Half-Life SDK fixed commit `b1b5cf5892918535619b2937bb927e46cb097ba1`, resolved by git ls-remote on the review date and used as a fixed raw-source URL, not a moving branch. GitHub commit API was rate-limited; its merge commit date was not verified. The downloadable merge patch contains constituent patches dated 2024-10-02, which is not proof of the merge timestamp.
   - [EV_HLDM_PlayTextureSound](https://github.com/ValveSoftware/halflife/blob/b1b5cf5892918535619b2937bb927e46cb097ba1/cl_dll/ev_hldm.cpp#L96-L236) maps wood/glass to `debris/*`, concrete/metal/dirt/vent/grate/tile/slosh to selected `player/pl_*` files; its flesh branch uses `weapons/bullet_hit*.wav`. This is HL SDK evidence, NOT proof that CS retail does exactly the same; CS-specific player-hit names are corroborated separately above.
   - [ricochets and BSP/pushstep decal eligibility](https://github.com/ValveSoftware/halflife/blob/b1b5cf5892918535619b2937bb927e46cb097ba1/cl_dll/ev_hldm.cpp#L252-L300): `SOLID_BSP` and `MOVETYPE_PUSHSTEP` are relevant for decal dispatch. That condition must not be misread as every such object supporting a material sound or this browser game supporting every GoldSrc entity.
   - [Half-Life PM source](https://github.com/ValveSoftware/halflife/blob/b1b5cf5892918535619b2937bb927e46cb097ba1/pm_shared/pm_shared.c) is a comparison only: its walk/run-dependent timing differs from the CS reference. Do not substitute its 400 ms walk rules for CS's >150 gate / 300 ms ordinary running steps.
3. Local imported MDLv10 evidence: `public/assets/weapons/*/model.json`, 30 imported models, 87 unique MDL event-5004 options. All are explicitly covered, including unprefixed Glock/AWP actions, `items/cliprelease1.wav`, `weapons/pinpull.wav` and `weapons/c4_click.wav`. This task re-read the imported event records and original-model sourceSHA256/sourceURL receipts; raw `.mdl` inputs were not present inside this scoped project, so this is not a fresh binary-MDL authenticity audit. See ignored weapon manifest and `artifacts/audio-source-probes/model-5004-names.json`. Existing model URLs are community mirror URLs, not retail certification.

## Movement/event rules to hand off

`PM_UpdateStepSound` at the fixed CS reference:

- Return while `flTimeStepSound > 0` or FL_FROZEN. `speed = Length(velocity)` is the full 3D vector in GoldSrc units/sec, not just horizontal speed. If speed <=150, set timer to 400 ms and return without playing. Ordinary running needs speed >150 plus ground contact or MOVETYPE_FLY ladder. Do not use >=150 for this ordinary-step gate (the jump code separately uses >=150).
- Normal ground: concrete/metal/grate/tile/slosh volume .5, dirt .55, vent .7, timer 300 ms. Ladder: .35 and 350 ms, then the ladder-or-duck branch adds 100 ms, so ordinary ladder cadence is 450 ms. Knee in water: wade .65 / 600 ms; feet in water: slosh .5 / 300 ms. Duck/ladder adds 100 ms. Duck volume multiplies by .35 only when FL_DUCKING and flDuckTime <950.
- `PM_PlayStepSound` flips iStepLeft, checks runfuncs and the multiplayer footsteps movevar, then selects right foot 1 or 3; left foot 2 or 4. `step.*` arrays in this catalog are filename order, not foot order. Wade is exceptional: right 1/2, left 3/4; one of each four wade calls is skipped by iSkipStep. Tile independently has a 1-in-5 override to pl_tile5. Snow selects 1..4; 5/6 are server-precached only. Unknown material (including W/P/X/Y/F for footsteps) falls through to concrete. There are no invented `pl_wood*.wav` footsteps.
- Texture classification traces down 64 GoldSrc units, strips a leading animation +/- plus frame character, then one leading `{`, `!`, `~` or space; materials.txt lookup is case-insensitive; default C. The fixed ReGame header uses 17-byte storage / 16-character comparison, whereas the HL SDK family uses its own constant; do not silently conflate these. Textures and actual traced surfaces, not English name heuristics, determine material.
- C/M/D/V/G/T/S/N map to concrete/metal/dirt/vent/grate/tile/slosh/snow. W/P/X/Y/F mean wood/computer/grass/glass/flesh in the material table, but do not imply distinct CS footstep playback. Wade/ladder are movement/content overrides, not material-table codes.
- [PM_Jump](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/pm_shared/pm_shared.cpp#L2729-L2751) uses a material step at volume 1 when full velocity >=150; a generic pl_jump1 voice is not evidenced there. [PM_CheckFalling](https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/pm_shared/pm_shared.cpp#L2907-L2952) uses a material step based on fall speed and resets timer to 300 ms; pain is not the right sound for every landing.
- The current scoped map import uses `unitsPerWorldUnit:40`; convert GoldSrc velocity/time explicitly. The current `public/map.js` collision solids filter only world model 0 and `func_breakable`. Buy/bomb triggers exist but are not solid footstep surfaces. Ladder/water families existing in the catalog do not mean working ladder/water mechanics were added. BSP30 is the imported format; no claim is made here about other BSP versions/entities.

Grenades: `he_bounce-1.wav` is the HE special case; other grenade bounce uses grenade_hit1..3 in the reference. HE and flash precache two explosion variants each, smoke uses sg_explode. Pin is the original MDL event. Do not emit both animation and gameplay copies of the same pin event. Generic explosion/debris files are available but not proof they should be layered onto every CS grenade.

C4: c4_click is an MDL action; c4_plant is the plant-completion sound, not an invented continuous arming loop; c4_disarm starts defusing, c4_disarmed is completion. c4_beep1..5 are ordered stages, NOT random variants. Use the source timing/state machine, cancel appropriate channels on completion/explosion. FIXES guards can change which entity emits disarm; this task does not select a client audibility policy.

Radio: `sentences.txt` resolves MRAD_TAKEPOINT to takepoint, MRAD_HITASSIST to fireassis, MRAD_REPRTINGIN to ct_reportingin. Similar mirror files ct_point/ct_imhit/hitassist are NOT interchangeable proof of menu mapping. Menu 3's first slot randomly selects roger/ct_affirm, so that family has 10 filenames for 9 menu slots. Winning announcement files are CTWIN/TERWIN; default start candidates are MOVEOUT/LETSGO/LOCKNLOAD/GO. Hostage/VIP start alternatives are deliberately not catalogued.

## Public API (exact exports)

- `SHOT_SOUNDS`: frozen object, existing 24 weapon ids to their unchanged default path.
- `gunSound(weapon, silenced=false)`: unchanged default / suppressed USP or M4A1 selection. Unknown and inherited keys return undefined. No randomization.
- `safeSound(name)`: boolean path grammar, NOT existence check. Only one basename ending in lowercase .wav beneath weapons/player/items/radio/buttons/debris/ambience/common; ASCII letters/digits/underscore/hyphen. Rejects nested paths, traversal, absolute paths, URLs, encodings, backslash, fragments, queries, controls and trailing CR/LF. `common` is required for evidenced original weapon-selection/body-drop sounds.
- `ALL_SOUNDS`: frozen explicit flat literal array; 316 unique paths. Build-time extraction does not execute JS. Includes precache-only files and legacy names, so availability does not imply event emission.
- `ACTION_SOUNDS`: frozen flat array containing all ALL_SOUNDS paths except the 24 default SHOT_SOUNDS values (292 entries). Existing auxiliary names remain included. It is a compatibility iterable, not a requirement to eagerly decode all sounds.
- `SOUND_BUDGET`: 512.
- `SOUND_GROUPS`: frozen flat object of frozen path arrays (109 keys):
  - For each SHOT_SOUNDS id: `shot.<id>`, `action.<id>`. Shot arrays contain available precache variants INCLUDING mixed silencer/burst choices; do not blindly randomize them. Action groups are convenient filename-prefix collections with explicit Glock/AWP/XM1014 overrides, not model sequence/timeline maps. TMP has no dedicated prefixed action sounds in these source records, so action.tmp is empty. Model event5004 records remain the authoritative source for exact sequence options and timing.
  - `knife.deploy`, `knife.swing`, `knife.body`, `knife.stab`, `knife.wall`; `dryfire.pistol`, `dryfire.rifle`, `zoom`.
  - `step.concrete`, `step.metal`, `step.dirt`, `step.vent`, `step.grate`, `step.tile`, `step.slosh`, `step.wade`, `step.ladder`, `step.snow`.
  - `landing.pain`, `player.pain`, `player.death`; `hit.flesh`, `hit.helmet`, `hit.kevlar`, `hit.head`.
  - `ricochet.generic`, `ricochet.metal`, `ricochet.concrete`; `impact.wood`, `impact.glass`, `impact.metal`, `impact.concrete`. The impact families are material-damage candidates, not a verified exact CS client bullet-event routing table. `bust*` are destruction, not every-hit sounds.
  - `grenade.pin`, `grenade.bounce.he`, `grenade.bounce.other`, `grenade.he`, `grenade.flash`, `grenade.smoke`, `grenade.aftermath`.
  - `c4.click`, `c4.plant`, `c4.defuseStart`, `c4.defused`, `c4.beeps`, `c4.explosion`.
  - `pickup.weapon`, `pickup.ammo`, `pickup.armor`, `pickup.nvg`, `nvg.on`, `nvg.off`.
  - `round.start`, `round.ctWin`, `round.tWin`, `round.draw`, `round.bombPlanted`, `round.bombDefused`; `radio.fireInHole`, `radio.menu1`, `radio.menu2`, `radio.menu3`.

## Local preparation, provenance and limits

Prefer a lawfully obtained sound directory. Cache entries are validated first and never overwritten; source is only used for absent names:

```sh
python3 tools/prepare-sounds.py --source /absolute/path/to/cstrike/sound --materials --strict
```

GoldSrc normally inherits shared sounds from valve. This task's initial cstrike-only mirrors omitted those common/debris/ricochet/reload files; a fixed Half-Life archive supplies individual bounded fallback files, not an entire distribution. Explicit local-test fetch actually executed:

```sh
python3 tools/prepare-sounds.py --fetch --materials --mirror https://raw.githubusercontent.com/sourcesounds/hl1/72e4b6b36d38cb5703a6b5ed3ffdc7b72bc2fd2f/sound/ --deadline 480 --strict
```

Default mirror roots, fetched/reviewed 2026-10-30:

- https://luxserv.ge/cstrike/sound/ — contains unrelated custom mod files; only the explicitly catalogued names are fetched. No assertion of an unmodified retail collection.
- https://packnt.com/files/games/gamecache/cstrike_new/pb/sound/ — public game-cache directory, not Valve verification.
- Fallback repository https://github.com/sourcesounds/hl1/tree/72e4b6b36d38cb5703a6b5ed3ffdc7b72bc2fd2f/sound — described as Half-Life sound files. Version/retail authenticity/license not established. Only absent shared names were obtained from it. Do not substitute Counter-Strike: Source's `sourcesounds/cstrike` collection.
- Radio mapping evidence https://packnt.com/files/games/gamecache/cstrike_new/pb/sound/sentences.txt (saved as a source probe, not a runtime text dependency).
- Optional materials https://luxserv.ge/cstrike/sound/materials.txt. The packnt copy differs in bytes; matching semantics/version are not assumed. The first validated file is retained with its own hash.

Preparation extracts quoted literal catalog paths plus original model event5004 options; validates unknown/unsafe options rather than silently traversing or synthesizing names. Limits: 512 WAV names, <=64 model JSONs <=32 MiB each, six workers, <=6 mirror roots, <=2 MiB per WAV, PCM mono/stereo / 8–96 kHz / 8–32-bit, >0 and <=20 s, full PCM payload and RIFF size/chunk checks, final aggregate byte audit <=256 MiB. materials.txt <=256 KiB and <=4096 well-formed rows. Invalid mirror bodies fall through to the next source. Socket timeout is 12 s by default (max30); the run deadline is checked between single underlying HTTP reads, so an in-flight read may outlast it by at most a socket timeout. `--strict` exits nonzero when a requested file remains missing.

Legacy odd-byte RIFF padding: several actual GoldSrc mirror WAVs omit a padding byte at EOF or directly before a complete LIST metadata chunk. Rejecting all of these incorrectly rejected pinpull, c4_click/disarmed, death6 and suppressed USP. Validation now accepts only complete known unpadded chunks/PCM, records `validationWarnings`, leaves the file byte-for-byte unchanged, and still rejects truncation/size mismatches. All prepared WAVs were separately decoded using actual Chrome decodeAudioData. This is not normalization, conversion or placeholder synthesis.

Manifest schema `local-sounds-v2`: each file records SHA256, bytes, PCM duration/rate/channels, acquisition method, exact mirror URL/resolvedURL or local path, attempt errors, warnings, `retailHashVerified:false`, `redistributionLicense:'unknown'`. Reruns verify cached hashes. A mismatched cache is reported missing/corrupt without overwriting it; the old expected checksum is retained so the next run cannot bless tampering. An existing unmanifested valid WAV is tagged existing-unattributed, never retroactively attributed to a mirror. Optional unselected prior receipts are retained.

## Verification and remaining work

Executed focused catalog/downloader unit tests, current consumer audio tests, strict asset preparation, offline cache-integrity replay and actual Chrome decoding. See the task report and ignored machine receipts for exact counts and commands.

Not performed by this worker: listening comparison against a licensed CS1.6 installation, byte identity versus Valve retail files, directional multiplayer gameplay, per-map acoustic occlusion, loudness/distance equivalence, event selection integration, live-service restart or release. The parent must select material/action/radio families from actual authoritative state and verify those behaviors independently.
