# Implementation

## Steps

### I-S01: 分离 Relay 工作状态与执行状态

通过 `0012_session_work_state.sql` 为账户拥有的 Session 增加默认 `open` 的 `work_state`，仅接受 `open / completed`；以受认证和 CSRF 保护的 `POST /api/connectors/:connectorId/sessions/:sessionId/work-state` 原子更新复合身份对应的标记，不修改执行状态、历史或活动时间。Connector 的 upsert 和事件写入不拥有此字段；消息 API、入队和 Durable Object 派发均检查未完成状态，保留现有能力、设备删除与原生只读保护。

### I-S02: 提供完成与重新激活交互

在每个 Session 列表项右侧提供按工作状态切换的 Mark completed / Reactivate 小 glyph 按钮，不在会话正文增加对应大按钮；保留 Show completed 入口，并兼容读取已有浏览器视图偏好。行内动作与选择 Session 分离，具备 tooltip、可访问名称和键盘焦点，触屏不依赖 hover。隐藏已完成父项时保留符合筛选的未完成子项；当前历史仍可读，草稿保留，完成项发送被禁用。状态以服务器确认后更新，旧库存响应不能覆盖刚完成的操作，账户切换不能泄露过期请求结果。

### I-S03: 验证状态与交互一致性

覆盖所有权、幂等更新、刷新/重连覆盖保护、跨浏览器一致性、失败反馈与桌面/窄屏交互；保留已结束、不可用、离线筛选语义。验证迁移、相关单元及 Worker 集成测试、桌面和两个窄屏项目、类型检查、lint 与构建。证据见 [Evidence.md](./Evidence.md)。

## Acceptance criteria

### I-AC01: 状态边界可靠

数据库和 API 测试证明：旧 Session 默认未完成，Connector 同步不能覆盖工作状态，非所有者与已移除设备的 Session 无法更改，重复相同操作无额外副作用。

### I-AC02: 工作整理可逆且非破坏

自动化测试证明：完成与 Reactivate 保持同一 Session 身份和历史，不停止 Agent、不级联子会话、不解除原生归档，也不会因新事件自动重新激活。

### I-AC03: UI 状态和失败明确

桌面与窄屏浏览器验证行尾图标完成、显示已完成项、查看历史和 Reactivate；验证 tooltip、键盘和触屏访问，图标点击不触发行选择或发送消息。持久化失败时不得显示虚假成功，选择与筛选保持连贯；已移除设备的只读历史不提供可执行的状态变更动作。
