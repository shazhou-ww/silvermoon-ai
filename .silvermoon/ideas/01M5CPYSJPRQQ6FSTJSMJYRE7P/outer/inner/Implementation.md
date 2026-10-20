# Implementation

这是构想阶段的轻量实施种子，进入 implementing 后逐步细化；构想验收不包含此契约。用户已授权按 Connector lib＋宿主嵌入＋薄验证 CLI 方向实施，并由主 Agent 评审门限；实现 Agent 不自行接受门限。先收敛[设计待决项](ideal/Connection-and-Message-Design.md#待决事项)，不据此授权生产操作或外部仓库改造。

## Steps

### I-S01: 收敛协议与身份兼容

按 Account 推导 Client/Device 通信关系。明确通用 lib 的公开 API、宿主显式生命周期/持久接收确认与稳定状态恢复；统一 Message 表、自增 ID 兼作排序/补读、布尔方向和独立请求幂等键，不强制 producer/task 字段。收敛存储/Device fencing 一致性、鉴权和旧历史兼容，保持既有 Account/Device ID。

### I-S02: 接通双向持久链路

实现 Relay 双向路由与账户群发，并以独立于 Agent 框架的 Connector lib 接通 Device outbox/inbox、原子请求键映射、ID 补读、重连、错误和背压。提供使用同一公开 API 的薄验证 CLI 和普通宿主样例/测试，不实现独立本地服务，不把验证代码冒充外部目标宿主集成。

### I-S03: 验证故障与兼容边界

覆盖库导入无副作用、显式启停、宿主确认/崩溃重放、CLI 同 API、离线持久恢复，以及多端路由、ID 可见顺序、幂等、fencing、背压和权限边界。更新使用/兼容文档并运行受影响检查；保留现有 UI，确需改变时先评审，不扩大为生产操作。

## Acceptance criteria

### I-AC01: 身份与历史保持可归属

用普通宿主嵌入、包导出/CLI 和本地状态重开测试证明库不耦合目标 Supervisor 类型、不产生导入副作用、不接管宿主进程；重启/升级/轮换保持 Device、outbox/inbox、幂等映射及游标。下行显式确认前可重放，旧历史仍按原归属读取，不要求 Connector 业务 ID。

### I-AC02: 账户路由与群发可验证

用至少两个同 Account Device、两个同 Account Client 和另 Account 对照主体测试：下行仅目标消费，上行全部同账户 Client 接收，新增 Device 自动纳入。并发/低 ID 延迟提交、回滚空洞与精度边界下按自增 ID 补读无遗漏；响应丢失时原幂等键返回原 ID 不重复追加、冲突拒绝，且 HTTP 接收与执行状态独立。

### I-AC03: 故障与权限边界显式可见

用故障注入与授权测试证明旧 generation 被拒绝、跨账户不可访问、慢订阅不无限缓存、游标过期不静默跳过、未知副作用不盲目重放；CLI 打印不自动确认且 stdout 不混日志，库错误显式暴露。运行受影响包既有检查并保存可复现结果。
