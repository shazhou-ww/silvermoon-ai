# 固定 Connector 消息原语

## 问题

当前 Connector 已有操作、领域事件和 provider 映射，但缺少跨 provider 可共同评审的语义基线，现有实现限制因而可能被误当作长期协议。

## 结果

以 [现有 WebSocket 上下行操作原语](./Current-WebSocket-Primitives.md) 为事实基线，确立下行请求、上行反馈的统一调用模型。历史补齐与实时观察采用同一读取原语，以 long poll 保证恢复、Connector 短时续推降低连续更新延迟。

## 边界

- 传输 envelope、领域原语与 UI projection 分层；具体字段、消息名称和 wire 编码不在构想决定范围。
- Session 状态事实单向传播，历史采用 JSONL 级不可变记录；中继可按整个 Session 淘汰缓存，不裁剪 Session 内旧历史，未命中时显式回源或报告不可用。
- 历史、当前观察与临时更新区分身份和保留保证；续推可忽略且不影响读取正确性，不建立长期订阅，具体时间阈值与 wire 细节留待实施。

## 验收标准

- [现状清单](./Current-WebSocket-Primitives.md) 可从源码追溯 Connector 与 Relay 的上下行操作、返回、错误及关键时序。
- [状态与历史最小候选](./Session-State-Channel.md) 和 [理想信道草案](./Ideal-Channel-Primitives.md) 明确两信道、统一读取与可选续推的职责，区分等待超时、缺口和不可用。
- [业务模型评审](./Business-Data-Model-Review.md) 明确历史事件、当前投影和命令的身份、所有权、生命周期及兼容边界。
