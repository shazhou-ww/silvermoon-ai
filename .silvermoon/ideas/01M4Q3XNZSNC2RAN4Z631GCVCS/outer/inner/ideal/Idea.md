# 固定 Connector 消息原语

## 问题

当前 Connector 已有操作、领域事件和 provider 映射，但缺少跨 provider 可共同评审的语义基线，现有实现限制因而可能被误当作长期协议。

## 结果

以 [现有 WebSocket 上下行操作原语](./Current-WebSocket-Primitives.md) 为事实基线，确立统一调用模型：上行固定指 Connector → Relay Service，下行固定指 Relay Service → Connector。历史补齐与实时观察采用同一读取原语，以 long poll 保证恢复、Connector 短时续推降低连续更新延迟。

## 边界

- 传输 envelope、领域原语与 UI projection 分层；具体字段、消息名称和 wire 编码不在构想决定范围。
- Session 状态事实单向传播，历史采用 JSONL 级不可变记录；中继可按整个 Session 淘汰缓存，不裁剪 Session 内旧历史，未命中时显式回源或报告不可用。
- 观察范围由 target + 观察基准表达，不要求独立 streamId；requestId 关联多包反馈与有界续推，有序 eventId 兼任事件身份和位置，不另要求 sequence。历史与临时更新保留保证分开，续推可忽略且不影响恢复，不建立长期订阅。

## 验收标准

- [现状清单](./Current-WebSocket-Primitives.md) 可从源码追溯 Connector 与 Relay Service 的上下行操作、返回、错误及关键时序。
- [请求原语草案](./Ideal-Channel-Primitives.md) 按下行请求共同定义反馈、续推与失败边界，覆盖现有功能；多包按事件编号幂等组装，完整性依赖声明覆盖而非最大编号。
- [业务模型评审](./Business-Data-Model-Review.md) 明确历史事件、当前投影和命令的身份、所有权、生命周期及兼容边界。
