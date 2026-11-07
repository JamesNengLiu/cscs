# CS2 呈现稳帧 A/B 与延迟边界

本轮增加可回退的 CS2 渲染预算对照。默认 **A：原画质预算**；显式使用 `?present=headroom` 可进入 **B：预留显卡余量**。菜单 `#renderProfile` 可实时切回 A，选择写入当前 URL，不覆盖原画质偏好。

B 的渲染像素比上限为 `min(DPR, 0.75)`；本次 DPR 1 下，宽高各为原来的 75%，像素数约为 56%。MSAA 保留，画面会变柔和。自动画质仍可降至 0.7；原 quality/target 偏好保留。先按 A 分配 backbuffer，再缩小活动视口，复用现有 viewport/CSS 映射路径。各 profile 缓存独立预算控制器，切回 A 保留已学习的刷新预算；切换清除待应用比例及旧性能采样。射击、移动、鼠标计数、FOV、位置镜头模式和 1.0 路径保持原设置。

三轮已完成的独立测试使用自有 Chrome 157.0.8103.38、Apple M1 Pro / ANGLE Metal、原生 **1920×936、DPR 1、约 75Hz 回调**，同一 T0 站位及相同扫视输入方案。每组先预热，再测约 10 秒；测试期间锁鼠、焦点、可见性、实际比例和 shader 程序数量均检查。A/B 保留 MSAA 4 samples，no-AA 仅为负载诊断。

| 样本顺序 | GPU 查询 P50（ms） | callback-start→呈现反馈 P50（ms） | >20ms 反馈间隙 |
| --- | --- | --- | --- |
| 第一轮 A / B75 / no-AA / A重复 | 5.635 / 4.598 / 4.907 / 5.522 | 32.072 / 32.079 / 32.067 / 32.080 | 15 / 0 / 8 / 14 |
| 第三轮 A / B75 / A重复 / B75重复 | 5.267 / 4.885 / 5.438 / 4.797 | 32.058 / 32.051 / 32.055 / 32.056 | 4 / 0 / 12 / 0 |

降低渲染比例减少了 GPU 耗时，并出现跨节拍反馈减少的可重复信号。但第二轮 controls 的未降画质 A 也得到 0 个间隙；不能保证 B 消除顿挫。反馈间隙不是肉眼掉帧次数：第一轮 A 的 7 个同时间反馈与 8 个近 1µs 反馈聚类后，仍对应 15 个约 26.667ms 间隙。报告同时保留原始去重时间与 100µs 聚类，未将近重合反馈当作独立物理刷新。

**固定约 32ms 的 callback-start→浏览器呈现反馈等待尚未修复。** 第二轮 `preserveDrawingBuffer`、`flush`、纯诊断 `finish` 没有可信延迟收益，均未接入游戏客户端。首个 desync 控制同时改变了 alpha，属于混变量，不能归因于 desync；第三轮修正为相同 alpha 后，实际 `desynchronized` 仍为 false。Chromium 的 [Mac WebGL 低延迟 usage guard](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/graphics/gpu/canvas_utils.cc#L164-L185) 也明确保留平台限制，请求该属性不能当作降低延迟的证据。

`pointerrawupdate` 替换仅保留为语义／累计计数守恒探针。CDP 输入回放与 ACK 节拍存在耦合，较早的事件时间戳、处理时刻或单组中位差异不能证明物理输入收益。该事件替换未投产；现有原始鼠标请求偏好照旧。

原用户页是 **Chrome 156、1920×836**，自有 Chrome 157 / 936 高度测试不能直接视为同环境复现。精确复现 836 高度的原生窗口校准失败，`native836-probes`、`native836-calibration` 收据均排除验收；初始未完成的 `native-ab` 也不计入上述三轮结果。

用户原页最后 9.92 秒锁鼠段约有 743 次 RAF。按显式 AnimationFrame `args.id`、安全的 origin source/sequence 与同一 PipelineReporter 结束时间校验后，callback-end→反馈中位约 24.573ms；同帧 stage 平均 24.804ms 中，21.406ms 位于 SwapEnd→Presentation。此段主要等待发生在 swap 结束后，不能全部称为 GPU 执行时间。旧分析按 AF-begin 取窗得到 7 个间隙；新 helper 统一按 callback-start 取窗得到 6 个，属于边界回调集合差异，不代表又修复一次卡顿。

上述 Presentation 是浏览器软件反馈，未认证物理屏幕扫描或完整 input-to-photon。输入 ACK 结束时间也不等于呈现时间。导出中可能被舍入的 64bit display/surface ID 不参与强制配对，缺失或歧义关联明确列出。

收据与复核入口：

- 第一轮：`artifacts/cs2-latency-ab/2026-11-06-native-ab-run1/report.json`。
- 第二轮 controls：`artifacts/cs2-latency-ab/2026-11-06-controls-run1/report.json`。
- 第三轮重复／语义探针：`artifacts/cs2-latency-ab/2026-11-06-native-repeat-probes/report.json`。
- 原页 stage 分解：`.local/cs2/current-live-trace-slices/stage-breakdown.json`；输入及同 AF 观察另见 `.local/cs2/current-live-turn-*-2026-11-06.json`。
- 离线指标 helper：`tests/fixtures/cs2-presentation-metrics.mjs`；profile 行为回归：`tests/cs2-render-profile.test.mjs`。

全量自动回归 **2201 项通过，0 失败、0 跳过**，日志为 `.local/cs2/latency-ab-full-regression-2026-11-06.log`。

真实公共模块的 A/B/A 计时也已完成，三组每组 759 条 callback 全部关联，约 75 次/秒：A/B 的 callback-start→反馈中位分别为 32.056/32.008ms，B 的 GPU 查询 P99 为 8.671ms，A 为 9.626ms。该轮 A/B/A 的反馈间隙为 0/0/2；它再次证明 GPU 余量增加，没有证明固定等待下降。收据 `artifacts/cs2-latency-ab/2026-11-06-production-headroom/report.json` 保留整体 `failed` 状态：计时后的同步 trace 解析期间临时 authority 连接已断开，导致菜单检查取不到玩家；旧收据没有记录关闭原因，不能将推断的积压限流写成已测事实。该测试工具与 authority 共用 Node 进程，后续改为反馈 tail 完成后先解锁、再离线解析，游戏客户端与现有服务没有为此修改。

菜单和玩法回归随后单独完成，避免离线解析争用：`artifacts/cs2-latency-ab/2026-11-06-production-smoke-only/report.json` 状态为 `completed`。B→A→B 的比例为 .75/1/.75，性能采样及导出旧采样清零，authority 状态不变，切回 A 保持已学 75Hz；刀模型、AUG/SG 开镜、AWP 2/1 与连续 Q/Q、精确鼠标计数、跳跃落地、蹲下站起均通过，WebGL 错误为 0。此短回归不重复计时，也不将自己当作物理输入延迟或多机测试。

烟雾活动视口与深度遮挡 **8/8 例通过**，覆盖 capacity 1/1.25 × ratio 1/.85/.75/.7；收据 `artifacts/cs2-smoke-viewport-browser.json`。这属于小尺寸像素正确性检查，不是地图 FPS 测试。

范围审计 `.local/cs2/latency-ab-scope-audit-2026-11-06.json` 确认 14/14 固定源码 SHA 未变，客户端输入、射击、物理及整个 frame 函数逐字节一致；反向补丁可精确还原原客户端 SHA。`git diff v1.0.0 --exit-code` 与暂存区检查均为 0，未提交或推送。现有 3001 服务仍为原 PID 3948，未重启；使用现有证书进行正常 TLS 验证，确认 HTML、客户端和新模块的实际返回 SHA 均匹配磁盘，收据 `.local/cs2/latency-ab-live-service-verification-2026-11-06.json`。

体验入口：`https://localhost:3001/?camera=baseline&present=headroom`；回退为 `present=baseline`，或在“图形与性能 → 呈现稳帧对照”切回 A。默认入口始终使用 A。所有自有测试窗口、临时 profile 和测试服务均已关闭，现有用户浏览器页面未被自动刷新。
