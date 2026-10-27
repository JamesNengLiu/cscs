# LAN STRIKE v0.3 — de_dust2 BSP 地图版

日期：2026-10-27。用途：可信局域网、本地开发验证。旧版 v0.2 工程保持不变。

> **GitHub 代码仓库不包含原版地图及派生资源。** 克隆后不能直接进入游戏；请先按 [ASSETS.md](ASSETS.md) 准备合法取得的本地 BSP/WAD 并生成地图和天空资源。下文“本机已有资源”指开发机，不代表仓库附带素材。

## 这次改了什么

### 下坡卡顿热修复

修复客户端保留未来的X/Z却直接套用旧快照Y造成的下坡位置回拉。预测改为固定60Hz指令，服务端在实际模拟后确认序号；客户端从完整权威姿态重放未确认输入，并只对显示位置做小偏差平滑。地图几何和原始碰撞树未修改。更新服务后所有游戏窗口需要刷新重连。

专项验证：`npm run test:downhill`、`npm run test:downhill:browser`。后者使用临时回环服务器和仅限父进程IPC的测试点位，不向游戏服务器增加传送接口。详见 `下坡卡顿修复说明-2026-10-27.md`。

### BSP地图导入

旧版手绘估算灰盒已经退出活动地图。当前地图由已下载的 CS 1.6 社区镜像 `de_dust2.bsp` 转换：

- 保留源多边形顶点、UV、门窗、箱体、台阶、坡道和高差，不重新拼接几何。
- GoldSrc 坐标 `(X,Y,Z)` 统一转换为浏览器坐标 `(X,Z,-Y)/40`。40 是内部单位换算约定，不是实测的现实米制单位；相对尺寸与比例不变。
- 44 张地图引用贴图由 BSP/WAD 提取；另有 `des` 天空盒六面。
- 原始逐面静态光照打包为贴图集，并保留 UV。当前使用首个静态 light style，未逐像素对齐原版 gamma。
- 直接保留原始 BSP 节点、平面、clipnodes 和模型 hull 头。身体使用站立/蹲下 hull，子弹使用点射线 hull；不是给画面套估算碰撞箱。
- 保留双方各20个源出生实体，房间人数上限仍为每队5人；玩家落地后使用对应源位置，不再在单点周围人为铺开。
- 安包判定使用原始爆破触发模型，不再是估计半径。
- 小地图从原图表面生成；预览增加 A 区，共七个视角。

## 运行

本机开发目录已经包含转换后的资源及已安装的依赖，可直接运行。另一台设备不需要安装依赖。

```sh
npm ci
PORT=3001 npm start
```

主机：`http://localhost:3001`。同一路由器的其他电脑使用启动日志中的主机局域网IP和3001端口。3000可能仍由旧版占用；不要把旧版页面误认为新版。

默认 HTTP 服务仅用于可信局域网，不开放公网、不自动修改防火墙。`HOST=127.0.0.1 PORT=3001 npm start` 可仅供本机访问。Windows PowerShell 使用 `$env:PORT=3001; npm start`。

- 桌面 Chrome/Edge、WebGL、键鼠。
- 双方各至少一人开始。单人可点击“先看地图”切换静态预览，没有机器人或单人自由训练模式。
- `/?view=b`、`/?view=a` 可直接查看双点。可选 overview、short、long、tunnels、mid、b、a。
- `Ctrl+C` 停止服务；失焦和释放鼠标清除输入。
- WASD 移动，鼠标/左键瞄准开火；R换弹、空格跳跃、C蹲下、Shift慢走、E静止安拆包、Tab战绩、Esc释放鼠标；准备阶段1/2/3免费选原型武器。

## 重建地图

原始数据保存在同级 `lan-strike-original-map-2026-10-27/`，不从网上下载或执行游戏安装程序。

```sh
npm run import:map
python3 tools/fetch-sky.py
```

也可指定来源目录：

```sh
python3 tools/import-map.py --source /path/to/local/map-assets
```

来源目录需要 `de_dust2-csboost.bsp` 以及补齐全部地图引用贴图的WAD。生成目标为 `public/map-data.js` 和 `public/assets/dust2/`。

## 验证

```sh
npm test
npm run test:map
npm run test:tuning
npm run test:browser
python3 tests/package.py
```

- `test:map`：逐面比较源坐标、UV、碰撞树和实体；自动寻路后用真正移动函数重放T经A大道、A小道、B通道，以及CT到双点的路线，检查全过程不进入实体。模拟跑图时间不是原版实测，也不是最短路线成绩。
- `test:browser`：使用本机 Chrome 和 Playwright，临时随机端口、两个隔离会话；核对七个地图视角、导入面/贴图数量、开局、移动、跳跃、连射、换弹、断线。最后关闭临时服务，不停止其他已有进程。
- `test:tuning`：既有原型参数的确定性模拟，不是原版枪感或人类实玩结果。
- `tests/package.py`：汇总并核对报告新鲜度，生成 `artifacts/verification.json`。默认不打包原版素材。加 `--code-only` 才生成不含地图资源的代码包，该代码包需要自行恢复本地资源才能运行。

最终数量以 `artifacts/verification.json` 为准。截图在 `artifacts/map-*.png`，来源和限制在 `artifacts/map-import.json`、`sky-sources.json`。

## 1∶1 的已完成与边界

已完成：相对于这份BSP，源几何/UV等比例导入、原始碰撞树接入、原始出生和爆破实体接入。可逐项重跑校验，不再用“路线差不多”当作还原。

未完成或未验收：

- 原版引擎逐像素 gamma、动态 light style 和透明/动画材质的全部语义。
- 爆炸后场景刷子模型破坏、碎片效果；当前保持静态。
- CS原版移动、武器、穿透、护甲、经济、投掷物、角色/武器模型和动画；本项目仍是独立原型。
- 双实体电脑对战、10人负载、目标硬件FPS和网络抖动。
- Valve官方版本散列认证。两份独立社区镜像字节一致，但不等于官方签名认证。

## 来源和许可

地图源文件 SHA-256：`15945389528d113562ede0a2c80647ebfa799079ed1c05a25379bcf84e4e9286`。

- https://www.csboost.eu/downloads/maps/de_dust2.bsp
- https://en.ds-servers.com/goldsrc-res/r11417/de_dust2.bsp
- https://en.ds-servers.com/goldsrc-res/r102947/cs_dust.wad
- https://en.ds-servers.com/goldsrc-res/r7/halflife.wad
- https://luxserv.ge/cstrike/gfx/env/

公开可下载不代表有权公开或商业再分发。原版地图与贴图仅保存在本地验证工程中；没有将其并入对外代码发行包。发布前需单独核查授权。几何转换和独立运动实现不代表移植了原版引擎代码。
