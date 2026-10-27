# 本地地图资源准备

本仓库保存 LAN STRIKE v0.4 的客户端、服务端、转换工具、测试和说明，不含 CS 原版素材或导出的地图/武器数据。因此这是一份代码备份，不是克隆即可玩的完整游戏发行包。

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

## 验证

```sh
npm test
npm run test:map
npm run test:downhill
npm run test:browser
npm run test:downhill:browser
```

`test:map` 的源数据逐项比对当前固定读取同级 `lan-strike-original-map-2026-10-27/`，使用 `--source` 在其他位置导入后，如需运行这一项，应将相同输入也放入默认源目录。源码内已包含它所需的 `tools/audit-bsp.py`。

测试运行时会重新生成报告与截图；由于素材未提交，GitHub上的纯代码检出不能在未准备资源的情况下直接运行这些测试。
