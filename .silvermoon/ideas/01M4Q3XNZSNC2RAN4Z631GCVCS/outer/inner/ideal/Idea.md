# 沉淀 Connector 消息原语与固定协议

## 问题

当前 Connector 的操作、领域事件和 provider 映射已有实现，但缺少可共同评审的语义基线，不能直接把实现限制当作长期契约。

## 结果

以 [现有 WebSocket 上下行操作原语](./Current-WebSocket-Primitives.md) 为事实基线，按 [理想信道与原语草案](./Ideal-Channel-Primitives.md) 明确 Session 状态信道、命令信道与可订阅消息信道；本期收敛前两者，第三信道仅记后续 TODO，逐步沉淀跨 Agent/provider 的固定协议。

## 边界

- 区分传输 envelope、领域原语与 UI projection；源码事实、候选规范、未决事项分别表达。
- 当前仅调查和讨论，不修改产品代码、schema 或协议版本，不操作生产 Session，不发布 npm；临时实时消息及订阅/取消订阅不在本期实现范围。
- 本 IDEA 独立于其他讨论；已明确三信道划分、历史状态单向同步、中继整 Session 淘汰、JSONL 级不可变历史，以及第二信道控制第三信道订阅的方向。用户授权将当前讨论文档提交并同步到 primary，不代表接受具体事件清单、wire 契约或授权产品实现。

## 验收标准

- 现状清单覆盖 Connector 与 Relay 的上下行操作、返回、错误及关键时序，并可追溯源码。
- 后续固定协议明确跨 provider 的语义边界及兼容原则；未决事项不伪装成已批准契约。
- [业务模型评审](./Business-Data-Model-Review.md) 明确历史事件、当前投影和命令的身份及生命周期边界。

## 下一步

先阅读 [第一信道最小候选与现有功能对照](./Session-State-Channel.md)，按覆盖与冗余收敛本期类型；订阅时序留待后续，此时不请求构想验收。
