# 以持久 Connector 承载 Supervisor 双向业务消息

## 问题

现有多 Stream 同步模型以设备日志为中心，不能清晰表达用户下发 regulation 与 Supervisor 上报 events 的两条业务链路，连接、凭证与业务身份也容易混淆。

## 结果

一个持久 Connector 对应一个 Supervisor，固定承载下行 regulation 和上行 event 两条逻辑流。双方通过短请求提交、Relay 持久化、长订阅加速交付，并能断线补读。

## 边界

- 上游始终是用户/客户端，下游始终是 Supervisor 及其设备；不开放用户创建多 Stream，不按任务另建传输流。
- 保留设备自治、历史归属和授权清理；不承诺端到端 exactly-once，不绑定某种长连接或存储技术。
- 本轮只准备协议与模型评审；UI 改版、应用代码、部署和生产数据操作不在本轮范围。

## 验收标准

- 评审可明确判断身份、双向职责和生命周期，见[业务模型](Business-Data-Model-Review.md)。
- 短请求接收、执行回报、重试、fencing 与离线恢复没有语义混用，见[连接与消息设计](Connection-and-Message-Design.md)。
- 版本隔离与原历史只读映射有明确边界；技术选型、精确字段和切换细节仍标为提案或待决，不作为已批准事实。
