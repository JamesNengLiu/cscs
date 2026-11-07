# CS2 独立对战版集成与验收

本轮把已验证的 CS2 Dust2 场景接入完整对战。原 `v1.0.0` 与 `main` 已跟踪文件保留；实验内容使用 `cs2-*` 独立入口。没有自动提交、推送、停止或替换现有 3001 服务。

## 范围与实现

| 计划部分 | 独立版实现 |
| --- | --- |
| 地图与 CPU 世界 | 原始 CS2 布局/尺寸、材质、烘焙光照、PVS；原 PHYS 凸体/网格与分离触发区，30 个出生点。Worker 完成完整碰撞编译，主线程接收紧凑 typed-array 结构。 |
| 完整战斗 | 输入排序、AWP 射击/连续 Q、弹药、购买、回合、经济、投掷物、C4、服务器命中及历史回溯；查询均绑定新世界。 |
| 人物 | 原生 Phoenix/SAS 加权模型、同源 world 动作；服务器与画面共用骨架采样及每阵营 19 个源胶囊。连续步态相位按源足底轨迹派生候选推进，保留方向回退和误差声明。动作衔接、瞄准俯仰、受击与死亡均在同一采样路径处理。 |
| 枪械与手臂 | 原 24 枪目录对应的真实 CS2 模型与专用次骨架动作，刀、三类手雷、C4；包含左右手、快切、原生动作声音事件及分段逐壳换弹。M4A4 是资源附加样本，当前商店兼容键 `m4a1` 对应 M4A1-S。 |
| 命中与声音 | 保留墙面弹孔/碎屑、人物血/甲/头盔反馈、爆炸表现；所有枪声变体与源动画声音事件使用原生音频，空间定位、隔墙柔化和去重使用独立适配。 |
| 准星与瞄镜 | 静态/动态准星、本地样式设置；保留 AWP 开镜/快切路径。AUG/SG553 使用真实 ADS 姿势、射击动作与镜片几何，转场和镜片红点为浏览器适配。 |
| 规则 | 已提取 vdata 的伤害、弹夹、射速、速度、准度系数、恢复参数及反冲参数；独立 CS2 候选移动 profile，保留已验证的 60 Hz 预测/碰撞求解。 |
| 烟雾 | 深度截断的体积积分；最近 4 体积精细采样及短时弹孔/HE 扰动，溢出体积保守遮挡。无烟不加全屏绘制；自动分辨率使用实际活动视口。 |
| 隔离与联机 | 地图/碰撞/规则/武器/人物资源契约一致后才允许加入；递归依赖检查阻止旧 BSP 偷渡。独立 WS/QUIC 编解码预算支持完整大快照。实验设置写入独立命名空间。 |

## 保真边界

这是一套采用真实资源和数值的浏览器实现，不是 Valve 零售客户端源码移植。下列内容不能按“已一比一校准”交付：

- 反冲种子生成和积分、精度积分/恢复、护甲/穿透能量、共享弹药池适配及部分受击减速仍有工程近似。
- 移动使用固定 60 Hz 命令和现有碰撞求解；候选摩擦、跳跃、蹲起等参数没有零售玩家回放认证，不是 Source 2 subtick。
- 原生动作通过共享混合层执行，未移植完整 animation graph、IK、布料、约束和 ragdoll。死亡采用明确选定的真实动画。
- Three.js PBR、镜片与体积烟雾不是完整 Source 2 shader/流体系统。受预算限制的溢出烟雾保守遮挡，不静默透明。
- 电台、部分地表与环境音仍可显式回退原有声音；Source 2 完整混音曲线未移植。
- 保留项目的补足式换弹、共享弹药池与自定义经济。Valve 在 2026 年新增的整匣弃弹及长按 R 静默换弹规则尚未接入；数值来源采用固定的新版本 vdata，不能据此声称已复刻全部最新规则。[官方整匣换弹说明](https://www.counter-strike.net/newsentry/532126482488623360)、[官方静默换弹说明](https://www.counter-strike.net/newsentry/674006995886407685?l=english)。
- 自动化、CPU、GPU 与实体多机验收分别记录；一个浏览器加九个协议客户端不能代替十台机器或真实局域网公平性认证。

## 运行

完整实验版入口是 `cs2-server.mjs`，页面为 `/cs2-play.html`。命令只在明确执行时启动服务，不接管已有进程。

```sh
# 本机安全上下文 + 原生 QUIC；默认仅回环3001。
node tools/start-cs2-secure.mjs

# 只有需要局域网连接且3001已安排给实验版时才显式绑定网卡。
HOST=0.0.0.0 node tools/start-cs2-secure.mjs
```

证书只放 `.local/cs2/certificate/`，不修改系统信任，不覆盖 1.0 证书。已有3001被占用时启动会失败，不会杀掉它。源码/分支变更不等于重启授权。

## 资源重建

地图、物理和内容素材均保持 `.gitignore` 隔离。定向原资源准备及官方 CRC/摘要核验见 `tools/cs2-content-README.md`。它们不随代码提交，不是游戏完整安装包。

```sh
# 在原生内容 manifest、模型、metadata、world clips 准备好后：
node tools/cs2-content-locomotion-audit.mjs --family=all --output=locomotion-stride-all-families.json --publish
node tools/prepare-cs2-runtime.mjs --build-rigs

# 已有稳定rig，只重新生成独立资源/规则契约：
node tools/prepare-cs2-runtime.mjs
```

`runtime.json` 是生成的契约包，不进入素材 manifest 的 files 自引用列表。actor 动作映射保存在纯符号的 `tools/cs2-actor-action-map.mjs`，重建不依赖私人绝对路径或 `.local` 中的唯一配置。

## 验证收据

以下是已完成的分项验证。收据保存在本地 `artifacts/` 与 `.local/cs2/`，不随素材或代码提交。

| 验证项 | 已取得的证据 | 收据 |
| --- | --- | --- |
| 完整自动回归 | `node --test --test-concurrency=2 --test-reporter=tap tests/*.test.mjs`：2145/2145 通过，失败、跳过、取消及 todo 均为 0；40.575 秒。临时网络测试使用随机回环端口并自动关闭。 | `.local/cs2/final-regression.log` |
| 离线资源与步态 | 9 项离线测试通过；33 个模型、321 个 clips、354 个声音条目完成闭包校验。72 个方向步幅候选中，48 个使用双足接触轨迹，24 个显式回退至同族北向候选；它们不是零售步态测量。 | `.local/cs2/content/closure-report.json`、`.local/cs2/content/locomotion-stride-all-families.json` |
| 浏览器战斗与武器 | 原生 Chrome 真地图中，24 枪均实际装备、单发、换弹；冷切换仅保留一个武器根节点且无幽灵开火。验证原生投掷物、AUG/SG553 ADS、命中、约 111.55 ms 历史回溯、墙阻挡及死亡动作。 | `artifacts/cs2-arsenal-browser.json` |
| 独立 WS 步态补证 | 2.083 秒真实 WS 补证中，9 人各采集 62 个样本；相位首尾净增 0.848–0.889，walk/duck 权重均到达 1，9 个可见原生人物均执行混合层。187 个来源摘要与完整 GPU 收据相同，fixture 已关闭。此项单独采集相位数值，不属于完整 FPS 窗口。 | `artifacts/cs2-native-phase-ws-supplement.json` |
| 合成刷新率数值回放 | baseline/responsive × 合成 60/120/144/240 Hz 共 8 组，每组 360 个固定 tick、3 次起跳/落地；最终位置、速度、疲劳和步态相位逐值相同。6768 次相机几何检查与骨矩阵有限检查通过，创建 0 个 WebGL context；187 个来源摘要与完整收据相同，fixture 已关闭。此项是独立数值回放，不认证实际高刷显示、FPS 或输入延迟。 | `artifacts/cs2-numeric-refresh-browser.json` |
| 换弹与长帧 | Nova/XM1014 的 8 个正常场景，加 AK47 800 ms、XM1014 900 ms 长帧场景，共 10/10 通过；核对 Insert/AddAmmo 事件边界与过期声音清退。 | `artifacts/cs2-shell-reload-browser.json` |
| 原生 WebTransport | 原生 HTTP/3 QUIC 无 WSS 回退；89,291 字节状态经 95 个 datagrams 完整重组，另验证大可靠消息的控制流分块。 | `artifacts/cs2-wire-webtransport.json` |
| 静态 I/O 与原生音频 | 大文件 HEAD/304 不打开内容流；首块中止后仅读取 131,072 字节。5 条暂停流每条读取小于 1 MiB，约 1.017 秒内权威端推进 59 ticks。真实 2,500,820 字节烟声音频解码、播放并释放；原生引擎只将编码上限调至 4 MiB，缓存与解码上限仍为 64/16 MiB。 | `artifacts/cs2-io-audio-browser.json` |
| 烟雾像素与视口 | 7 项烟雾检查及 6 个小像素/深度视口案例通过，覆盖墙后遮挡、弹孔、HE 扰动和第 5 个保守溢出体积；这些案例不测吞吐帧率。 | `artifacts/cs2-smoke-browser.json`、`artifacts/cs2-smoke-viewport-browser.json` |
| 首次烟与 FX 编译探针 | T/CT/A/B 首烟、MUP 开/关各检查首 30 次连续回调；新增首次 HE、金属命中 glow 的实际 RT 路径探针通过。最新探针以 234 个 programs 为基线，触发路径未新增程序，187 个文件摘要在采样前后相同。 | `artifacts/cs2-first-smoke-all-regions.json`、`artifacts/cs2-mup-smoke-probe.json`、`artifacts/cs2-first-he-glow-rt-probe.json` |
| 完整持续 GPU 压力 | `completed`、`full-performance`、非 quick/probe，共 20 阶段：T/CT/A/B 各 30 秒无烟，随后 16 个移动射击、1/4 烟及 auto/performance 压力阶段各 15 秒。29,794 个主测窗口 RAF 帧，74.996–75.007 fps；最坏 P99 15.4 ms、最大 15.5 ms，0 个 >33 ms 帧、0 个长任务。16 个压力阶段均实际观测到 10 人移动和射击；12 个烟阶段首 30 次回调 RT 程序均无新增。187 个来源文件起止摘要一致，fixture 已关闭。 | `artifacts/cs2-combat-performance-final.json`、`artifacts/cs2-combat-performance-final-summary.json`；测试方法快照 `artifacts/cs2-combat-performance-final-source.mjs` |
| 临时资源清理 | 删除 4 个批准目标中的 180 个临时文件，保留 11 份小型审计记录，净分配空间减少 3,249,065,984 字节。3737 个受保护文件的 metadata 与 79 个关键文件摘要均无变化；保留 raw 输入、Source2Viewer 与最终 public 资源。清理后 187 个来源文件仍与最终 GPU 收据相同。 | `.local/cs2/content/cleanup-records/20261105T095723.271607Z/receipt.json` |

持续采样环境为 Apple M1 Pro、原生 Chrome 156、有头前台、1920×1080 视口与 DPR 1。sharp 阶段始终有 9 个远端原生人物可见；performance/auto 个别阶段最低 7–8 个，其余为 9 个。performance 渲染比例为 0.85，烟雾目标逐样本核对实际活动视口。各阶段末尾滚动窗口的 GPU timer P99 为 8.279–15.997 ms，CPU render-submit P99 为 3.1–6.7 ms；这两项与整段 RAF 回调统计口径不同。烟雾首 30 次连续回调另行记录，最坏间隔 24.7 ms，未混入主测窗口的 15.5 ms 最大值。冷资源就绪为 8.94 秒，RT 预热为 1.454 秒；主动 GC 后 JS 堆为 482–556 MiB，不能据此推算整个进程或 GPU 显存占用。

首次烟修复过程曾测得 world/composite 两个 pass 的 CPU 提交分别为 4.3/0.2 ms；这不是 GPU 耗时或完整帧耗时。首 30 次回调记录的是连续回调间隔。上述短探针用于检查首次编译停顿；其旧来源数据不替代最终冻结版本的持续渲染结果。此前失败、中止或使用非法烟寿命夹具的采样均不计为持续验收通过，旧 98-clips 人物 CPU 样本也不作为最终版本性能结论。

浏览器压力测试使用一台浏览器和九个 WS 协议客户端；自动化、CPU 提交、GPU 查询与帧回调分别解释，不代表十台实体机器、物理高刷新率、输入到光子延迟或局域网公平性认证。验收范围仍是本项目的可玩迁移版：保留补足式换弹、共享弹药池和自定义经济，未接入 2026 年整匣弃弹与长按 R 静默换弹规则，也未完成零售 Source 2 的 subtick、IK、ragdoll、完整 shader 或反冲生成器校准。
