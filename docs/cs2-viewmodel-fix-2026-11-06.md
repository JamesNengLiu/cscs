# 一人称持枪视角与刀可见性修复

本轮仅调整 CS2 实验版的展示路径。世界相机、鼠标输入、移动、弹道、后坐力与服务器判定不变；旧 1.0 文件不修改。

## 原因与修复

- 原生手臂和武器使用了世界相机投影，缺少独立的一人称视野和经典右下偏移。现使用独立 layer-1 相机、本项目经典预设：4:3 参考水平 FOV 68°、整体右移 2.5 Source 单位、下移 1.5 Source 单位。原有内部坐标基准抵消保留；偏移施加给手臂和武器的共同父级，不改变抓握或骨骼装配。该四元组是项目的经典风格选择，不声称已经读取 CS2 私有 Classic preset 的全部内部赋值。
- 世界仍使用原有 FOV。16:9 时，一人称垂直 FOV 约 53.668°，世界垂直 FOV 约 73.740°。近裁面独立为 0.0254m。AUG/SG 553 ADS 淡出髋射偏移，并使用自己的瞄镜投影；AWP 仍由原开镜覆盖层处理。
- 本地弹壳、枪口装饰接头按两个投影的横纵比例映射回世界层，以免独立 FOV 后接头错位。服务器射线不使用此映射。
- 刀模型只有一个合法 `body_legacy` 网格；通用资源加载器原先对所有模型隐藏该名字，因此克隆后整把刀也被隐藏。现隐藏规则只用于人物模型中的排除部件，刀继续使用真实原模型和原动作。
- 开镜回归发现 SG 553 镜片原语共享全枪 POSITION 缓冲；旧逻辑用整缓冲包围盒及顶点0骨权重求锚点，导致镜片偏离屏幕。现只采样该原语实际 index/drawRange 引用的蒙皮顶点。

公开 Source 惯例依据：[独立世界/一人称 FOV](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/view.cpp)、[本地装饰接头投影修正](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/c_baseviewmodel.cpp)。这是公开 Source 实现惯例和实际资源坐标的适配，不是 CS2 闭源渲染器的逐行移植。

## 验证

- `tests/cs2-viewmodel-presentation.test.mjs`：独立投影及世界状态不变、共同偏移和左右镜像、装饰接头屏幕投影一致。
- `tests/cs2-iron-sight-anchor.test.mjs`：共享全枪缓冲中的无关顶点、顶点0外来骨权重不能影响真实镜片锚点。
- `tests/cs2-knife-visibility.test.mjs`：实际原生加载器及真实 4756 个蒙皮顶点，刀网格保留可见，idle 五帧可见。缺素材显式跳过，不以替代几何当作通过。
- `tests/cs2-viewmodel-browser.mjs`：刀四动作、8类武器和左右手，使用实际蒙皮三角形裁剪/轮廓像素检查；刀刃单独检查，不能靠手臂或刀柄通过。AUG/SG镜片中心约 `(0.4984, 0.5)`；退镜回原髋射范围。AWP 真实 `awp→deagle→awp`，`5→4` 弹、无重复射击动画；左右手实际权威射线一致。
- 浏览器收据：`artifacts/cs2-viewmodel/report.json`，独立测试端口和浏览器均关闭。现有3001服务不重启；客户端文件通过刷新加载。

完整回归：2151 项通过，0 失败、0 跳过；耗时 41.36 秒。日志见 `.local/cs2/viewmodel-regression-2026-11-06.log`。
