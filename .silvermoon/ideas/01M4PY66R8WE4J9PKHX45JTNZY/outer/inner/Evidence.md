# 设备管理实施证据

## 已实现的边界

- Device 名称是权威，修改投影由同一数据库事务中的触发器同步至 Connector；复用去首尾空白与 1–80 字符规则，允许重名，不改身份、token 或 Session。
- 移除是不可逆的 Relay 身份注销，不是物理删除。`removed_at` 更新原子撤销该设备全部 token、清空当前连接、失败 queued 命令并标记 sent/accepted 结果未确认。Session、事件和命令仍保留原归属。
- 数据库阻止已移除身份重新签发/启用 token、连接绑定恢复及迟到 Session/事件写入。连接鉴权、DO 绑定、每次 RPC 与命令完成均核对可用身份；API 拒绝已移除来源的写操作，保留历史 GET。
- 每个 token 定位独立 DO，移除逐个请求撤销；取消内存 command waiters 后关闭 socket。部分通知失败返回 202、结构化错误日志和持久化待重试状态，不将数据库访问禁用误报为失败，也不声称本地 agent 已停止。
- Settings 提供重命名与删除确认、保存失败保留输入、操作中防重复/关闭及返回焦点。待断开请求可刷新后重试。正常设备、在线计数及新建选择排除已移除来源；沿用 Show offline Sessions 与 All 查找只读历史。
- 新版 Worker/Pages 不要求发布 Connector 包；已有 Connector 自动重试旧凭据会收到拒绝。重新添加创建新身份，不合并旧历史。

## 可重现检查

在仓库根目录安装既有锁定依赖后执行：

```text
pnpm check
pnpm --filter @silvermoon-ai/worker d1:migrate:local
pnpm --filter @silvermoon-ai/web test:browser -- --workers=3
```

2026-10-12，Windows / Node 24 / pnpm 10.27.0：

- `pnpm check` 通过 lint、所有包类型检查、测试及 Worker dry-run/Web/Connector/RPC/Protocol 构建。随后增加故障重试测试和精化加载标签，再执行 Worker 测试、两端类型检查、lint 及 Web 构建，均通过。单元/集成合计 112 通过、1 个原有 Connector 测试跳过。
- 本地 D1 按现有工作流应用全部 11 项迁移，含 `0011_device_management.sql`，成功；不访问生产数据库。
- Worker 28 项通过：新覆盖精确长度 1/80/81、重名与旧名重连、CSRF/跨账号、同设备两个不同 token 的在线 socket 都以 4003 关闭、迟到 INSERT/UPDATE、不可恢复、历史保留、queued 失败/sent 与 accepted 未确认、离线轮换竞争、新身份独立。专门注入 DO 撤销失败，证明 202 时持久化移除且凭据无效、重试后状态完成。该测试会产生预期的 `Test disconnect unavailable` 运行时错误日志。
- Web 单元测试 50 项通过，包含已移除但残留 online/current confirmation 的保守判定与历史 facet、默认隐藏、显式离线可见和归属保持。
- 全量浏览器回归 151 项通过、2 项按现有桌面/移动条件跳过，覆盖 1440px、iPhone 13 和 320px，测试重命名取消/错误/保存、删除取消/错误/防重复/禁止加载中关闭、断开失败跨刷新重试、返回焦点、移除后新建排除和历史只读。网络延迟使用显式响应屏障，不依赖固定等待。
- 现有两个 UI Fast Refresh lint 警告与 Web 大 bundle 提示仍在，不属于本次变化；未改其规则或掩盖输出。

## 源码与使用说明

- [生命周期迁移](../../../../../apps/worker/migrations/0011_device_management.sql)、[管理服务](../../../../../apps/worker/src/devices.ts)、[API](../../../../../apps/worker/src/api.ts)。
- [Worker 回归](../../../../../apps/worker/src/index.test.ts)、[Settings 浏览器回归](../../../../../apps/web/tests/settings.browser.ts)、[历史过滤回归](../../../../../apps/web/src/session-list.test.ts)。
- [用户指南](../../../../../README.md#manage-devices)。

## 验收与安全边界

用户已要求不单独做 implementation 验收、持续推进部署。实施完成与自动测试是 Agent 证据，不是用户已接受某个尚未展示的 revision；不捏造 `acceptInner` 或 `acceptOuter`。生产发布和登录后的端到端结果另在 [Deployment.md](../Deployment.md) 与同世界证据记录。此次本地验证不删除真实设备、不撤销真实 token。
