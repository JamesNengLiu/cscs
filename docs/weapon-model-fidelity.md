# CS 1.6 viewmodel fidelity

Implemented and locally exercised on 2026-10-27: **30 MDLv10 viewmodels, 34,515 triangles, 226 original paletted textures, and 209 embedded skeletal sequences**. These are converted source meshes and skins, not reconstructed boxes. This is **not a claim of 1:1 CS 1.6 rendering or gameplay animation timing**.

The importer/loader is integrated with the real client in v0.4. Source conversion, runtime visuals and gameplay animation synchronization are separate acceptance areas.

## Acquisition and provenance

Downloaded raw `IDST` version 10 model bytes from the [professorDeveloper/CS-1.6 public mirror](https://github.com/professorDeveloper/CS-1.6) and [Vertigo Gaming's model directory](https://www.vertigogaming.org/downloads/cstrike/models/). No installer, executable, credentials, or downloaded code was used. The GitHub API returned HTTP 403 rate-limit exceeded; direct HTTPS raw model URLs worked.

* Regular source template: `https://raw.githubusercontent.com/professorDeveloper/CS-1.6/main/v_{name}.mdl`.
* Independent comparison template: `https://www.vertigogaming.org/downloads/cstrike/models/v_{name}.mdl`.
* `mp5navy` uses `v_mp5.mdl`.
* `shield` uses `https://www.vertigogaming.org/downloads/cstrike/models/shield/v_shield_knife.mdl`. CS uses combination shield viewmodels; this canonical ID displays shield plus knife, not a fictional standalone shield model.
* **28 of 30** files matched the two mirrors byte-for-byte. The Elite comparison encountered `SSL: UNEXPECTED_EOF_WHILE_READING`; its primary MDL downloaded and converted successfully. The shield comparison URL on GitHub returned 404; its Vertigo model downloaded and converted successfully.

Every source URL, resolved URL, timestamp, byte count, SHA256, comparison hash, and acquisition error is recorded in ignored `public/assets/weapons/sources.json`. Raw models total 8,546,580 bytes. `manifest.json` records converted JSON hashes, original hashes, counts, and warnings. JSON/PNG, raw MDL, and these manifests all stay beneath the already-ignored `public/assets/weapons/` directory.

For a reproducibility anchor, the AK-47 source SHA256 is `6eb08a5e76210712ad787949e244fd57346b1836a7462f3a436976126e270fa3`; it has 564 source vertices, 1,050 triangles, 42 bones, and 11 textures.

Mirror agreement is evidence of the downloaded data, **not authentication against a licensed retail installation**. `retailHashVerified` is false. `source: 'original-mdl'` means geometry, textures, and tracks came from the recorded actual MDL bytes; it does not establish a retail version, ownership, or permission to distribute. Public availability does not establish a distribution license. Neither the binaries nor their derived JSON/PNG should be bundled or published with the repository.

## Reproduce locally

Python 3 uses only the standard library. Three is the project's existing dependency.

```sh
python3 tools/fetch-weapon-assets.py --compare-mirror
python3 tools/import-weapons.py
node --check public/weapon-model.js
node --test tests/weapon-model.test.mjs
```

Use `--ids ak47 awp` on either tool for a subset. The fetcher has a 16 MiB per-file cap, accepts HTTPS only, validates signature/version/declared length, and saves hashes. It never runs downloaded data. Network failures are recorded and produce a nonzero exit status when an asset cannot be acquired. The importer verifies the raw SHA256 before conversion. An owner's locally obtained MDLs can also be placed under `raw/` with matching relative `file`, `sha256`, and provenance entries in `sources.json`; no network is required to import them.

Supported canonical IDs:

```text
glock18 usp p228 deagle elite fiveseven m3 xm1014 mac10 tmp mp5navy
ump45 p90 galil famas ak47 m4a1 aug sg552 scout awp g3sg1 sg550 m249
knife hegrenade flashbang smokegrenade c4 shield
```

## Conversion and coordinate conventions

The format schema was checked against the local ReGameDLL `regamedll/engine/studio.h`. Public reference: [ReGameDLL studio structures](https://github.com/rehlds/ReGameDLL_CS/blob/master/regamedll/engine/studio.h). Animation layout/interpolation was checked against [Valve's studio renderer](https://github.com/ValveSoftware/halflife/blob/master/cl_dll/StudioModelRenderer.cpp). The Python and JavaScript here are new implementations, not imported SDK implementation files.

The converter checks every accessed span, count, index, and finite transform, and applies geometry, pixel, and animation budgets. Invalid parent references, vertex/normal indices, skin references, malformed RLE runs, and command/header triangle-count disagreements fail conversion. It parses:

* All bodyparts and submodels; source vertex and normal arrays with their **separate bone indices**.
* Triangle strips and fans, including alternating strip winding. CW studio faces become CCW Three indices. This changes the convention, not the shape or topology.
* Bone parent hierarchy, local default translations/rotations, channel scales, and controller metadata. No bone/weapon is independently resized or recentered.
* All skin-family references and embedded 8-bit indices plus RGB palettes. RGBA PNGs preserve every palette texel; masked index 255 becomes transparent. Texture flags are retained.
* Attachments and sequence labels, FPS, frame counts, events, motion metadata, and signed 16-bit RLE channels. All 209 acquired sequences are internal group 0, single-blend sequences and were imported.

JSON retains GoldSrc bone-local coordinates, radians, and integer pixel S/T. Runtime composes the original hierarchy, samples translations and quaternion rotations, and deforms vertices and normals using their respective bones. Fractional translation sampling retains the studio RLE run-boundary hold behavior. This is CPU skeletal deformation, not a Three `SkinnedMesh`, and it does not invent motion tracks.

Stock viewmodels are authored on the left. For the right-hand view the camera-space basis is **`(X,Y,Z) -> (Y,Z,-X)/40`**. The reflection acts on geometry and attachments; **U is not reversed**. Three accounts for the negative world-matrix determinant when culling. PNG `flipY=false` and UV `(S/width,T/height)` preserve the source image convention. `/40` is the same single uniform unit conversion used by the map importer, with no per-weapon dimensional changes.

## Runtime contract

```js
const view = await createWeaponView(THREE, camera);
await view.setWeapon('ak47'); // Await when asset readiness matters.
view.update(dt, playerState);
console.log(view.info());
```

The factory attaches `group` to the camera and initially loads `glock18`. `setWeapon(id)` installs an immediate distinguishable fallback, then loads the requested original asynchronously; its returned promise is safe to ignore, and stale loads cannot replace a newer choice. `info().loading` indicates a pending load. Missing assets, invalid geometry/provenance, failed JSON checksums, or failed texture loads leave an honest fallback with the error message. `sourceSHA256` is null and `animationSupport` is `none` for fallback. The fallback is a magenta wire schematic, never labeled as an original weapon.

The outer group starts at the existing caller's **`(.25,-.24,-.42)`**. The original-model child cancels that fixed translation so native eye-origin coordinates land at the camera; subsequent caller recoil deltas remain effective. `update` never writes the outer group's position/rotation. If integration later changes the caller's neutral origin, update this one shared compatibility translation, not individual model shapes. With the current legacy API, setting the outer group to zero does **not** represent the neutral pose.

All weapon meshes use layer1, foreground render order100, depth testing/writing, no fog/shadows, and no tone mapping. The client renders world layer0 first, clears depth, then renders weapon layer1 without clearing color. This preserves weapon self-occlusion without letting nearby walls cover it. `muzzle` is a mesh with caller-owned visibility and follows attachment0 when present; the flash itself is procedural. Do not flash knives or utility items.

`info()` includes `id`, `source`, `sourceSHA256`, source URL, counts, imported/total sequence counts, available labels/FPS/frames, current sequence/frame, warnings, transform details, and animation limitations. `convertedSHA256Verified` is true when browser Web Crypto checked the converted JSON against the local manifest. On insecure LAN HTTP without Web Crypto it is false; source SHA256 remains provenance recorded by the importer, not a fresh browser verification.

Animation controls accepted by `update(dt, playerState)`:

| Field | Meaning |
| --- | --- |
| `weaponSequence` | Exact source sequence label or zero-based sequence index. Takes precedence over heuristics. |
| `animationToken` | Change this to restart the same explicitly selected sequence. |
| `weaponFrame` | Optional explicit fractional source frame; clamped to that sequence's range. |
| `skin`, `body` | Original skin-family index and GoldSrc body selection integer. Defaults to zero. |
| `reloading` or `reloadAt` | In heuristic mode, a newly truthy value selects the first `reload*` sequence. |
| `ammo`, `lastShot` | In heuristic mode, observed ammo decrease or advancing shot time selects the first `shoot*`, `fire*`, or `slash*` sequence. |

Without explicit controls, switching selects the first `draw*` sequence, then the first `idle*`. Unflagged idle sequences are restarted as a presentation heuristic. Heuristics choose available source motion; they do not reproduce CS weapon state machines. Shotgun `start_reload`/`insert`/`after_reload`, silenced/unsilenced variants, Elite left/right shots, shield raise/lower, grenade throws, C4 button presses, and knife variants should be selected explicitly for faithful gameplay synchronization. Unknown/unimported explicit sequences retain the existing pose/sequence; `availableSequences` exposes which labels are usable.

## Verified result and limits

The focused tests passed with all private assets installed (4 tests, no skips):

* All 30 raw and converted file hashes, mesh counts, triangle indices, bone references, and imported sequence counts validate.
* Every texel of every PNG equals the source palette lookup, with valid PNG CRCs/dimensions.
* Real Three geometry loads for all IDs using a filesystem-backed texture loader. Known AK-47 muzzle coordinates match the original attachment transformed to camera space. A real reload sequence changes the vertex geometry, and caller transforms/visibility survive updates.
* Missing assets/textures, unknown IDs, weapon switching races, truncated headers, invalid spans/counts, malformed RLE, and an out-of-range real triangle index are checked.

These focused tests do not exercise WebGL. Separate real-server browser and shop/client browser checks exercise the integrated renderer, and screenshots are inspected; there is still no pixel-for-pixel retail comparison. Fidelity limits:

* Original pixels use unlit Three materials. GoldSrc lighting, gamma, texture filtering, viewport/FOV behavior, view bob, and depth-range rendering are not reproduced exactly. The caller's FOV/near plane affect appearance.
* The separate foreground pass fixes self-occlusion, but is not an exact port of GoldSrc depth-range/viewmodel rendering. Near-plane/FOV behavior and material lighting remain different.
* Sequence events are preserved as data, not executed. Sounds, shell ejection, engine event timing, transition blending, aim/FOV changes, and gameplay state synchronization are not implemented here. Existing outer recoil can combine with imported shot motion.
* General external texture companion MDLs are rejected. External sequence groups retain metadata but no tracks. Multiblend models import blend 0 with a warning; controller input uses rest values. None of those gaps affects the 30 acquired viewmodels.
* Chrome/legacy alpha material flags are retained but not emulated, with warnings when encountered. None of these acquired textures needs those flags. Masked and additive flags have basic material support.
* No retail hash verification or redistribution rights were established. Source hashes and mirror comparisons document exactly what was tested, not a distribution grant.


## Flying grenade presentation

`public/projectile-models.js` reuses the validated local viewmodel data and only
selects model 0 of its `weapon` bodypart. Hand and arm bodyparts and their
textures are excluded. Meshes are baked into a common rigid local frame,
centered, rotated to world up with a positive-determinant basis, and uniformly
scaled by 1/40; original pixel UVs and the three body/top/lever textures remain.
This is a viewmodel-body presentation, not an independently imported `w_` model
or a claim of retail world-model fidelity. No derived asset is added to Git.

The three types use at most nine reusable instanced meshes for up to 64 visible
projectiles. Position still comes from the authoritative snapshot; `bornAt`
and `resting` drive cosmetic tumble/settling only. The point-sized collision,
velocity and fuse stay in the grenade simulation. Models/textures load once,
with late completion and disposal guarded. Missing/invalid assets retain an
explicitly diagnosed procedural canister/cap/lever fallback, never a sphere.

`npm run test:projectiles` captures a local WebGL appearance review and checks
batch/geometry bounds; `npm run test:utility` also verifies this rendering in
the real client. Neither starts or restarts the current game service. These
checks do not measure physical multiplayer or claim a hardware FPS result.
