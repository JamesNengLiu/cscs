# Original MDLv10 player assets

## Consumer contract

`public/assets/players/manifest.json` uses `schema: "goldsrc-players-v1"` and
`models[id] = {source: "original-mdl", file: "{id}/model.json", sourceSHA256,
convertedSHA256, counts, ...}` for terror, leet, arctic, guerilla, urban, gsg9,
sas and gign. All downloaded binaries and converted JSON/PNG stay ignored.

Each model uses `schema: "goldsrc-player-v1"`. Bones, textures, skins, bodyparts,
meshes and per-bone animation channels retain the existing
`goldsrc-viewmodel-v1` shapes. **Every sequence has `blendTracks[blend][bone][axis]`**;
axis 0–2 is position and 3–5 is rotation. Channels are `null` (bone default) or
`{values: int16[], positionHold: int[]}`. `tracks` equals `blendTracks[0]` for
existing samplers (JSON repeats that value; there is no hash indirection).
Decode using the bone's original `value` and `scale`. Sequences retain
`blendCount`, `blendType`, `blendStart`, `blendEnd`, and `blendParent`.

`hitboxes` are `{bone, group, min: [x,y,z], max: [x,y,z]}` in source bone-local
coordinates. `metadata.headBones` contains `{index, name}` entries;
`metadata.headBoneIndices` and `metadata.headBoneNames` provide parallel arrays
for custom-face consumers. No vertices or bones are rescaled or recentered.
Apply the single uniform `/40` conversion at runtime, shared with the map.
Texture files are `texture-N.png`, pixel S/T are unchanged, and triangle winding
alone is converted to CCW for the existing renderer.

`textures[].paletteRGB` retains all 768 original palette bytes, including unused
colors; `paletteSHA256` and `pixelIndicesSHA256` identify the palette and indexed
image separately. PNGs use exact RGBA palette lookups, with index 255 transparent
only when the original masked flag is set. `bodyparts[].models[].sourceGeometry`
retains all source vertices/normals and their separate bone indices, including
unused vertices. `meshes` contains the UV-split render geometry. Submodel
selection remains `floor(body / bodypart.base) % bodypart.models.length`.

`sourceHeader`, `sequenceGroups`, `transitions`, attachments (including type),
bone controllers, sequence events, motion/bounds/pivots/transition metadata and
the original source provenance are retained. `metadata.runtimeUnitScale: 0.025`
is documentation for the consumer; the converter never applies that scale.
For these eight files, **the head is index 7, named `Bip01 Head`**.

Optional third-person weapons use the same schema and converter, with
`metadata.assetKind: "third-person-weapon"`, under
`weapons/{canonical}/model.json` and `manifest.weapons`. Bone names are unchanged
so a renderer can merge bones by source name. `mp5navy` maps to `p_mp5.mdl`;
other IDs map to `p_{id}.mdl`. Missing files have explicit unavailable entries,
never synthesized geometry.

Match each weapon bone to the player by exact name. Weapon-only bones such as
`flash`, `Line02`, and `p_galil` remain in their source parent hierarchy; evaluate
those relative to the merged parent transform. Do not assume every p-model bone
has a player counterpart or center the p-model on its own bounds.

## Provenance and limits

Player downloads use
`https://www.vertigogaming.org/downloads/cstrike/models/player/{id}/{id}.mdl`.
Only raw data is fetched; downloaded code is never executed. Source timestamps,
URLs, SHA256, byte counts, comparison attempts, and rights status are recorded in
`sources.json` and preserved in model metadata. Rights are **unknown**. Full
source assets are **not retail-authenticated**; mirror agreement is not proof of
a particular retail release or permission to redistribute. Do not publish raw
or derived files. External sequence/texture companion files are unsupported and
must fail explicitly rather than silently omit animation or texture data.

The independent comparison attempted
`https://raw.githubusercontent.com/professorDeveloper/CS-1.6/main/player/{id}/{id}.mdl`
for all eight players; every URL returned HTTP 404. There is **no successful
independent player hash comparison**. The required Vertigo files all downloaded
and passed conversion. For the p-models, 18 of 24 matched the GitHub mirror
byte-for-byte; usp, xm1014, ump45, ak47, aug and awp comparison URLs returned 404.
All attempted URLs, errors and UTC timestamps are retained; comparison failure
does not substitute a different source or prevent conversion of the primary.

Format layout was checked against [Valve's studio structures](https://github.com/ValveSoftware/halflife/blob/master/engine/studio.h).
The existing RLE representation follows [Valve's studio renderer](https://github.com/ValveSoftware/halflife/blob/master/cl_dll/StudioModelRenderer.cpp).
`runpy` loads only the existing local `tools/import-weapons.py` and the new local
fetcher. Downloaded files are always data, never Python or executable code.

## Reproduce locally

Python uses the standard library. The test uses Node's built-in test runner and
invokes Python; it starts no browser or service.

```sh
python3 -B tools/fetch-player-assets.py --compare-mirror
python3 -B tools/import-players.py
python3 -B tools/fetch-player-assets.py --weapons-only --compare-mirror
python3 -B tools/import-players.py --weapons-only
node --test tests/player-assets.test.mjs
```

`--ids terror leet` selects players; `--weapons` adds firearms to a player run;
`--weapons-only --weapon-ids ak47 mp5navy` selects p-models. The 24 default IDs are:

```text
glock18 usp p228 deagle elite fiveseven m3 xm1014 mac10 tmp mp5navy ump45
p90 galil famas ak47 m4a1 aug sg552 scout awp g3sg1 sg550 m249
```

Knife and hegrenade/flashbang/smokegrenade are supported explicit
`--weapon-ids` choices but were not requested or fetched in this run. There is
no fake entry for these optional assets. No canonical firearm was absent.
For a missing requested asset, `manifest.weapons[id]` has `source: "unavailable"`,
an error and provenance, without a fabricated model file or checksum.

Existing raw files are immutable: identical downloads leave their bytes alone;
different downloaded bytes are rejected, preserving previous provenance plus a
failed-refresh record. Import verifies the source SHA256 before decoding.
Both CLIs constrain output to the ignored player directory, resolve paths to
reject escapes, and limit manifests to 2 MiB when read. The existing repository
`/public/assets/` ignore rule covers every source and derived player file;
`git check-ignore` confirmed representative raw/JSON/PNG paths.

Limits include 16 MiB per raw file, 4 download workers, at most 8 player plus
28 explicitly allowed p-model IDs, 128 bones, 256 textures and 16 Mi pixels,
32 bodyparts / 256 aggregate submodels / 1,024 meshes, 262,144 source vertices
and normals each, 200,000 triangles, 1,000,000 command corners, 2,048 sequences,
16 blends and 10,000 frames per sequence, 1,000,000 channel slots,
16,000,000 decoded samples across **all** blends, and 256 MiB per output JSON.
Invalid indices, hierarchy, finite numbers, offsets/counts, hitbox bounds, skin
references, RLE runs and triangle counts are rejected. External sequence groups,
texture companions, nonzero legacy group-0 data bases, obsolete automove payloads
and deformation groups are unsupported and fail explicitly.

## Measured local result

Completed on **2026-10-28 Asia/Shanghai** (source timestamps are UTC on October
27). Every player has 111 sequences: 45 single-blend and 66 nine-blend sequences,
for 639 complete blend tracks per model. Counts include every bodypart/submodel.

| Player | Source vertices | Triangles | Bones | Textures | Hitboxes |
| --- | ---: | ---: | ---: | ---: | ---: |
| terror | 396 | 784 | 53 | 2 | 21 |
| leet | 414 | 796 | 55 | 3 | 21 |
| arctic | 396 | 765 | 55 | 2 | 21 |
| guerilla | 417 | 828 | 53 | 2 | 21 |
| urban | 444 | 870 | 53 | 2 | 21 |
| gsg9 | 435 | 846 | 53 | 3 | 21 |
| sas | 426 | 832 | 55 | 3 | 21 |
| gign | 415 | 820 | 53 | 2 | 21 |
| Total | 3,343 | 6,541 | 430 | 19 | 168 |

Players total **888 sequences, 528 multiblend sequences, 5,112 blend tracks,
11,237,408 decoded samples and 5,765 render vertices**. Raw files total
18,861,584 bytes; model JSON totals 114,373,952 bytes. Plain blend arrays and
the repeated blend-0 compatibility field favor a simple consumer contract over
minimum download size. There is no animation hash table to resolve.

All **24 p-model firearms** converted: **1,782 source vertices, 4,584 render
vertices, 3,077 triangles, 24 textures, 53 hitboxes and 24 single-blend sequences**.
Their raw files total 688,468 bytes; model JSON totals 1,078,506 bytes.

Reproducibility anchor: terror source SHA256
`f2cca62fb9dd22c49c8421b2a89bb6ca92a1fbd08733ddfb75baebe6f3c37ca5`.
All 32 raw/converted hashes and source metadata are in the ignored manifest.

The focused run passed **5 tests, 0 failures, 0 skips**. It checks a synthetic
nine-blend fixture, malformed late blends and hitboxes, sample budgets and path
escapes; all local hashes and dimensions; every original mesh corner and its
separate vertex/normal bone, palette byte/PNG texel, hitbox, skin family and
decoded animation sample; sequence blend metadata/events; and all 24 firearm
entries. Source files still hash to their original acquisition SHA256.

This is acquisition/conversion validation, not retail rendering verification.
The integrated [player renderer](player-renderer.md) now consumes all nine-way
blends and merges source weapon bones; the parent performed a separate real
browser pass described in [character integration](characters-integration.md).
Exact source gait/state synthesis, dynamic controller behavior, events, GoldSrc
chrome UVs, and lighting/gamma are still not fully reproduced. Sequence events
are preserved as data and never executed. Chrome flags occur on leet, gsg9 and
sas textures. The acquisition/conversion subtask itself did not change browser,
game/server modules, services, git configuration/index, commits or pushes.
