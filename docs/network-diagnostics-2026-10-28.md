# 跨设备卡顿诊断

日期：2026-10-28。此版本仅增加诊断，不改变玩法、地图、传输协议、60Hz权威模拟、15Hz状态发布、预测/ACK或远端平滑策略。并未接入WebTransport，也不宣称已修复实体Wi-Fi卡顿。

## 在有问题的设备上采集

1. 主机更新服务后，其他设备刷新游戏页面，使用主机当前局域网IP与3001端口。
2. 加入对局，按Esc打开菜单，在“联机诊断”中点击“重置诊断采样”，再点击“继续游戏”。
3. 在实际对局中移动、转向、开火30–60秒；出现问题后尽快按Esc，点击“导出诊断JSON”。导出前不要刷新或关闭页面。
4. 将下载的 `lan-strike-diagnostics-*.json` 文件发回开发者。最好同时从主机游戏页面导出一份，用于对照；各自的采样起点不一定相同。
5. 附上网络连接方式（有线、Wi-Fi或手机热点）、大概卡顿时间、是否只有远端人物抖动或自己也会回拉。浏览器与显卡信息已在报告中，无需另行抄写。

只在大厅导出的文件会标记 `lobby-only`，不能替代对局数据。按Esc会停止本机操作，不会暂停服务器对局。

## 指标与边界

| 字段 | 含义与限制 |
|---|---|
| applicationRttMs | 原有应用ping/pong的实际往返耗时，保留峰值，包含客户端/服务端事件循环和TCP/WebSocket排队，不是纯网络RTT |
| stateArrivalIntervalMs | 状态消息到达浏览器JS回调的间隔，包含浏览器调度 |
| stateSourceIntervalMs | 新服务端实际生成消息的单调时间间隔；旧服务端降级为模拟时间间隔 |
| deliveryVariationMs | 到达间隔与生成间隔差的绝对值；不能单独视为网络抖动或丢包率 |
| snapshotSequenceGap | 发送尝试序号中的跳号；结合服务器skippedStates判断，不能当作TCP丢包率 |
| foregroundFrameIntervalMs | 仅采集加入房间且捕获鼠标、前台可见时的rAF间隔；不把菜单/后台节流算作实战帧率 |
| longTaskMs | 浏览器Long Tasks API可观测的主线程长任务；不支持时显式标记，不假报零卡顿 |
| pendingInputs / positionCorrectionUnits | 未确认预测输入数和权威校正大小；只读取，不改变预测或碰撞 |
| webSocketBufferedBytes | 客户端发送队列；通常接近零也不能排除OS/TCP/Wi-Fi排队 |
| serverLoop* / tickGap* / loopWork* | 服务端事件循环延迟、tick回调间隔与回调工作时间；事件循环直方图采样分辨率10ms，基础值附近不等于10ms工作阻塞 |
| server.connection | 该连接发送字节、跳过消息与最大待发送字节计数；保持原有发送策略，仅增加计数 |
| revision / sourceFingerprint | 启动时Git提交与服务端源文件指纹，用于发现旧服务端仍在运行；不表示未提交代码已发布 |

每个指标最多保留600个最近样本；每秒汇总时间线最多180个有采样的秒桶。累计计数从重置起计算。不同指标采样频率不同，分位数的观察窗口并不相同。时间线用于对照峰值发生在哪个采样秒；没有两端时钟校准，不能据此直接计算单向延迟。

按Esc导出时保留刚才前台绘制统计，避免原画质控制器在释放鼠标时重置统计导致报告只剩零帧。报告中的CPU提交时间不等于GPU时间。

## 隐私与运行方式

报告仅由按钮在本地下载，不会自动上传，也不写localStorage。包含连接来源地址、浏览器UA、可用的CPU线程数/设备内存提示、WebGL渲染器、视口、画质、输入序号和性能统计。不导出昵称、玩家ID、完整对局状态、坐标、聊天、凭据或页面查询参数。分享前可自行检查JSON。

新版服务端在 `/health` 的 `network.diagnosticsVersion` 暴露 `netdiag-v1`，并通过pong返回调度统计。旧服务端仍可连接，但报告会提示完整诊断未收到；服务器重启与所有浏览器刷新后再采集。

## 复验

```sh
npm test
npm run test:diagnostics
npm run test:menu
npm run test:browser
npm run test:downhill:browser
npm run test:shop
npm run probe:network
```

`test:diagnostics` 使用真实Chrome/WebGL、实际权威服务器与WebSocket，通过按序延迟交付、浏览器150ms忙等和仅父进程IPC可触发的服务端120ms忙等，验证诊断保留异常并可实际下载JSON。注入只在临时回环测试实例中存在，生产服务不提供卡顿控制接口。测试结束关闭实例并验证端口不可达。

`probe:network` 是10个本地WebSocket、无浏览器的调度测试；主动注入四次120ms服务器停顿。报告不是正常网络基线，更不是十台实体电脑Wi-Fi验收。所有导出样例、截图、基线与验收收据均留在忽略的 `artifacts/`，不纳入代码提交。
