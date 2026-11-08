# CS2 投掷后续批次：公开证据与独立回放边界

本轮只研究现有 HE、闪光弹、烟雾弹。证据采集未安装工具、下载客户端或地图，没有启动服务。下面的公开研究值仍须与本工程的测试结果分开；作者称其验证成功，不等于我们已经复算成功。

## 官方和公开数据能确认的边界

- SteamTracking 固定提交 `cce7bf1f190144c1c08fb0fe75fd3c9514f2637f` 的 [ConVar 文本](https://github.com/SteamTracking/GameTracking-CS2/blob/cce7bf1f190144c1c08fb0fe75fd3c9514f2637f/DumpSource2/convars.txt)明确 `sv_gravity=800`、`sv_maxvelocity=3500`；其武器数据中的投掷速度为 750。它们不提供完整运行时算法。
- Valve [2023-11-02 更新](https://store.steampowered.com/news/posts/?appids=730&enddate=1700189319&feed=steam_community_announcements)确认烟雾弹存在最短引信，防止卡缝时过早起爆，但未公开该时长。
- Valve [2024-10-02 更新](https://store.steampowered.com/news/posts/?appids=730&enddate=1728089262&feed=steam_community_announcements)说明 HE 与闪光弹不能因为超过卡住反弹次数上限而提前爆炸。
- [CSmokeGrenadeProjectile schema](https://github.com/SteamTracking/GameTracking-CS2/blob/cce7bf1f190144c1c08fb0fe75fd3c9514f2637f/DumpSource2/schemas/server/CSmokeGrenadeProjectile.h)可观察烟雾生效 tick 与位置；[基础弹体 schema](https://github.com/SteamTracking/GameTracking-CS2/blob/cce7bf1f190144c1c08fb0fe75fd3c9514f2637f/DumpSource2/schemas/server/CBaseCSGrenadeProjectile.h)可观察初始位置、速度、出生时间及反弹数。字段声明不是算法或默认时长。

## 原作者研究候选

| 来源 | 候选值或行为 | 限定 |
| --- | --- | --- |
| [Memorin 出手研究](https://memorin.app/mechanics/grenade-throw) | 三档速度 202.5 / 438.75 / 675 u/s；眼位降低 `12×(1-strength)` u，向前 22u 做半宽 2u 的 hull 检查后后退 6u；自身速度向量乘 1.25 | 没有取得原始实验流。移动速度缓存时刻与实际构造时刻需要另外验证，不能用合成初态样本校准真人出手 |
| [Memorin 重力研究](https://memorin.app/mechanics/grenade-gravity) | 重力 320u/s²、无空气阻力；64Hz tick 内两个 1/128 秒子步，竖直位移使用施加重力前后速度平均值 | 作者的受控精确采集门禁只覆盖烟雾；其页面明确烟雾起爆时序没有采证 |
| [Memorin 反弹研究](https://memorin.app/mechanics/grenade-bounce) | 反射后整向量乘 .45；接触前 1/32u 停留；低速烟雾在向上法线大于 .1、反射后速度低于 20u/s 时休眠 | .1 法线值主要来自作者二进制转录，实测夹逼很宽；并非我们独立确定的常量 |
| [Memorin 跳投研究](https://memorin.app/mechanics/jump-throw) | 作者提出跳跃后 .1 秒缓存、.2 秒缓存有效期及一次延后构造；报道约 297ms 手动松键容错 | 没有公开原始按键时间线或可执行 fixture；不能据此给现有 60Hz 人物求解器硬塞 64Hz 速度阶梯，也不能宣称已经实现 Source 2 subtick |

另一原作者 [NC1107 的物理实验说明](https://github.com/NC1107/cs2-smoke-solver/blob/7ebba5b0443292886d2b2134e67b44736752d82d/physics-sim.md)也报告两次半步、整向量 .45 和无阻力，另外报告高能陡地面减振、19.685u/s 停止阈值及 floor-like 法线大于 .7。这些停止条件与 Memorin 有差异，应作为待比较候选，不能把两个研究的不同分支任意拼成“原版确证”。

本工程的固定服务器输入频率为 60Hz。弹体内部采用何种有界子步、接触余程和时间余量，属于独立可测的适配；不能通过更改全局 tick 来迁就投掷研究。恒重力的解析位移能解决自由飞行积分误差，但仅解析曲线吻合不足以证明碰撞时的原版积分顺序。

## 新取得的小型原版实验样本

公开研究仓库固定到 `7ebba5b0443292886d2b2134e67b44736752d82d`。只下载文本与小型实验样本，保存在忽略目录 `.local/cs2/grenade-trajectory-evidence-2026-11-07/`。该仓库软件使用 [PolyForm Noncommercial 1.0.0](https://github.com/NC1107/cs2-smoke-solver/blob/7ebba5b0443292886d2b2134e67b44736752d82d/LICENSE)；本轮没有将其实现或素材拷入生产代码，也未安装其 .NET 工具链。

取得的 [Dust2 验证报告](https://github.com/NC1107/cs2-smoke-solver/blob/7ebba5b0443292886d2b2134e67b44736752d82d/data/validation/de_dust2-20260909-225038.json)为 51,642 字节，SHA-256：`9ea003fe73a88b1109c6f8c171e85a9ac85c906858a2f418d5fa3ad4df894f4b`，含 60 个实验的给定初态和原作者报告的实际落点。

- `Pos`、`Vel`、`RealRest` 是 Source 的 X/Y 水平、Z 向上坐标，单位分别为 u 和 u/s；本工程映射为 `{x:sourceY×.0254,y:sourceZ×.0254,z:sourceX×.0254}`。
- `RealBounces` 和 `Detonated` 为实验结果；`PredictedRest`、`ErrPredicted` 属于原作者模拟结果，不能拿来充当我们的计算结果。
- 顶层 `build=2000899` 是提取碰撞 mesh 的版本，`serverBuild=2000908` 是实际运行服务器的版本。报告未携带 VPK/地图哈希，因此不能认证它与本工程的地图几何完全一致。
- 原作者插件通过 CS2 原生弹体构造函数注入给定初态。这些样本可用来检验飞行与落点，不能验证玩家鼠标操作、出手高度、跳投缓存或发射时的采样时刻。
- 原始插件会记录 `[tick,x,y,z,vx,vy,vz]`，并观察 `DidSmokeEffect` 翻转；但这份公开报告没有保留逐 tick 流和起爆时刻。仓库仅另含两条 308 字节的初态/落点 golden 数据，不能将它们描述成完整逐 tick corpus。

## 已实际执行的旧版独立回放

独立脚本从固定 `46dd5103c692d200d2ae849ad221fb790f94594b` 加载旧运行时及旧 profile，在本工程真实 CS2 CPU 碰撞包中重放上述 60 条初态，未使用原作者软件。地图 source SHA-1 为 `7dc529cd65d843a2b8a98c297e79b9923dd70a5d`，碰撞 SHA-256 为 `af6d31b6df6109aef2619e360a321ff17f4613f2cbdd460b6dd359d4fab6f5c3`。

旧版结果为 41/60 条出现烟雾，其余 19 条在十秒内未成功或被安全移除；有落点的 41 条中，误差中位数 11.228u、P95 145.846u、最大 385.318u。全部 60 条中只有 10 条落在 3u 以内、26 条在 48u 以内。未成功的样本必须单列，不得从总数里静默排除。

复现脚本 `replay-retail-baseline.mjs` 与收据 `retail-baseline-replay.json` 均在上述忽略目录。它们是我们实际执行的旧版测量，不是搬用原作者的误差统计。后续新 solver 应重放同一批初态并同时报告成功率、落点误差及反弹数；几何版本差异仍可能占据部分误差。没有同版本原始轨迹流之前，不能据落点改善宣称逐 tick 原版一致。

## 未参与调参的独立点位

在首批 A 点 60 条样本之外，另外固定同一仓库提交的两份报告，供后续盲测。两份均具有相同坐标和字段定义，提取 mesh 版本 `2000899`、实机服务器版本 `2000908`；研究子任务下载后没有用它们调整参数。

| 点位 | 报告 | 条数 / 大小 | SHA-256 |
| --- | --- | --- | --- |
| 中门上方 `top_door` | [224949 报告](https://github.com/NC1107/cs2-smoke-solver/blob/7ebba5b0443292886d2b2134e67b44736752d82d/data/validation/de_dust2-20260909-224949.json) | 60 / 52,077 字节 | `b9b941ec2454c5a7a1805e46d75025f2eccdae0857a1114c2b7f1c9de7fff356` |
| B 点窗方向 `top_window` | [225013 报告](https://github.com/NC1107/cs2-smoke-solver/blob/7ebba5b0443292886d2b2134e67b44736752d82d/data/validation/de_dust2-20260909-225013.json) | 60 / 51,919 字节 | `8941f7bdd74f01e72bf81f21c1b95987764ec9ba5b72334111c684d1b232480b` |

这些报告继续留在忽略目录，不将实机采样素材随代码提交。后续工具应保留分组结果，避免首批误差下降掩盖新点位退化。
