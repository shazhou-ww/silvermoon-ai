# 固定 Connector 消息原语

## 问题

当前 Connector 已有操作、领域事件和 provider 映射，但缺少跨 provider 可共同评审的语义基线，现有实现限制因而可能被误当作长期协议。

## 结果

以 [现有 WebSocket 上下行操作原语](./Current-WebSocket-Primitives.md) 为事实基线，确立跨 Agent/provider 的三类逻辑信道及职责边界；本期固定 Session 状态与命令语义，可订阅临时消息仅保留为后续方向。

## 边界

- 传输 envelope、领域原语与 UI projection 分层；具体字段、消息名称和 wire 编码不在构想决定范围。
- Session 状态事实单向传播，历史采用 JSONL 级不可变记录；中继可按整个 Session 淘汰缓存，不裁剪 Session 内旧历史，未命中时显式回源或报告不可用。
- 命令使用 RPC 语义；可订阅消息由命令控制，但其消息格式、订阅生命周期和实现留待后续。

## 验收标准

- [现状清单](./Current-WebSocket-Primitives.md) 可从源码追溯 Connector 与 Relay 的上下行操作、返回、错误及关键时序。
- [第一信道最小候选](./Session-State-Channel.md) 和 [理想信道草案](./Ideal-Channel-Primitives.md) 足以区分已确定方向、候选原语与未决 wire 细节。
- [业务模型评审](./Business-Data-Model-Review.md) 明确历史事件、当前投影和命令的身份、所有权、生命周期及兼容边界。
