# 手雷本地预测与可靠操作意图

日期：2026-10-29。替代 `5738e2e` 的750ms静默取消止血方案；本次不自动推送或重启服务。

## 目标与非目标

- 本地拉环、持握、松手动作不等待网络确认，也不随权威快照重播。
- 服务端验证操作并权威生成投掷物；断续的移动输入不释放、不取消、不重新准备手雷。
- 不更改地图、移动预测、枪械burst、手雷数量、投掷速度、碰撞、引信或伤害规则。
- 本期不做投掷物本体预测；世界中的飞行手雷仍从服务端权威结果展示。不把第一人称投掷动作预测冒称成弹道预测。

## 协议与动作身份

加入消息声明 `grenadeProtocol: "grenade-intent-v1"`，服务端在玩家状态中确认协商结果。未协商的旧客户端保留原输入兼容路径。

关键操作使用GameConnection已有可靠控制流，WebSocket回退也支持：

```text
grenadeIntent {round, seq, actionId, kind: press|release|cancel, weapon?, yaw?, pitch?}
grenadeAck    {round, seq, actionId, status, reason}
```

- seq在回合内独立递增，不与可以过期跳过的移动命令ACK混用。
- press的actionId等于它的seq；release/cancel关联同一个actionId。取消全部可使用actionId=0。
- 服务端严格验证回合、序号、动作身份、装备和有限视角；重复序号不再次执行，旧动作的取消不能取消新动作。
- 可靠ACK说明已接收/处理意图，pending不冒称已完成拉环。权威快照还包含动作ID、确认水位、动作状态与拒绝ID，供纠正和诊断。
- throw事件用玩家id/projectileId以及round/actionId关联，投掷物快照带ownerId/round/actionId；客户端不能提供位置、数量、弹道或落点事实。

## 客户端表现

`public/grenade-intent.js` 的预测器在真实鼠标按下时立即生成动作，在本地单调时钟推进；部署/恢复尚未结束则等待合法起点。持续按住进入hold；松开记录释放时间，并遵循最短准备时长。

状态转移由前后端共用的 `grenadeActionPhase` 定义：

```text
等待部署/恢复 → pin → hold → throw
                    松手已记录则准备完成后直接throw
```

相同动作的服务器确认只确认，不重设本地开始/投掷时间。模型使用round/actionId动画token，结合原有单调帧保护，防止确认重播或声音事件再次触发。权威库存不因本地预测而提前扣除。

菜单/失焦先本地取消，再发可靠cancel和原有移动取消屏障；死亡、回合变化、权威切枪、服务器拒绝或投掷准入失败会纠正/取消预测。无效的同武器切换/丢弃请求不预先破坏手雷动作。

## 服务端权威

- 协商新协议后，移动包中的fire不再驱动手雷准备/释放；重复输入备份也不能重拉。移动仍按原命令队列和安全失活规则处理。
- 按下意图经验证后进入pending/active，保持到明确释放、取消、切枪、死亡、换回合或连接关闭。移除手雷专用750ms失活及等待再松手锁，不再依赖周期收到按住包。
- 松手携带的有限视角用于投掷方向；投掷位置、身体状态和继承速度仍来自服务端。最短准备时间、恢复和投掷物数量上限均在服务端验证。
- 成功创建投掷物才扣一次数量、生成一次throw；轨迹、碰撞、反弹、引信和伤害仍使用现有权威模拟。准备期间不烹煮引信。
- 连接关闭仍由运输层close进入Game.remove；不为手雷另造短周期断线阈值，也不将普通移动缺包等同于连接关闭。

## 实测

- `npm test`：746通过，0失败、0跳过；新增31项覆盖三种手雷的可靠意图、长静默、释放、去重、旧动作取消、参数验证、服务器拒绝、准入失败、本地提前反馈及取消。
- `test:double-flash:browser`：真实Chrome/生产客户端与模型/离线权威Game经IPC联动。人为阻挡可靠按下和松手的交付，本地已播放pin及throw时服务端仍未收到操作且未扣库存；解除门后确认不重播。180/330/1200/3000ms应用输入缺口保持唯一拉环起点、单调模型帧，连续第二闪光弹仅投扣一次。
- `test:webtransport`：真实原生HTTP/3 QUIC完整回归8组通过。双向应用数据报完全丢弃1250ms时，拉环持续持握、松手经可靠流生成一颗权威手雷；Esc取消预测及服务端准备，保留数量。服务端测试进程正常关闭。
- 额外 `test:menu` 未通过：旧断言仍使用0.002 rad/pixel，而当前已提交的mouse-settings配置为0.001，且综合报告包含本地资源404。未修改灵敏度、未削弱断言，不把该专项列作通过。
- 截图已检查本地提前拉环时的真实手臂/闪光弹模型与HUD；截图只在忽略的artifacts中，不上传素材。

证据：`artifacts/grenade-prediction-unit.tap`、`grenade-prediction-browser.log`、`double-flash-browser-report.json`、`grenade-prediction-quic.log`、`grenade-prediction-menu.log`。以上不是实体Wi-Fi、Windows或完整音频播放验收。

架构参考：[Valve Prediction](https://developer.valvesoftware.com/wiki/Prediction)。采用常见权威FPS的本地武器预测与服务端验证原则，不声称逐行复现原版CS1.6网络实现。
