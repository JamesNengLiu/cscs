# Player renderer and character review

Owned implementation: `public/player-model.js`, `public/characters.html`, `public/characters.js`, and `tests/player-model.test.mjs`. Asset acquisition, conversion, custom face generation, networking, and game-client integration belong to their respective owners. This implementation starts no service and changes none of those files.

## Actor contract

```js
import {createPlayerActor} from './player-model.js';

const actor = createPlayerActor(THREE, {onChange: info => console.log(info)});
scene.add(actor.group);
await actor.setCharacter('terror_trump');
// In the existing render loop; dt is seconds, p.y is feet height.
actor.update(dt, playerState);
// On entity removal:
actor.dispose();
```

`createPlayerActor` is synchronous and returns `{group, setCharacter, update, info, dispose}`. `setCharacter(id)` resolves to a diagnostics snapshot, including on failure; a failed/missing load becomes an unmistakable magenta wire octahedron and a descriptive error. `onChange` receives loading, completion, failure, weapon, and disposal snapshots. It is not called for every animation frame. `info()` returns fresh diagnostic objects; editing them does not edit actor data. `dispose()` is idempotent and detaches the group. Late selection/texture completions cannot attach an outdated or disposed actor. Selecting the same failed ID retries; reload the page to obtain a newer successfully cached manifest.

Supported IDs:

- Original: `terror`, `leet`, `arctic`, `guerilla`, `urban`, `gsg9`, `sas`, `gign`.
- Custom fictional cosmetic: `terror_trump`, `leet_trump`, `arctic_trump`, `guerilla_trump`.

### Placement and rendering

`update(dt,p)` owns `group.position.x/y/z` and `group.rotation.y` **only when the corresponding `p` values are finite**. Omit these fields to preserve caller placement. Do not also apply a crouch scale or hull-center offset in the caller. The outer group stays at the player's **feet**, with unit scale. The model's inner transform is:

```text
worldLocal = (-sourceY, sourceZ, -sourceX) / 40
worldLocal.y += crouch ? 0.45 : 0.9
world = groupTransform(worldLocal)
```

This is a right-handed basis with positive determinant, no viewmodel reflection, yaw zero facing world `-Z`, and positive yaw turning toward `-X`. Source standing/crouched hull centers are 36/18 GoldSrc units above the feet. Crouching changes the source sequence and origin; geometry is never squashed. All actor and weapon meshes use **layer 0**, render order 0, `depthTest:true`, and `depthWrite:true`. The actor has no renderer, camera, depth clearing, or overlay pass. Render it in the map's normal pass so walls occlude players. Source-deformed geometry disables static frustum culling because its bind-pose bounds are insufficient for every animation.

### Animation inputs

| Input | Meaning |
| --- | --- |
| `vx`, `vz`, `walk` | Speed above 0.12 selects locomotion; below 3 world units/s or `walk:true` selects walk, otherwise run. |
| `crouch` | Crouched origin and source crouch idle/locomotion/action sequences. |
| `grounded:false` | Source jump sequence. |
| `alive:false` or `dead:true` | Source death sequence; terminal pose is held. Caller decides when to remove the actor. |
| `weapon` | Source weapon-family aim/shoot/reload labels and optional third-person asset key. |
| `reloading` or truthy `reloadAt` | Source reload sequence while active. |
| increasing `lastShot` or decreasing `ammo` | Source shoot sequence after a baseline observation. |
| `pitch`, `aimYaw` | Radians; feed source blend controls, not fabricated bone rotations. |
| `skin`, `body` | Original skin family and packed GoldSrc bodypart selection. |
| `animation` | Review override: `idle`, `walk`, `run`, `crouch`, `jump`, `death`, `aim`, `shoot`, or `reload`. Death state still takes priority. |
| `playerSequence` | Explicit source label or sequence index; takes precedence over automatic selection. |
| `playerFrame` | Exact fractional source frame while `playerSequence` is set. |
| `animationToken` | Changing this restarts explicit or automatic sequence playback. |
| `blendX`, `blendY` | Optional normalized `[0,1]` blend coordinates, overriding pitch/yaw mapping. |

Weapon families include AK-47, carbine, rifle, onehanded, dualpistols, MP5, shotgun, M249, grenade, C4, and knife. Label selection uses only imported sequences. Missing actions explicitly report `animationWarning` and show an available idle/aim sequence, or a bind pose when no imported tracks exist. Standalone callers without authoritative animation metadata use heuristic action selection. Game snapshots use the shared upper-body/lower-body gait layers described below; complete retail animation priorities remain outside the current implementation.

Positions interpolate original channel samples, including `positionHold` RLE semantics; rotations use the source `ZYX` Euler convention and quaternion interpolation. Controller rest values are applied. GoldSrc `STUDIO_X/Y/Z` motion-bone channels are consumed by world movement and therefore zeroed, matching the source motion-axis convention. Other sample coordinates/angles remain unmodified. Frame delta is bounded to 0.25 seconds. Source loop flags control playback; deaths hold their last frame.

`seq.tracks` supplies blend 0. If `seq.blendTracks` supplies all source blends, counts 2, 4, and 9 use linear, 2×2, and 3×3 row-major interpolation respectively. Positions lerp and rotations slerp within each grid cell. For two/four blends, the declared sequence ranges are used. CS player nine-blend grids use columns for relative torso yaw and rows for pitch: logical browser pitch maps to `clamp(.5 - pitch / (pi/2))`, and relative aim yaw maps to `clamp(.5 - aimYaw / pi)`. Explicit `aimYaw` overrides the difference between logical eye yaw and gait yaw. Defaults select the center. Explicit `blendX/Y` makes every grid sample inspectable. Exact CS engine pitch/yaw/gait parameter synthesis is not claimed. Missing blend arrays or other counts use original blend 0 and expose that limitation in `blendSupport` and `availableSequences[].allBlends`.

### Assets, provenance, and limits

The manifest URL is `/assets/players/manifest.json`, schema `goldsrc-players-v1`, with models keyed by ID. Model files use `goldsrc-player-v1` and the converter's bones, controllers, textures, skins, bodyparts, meshes, attachments, and sequences. File paths are relative to `/assets/players/`; traversal, absolute paths, and external URLs are rejected. PNG paths must be `texture-N.png` beside their model JSON. Texture S/T is divided by the selected original texture dimensions; `flipY:false`, no UV mirroring, and original winding are retained.

Original entries and model metadata must both declare `source:'original-mdl'` and matching 64-character `sourceSHA256`. Custom entries and metadata must both declare `source:'custom-trump-face'` and matching `baseSourceSHA256`. A custom `sourceSHA256`, if supplied by the entry, must also match; it is not required. No custom model is reported as original. Diagnostics include original/custom source, base/source hashes, converted hash, verification status, source URL/authenticity, and retail authentication status when supplied.

`convertedSHA256` is checked against the exact fetched JSON bytes when Web Crypto is available. A mismatch fails visibly. On insecure LAN origins where Web Crypto is unavailable, or if the entry has no converted hash, `convertedSHA256Verified` remains false. Source MDL hashes are declared provenance checked for consistency, not independently authenticated by fetching retail MDLs. Runtime PNG dimensions are checked; PNG byte hashes are not verified by the renderer. Texture colors use unlit materials, original masking/additive flags, and scene fog; GoldSrc lighting and animated bone-controller inputs are not reproduced.

JSON is bounded during streaming, before parsing: 1 MiB manifest, 64 MiB model, and a 20-second fetch timeout. Structural limits include 128 bones/textures, 1,024 meshes/sequences, 500,000 total render vertices, 3,000,000 total indices, 10,000 frames/sequence, 16 blends/sequence, 24,000,000 serialized channel samples, 4,096-pixel texture dimensions, and 16,777,216 total texture pixels. Vertex/bone/skin/body references and finite samples are validated. Importer output beyond these runtime budgets fails visibly.

Per-Three-namespace caches retain a bounded 16 parsed model assets and a manifest. Parsed model objects are deeply frozen and not exposed. Active instances share initialized texture objects through reference-counted leases. Last release disposes those textures; cached JSON remains reusable. Every instance has separate pose matrices, mutable position/normal/UV buffers, geometry, and materials. Pose calculations reuse vectors, quaternions, and channel buffers; they do not allocate arrays proportional to vertex count per frame.

### Optional third-person weapons

If `manifest.weapons[weaponId]` exists, it must reference original `p_*` conversion geometry under the players asset root. The converter's `goldsrc-player-v1` schema is supported, along with `goldsrc-player-weapon-v1`/`goldsrc-worldmodel-v1` equivalents. Viewmodel schema is deliberately unsupported here. Weapon bones matching player bone names (case-insensitive) copy the player's posed source matrices; unmatched bones inherit their source local transform from their weapon parent. At least one bone must match. Weapon geometry uses the same world basis/origin and depth policy. `info().thirdPersonWeapon` reports missing imports, failures, matched counts, and unmatched bone names. Missing guns have **no substitute box or invented mesh**. Weapon-specific animation for unmatched weapon-only bones and attachment-event effects are not implemented.

## Standalone review

Open `/characters.html?model=terror_trump` through the existing server when the parent runs it. Add `&compare=1` for original/custom comparison. The page imports Three from the existing `/vendor/three.module.js` route and the actor module; it does not import `client.js`, open a WebSocket, join a game, or start a server.

Controls include all 12 IDs, front/side/rotation, drag orbit, wheel zoom, close face/torso framing by default, full-body framing, original/custom pairs, animation state, exact imported sequence, pause/restart, pitch, speed, and equipment. CT models disable original/custom comparison because no CT custom variants are defined. Missing assets and WebGL failures appear visibly. Custom variants are explicitly labeled fictional cosmetics with no official identity/affiliation/endorsement.

`window.characterReview` is a getter returning a deeply frozen snapshot of selected IDs, actor provenance, sequences/frames/blends/errors, camera, render counts, and pause state. It does not expose actor mutation methods or scene objects. Screenshots and visual approval belong to the parent's browser pass; this work does not claim visual review or face recognizability from a file-backed run.

## Focused verification

Run without any server:

```sh
node --test tests/player-model.test.mjs
node --check public/player-model.js
node --check public/characters.js
```

The test uses installed Three with mock fetch and texture loading. Fixtures exercise handedness, exact world origin, source UVs, depth/layers, held position samples, quaternion interpolation, 9-blend sampling, state-driven sequences, disposal/refcounts, independent geometry, selection races, custom provenance, optional weapon merging, malformed/oversized assets, and visible missing-data behavior.

The file-backed branch reads actual local manifest/model JSON/PNG files, validates converted hashes through the actor, samples source animation geometry, samples every available 9-blend sequence, and merges each available third-person weapon. It checks PNG headers/dimensions through a file-backed TextureLoader; it does not create a GPU context or perform browser rasterization. If no player manifest exists, this branch explicitly skips instead of claiming real-model validation.

Verification on 2026-10-28: **17 tests passed, zero skipped**, including all **12 actual models** (the eight originals and four custom fictional cosmetics), plus **24 actual third-person weapons** merged by bone name. An initial actual-asset attempt correctly rejected a manifest/JSON hash mismatch while the separate import was in progress; the completed import passed without weakening validation. These are file-backed module tests, not GPU evidence. The parent's separate actual-Chrome rendering, original/custom screenshots and real network replication pass are recorded in [character integration](characters-integration.md); exact face geometry and source-engine parity remain explicitly unclaimed.

## 2026-10-29: shared locomotion and combat layers

The Game snapshot now supplies the upper-body sequence/frame plus optional `playerFrameSpan`, `playerLooping`, `playerGaitSequence`, `playerGaitFrame` and accumulated `gaitDistance`. The shared `public/bone-pose.js` evaluator applies locomotion below `Bip01 Spine` (root/pelvis/legs), while the upper body keeps aiming, shooting, reloading or briefly flinching. Ground gait advances by actual signed distance and the imported sequence's linear movement; backwards motion reverses its phase. Airborne gait uses a canonical jump frame derived from elapsed air time. Spawn resets the distance/air counters.

This follows the lower-body gait layering principle in Valve's [Half-Life SDK Studio renderer](https://github.com/ValveSoftware/halflife/blob/master/cl_dll/StudioModelRenderer.cpp). It is not a claim that the full official Counter-Strike client source is public. Gait yaw follows travel, reverses for backwards movement beyond 120 degrees, and eases toward view yaw at rest. Full dynamic bone-controller inputs and retail animation priorities remain fidelity boundaries.

The renderer and authoritative bone hitboxes use the same layering evaluator. Lag-compensation records retain walk/gait/air/flinch state and interpolate travelled distance; they do not infer a historical pose from the current target. Remote snapshots interpolate declared looping frames across the last/first frame rather than holding the old frame for a snapshot interval. Legacy callers without the new optional fields keep their existing behavior.

Verification: `node --test tests/player-feedback.test.mjs tests/snapshot-buffer.test.mjs tests/lag-compensation.test.mjs`; browser integration: `npm run test:player-feedback`. Unit checks compare original lower-body matrices during aim/shoot/flinch and airborne flinch, validate loop seams and preserve on-demand hitbox cache invalidation. Browser checks use the actual client, imported local models, keyboard/mouse and two offline authoritative players over IPC. A separate render-only fixture animates nine remote actors; it does not represent nine physical network clients.


## 2026-10-29: pose direction and weapon-switch correction

The previous nine-blend parameter synthesis used the generic axis descriptors for pitch. That was wrong for these CS player assets: looking up/down selected torso-yaw columns. This affected the existing renderer before the recent gait work. The corrected CS mapping is corroborated by the local blend poses and [FWGS CS16Client, commit a238ef131803ed7592c4ba701499027c862889ee](https://github.com/FWGS/cs16-client/blob/a238ef131803ed7592c4ba701499027c862889ee/cl_dll/GameStudioModelRenderer.cpp), `CalculatePitchBlend`, `CalculateYawBlend` and `StudioSetupBones`. This is a community client implementation, not Valve-published CS client source.

Shared movement now records `gaitYaw`. The rendered root and canonical bone hitboxes use it, while upper-body nine-blend yaw retains the logical aim direction. Remote gait yaw interpolates by the shortest arc and historical poses retain it. Ground gait distance still controls leg phase.

`Game.activate` captures the previous authoritative upper-body sequence/frame. A 0.2-second local-bone crossfade runs before world transforms and leaves the active gait layer intact. Snapshots and history preserve transition metadata, so rendering and hitboxes use the same blend. Spawn skips the crossfade. This follows the previous-sequence transition principle in CS16Client; fully interrupted retail transition behavior is not claimed.

Remote weapon model changes keep the old mesh while the requested valid asset loads, then atomically swap. Stale requests cannot install themselves; a missing/failed asset still reports its failure and has no fabricated substitute. `thirdPersonWeapon.displayedId` and `visible` distinguish the displayed model from the requested model during loading.

`node tests/player-pose-browser.mjs` renders nine neutral-scene cases using actual local models and shared Game metadata: stationary AK, M4 up/down aim, forward run, aimed strafe, backwards motion and three weapon-switch times. `POSE_LEGACY_BLEND=1` produces a diagnostic comparison using the old axis calculation; it does not modify production files. Screenshots/reports remain under ignored `artifacts/`. Tests additionally verify physical aim direction, backward/strafe orientation, transition endpoint/midpoint and atomic asset replacement.
