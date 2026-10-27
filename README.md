# LAN STRIKE v0.4 — 武器、购买与经济开发版

日期：2026-10-27。用于可信局域网和本地开发验证。稳定v0.3保留，本分支为 `feat/cs16-arsenal`。

> **GitHub代码仓库不包含原版地图/武器及派生资源。** 克隆后不能直接玩；先按 [ASSETS.md](ASSETS.md) 准备有权使用的本地素材。下文“本机已有资源”不代表仓库附带素材。

## 这次接入了什么

- 24把枪、免费刀、HE/闪光/烟雾、护甲/头盔、拆弹器、夜视仪和CT盾牌。枪械、装备和备用弹药需要真实扣款购买。
- 开局资金按用户要求为 **$10,000**，上限 **$16,000**；只在首次加入初始化，不是每回合重置。阵营默认手枪与刀免费，其余按规则购买。
- 源BSP己方购买区、90秒购买窗；服务端核验资格、余额、阵营、库存与携带上限，不接受客户端自报金额、伤害或位置。
- 按ReGameDLL参考核对购买价格、口径共享、护甲、击杀/胜负奖励、完整连败状态、T超时存活无补助等规则，不套用CS:GO经济。参考默认准备6秒、回合300秒、炸弹45秒；用户可配置的服务器参数不等于所有CS服务器都一样。
- 持有武器切换、丢弃/拾取、霰弹枪逐发装填、三连发、消音器、瞄准镜和盾牌防护。
- 本地转换30份真实MDLv10第一人称模型、原始皮肤和骨骼轨道。缺失时明确显示紫红线框占位；人物仍是原型网格，**不是人物模型还原完成**。
- 保留原图碰撞及固定60Hz、ACK确认/未确认输入重放的下坡同步修复，不通过改图掩盖位置回拉。

**不能称完整1:1：** 移动引擎、逐枪散布与后坐力、骨骼命中盒、子弹穿透、动画事件/声音、世界模型、烟雾和夜视显示仍有近似或缺失。详见 [接入验收](docs/equipment-integration.md)、[规则来源](docs/cs16-sources.md)、[模型忠实度](docs/weapon-model-fidelity.md) 和 [投掷物限制](docs/grenades-fidelity.md)。

## 运行

开发机已备资源。若从代码检出，须先完成ASSETS中的资源准备：

```sh
npm ci
HOST=0.0.0.0 PORT=3002 npm start
```

- 建议开发版用3002，**不要误覆盖正在使用的3001稳定版**。文档给出启动命令不表示3002已经常驻启动。
- 主机用 `http://localhost:3002`；其他电脑用主机局域网IP与3002端口，不能用另一台电脑自己的localhost。
- 仅限可信局域网；不自动开放防火墙，不配置公网转发。仅本机测试用 `HOST=127.0.0.1`。
- 桌面Chrome/Edge、WebGL、键盘鼠标。双方各至少一人开始；无机器人，单人可看静态地图。
- Windows PowerShell先设置 `$env:HOST="0.0.0.0"; $env:PORT=3002`，再 `npm start`。
- 服务重启会断开连接；更新后所有窗口刷新重连。Ctrl+C停止对应进程，不停止其他版本。

## 操作

WASD移动；左键射击/投掷，右键副功能（刀刺/开镜/切连发/消音器/举盾）。

B购买；1主武器、2手枪、3刀、4切换投掷物、5 C4；Q上一武器、滚轮切换、G丢弃、R换弹、N夜视。

空格跳跃、C蹲下、Shift慢走、E静止安拆包/交互、Tab战绩、Esc释放鼠标。打开购买菜单会清空按住的移动/射击输入；点击“继续游戏”重新捕获鼠标。

## 原始地图与重建

活动地图不是估算灰盒：相对于已下载的社区镜像BSP，保留源多边形、UV、原始站立/蹲伏/点射线碰撞hull、出生点和爆破/购买触发模型。

统一坐标转换为 `(X,Y,Z) -> (X,Z,-Y)/40`；40是内部单位换算约定，不是现实米制实测。44张地图贴图、4002个可见面、9932个三角形；首个静态light style与六面天空，不是原版gamma逐像素复现。

```sh
npm run import:map
# 或 python3 tools/import-map.py --source /path/to/local/map-assets
# 天空来源与使用授权确认后，才手动运行：
python3 tools/fetch-sky.py
```

默认原始目录为同级 `lan-strike-original-map-2026-10-27/`，包括 `de_dust2-csboost.bsp` 与补齐引用贴图的WAD。转换生成 `public/map-data.js`、`public/assets/dust2/` 和地图导入报告。

源地图SHA-256：`15945389528d113562ede0a2c80647ebfa799079ed1c05a25379bcf84e4e9286`。镜像一致不是Valve官方版本认证。

## 验证

```sh
npm test
npm run test:map
npm run test:tuning
npm run test:browser
npm run test:shop
npm run test:downhill
npm run test:downhill:browser
```

- 规则测试自动发现 `tests/*.test.mjs`；武器/经济集成覆盖24把枪的购买、切换、开火，以及余额、奖励、护甲、投掷、携带与死亡规则。
- `test:map` 对照源坐标/UV/碰撞树/实体，再用真实移动函数重放五条出生到包点路线；首次运行前先导入，不能复制旧导入报告冒充本次校验。
- `test:browser` 用临时127.0.0.1随机端口和两个隔离Chrome会话，真实WebSocket购买/扣款、开局、移动、跳跃、开火、换弹、断线；finally关闭临时服务并核查端口。
- `test:shop` 包含独立菜单测试及**拦截传输的客户端夹具**，用于UI/闪光/烟雾，不作为真实服务端联网证据。
- 下坡真实浏览器夹具只通过父进程IPC设置点位，不为生产服务器增加传送接口。
- `test:tuning` 仍是旧原型参数的确定性比较，不是CS原版枪感认证。

本地报告与截图位于忽略的 `artifacts/`。实体双机Wi-Fi、10人负载、目标硬件FPS、原版逐帧对照尚未验收。测试通过不等于完整原版还原。

## 来源与许可

- 地图：https://www.csboost.eu/downloads/maps/de_dust2.bsp 、https://en.ds-servers.com/goldsrc-res/r11417/de_dust2.bsp
- WAD：https://en.ds-servers.com/goldsrc-res/r102947/cs_dust.wad 、https://en.ds-servers.com/goldsrc-res/r7/halflife.wad
- 天空：https://luxserv.ge/cstrike/gfx/env/
- 规则与模型来源、固定参考提交和逐项限制见 `docs/`。

公开下载不等于有权公开或商业再分发。原版BSP/WAD/MDL和派生JSON/PNG仅保存在本地验证工程，不纳入公开代码包。独立转换器和浏览器实现不代表移植了原版引擎。
