# 实现 Account 内 Device 与 Client 的双向消息路由

## 问题

现有消息主要由 Device 上行到 Client，缺少以 Account 为中心、面向多个 Device 与多个 Client 的双向路由与群发能力。

## 结果

同一 Account 下 Client 与 Device 多对多通信：每条 Client 下行 regulation 指定一个 Device，每个 Device 的每条上行 event 群发给该 Account 所有 Client。Relay 先持久化再交付，支持短请求提交、长订阅和断线补读。

## 边界

- 上游称 Client，下游称 Device；一个持久 Connector 对应一个 Device、固定两方向，不开放用户多 Stream 或按任务建流。
- 保留设备自治、历史归属和授权清理；不承诺端到端 exactly-once，不绑定某种长连接或存储技术。
- 本轮只准备协议与模型评审；UI 改版、应用代码、部署和生产数据操作不在本轮范围。

## 验收标准

- 同账户指定 Device 路由、全部 Client 群发与跨账户隔离清晰可验证，见[业务模型](Business-Data-Model-Review.md)。
- 接收、执行、重试与各 Client 独立补读不混用，见[连接与消息设计](Connection-and-Message-Design.md)。
- 版本隔离与原历史只读映射有明确边界；技术选型、精确字段和切换细节仍标为提案或待决，不作为已批准事实。
