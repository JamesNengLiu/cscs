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

The factory attaches `group` to the camera and initially loads `glock18`. `setWeapon(id)` keeps its Promise API but installs a ready cached original synchronously, before the switching frame renders. A cold load detaches the old weapon and stays visually empty while its validated model and decoded textures are pending; `info().loading` is true and `source` is `loading-original-mdl`. The debug fallback is installed only on an actual resource/error path. Stale loads cannot replace a newer choice. Missing assets, invalid geometry/provenance, failed JSON checksums, or failed texture loads leave an honest fallback with the error message. `sourceSHA256` is null and `animationSupport` is `none` for fallback. The fallback is a magenta wire schematic, never labeled as an original weapon.

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

## 2026-11-02：切换时粉紫占位网格

先用原生 Chrome、实际第一人称渲染器与本地模型逐帧复现：即使 HE／闪光／烟雾已在四槽缓存中，每次切换仍先安装粉色线框，再通过已完成 Promise 的回调装回真模型，九次热切换均露出一帧。复现时 HTTP 请求、模型哈希及材质加载均正常。另给 HE 的模型/贴图请求各加 120ms 测试延迟放大冷加载，捕获十七帧网格；该延迟不是正常网络耗时测量。

缓存增加仅引用现有模型的 ready 索引，命中时当帧安装并采样原 deploy/draw；冷加载期间不放调试网格，也不把旧武器当作新投掷物。就绪后再显示真模型。Promise API、四槽 LRU、最晚请求优先、校验与资源释放保留；淘汰和销毁同时清理 ready 引用。真正缺失、哈希错误或纹理解码失败仍保留明确的紫红线框和错误诊断，加载等待与资源失败区分显示。

首次修复验证时，完整自动化 **1112 项**通过，新增九项覆盖热切换同步、JSON/纹理等待、四槽淘汰、晚到结果、销毁、错误恢复、同 ID 的旧失败不得清除新缓存及单次资源释放。原生 GPU 十七个切换阶段加一个快速竞态场景通过；三种热切换九次均为 **零加载帧、零网格帧**，所有正常加载阶段零旧武器误显示，原贴图模型与转换哈希验证正常。截图和像素读回仅用于隔离视觉检查，不拿它们报告游戏帧率。

回归中还确认旧 `utility-presentation-browser.mjs` 夹具在修复前也会卡在 M4 射击断言：准星相机测试虚构了累计射击序号 10，随后独立 Game 从 0 开始，同一展示回合内的新序号 1 被视为旧记录。移除该相机测试不需要的假序号，保留反冲、准星位置和 M4 实际开火全部断言；未修改生产射击确认逻辑。三种投掷物准备/持握/投出/回主武器、连续双闪，以及主战枪恢复、FAMAS 连发和 AWP 快切后手动开镜回归通过；实际 QUIC/WSS 十四项回归通过。

`npm run test:weapon-switch` 可复测原生视觉专项；`--before` 需明确提供先前保存的 `WEAPON_SWITCH_BASELINE`。截图、报告仍位于被忽略的 `artifacts/weapon-switch-*`，不提交原模型、贴图或截图。此次只修改第一人称模型的加载/缓存交接，不修改投掷、弹道、后坐力、移动、网络连续性或原始素材。已验收的网络修复独立提交为 `d29da5d`，A/B 镜头与高刷验证独立提交为 `1651d7a`；本项单独提交模型交接修复与对应测试。前端刷新即可加载，本次提交不重启现有服务。

本次提交前在已合入 A/B 镜头与高刷验证的 main 上重新回归：完整自动化 **1185 通过、0 失败、0 跳过**；原生 GPU 十七个切换阶段及快速竞态场景均通过，九次热切换为零网格帧、零加载帧，全部正常阶段零旧模型误显示，并重新检查了 HE、闪光、烟雾的真实贴图截图。客户端投掷物呈现 **9 项**、连续双闪 **5 项**通过；B 镜头下的 **4 组**即时射击场景和 **7 组**主战武器/模式恢复检查通过。没有更改射击、移动、后坐力、跳跃或 A/B 相机代码。
