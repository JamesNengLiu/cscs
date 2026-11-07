# CS2 匪家至黄车：已确认性能缺陷修复

本轮仅修改独立 CS2 验证版。修复长点射线候选过多、贴图流重复提交，以及同一人物模型内重复的骨骼 palette。保持弹道系数、后坐力、移动与跳跃规则、网络协议、原地图索引上传机制不变；1.0 源码保持一致。未重启现有 3001 服务、提交或推送。

## 点射线查询

`cs2-collision.js` 原来以整条线段的 AABB 收集三角形，约 208m 的 AK 射线在坡下或黄车附近可能遍历九万余候选。现在仅在 height=0、radius=0、未指定 halfExtents 时，为 triangle-only 子树及三角形 primitive 增加保守的线段/包围盒筛选。保留原左右遍历顺序和所有窄相、startSolid、tie、skin、材质结果；hull 及包含 hull 的祖先不做新 slab 拒绝，避免顶点边界与 plane volume 的微小外扩差异。

身体、带半径、显式 halfExtents 查询和穿透 rayIntervals 继续使用原候选收集器。真实 PHYS、随机与合成场景共 31,942 项检查零字段差异。真实 native game 固定 60Hz 输入的新旧对照覆盖 270 发 AK、9 发实际命中的 AWP 和可靠双 Q，2,136 个同 tick 的完整人物状态/事件比较一致，291 个 shot segment 一致。

同条件离线 AK 单发 CPU 中位约 19.55–33.84ms 降到 1.185–2.396ms。这是本机 Node CPU 数据；新实现仍记录到一个约 25.14ms 尾样本，未作 GC 等未经证实的归因，也不保证每次调用都小于一个 tick。

## 贴图流每帧额度

同一 RAF 时间戳的帧首、帧末 runtime.update 共用一次 `renderer.initTexture` 额度。每个材质 variant 单独推进，高 mip 升级与 preview 退清共用队列，避免一次 entry 隐含多个提交。首次加载继续独立泵送，原 160MiB / 10s 退清策略、原生 mip 内容与最终画质不变。

额度限制的是一次 texture 提交，可能包含多个 mip / cube face，不代表 GPU 命令数量、耗时或完成。正常下载、逐 variant 完成、同步新增 variant、退清取消、失败重试和销毁均有队列回归测试；浏览器验证保留首入帧，不等待全图高 mip 下载完。

## 人物骨骼重复工作

`SkeletonUtils.clone` 会为多个 SkinnedMesh 各建一个 Skeleton。同一个 owned 模型中，若 bones 对象引用、顺序和全部 inverse bind 矩阵严格一致，现共享一份 palette，保留每个 mesh 的 bind 矩阵及几何。人物之间、独立武器之间不共享；临时预热 clone 的独立 Skeleton 在编译后释放。

真实 4T + 5CT、AK/M4 的 9 人模型中，palette 从 63 份降到 18 份，对应 CPU 数组/骨纹理源数据 333,312 → 66,816 字节。1,717,988 次顶点变形检查和 252 个 mesh/姿态比较误差为零。纯 palette.update CPU 均值约 0.147 → 0.035ms/9 人帧；这不是完整渲染或 GPU 帧率收益。三角形和 draw 数没有因本优化减少。

本轮未使用单中心射线隐藏人物，也未直接把静态几何的 boxClusters 列表用作动态人物隐藏依据。真实站位的保守 3m 外接框常覆盖可见或未知 voxel，安全收益不足，贸然缩小框会增加墙角露出被误剔除的风险。

## 验证范围

完整单测与服务集成测试、原生模型 CPU 对照，以及独立浏览器 10 人八站验证分开记录。浏览器使用同机 Chrome / Metal、1920×913、DPR1；一个浏览器加九个真实协议 peers，不是十台物理机器。后台约 60Hz 回调不作为外接屏 75Hz 物理呈现或实物鼠标延迟认证。

最终完整 `npm test` 为 **2,281 通过，0 失败/跳过**。受限沙箱下初跑的 6 项失败均为本机随机端口 listen EPERM；获得仅回环测试执行权限后全部通过，未通过删测试或跳过用例处理。

最终八站均完成，流式队列结束时均为 0，384 次独立贴图状态采样中观测的同帧额度均不超过 1。两站另以最终代码各打 30 发、完成自动换弹，62 个权威墙面 segment 的 FX 均进入渲染提交，无 WebGL 或贴图流错误。接收至提交最大约 17.8ms；这是 JS 提交，不是 GPU 完成/像素可见。该回环 WS 测试没有复现远程秒级补弹孔，不能据此宣布真实局域网问题已完全解决。

归档的旧版八站 GPU P99 较低，因此另外做了近时的新→旧渲染→新三次对照。只在自有测试浏览器中覆盖旧 actor / texture stream / optimized renderer 三个模块，实际响应 SHA 均校验；生产文件、弹道和服务器版本一致，诊断采样开关关闭，1920×913 / ratio1。

| 地点 | 新 A / 旧渲染 / 新 B 转头 CPU 均值 | 新 A / 旧渲染 / 新 B 全阶段 GPU P99 |
| --- | --- | --- |
| 匪家坡上 | 7.56 / 7.77 / 7.02ms | 7.58 / 9.60 / 14.75ms |
| 黄车旁 | 4.94 / 5.20 / 4.97ms | 9.91 / 11.53 / 10.39ms |

两次相同新版的 GPU 尾耗时也明显不同，不能把归档与当次差值直接归因代码、GC 或硬件温度。本组两次新版的 CPU 均值较低，GPU 短样本仍有较大波动，不用于宣称整体帧率提高或认证高刷。

随后在同一浏览器、同一固定坡上场景中，停止游戏 RAF、网络、音频与自有 authority，等待流式队列完成，保留原生 9 人 AK/M4 模型和相同镜头。旧版每 mesh 独立 palette 与新版共享 palette 都常驻，交错 6 块，每块预热 30 帧、采样 120 帧；逐帧 info.reset 并执行相同 world + viewmodel 双 pass，避免漏测 Skeleton.update。

每帧 308 draw、1,449,256 三角形、234 programs 完全相同，63/18 份 palette 的矩阵误差为零。旧三块 GPU 中位为 7.09 / 7.27 / 7.00ms，新三块为 7.84 / 6.53 / 6.85ms；新首块较慢、后两块未变慢，没有一致方向的 GPU 回退，也不能据此宣称 GPU 提升。CPU 提交均值旧为 5.02 / 4.79 / 4.81ms，新为 4.77 / 4.51 / 4.65ms。720 个 distinct GPU queries 均完成，无 disjoint、expired、pending 或 WebGL error。

隔离夹具初次因 loopback 权限、随后因缺少 bringToFront 的测试焦点等待而退出，均未进入 GPU 采样；失败收据保留。补齐焦点、显式朝向 A 门斜坡及有界等待后的首次有效采样完成，未靠反复选择有利结果收尾。临时浏览器、profile 和 authority 均关闭。

## 仍需现场核实

尚不确定远程机器实际使用 QUIC 还是 WS，以及是否存在 state 与可靠 shot 事件通道偏斜。本轮没有更改协议、伪造提前命中或增加延迟补弹孔。继续保留默认关闭的 `?shotDiagnostics=1`，供真实远程机器复现后立即导出；先确认双方当前可达的 LAN 地址。

## 本地收据

- `.local/cs2/yellow-car-audit/node-slab-landed-results-2026-11-06.json`
- `.local/cs2/yellow-car-audit/native-game-landed-results-2026-11-06.json`
- `.local/cs2/actor-render-audit/real-palette-equivalence.json`
- `.local/cs2/actor-render-audit/actual-9actor-pvs-upper-bound.json`
- `artifacts/cs2-yellow-car-diagnostics/confirmed-fixes-10p/report.json`
- `artifacts/cs2-yellow-car-diagnostics/confirmed-fixes-final-corridor/report.json`
- `artifacts/cs2-yellow-car-diagnostics/confirmed-fixes-final-shots/report.json`
- `.local/cs2/confirmed-fixes-2026-11-06/render-adjacent-comparison.json`
- `artifacts/cs2-palette-single-scene/2026-11-06-fixed9-focus/report.json`
- `.local/cs2/confirmed-fixes-2026-11-06/`：版本范围、测试日志和汇总。

上述原始素材、派生素材与测试收据均留在本地忽略目录，不纳入提交。
