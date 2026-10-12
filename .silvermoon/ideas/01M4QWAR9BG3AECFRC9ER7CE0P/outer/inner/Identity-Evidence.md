# 跨来源 Session 身份实施证据

## 结论与方向升级

截至 2026-10-12，Copilot SDK 与 VS Code Agent Host 的现有目录契约没有暴露可证明两个不同来源 ID 属于同一逻辑 Session 的稳定关联字段。后续讨论确认不再等待或创建跨来源关联：Connector 改用 AHP 作为唯一 Session 身份与操作控制面，并移除 Copilot SDK 直接依赖。

## 指定生产案例

- SDK/Relay 投影 `9090f04f-63e6-4dc1-9f52-03ac6c9ca406`。
- Agent Host/Relay 投影 `9df9ca7a-22e9-41e3-87ec-7bbccff5d79d`。
- 已验证二者首条工作提示相同、创建时间相近且事件 payload 大量重合，但这些均是内容或时间证据，不是稳定身份。
- 2026-10-12 的已认证生产 UI 仍将前者显示为 `Execution state unknown`，并将后者作为独立的运行中 Session 展示。

## 实际来源目录

### Copilot SDK

本机运行中的 SDK `listSessions()` 返回：

- `sessionId`
- `startTime` / `modifiedTime`
- `summary`
- `isRemote`
- `context.workingDirectory`
- `context.gitRoot`
- `context.repository`
- `context.branch`

当前实施 Session 的 SDK ID 为 `1f37b106-7c57-42e4-ad6c-97038b7e11e1`。这些 context 字段描述工作区，不含对应 Agent Host resource。

### Agent Host

同一时间读取的 Agent Host `listSessions` summary 返回独立 resource，例如当前实施 Session 为 `copilotcli:/8bcf150d-1670-45f7-a909-b2ec934a2113`，并包含：

- provider、title、status、createdAt、modifiedAt
- project 与 workingDirectories
- `_meta` 中的 Git、GitHub、VS Code 发起方、sandbox、prompt cache 等运行时信息
- 部分派生 Session 的 `agentHost/createdBySession` 父级 AHP resource

该 summary 不含 SDK `sessionId`。`agentHost/createdBySession` 只表示 AHP 父子创建关系，不能映射到 SDK 目录。

## 为什么现有候选键不成立

| 候选 | 失败原因 |
| --- | --- |
| 标题或首条消息 | 可重复、可编辑、可截断，且两个来源的 role 与事件边界不同 |
| 创建或更新时间 | 两个投影存在数秒偏移；并发 Session 可落入同一窗口 |
| working directory / repository / branch | 一个工作区可以同时拥有多个 Session |
| Git 或 GitHub `_meta` | 描述工作副作用与仓库状态，不定义 Session 身份 |
| Agent Host 父 Session | 只在 AHP 命名空间内有意义，没有 SDK 对应值 |
| 事件 payload 重合 | 需要读取历史、成本高，并可能把重复提示或工具输出误判为同一身份 |

## 架构决定

1. 新 Relay Session 只接受 AHP Session URI 派生身份。
2. 所有读写操作通过拥有该 URI 的 Agent Host 完成。
3. Host 不可用时显式失败或离线，不调用 SDK 恢复另一个 ID。
4. Copilot 可以继续作为 Agent Host 内部 backend，但 Silvermoon Connector 不直接依赖其 SDK。
5. 旧 Relay 行继续独立保留，不推断来源、不关联、不清理。

## 边界

- 未修改 connector、Relay、Web 或生产数据。
- 未提交本机 Agent Host endpoint、连接 token、完整目录 dump 或用户消息。
- 此证据不把协议缺口解释为可以采用启发式去重或 SDK fallback 的授权。
