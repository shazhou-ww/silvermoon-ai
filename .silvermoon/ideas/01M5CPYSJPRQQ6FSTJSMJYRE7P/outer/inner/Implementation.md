# Implementation

这是准备阶段的可行性种子，不是本轮执行授权；构想验收不包含此契约。未来实施先收敛[设计待决项](ideal/Connection-and-Message-Design.md#待决事项)，再逐步细化，不预先指定物理 schema 或技术方案。

## Steps

### I-S01: 收敛协议与身份兼容

按 Account 推导 Client/Device 通信关系，Connector 仅是连接程序。细化统一 Message 表、自增 ID 兼作排序/补读、布尔方向和独立请求幂等键的契约；不另加 position 或强制 producer/task 字段。确定存储事务/Device fencing 一致性、权限和保留边界，核实原历史且优先保留既有 Account/Device ID。

### I-S02: 接通双向持久链路

实现 Client→Relay→指定 Device 的下行与 Device→Relay→同 Account 全部 Client 的群发；按授权过滤统一 Message 并按 ID 补读，不要求逐设备复合游标。接通各 Client 独立恢复、Device 本地 outbox/inbox、请求键到 Relay Message ID 的原子映射；根据统一存储和租约协调需要决定 DO 调整，不以 HTTP 自动移除。

### I-S03: 验证故障与兼容边界

覆盖多 Device/多 Client 并发、群发中断/新设备加入、错投与跨账户隔离、重试冲突、同一 Device 的双实例抢占、离线恢复、未知副作用、背压、游标过期和授权撤销。保持现有 UI 行为；若实施需要改变屏幕或交互，先提供 ui-change-review 材料并请求相应决定。

## Acceptance criteria

### I-AC01: 身份与历史保持可归属

用迁移与本地状态重开夹具证明 Connector 程序升级/替换、凭证轮换、重连和重启不更换 Device 身份，不丢失其历史、方向日志、outbox/inbox 与游标；接口不要求独立 Connector 业务 ID。旧命名空间历史仍可定位且不被重新编号合并，冲突映射明确阻断。

### I-AC02: 账户路由与群发可验证

用至少两个同 Account Device、两个同 Account Client 和另 Account 对照主体测试：下行仅目标消费，上行全部同账户 Client 接收，新增 Device 自动纳入。并发/低 ID 延迟提交、回滚空洞与精度边界下按自增 ID 补读无遗漏；响应丢失时原幂等键返回原 ID 不重复追加、冲突拒绝，且 HTTP 接收与执行状态独立。

### I-AC03: 故障与权限边界显式可见

用故障注入与授权测试证明旧 generation 被拒绝、跨账户不可访问、慢订阅不无限缓存、游标过期不静默跳过、未知副作用不盲目重放；运行受影响包既有检查并保存结果。
