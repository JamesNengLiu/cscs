# 本地地图、武器、人物与定制面部资源准备

本仓库保存 LAN STRIKE v0.5 的客户端、服务端、转换工具、测试和说明，不含 CS 原版素材或导出的地图/武器/人物数据、肖像和定制面部素材。因此这是一份代码工程，不是克隆即可玩的完整游戏发行包。

## 为什么没有地图文件

地图、WAD贴图、天空及转换产物的再分发许可尚未确认。可公开下载不等于已获得上传GitHub或商业再分发的授权。以下内容被 `.gitignore` 排除，开发机上的文件不会被删除：

- `public/map-data.js`：源地图的几何、碰撞与实体数据。
- `public/assets/`：渲染数据、贴图、静态光照、天空图片。
- 原始 `.bsp`、`.wad`、`.mdl`、`.tga` 等游戏素材。
- `artifacts/` 测试报告/截图、`backups/` 本地回退副本和 `node_modules/`。

代码仅为独立原型；不代表 Valve 官方复刻、游戏素材授权或完整 CS 移植。不要把缺少原图导致的启动失败解释为网页不支持联机。

## 准备输入

先取得你有权使用的 CS 1.6 `de_dust2.bsp` 及其引用贴图的 WAD 文件。不要执行来路不明的游戏安装程序。

转换器当前的默认源目录在项目目录的同级：

```text
workspace/
  cscs/                               # 本仓库
  lan-strike-original-map-2026-10-27/
    de_dust2-csboost.bsp               # 将合法取得的源文件复制并命名为此名称
    cs_dust.wad
    halflife.wad
    ...                               # 如需其他WAD，必须补齐地图引用贴图
```

转换器会读取该目录下的 WAD 文件；实际需要哪些 WAD 由具体 BSP 的纹理引用决定，名字相同不保证内容相同。

当前回归测试采用的地图源文件 SHA-256 为：

```text
15945389528d113562ede0a2c80647ebfa799079ed1c05a25379bcf84e4e9286
```

其他地图修订版可能与固定面数、出生点和路线夹具不匹配。这个散列只标识本地采用的数据，不是 Valve 官方版本认证。

## 安装、生成、启动

需要 Node.js/npm、Python 3；浏览器测试还需要可用的 Chrome。项目没有运行时 CDN 依赖。

在仓库根目录执行：

```sh
npm ci
npm run import:map
```

转换后生成 `public/map-data.js` 与 `public/assets/dust2/`。如源文件在其他目录，可运行：

```sh
python3 tools/import-map.py --source /path/to/local/map-assets
```

天空资源可使用已取得本地使用许可的素材。现有工具 `python3 tools/fetch-sky.py` 会从 README 列明的社区镜像下载六面天空并生成 `sky-*.png`，不会随仓库自动执行；运行前应自行确认该来源与用途的授权。它还会写入 `artifacts/sky-sources.json`，所以先运行地图导入以创建输出目录。

准备好全部本地资源后：

```sh
HOST=0.0.0.0 PORT=3001 npm start
```

主机使用 `http://localhost:3001`；其他电脑使用主机的局域网IP和同一端口，不是其他电脑自己的 localhost。仅限可信局域网，勿配置公网转发。

## 第一人称武器资源

武器的原始MDL、派生模型JSON/PNG及来源清单都位于忽略的 `public/assets/weapons/`。有权使用相关本地素材后，按 [模型来源与准备](docs/weapon-model-fidelity.md) 配置 `raw/` 与 `sources.json`，再运行 `python3 tools/import-weapons.py`。现有获取工具只下载和校验数据，不执行下载内容；运行前仍须确认使用授权，公开镜像不是授权。

缺失武器资源时显示明确的紫红线框占位，不会声称加载了原版模型。地图资源缺失仍会阻止进入游戏。不要把占位视为一比一模型或将这些资产纳入公开仓库。

## 原版人物与第三人称持枪模型

详见 [人物资产来源与逐项校验](docs/player-asset-fidelity.md)。优先使用有权使用的本地原版MDL；需使用获取脚本时，先自行核实来源与用途的许可。脚本只下载数据并核对来源，不执行远程程序。以下命令在本地准备8个人物及24把第三人称枪械：

```sh
python3 -B tools/fetch-player-assets.py --compare-mirror
python3 -B tools/import-players.py
python3 -B tools/fetch-player-assets.py --weapons-only --compare-mirror
python3 -B tools/import-players.py --weapons-only
```

`public/assets/players/raw/`、`sources.json`、`manifest.json`、模型JSON/PNG全部保持忽略。当前人物主来源是社区镜像，不是Valve官方认证；第二个人物来源全部404，不能称双源一致。24把第三人称枪械中18把获得第二来源字节一致证据，其他6把未完成独立比对。

## 特朗普定制头部

这是非官方的虚构娱乐外观，不暗示本人或政府参与、认同。先生成原版人物，再生成定制头部；不要在此后只重导原版而遗漏最后一步。身体、骨骼、动画和原版贴图保留，头部为新建网格与肖像投影，**不是三维扫描或精确侧脸重建**。

仅面部生成需要Pillow，建议使用项目虚拟环境（`.venv/`已被忽略）：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install Pillow
.venv/bin/python tools/build-trump-face.py --fetch-portrait
```

`--fetch-portrait`只在缺失时下载固定White House官方2025肖像；按脚本固定散列核对，不覆盖现有源照片。也可自行将同一源照片放到 `public/assets/portraits/trump-official-2025.png` 后运行 `npm run build:trump-face`（此时npm调用的Python环境需已安装Pillow）。未知或变更后的照片会被拒绝，不能静默替换来源。

肖像来源：[White House官方PNG](https://www.whitehouse.gov/wp-content/uploads/2025/06/President-Donald-Trump-Official-Presidential-Portrait.png)。肖像来源与CS人物版权分别记录；来源为官方不自动解决肖像权、商标或背书误导，也不赋予CS身体模型再分发许可。默认不上传原照片、派生纹理、定制模型或素材截图。

启动后访问 `/characters.html?model=terror_trump&compare=1`，无需第二位玩家即可检查正/侧脸、原版对照和动画；游戏大厅的外观选择通过服务端验证阵营。缺失或校验失败会明确显示紫红线框，不能作为原版加载成功。

## 验证

```sh
npm test
npm run test:map
npm run test:downhill
npm run test:browser
npm run test:characters
npm run test:downhill:browser
```

`test:map` 的源数据逐项比对当前固定读取同级 `lan-strike-original-map-2026-10-27/`，使用 `--source` 在其他位置导入后，如需运行这一项，应将相同输入也放入默认源目录。源码内已包含它所需的 `tools/audit-bsp.py`。

测试运行时会重新生成报告与截图；由于素材未提交，GitHub上的纯代码检出不能在未准备资源的情况下直接运行这些测试。

## 本地声音资源

声音文件位于忽略的 `public/assets/sounds/`。优先使用有权使用的本地游戏声音目录：

```sh
python3 tools/prepare-sounds.py --source /path/to/cstrike/sound
```

需要按当前工具列出的社区镜像准备本地验证素材时，可显式运行 `python3 tools/prepare-sounds.py --fetch`。工具只读取有界 WAV 数据并记录来源和散列，不执行下载内容，也不代表镜像文件获得了再分发许可或官方零售认证。声音名称来自枪械目录和已导入模型的动作事件；不会自动下载到公开仓库或随服务启动获取远程素材。

缺少音频时保留游戏功能，声音诊断的 `missing` 计数反映缺失或解码失败；不会将所有武器替换成同一段合成枪声。实体双机的声场和真人听感需要另行试玩确认。
