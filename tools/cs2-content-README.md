# CS2 独立内容准备

本管线只写 `.local/cs2/content/` 和 `public/assets/cs2-content/`，不启动服务、不改变 1.0 素材。原版、派生素材和收据继续由 `.gitignore` 隔离，不提交到 Git。

固定来源为 Steam app 730 / depot 2347770 / manifest `6679288287140932208`。只下载官方原索引中选定的资源范围，`tools/cs2-depot-chunks.py` 保留原 Steam chunk SHA1 与偏移，提取时核对原 VPK 的 CRC。稀疏 VPK 临时文件不能称为完整游戏文件，不发布它们。

资源转换需要 Python 3；`export` 使用 Pillow，可在本地隔离虚拟环境中准备（运行游戏本身不需要 Pillow）：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install Pillow
# 后续转换命令可用 .venv/bin/python 替代 python3。
```

本机验证的转换器为 Source2Viewer CLI 20.1，来源是 [ValveResourceFormat 作者发布的 macOS arm64 包](https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/20.1/cli-macos-arm64.zip)，54,131,516字节，SHA256 `3e3196a678a8f010c345b49bac67c63bc7af0ef02e4543bb7a80b7508c1eefc4`。其他系统应从同一作者的 [20.1 release](https://github.com/ValveResourceFormat/ValveResourceFormat/releases/tag/20.1) 选择匹配架构的包并核对其摘要，不能套用此 arm64 摘要。

工具放在本地忽略的 `.local/cs2/tools/source2viewer/`，不随源码提交。源码坐标核对固定至 ValveResourceFormat commit `7d9e6c9eb70cb3e6510415ac56e2e1ea2a355836`；本机下载收据可保留在 `.local/cs2/tools/source2viewer-source.json`。不执行素材文件内任何脚本。

已有工具与索引时，依序运行：

```sh
python3 tools/prepare-cs2-content.py catalog
python3 tools/prepare-cs2-content.py requests
python3 tools/prepare-cs2-content.py delta
# 按 tools/cs2-depot-chunks.py 帮助对 requests-delta.json 做增量下载、CRC 提取。
python3 tools/prepare-cs2-content.py expand
# 继续下载新增依赖，重复 expand，直到非引擎资源闭包稳定。
python3 tools/prepare-cs2-content.py audio-requests
# 下载最后的声音资源。
python3 tools/prepare-cs2-content.py metadata
python3 tools/prepare-cs2-content.py export
python3 tools/prepare-cs2-content.py audio
python3 tools/prepare-cs2-content.py manifest
node --test tests/cs2-content.test.mjs
```

`requests` 的第一次准备需要已有 `scripts/weapons.vdata_c`。该文件仅 26,903 字节，可先把它作为唯一请求提取。下载器不由本脚本自动安装，须核对官方固定 release SHA256 后放到项目临时工具目录，完成后删除。原始武器数值按 `_base` 继承展开；不是从维基拼凑参数。

当前产物契约：

- `manifest.json`: `cscs.cs2.content.v1`；33 个真实骨骼模型，覆盖原 24 枪 catalog 的 CS2 对应、M4A4 附加样本、CT/T 人物、手臂、刀、三种投掷物和 C4；另含独立命名动作、文件大小和 SHA256、声音索引。构建时保留其他适配器写入的顶层扩展。
- `models/{key}.metadata.json`: `cscs.cs2.model-metadata.v1`；原始骨名/父子关系/局部参考姿势、挂点、命中盒及 source SHA256。CT SAS / T Phoenix 各有 19 个 `cstrike` 胶囊，包含头颈、躯干及四肢。胶囊不在 glTF 中，由原模型各 MDAT 提取并检查一致性。
- `weapons-reference.json`: `cscs.cs2.weapon-reference.v1`；全部 66 个可拾取 `weapon_*`，包含特殊刀具和投掷物，并非 66 把枪。**原始 vdata 的 `weapon_m4a1` 指 M4A4；当前项目旧兼容键 `m4a1` 则按照 CS2 gameplay profile 映射为 `m4a1_silencer`（M4A1-S），两者不能混淆。** `usp` 对应 `usp_silencer`；`mp5navy` 对应 `mp5sd`。
- `audio.json`: `cscs.cs2.audio.v1`；真实 WAV / MP3 编码与扩展名、声音事件到资源的引用、旧相对 sound 名到新 URL 的桥接。直接枪声取官方事件 track 01；不把 Source2 复杂混音曲线声称为已经复刻。

全局转换是 `(X,Y,Z) -> (Y,Z,X) * 0.0254`。转换器仅在骨架根部烘焙换轴，子骨骼局部旋转保留原轴，局部平移乘 `0.0254`。**原命中胶囊端点在骨局部只乘 `0.0254`，再乘 glTF 对应骨骼世界矩阵，禁止再次换轴。** 服务端和客户端使用同一骨架采样及 in-place 水平根位移策略。

转换保留真实第一人称 `vnmclip`，含人物手臂和武器次骨架；不能用摆在镜头前的 world model 冒充原生 viewmodel。`viewmodelActions` 的每一项都按原 `m_szAnimSkeleton` 与 clip `secondarySkeletons` 精确匹配；Glock 的文件后缀是 `_glock`，Smoke 是 `_smoke`，G3SG1/M249 的闲置为 `idle1_*`，不能只按目录名拼接。`_default_pistol` / `_default_rifle` 实际次骨架分别就是 USP-S / M4A1-S，目录通用不代表套错武器。双持精英含左右 fire；手雷包含 pin/hold/fire 与 pullpin/throw 别名。角色动作只从 `world.*` 取，不能误接 `viewmodel.*`。标记 additive 的动作需要混合器支持，不能直接替换全身姿势；当前 fire 使用官方 `+non_additive` 变体。浏览器的动作状态、IK、声音事件编排仍属于应用适配。

CS2 官方 grenade world 动作目录没有独立 run/walk 八向动作，原引擎依靠动画图叠层。使用刀/手枪下肢与手雷上半身组合时须标记为应用适配，不能称为一比一原生图执行。glTF PBR 也不能完整承载 Source2 shader；网页纹理默认为 1024 上限，按武器分组加载。

`world/shared/` 有真实头部/胸部受击和非 ragdoll 死亡 clip。本小集包含 rifle/pistol/knife 各自 `flinch_head/chest +non_additive`、`death_chest_a`、`death_gut_a`、`death_rknee_a`，同时保留源时长、骨架和 additive 标记。可用性不等于零售版正常死亡必选这些 clip；浏览器的选择/混合/静态尸体仍属于应用适配。

`manifest.files` 排除 `manifest.json`、独立生成的 `runtime.json` 及整个 `rigs/` 目录：后两者由 runtime 的 actorRigs 独立摘要核验，不属于 extractor 产物，避免 envelope 自引用和 rig 重建造成陈旧摘要。修改 base manifest 后要重新生成 runtime envelope，单独重建 rig 不需要重导出素材。离线 `node tools/cs2-content-inspect-viewmodel.mjs` 会在内存中剥离材质并嵌入本地 buffer，再按 primary `wpn -> Qinv(.5,.5,.5,.5) -> weapon` 装配和真实加权蒙皮检查坐标；它不修改素材，也不代表浏览器/GPU/多机验证。

步态的原 VNM/glTF 根轨迹是 in-place，不能把固定 `1.6m` 当原生步幅。离线复测：`node tools/cs2-content-locomotion-audit.mjs --family=all --publish`。它以真实30fps骨骼世界轨迹的低Y支撑前掌反向速度推导候选，并把窗口、RMS、左右差、阈值敏感性和原文件摘要留在 `.local/cs2/content/`。发布的 `locomotion-strides.json` 包含72项：48个双足派生候选、24个明确同family/mode_N回退（包括单侧样本不足和walk_NW左右速度差过大），不能把回退说成该方向已严格确认。该数据只供动画相位使用，不改变权威移动/弹道。发布后重建base manifest与runtime；不需要重新导出原模型和动作。

官方老 `characters/models/ctm_sas/ctm_sas.vmdl_c` 和 Phoenix 同名文件是约 4.8KB 的橙色立方体占位；本管线使用真正的 `agents/models/...`，不能以进程返回 0 或存在 glTF 文件当作导出成功。检查 meshes/skins、图片/缓冲链接、动作与胶囊覆盖后才发布。

最后保留必要 raw 来源与产物，删除稀疏临时 VPK、重复 mount、下载器 ZIP/可执行文件、早期占位模型和失败导出，减少无用磁盘占用。需要重做下载时重新核对固定工具摘要。
