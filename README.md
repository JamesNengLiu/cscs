# LAN STRIKE — CS2 验证分支

当前分支为 **`codex/cs2`**，用于独立的 CS2 Dust2 浏览器验证版。**远端 `main` 和标签 `v1.0.0` 保留已验收的 1.0**；CS2 代码不合入 `main`，后续 CS2 迭代继续在本分支进行。

这是 JavaScript / Three.js / WebGL 2 的独立实现，使用真实布局与本地准备的内容数据，并包含明确的工程近似。它不是 Valve 客户端源码移植，也不保证所有规则、动作或弹道与最新零售版逐值一致。没有新增游戏运行依赖或引入 Wasm。

## 当前内容

- CS2 Dust2 的真实布局、尺寸、贴图和烘焙光照；地图 PVS、合批与贴图分级加载。
- 原生加权人物、武器、手臂与声音；购买、回合、命中、历史回溯、投掷物及烟雾。
- 独立 HTTPS / WebSocket / WebTransport 联机与客户端预测；保留 AWP 吞弹、连续 Q 和快切显示响应的修复。
- 匪家至 A 门坡道、台阶、箱沿及车上跳下的镜头衔接；可回退的镜头／呈现实验。
- AK、M4A1-S、AWP 弹道校准 v2：原版回放验证的反冲表、射线基准、地面精度及停火恢复；角度响应仍为有量化误差的近似。

M4 兼容键 `m4a1` 对应 M4A1-S。种子映射、移动／腾空额外散布、受击扰动、穿透／护甲等仍有未认证部分，具体覆盖见[弹道校准记录](docs/cs2-ballistics-calibration-2026-11-07.md)。

## 素材准备

**本次 CS2 提交只包含源码、转换工具、测试和说明，不上传 CS2 地图、模型、贴图、声音、证书、依赖或本地测试收据。** 开发机已准备素材；新的服务器检出须先按 [ASSETS.md](ASSETS.md#cs2-分支资源边界) 和 [CS2 内容准备](tools/cs2-content-README.md) 准备有权使用的本地资源。

服务器需要以下目录，均由现有忽略规则隔离：

```text
public/assets/cs2-physics/
public/assets/cs2-optimized/
public/assets/cs2-content/
```

缺少资源时启动或加入会明确失败，不能把源码仓库当作克隆即可玩的完整素材发行包。浏览器客户端连接已准备好的主机即可，无须自行安装 Node.js 或服务器素材。

## 启动

需要 Node.js/npm，首次生成本地测试证书需 OpenSSL；资源转换另需 Python 3。浏览器建议使用支持 WebGL 2 的桌面 Chrome / Edge。项目已在 Node 24 与本机 Chrome 上验证。

```sh
npm ci
npm start
```

`npm start` 在本分支启动 CS2，默认仅本机 `https://localhost:3001/`。显式命令 `npm run start:cs2` 等价。同一可信局域网联机时：

```sh
HOST=0.0.0.0 PORT=3001 npm start
```

Windows PowerShell：

```powershell
$env:HOST="0.0.0.0"
$env:PORT="3001"
npm start
```

- 同事访问 `https://主机当前局域网IP:3001/`，主机 IP 变化后需重新核对地址。
- 同端口提供 HTTPS/WSS 和原生 QUIC；URL 加 `?transport=websocket` 或 `?transport=webtransport` 可做协议对照。
- 证书位于 `.local/cs2/certificate/`，启动器不修改系统信任。不全局关闭证书校验，也不自动开放公网或配置转发。
- 只运行一个3001实例。切分支、提交或拉代码不会自动重启服务；重启前确认版本，更新后浏览器刷新并重新加入。
- `npm run start:ws` / `start:cs2:ws` 是仅 HTTP/WS 的本机诊断入口；正常局域网体验使用上面的 HTTPS 方式。

1.0 启动器保留为 `npm run start:classic` / `start:classic:ws`；稳定版维护与游玩应使用 `main` 或 `v1.0.0`，不要与本分支同时占用端口。[1.0 原有说明](https://github.com/JamesNengLiu/cscs/blob/v1.0.0/README.md)仍保留在该标签中。

## 操作

WASD 移动，左键开火／拉保险、松开投掷；右键武器副功能；B 购买，购买菜单右键关闭并返回；Q 上一武器，R 换弹，G 丢弃；空格及滚轮向下跳跃，C / Ctrl 蹲下，Shift 慢走，E 交互，Tab 战绩，Esc 菜单。设置中可调整鼠标、左右手、画质与镜头响应实验。

## 验证与诊断

```sh
npm test
node tests/cs2-ballistics-browser.mjs --dry-run
# 已有本地素材与 Chrome 时，显式执行隔离的原生地图回归：
node tests/cs2-ballistics-browser.mjs --run
```

当前已验收源码有 **2351 项 Node 回归通过、0 失败／跳过**；原生浏览器回归覆盖 AK30、M4A1-S20整匣与自动换弹，以及 AWP 三轮开镜后连续 QQ。测试报告和截图只保存在本地忽略目录。

资源相关测试需要本机素材，缺失时可能明确跳过或无法启动；代码检出不等于已经复验地图。自动化、CPU、GPU、浏览器回调和实体多机体验分别报告，不能把一台浏览器加协议 peers 当作十台物理设备或高刷认证。

出现弹孔延迟时，可添加 `?shotDiagnostics=1`，复现后立即 Esc → 导出诊断 JSON；不会自动上传。部分历史诊断需本地站位或旧源码快照。例如黄车诊断使用 `--stations=/本地/站点.json`：数组各项需含 `name`、米制脚底 `x/z`、探测上限 `maxFeet`、弧度 `yaw`，站位须由实际 PHYS 确认合法。旧版渲染对照还需另备三份旧源码，不将整个 `.local/` 提交。

## 进一步说明

- [完整对战版集成及保真边界](docs/cs2-playable-integration-2026-11-05.md)
- [地图渲染优化](docs/cs2-map-optimization-2026-11-05.md)
- [低延迟呈现 A/B](docs/cs2-presentation-ab-2026-11-06.md)
- [坡道与落地镜头](docs/cs2-terrain-camera-2026-11-06.md)
- [匪家至黄车的性能及弹孔排查](docs/cs2-yellow-car-shot-delay-2026-11-06.md)
- [已确认的性能缺陷修复](docs/cs2-confirmed-performance-fixes-2026-11-06.md)
- [AK／M4A1-S／AWP 弹道校准 v2](docs/cs2-ballistics-calibration-2026-11-07.md)
- [出帧时机、延迟预测与联机恢复修复](docs/cs2-frame-pacing-prediction-fixes-2026-11-11.md)

这些文档保留各轮验证的条件和限制，历史服务状态与命令以当时记录为准；本分支当前入口以上述启动章节为准。Git 和素材边界遵循 [AGENTS.md](AGENTS.md)。
