# Implementation

## Steps

### I-S01: 分离 Relay 工作状态与执行状态

通过 `0012_session_work_state.sql` 为账户拥有的 Session 增加默认 `open` 的 `work_state`，仅接受 `open / completed`；以受认证和 CSRF 保护的 `POST /api/connectors/:connectorId/sessions/:sessionId/work-state` 原子更新复合身份对应的标记，不修改执行状态、历史或活动时间。Connector 的 upsert 和事件写入不拥有此字段；消息 API、入队和 Durable Object 派发均检查未完成状态，保留现有能力、设备删除与原生只读保护。

### I-S02: 提供完成与重新激活交互

保留每个 Session 列表项右侧的 Mark completed / Reactivate 小 glyph，并在桌面详情标题区和手机详情标题区提供同样的动作，不在会话正文增加大按钮；复用已有状态更新与 pending 保护，使两个入口一致。手机和触屏的列表与详情动作点击区至少为 44 × 44 CSS px，始终可见；桌面详情动作也不依赖列表 hover。保留 tooltip、可访问名称、键盘焦点及明确的只读限制。

保留 Show completed 入口和已有浏览器偏好。隐藏已完成父项时保留符合筛选的未完成子项；在详情内完成后保留当前历史与草稿，允许在同一详情内 Reactivate，发送仍需恢复且符合原有能力限制。状态以服务器确认后更新，旧库存响应不能覆盖刚完成的操作，账户切换不能泄露过期请求结果。详情提示与输入区文案不再要求用户返回列表。

### I-S03: 验证状态与交互一致性

补充桌面、390px 和 320px 详情内完成与 Reactivate、至少 44px 触控区、列表与详情状态及 pending 一致性、失败反馈、长标题布局和已移除设备只读的浏览器验证。保留所有权、幂等、刷新/重连覆盖保护、跨浏览器一致性及其他筛选语义的既有回归，运行相关检查与构建。现有 [Evidence.md](./Evidence.md) 记录上一版实现；本轮新增交互的验证待实现后补充，不复用为本轮已完成证明。

## Acceptance criteria

### I-AC01: 状态边界可靠

数据库和 API 测试证明：旧 Session 默认未完成，Connector 同步不能覆盖工作状态，非所有者与已移除设备的 Session 无法更改，重复相同操作无额外副作用。

### I-AC02: 工作整理可逆且非破坏

自动化测试证明：完成与 Reactivate 保持同一 Session 身份和历史，不停止 Agent、不级联子会话、不解除原生归档，也不会因新事件自动重新激活。

### I-AC03: UI 状态和失败明确

桌面与窄屏浏览器验证列表及详情内完成和 Reactivate，无需退出当前详情；手机和触屏实测两个入口的点击区均至少为 44 × 44 CSS px，长标题不挤出动作或产生横向溢出。验证 tooltip、键盘、pending/失败与两入口一致性，点击不触发行选择或发送消息；当前历史和草稿保留，其他筛选仍生效。已移除设备的只读历史不提供可执行的状态变更动作。
