# Implementation

这是准备阶段的可行性种子，不是本轮执行授权；构想验收不包含此契约。未来实施先收敛[设计待决项](ideal/Connection-and-Message-Design.md#待决事项)，再逐步细化，不预先指定物理 schema 或技术方案。

## Steps

### I-S01: 收敛协议与身份兼容

统一 Account/Device/Client 术语，确定账户内下行单目标与上行全量群发契约，细化版本协商、身份映射、权限、幂等范围、fencing 与保留策略；核实原 user/device/connector/stream 历史归属，不因名称相同就假定身份映射。

### I-S02: 接通双向持久链路

实现 Client→Relay→指定 Device 的 regulation 下行及每个 Device→Relay→同 Account 全部 Client 的 events 群发。接通账户级订阅、动态来源发现、各 Client 独立恢复与去重，贯通 Device 本地 outbox、持久 inbox/执行记录和游标；不以更换 HTTP 自动移除协调存储。

### I-S03: 验证故障与兼容边界

覆盖多 Device/多 Client 并发、群发中断/新设备加入、错投与跨账户隔离、重试冲突、同一 Device 的双实例抢占、离线恢复、未知副作用、背压、游标过期和授权撤销。保持现有 UI 行为；若实施需要改变屏幕或交互，先提供 ui-change-review 材料并请求相应决定。

## Acceptance criteria

### I-AC01: 身份与历史保持可归属

用迁移夹具证明凭证轮换、重连和重启不更换 Connector，旧命名空间历史仍可定位且不被重新编号合并；冲突映射明确阻断。

### I-AC02: 账户路由与群发可验证

用至少两个同 Account Device、两个同 Account Client 和另一个 Account 的对照主体做集成测试：每个 Client 均能定向下发到每个 Device，每条只被目标消费；每个 Device 每条 event 都被全部同 Account Client 接收且不跨账户；新增 Device 自动纳入，离线 Client 独立补读。两个方向先持久化再确认、同 ID 去重/冲突拒绝，HTTP 接收与执行状态独立。

### I-AC03: 故障与权限边界显式可见

用故障注入与授权测试证明旧 generation 被拒绝、跨账户不可访问、慢订阅不无限缓存、游标过期不静默跳过、未知副作用不盲目重放；运行受影响包既有检查并保存结果。
