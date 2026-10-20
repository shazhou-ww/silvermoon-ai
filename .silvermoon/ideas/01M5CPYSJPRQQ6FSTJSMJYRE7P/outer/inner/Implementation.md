# Implementation

本契约细化已验收的 Ideal，不修改 Ideal tree。实现采用 Connector lib＋普通宿主夹具＋同 API 薄 CLI；主 Agent 负责评审、同步与门限，实现 Agent 不记录生命周期事件、不提交或推送。当前 implementing report 无附加 guidance。详细 wire/API、容量与恢复边界见[使用契约](../../../../../docs/duplex-messages.md)，可复现证据见[Implementation-Evidence.md](Implementation-Evidence.md)。本轮不部署、不发布、不访问生产，不冒充外部目标宿主集成。

## Steps

### I-S01: 收敛协议与身份兼容

复用既有 Account（users.id）、Device 与凭证，Client/Device 仅经 Account 关联，不登记 Connector 或配对实体。新增版本隔离的 v2 路由；每 Account 一个 SQLite AccountMessages DO，单张双向 Message 表仅暴露 id/account_id/device_id/is_upstream/payload。自增 ID 在 Account 范围唯一、以十进制字符串跨 JSON/JS 边界；不同 Device 不生成可混用的局部游标。同步事务内分配 ID、追加、配额与独立请求键映射，不在分配和提交间 await；回滚不发布候选 ID，空洞不代表过期。幂等映射保留到日志生命周期结束，本版不自动清理，满额明确停止，不以删除映射重收旧请求。

Client 使用浏览器会话与精确 Origin，写入还需 CSRF 与会话显式 write-access opt-in；不以既有只读订阅自动授予写入，不接受 Device Bearer 冒充 Client。Device 使用绑定凭证与 60 秒 owner/generation 租约，所有上报、下行读取、长轮询、持久接收 ACK、续租/释放均 fencing。D1 每次鉴权是重叠操作的准入边界，DO 最后同步事务核验 ownership；不声称 D1 撤销和 DO 写入存在跨服务事务。已准入的重叠操作可完成，撤销完成后的新准入与等待轮询拒绝。

### I-S02: 接通双向持久链路

Client 每个短请求指定一个有效同账户 Device；Device 每个短请求上报一条事件，账户级上行读入口/有界长轮询覆盖全部既有和新 Device，所有 Client 各自保存独立游标。长轮询最长 20 秒、每页 32 条、每主体最多 4 个并行窗口，每轮最多 250 ms 后重新鉴权；没有唯一内存通知依赖。载荷、请求、速率、Account/Device 日志与本地状态均有明确上限；无清理 API，游标低于显式保留下界返回 cursor_expired，不静默跳读。

新增独立公开 `@silvermoon-ai/connector/duplex`，导入/构造无网络、文件、环境、日志或进程生命周期副作用。宿主显式 initialize/start/renew/flush/receive/acknowledge/stop，调度有界调用；库重试最多三次，凭证按请求供给，断线后保留原请求键重试。本地 SQLite WAL/FULL 持久 outbox、远端 ID 映射、inbox、游标和收据标记，错误身份或丢失状态不自动重建；本地 owner claim 防止同文件并发写者，跨文件实例由 Relay generation fencing。离线只能按宿主既有授权自治；离线实例不能神奇感知远端接管，已知 stale generation 明确停止修改/远端推进。

receive 必须先原子落 inbox/游标，回调返回与 CLI 打印均不 ACK。宿主自身持久接收提交后才显式 acknowledge，按未确认顺序推进；崩溃重放以 Account＋Message ID 去重。普通宿主样例只记录收据、不执行或重放未知外部副作用。新增 `silvermoon-duplex` 的 init/state/enqueue/send/flush/receive/ack 仅包装公开 API，stdout JSONL、诊断 stderr、失败非零退出；没有独立 localhost 服务、生产管道或业务执行器。

### I-S03: 验证故障与兼容边界

用真实 Workers SQLite 测试验证两 Device×两 Client 加其他 Account、精度边界/并发/分配后回滚、幂等冲突、租约与撤销。用本地 SQLite 故障测试验证未知接收结果、宿主提交后 ACK 丢失、重开/换凭证、同文件接管、半页容量失败的事务回滚与显式 stop。自包含 loopback smoke 使用构建产物、完整 D1 migrations、真实 HTTP、整套 workerd 重启和实际 CLI 子进程，不以 mock 声称外部接入；退出时停止助手并仅删除本次生成状态。

运行受影响 lint/typecheck/tests/build 与包导出/私有依赖内联契约检查，验证新增公开类型可接受宿主自定请求键与有界 flush 参数。保持现有 v1/AHP/browser 行为和旧 account/device/stream/seq、token-* 迁移来源，绝不改号、合并或将历史导入为可执行 regulation；运行既有同步及浏览器 smoke。

## Acceptance criteria

### I-AC01: 身份与历史保持可归属

普通宿主收据夹具、公开包导出/声明、构建产物无副作用导入和实际 CLI 证明通用 lib 不依赖 Supervisor/AHP 类型、不接管进程。整套运行时＋本地状态重开及换凭证后 Device、请求键/远端 ID、inbox/游标仍在，显式宿主 ACK 前重放，ACK 后不再交付。既有 v1 同步/浏览器回归证明旧来源保留；证据命令、结果和限制落在 Inner 辅助文件。

### I-AC02: 账户路由与群发可验证

至少两个同 Account Device、两个同 Account Client 和另 Account 对照主体的真实 Worker 测试证明每个 Client→每个 Device 组合仅目标消费，全部上行到所有同账户独立轮询，新 Device 自动纳入。同步事务禁止低 ID 分配后让出执行权，并以并发 15 次追加、映射写入前注入回滚、已提交空洞、超过 Number 安全范围及 64 位耗尽证明安全游标。真实 HTTP 已提交响应丢失重试取回同 ID，变更内容/目标/方向/归属拒绝，接收状态不冒充执行结果。

### I-AC03: 故障与权限边界显式可见

故障注入与权限测试证明旧 generation 不能追加/读取/轮询/ACK/续租/释放，撤销、删除与跨账户被拒绝；窗口、速率、载荷、日志和本地持久容量有界，过期游标返回边界而不推进，未知外部副作用没有自动执行入口。实际 CLI receive 打印后仍 pending，显式 ack 后才消失，机器输出与非零诊断分离。受影响现有检查及自包含 smoke 通过；已知跳过/基线警告、无自动清理/备份恢复和外部目标宿主未改造明确列入证据，不包装为已验收或已部署。
