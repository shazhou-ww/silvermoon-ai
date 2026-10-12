# 当前 Connector WebSocket 操作原语清单

## 阅读边界

- 性质：**源码现状调查，不是候选固定协议，也不是已批准契约**。
- 调查日期：2026-10-12。
- 源码基线：`0d25cd8fd4722815e07e3b2a467871c464158f8e`，当前独立 worktree 的产品源码。
- 上行：Connector → Relay worker；下行：Relay worker → Connector。RPC 的返回帧方向与请求相反。
- 主清单覆盖 Connector 与 Relay 的连接；Connector 与本地 VS Code Agent Host 的另一条 WebSocket 连接单独说明，不混入 Relay 协议。
- 此次未修改产品代码、消息 schema、协议版本，未连接生产或真实 Session。

源码路径以仓库根为基准；下列链接相对本文档定位。

## 1. 三层结构及入口

| 层次 | 当前实际内容 | 不应混淆的概念 |
| --- | --- | --- |
| 传输层 | WebSocket 承载 tRPC 请求、返回、订阅生命周期及保活 | tRPC 请求 `id` 不是领域事件 `id`，也不是命令 `commandId` |
| 操作层 | `register` 等 mutation，`commands` subscription，订阅内的四种业务命令 | 下行业务命令不是四个独立的 tRPC procedure |
| 领域层 | `AgentSession`、`AgentSessionEvent`、输入请求、工具状态 | Web 的 turn 分组、工具折叠、气泡不是额外 wire 消息 |

连接使用 `GET /v1/connect` 升级为 WebSocket，凭 HTTP `Authorization: Bearer <token>` 认证。Connector 会把 relay URL 的路径替换为该入口；身份由 worker 认证结果确定，不由 `register` 传入。

worker 还接受兼容入口 `/v1/daemon/connect` 和 `/v1/connectors/{id}/connect`；后者路径中的 ID 不用于决定认证身份。升级前可能返回 HTTP 401、409、426，这些不是已连接后的 RPC error 帧。

当前 `PROTOCOL_VERSION = 2`。版本字段出现在注册返回和下行业务命令中；普通上行 mutation 输入和 `AgentSessionEvent` 自身没有该字段。注册请求不提供支持版本范围，当前 Connector 也没有显式检查注册返回的版本。

依据：[连接客户端](../../../../../../packages/connector/src/connector.ts)、[worker 入口](../../../../../../apps/worker/src/index.ts)、[RPC router](../../../../../../packages/rpc/src/index.ts)、[领域 schema](../../../../../../packages/protocol/src/index.ts)。

## 2. WebSocket 外层帧

以下是仓库连接测试所使用的单帧形状，省略可选的 tRPC 元数据；实际传输也可使用批量请求。不是新设计的 envelope。

### 2.1 上行 mutation 与下行返回

```json
{
  "id": 1,
  "method": "mutation",
  "params": {
    "path": "heartbeat",
    "input": { "observedAt": "2026-10-12T03:50:30.000Z" }
  }
}
```

```json
{ "id": 1, "result": { "type": "data", "data": { "ok": true } } }
```

`id` 用于匹配本次 RPC 调用；`path` 是 procedure 名称。除 `register` 外，当前所有 mutation 成功返回都是 `{ "ok": true }`，不返回领域事件游标或事件存储版本。

### 2.2 上行订阅与下行命令数据

```json
{ "id": 2, "method": "subscription", "params": { "path": "commands" } }
```

```json
{ "id": 2, "result": { "type": "started" } }
```

```json
{
  "id": 2,
  "result": {
    "type": "data",
    "data": {
      "protocolVersion": 2,
      "commandId": "11111111-1111-4111-8111-111111111111",
      "connectionId": "22222222-2222-4222-8222-222222222222",
      "type": "session.message",
      "sessionId": "session-1",
      "message": "继续检查测试"
    }
  }
}
```

停止订阅由 tRPC 使用 `subscription.stop`；订阅结束使用其 `stopped` 生命周期返回。Relay 自身没有另定义业务级 subscribe/unsubscribe 消息。

### 2.3 RPC 错误与保活

```json
{
  "id": 1,
  "error": {
    "message": "Obsolete Relay connection.",
    "code": -32009,
    "data": {
      "code": "CONFLICT",
      "httpStatus": 409,
      "path": "heartbeat"
    }
  }
}
```

错误外层的数值 code 属于 tRPC；`data.code` 是其符号错误码。验证失败、过期连接、存储失败等通过 RPC 错误返回，不等于领域层 `type: "error"` 事件，也不等于业务命令失败结果。

Connector 开启 tRPC 文本保活：`PING` → `PONG`，间隔 20 秒，等待 pong 超时 5 秒。它们不是 JSON，不是业务 `heartbeat`，也不是 WebSocket 控制帧的同义名称。worker 使用 tRPC WebSocket handler 处理传输细节，没有自行定义完整帧语法。

依据：[连接测试](../../../../../../packages/connector/src/connector.test.ts)、[worker tRPC bridge](../../../../../../apps/worker/src/trpc-websocket.ts)、[连接配置](../../../../../../packages/connector/src/connector.ts)。帧示例不构成对 tRPC 全部内部消息或未来版本的冻结。

## 3. 上行操作完整清单

所有操作均由 Connector 调用；下表的成功返回均沿原 RPC 返回。`?` 表示 schema 可选，不意味着当前 Connector 一定省略。

| Procedure | 输入 | 成功返回 | 当前用途与约束 |
| --- | --- | --- | --- |
| `register` | `agent: {name, version?}`；`capabilities`；`confirmationVersion?: 1` | `{protocolVersion: 2, connectionId, connectorId}` | 每次连接注册；当前 Connector 总是声明 `confirmationVersion: 1`。能力包含四个必填布尔项：`listSessions/createSession/sendMessage/streamEvents` |
| `heartbeat` | `{observedAt}` | `{ok: true}` | 默认每 20 秒；worker 按自己的当前时间续 60 秒 lease，当前未使用上传时间计算 lease |
| `syncSessions` | `{sessions, commandId?, observation?}` | `{ok: true}` | Session 清单快照，最多 10,000 个；初次连接和 `sessions.list` 使用。带 `commandId` 时同时完成该命令 |
| `syncFailed` | `{connectionId, message}` | `{ok: true}` | 报告 Session 清单同步失败，message 最长 2,048；不是通用命令失败或领域 error |
| `sessionUpdated` | `{session, observation}`；兼容直接 `AgentSession` | `{ok: true}` | 单个 Session 当前观察值；确认模式下必须提供本次连接的 observation |
| `sessionEvent` | `{event, connectionId, historical?: boolean}`；兼容直接 `AgentSessionEvent` | `{ok: true}` | 单事件上传；包装形式 `historical` 默认 false。确认模式下必须提供本次连接 ID；断线缓冲补传使用 true |
| `sessionEvents` | `{events, connectionId?}` | `{ok: true}` | 历史批量上传，一批 1–50 个事件；确认模式下 connectionId 必须匹配；当前没有批次 ID、历史游标、范围或删除标记 |
| `commandAccepted` | `{commandId}` | `{ok: true}` | 已接收命令；不代表执行成功或模型完成回答 |
| `commandCompleted` | `{commandId, commandConnectionId?, observation?, outcome, session?, error?}` | `{ok: true}` | `outcome` 为 succeeded/failed；failed 必须带 `{code, message}`。可携 Session 观察，当前 Connector 常规路径未用该可选项 |
| `commands` | 无业务输入，类型为 subscription | `started`、持续的命令 `data`、结束/错误 | Connector 发起订阅，worker 向该订阅发命令；是下行推送通道 |

`observation = {connectionId, sequence}`：sequence 是本次注册连接内的正安全整数，Connector 重连后归零再递增。它用于 Session 当前状态防旧覆盖，**不是消息事件流 sequence**。

worker 为 `sessionUpdated`/`sessionEvent` 保留旧输入形状，但当前确认模式不允许靠旧形状绕过连接确认。兼容 schema 存在不等于旧客户端拥有相同可写性或状态可信度。

依据：[全部 procedure 和输入 schema](../../../../../../packages/rpc/src/index.ts)、[连接及调用实现](../../../../../../packages/connector/src/connector.ts)、[worker 连接确认与存储](../../../../../../apps/worker/src/connector-session.ts)。

## 4. 下行业务命令完整清单

全部通过 `commands` subscription 的 `result.data` 发出。共同字段：`protocolVersion: 2`、UUID `commandId`、可选 UUID `connectionId`。当前 Connector 拒绝执行明确指向旧连接的命令。

| `type` | 专属字段 | 当前执行与回传 |
| --- | --- | --- |
| `sessions.list` | 无 | `adapter.listSessions()` → `syncSessions({sessions, commandId, observation})`；该上传同时确认命令成功 |
| `session.create` | `prompt`，`title?` | `adapter.createSession()` → 发布 `sessionUpdated` → `commandCompleted` |
| `session.message` | `sessionId`，`message` | `adapter.sendMessage()` → `commandCompleted`；Agent 后续输出另走事件上传 |
| `session.history` | `sessionId` | `adapter.loadSessionHistory()` → 每 50 条 `sessionEvents` → `commandCompleted`；空历史不发空批次，直接完成 |

create prompt 和 message 均 trim 后要求非空，最长 32,768 字符；title 最长 256；session ID 最长 256。

执行前当前 Connector 调用 `commandAccepted`，并在本地 promise 队列内串行处理收到的命令。`commandCompleted.succeeded` 表示对应 adapter 操作返回，不表示用户任务完成、模型 turn 完成或所有工具结束。

失败返回使用 `commandCompleted` 的 error，当前 Connector 错误 code 为 `copilot-command-failed`；清单失败还会报告 `syncFailed`。这个 provider 命名是现有实现，不是未来跨 provider 的错误标准。

业务命令产生于 Web 调用 HTTP API 后的 worker 分发；**浏览器不通过这条 WebSocket 直接发送指令**。

依据：[命令 schema](../../../../../../packages/protocol/src/index.ts)、[命令执行](../../../../../../packages/connector/src/connector.ts)、[worker 分发及命令状态](../../../../../../apps/worker/src/connector-session.ts)。

## 5. 上行承载的领域数据

### 5.1 AgentSession

必填：`id/title/status/createdAt/updatedAt`，其中 title 可为 null。其他字段包括 `parentSessionId/nativeStatus/lastMessagePreview/canSendMessage/pendingInputRequest/executionStateKnown`。

`status` 当前枚举：`queued/running/waiting/idle/failed/closed/gone/unknown`。其含义主要是 Agent 执行与 Session 生命周期；schema 没有独立人工工作状态字段。离线、状态未确认等 Web 显示状态还依赖连接确认，不能当成同一枚举的 wire 原语。

### 5.2 AgentSessionEvent

必填：`id/sessionId/sequence/type/createdAt`；可选：`role/text/status/data`。text 最长 65,536 字符。schema 不要求每种 type 必带特定 role、text、status 或 data。

| `type` | 当前语义及已观察用途 |
| --- | --- |
| `message` | 用户或 assistant 内容；Agent Host 还用它表达 system 通知和输入请求/回答 |
| `activity` | 进度、意图或活动描述，不等同于正式 assistant 回答 |
| `tool` | 工具观察；可带 `toolCallId/toolName/state`，没有统一必填的参数/结果 payload |
| `status` | SDK 的 idle 等状态观察；不能把历史 status 当成当前执行状态的可靠证明 |
| `error` | Agent 执行错误，可在 data 带 errorType；不是 RPC 或命令错误 |

`role` 为 `user/assistant/system`。`data` 已知可选字段：

- 结构：`turnId/partId/partIndex/partKind/update`；partKind 为 `request/markdown/tool/system/activity/error`，update 当前只接受 `"snapshot"`。
- 工具：`toolName/toolCallId/state`；state 为 `started/running/waiting/succeeded/failed/cancelled`。
- 输入：`inputRequestId/inputRequest/inputRequestResolved`。
- data 允许额外未知字段；未知 event type、partKind、role 或工具 state 则不能通过当前 schema。

这些结构字段分别可选，当前 schema 不保证成组出现，也不验证 type 与 partKind 的组合关系。没有独立必填 message 对象或 turn 生命周期事件契约。

输入请求包含 ID、可空 message/url、questions。问题类型有 text、number、integer、boolean、single-select、multi-select；可带选项、必填标记、freeform 和 min/max。**Relay 下行没有专门的结构化 input-response 命令**；Agent Host provider 当前尝试将普通 `session.message` 转换为部分输入回答，不能据此宣称所有输入类型都能回答。

### 5.3 当前 part 快照示例

```json
{
  "id": "ahp:turn-1:part:text-1:update:42",
  "sessionId": "session-1",
  "sequence": 1791777030000500,
  "type": "message",
  "role": "assistant",
  "text": "正在检查测试。",
  "data": {
    "turnId": "turn-1",
    "partId": "text-1",
    "partIndex": 0,
    "partKind": "markdown",
    "update": "snapshot"
  },
  "createdAt": "2026-10-12T03:50:30.000Z"
}
```

示例仅演示当前 schema 形状；sequence 是示意值，不要求从该时间精确推导。下一次同 part 快照的 text 是完整内容，不是追加字符。

## 6. 两种 provider 映射边界

| 来源 | 当前原生输入 → Relay 输出 |
| --- | --- |
| Copilot SDK | user.message / assistant.message → 扁平 message；assistant.intent → activity；tool.execution_start/complete → tool；session.error → error；session.idle → status |
| VS Code Agent Host | turn 请求 → request part；markdown/delta → 带稳定 part 身份的完整 markdown 快照；toolCall → tool 快照；systemNotification → system message；inputRequest/回答 → request part；error → error；活动变化 → activity |

SDK 映射当前不填写 turn/part 元数据，也不上传原始工具参数/结果。标题变化和 shutdown 等还可能只影响 Session 摘要，不一定产生领域事件；未知 SDK 事件默认不输出。

Agent Host 的 reasoning 在当前 part 转换中不输出独立 reasoning 原语。实时 markdown delta 先经本地状态归约，再传完整内容，不把原生 delta 直接送到 Relay。provider 的原始 serverSeq 有时用于生成 event ID，但并未成为 Relay 统一的来源游标。

另一条本地 WebSocket 由 `@microsoft/agent-host-protocol` 管理，源码显式使用 initialize、listSessions、subscribe、dispatch、fetchTurns、shutdown。此清单不声称列举了该依赖的全部 wire 帧；它不是 Relay tRPC API，不能把其原生 ActionType 直接当成 Relay 固定协议。

依据：[SDK 映射](../../../../../../packages/connector/src/copilot-adapter.ts)、[Agent Host 历史与实时映射、传输客户端](../../../../../../packages/connector/src/vscode-agent-host-provider.ts)。

## 7. 当前关键时序

### 连接与状态确认

1. WebSocket 升级，Connector 建立 commands 订阅并注册；具体订阅帧与注册帧不应预设严格先后。
2. register 返回本次 connectionId；Connector 重置 observationSequence。
3. Connector 分配 observation，读取 Session 清单，上传 syncSessions；成功后才将本地 connected 置 true。
4. 上传期间产生的事件可能暂存；成功后补传事件及保留的命令结果。
5. 心跳延续连接；断线由 tRPC 重连，新连接重新注册并同步清单。

### 历史同步与 Web 消费

1. Web 经 HTTP 请求历史同步；worker 发送 session.history 命令。
2. Connector 上传批量 sessionEvents，再上传成功结果。
3. worker 标记 history_synced_at；该时间不是领域历史 revision。
4. Web 当前每 2 秒用 HTTP GET `events?after=<sequence>` 拉取，每次最多 500 条；并非 WebSocket 订阅消息流。
5. Web 将事件投影为 turn/part，按 partIndex 排序并折叠快照；没有结构字段的事件保留为独立项。

依据：[Web 拉取流程](../../../../../../apps/web/src/App.tsx)、[事件读取 API](../../../../../../apps/worker/src/api.ts)、[transcript 投影](../../../../../../apps/web/src/message-flow.ts)。

## 8. 现有可靠性与兼容限制：不是永久规范

| 主题 | 源码事实 | 尚不能宣称的保证 |
| --- | --- | --- |
| 身份 | 存储以 user/connector/session/event ID 为主键，并对 session 内 sequence 唯一约束；冲突可更新原行 | event ID 与观察版本身份严格分离；记录不可变 |
| 顺序 | 两个 provider 用时间毫秒乘 1,000 加局部单调修正生成 sequence；Agent Host 另加 500 | 来源全局严格序号、连续无缺口、跨重启及历史重建稳定 |
| 快照 | Web 按 turnId、partKind、partId 折叠并选较大 sequence；worker 对 data 使用 JSON merge patch | 旧快照不会覆盖新状态；缺字段或 null 在所有层有统一删除语义 |
| 历史与实时 | 共用存储；历史可重新生成 ID/sequence；旧行更新不改变原存储 sequence | 已越过 cursor 的客户端一定能看到旧行变化；两条路径必然收敛 |
| 断线缓冲 | 默认 1,000 项，满时丢最旧项并记日志；补传事件标 historical；旧连接 Session 观察可丢弃 | 不丢事件、持久化 outbox、准确断点续传 |
| 命令恢复 | create/message 结果在进程内保留并重试；重连将已发未确认命令标为结果不确定；旧连接结果可带 commandConnectionId 回报 | 跨进程 exactly-once；所有操作都持久可重放 |
| 状态隔离 | 当前确认模式及 historical 上传不以 event.status 更新当前执行状态 | Agent 执行状态与人工工作状态已有完整独立模型 |
| 版本演进 | 命令版本为字面量 2；data 可扩展；保留部分旧 RPC 输入形状 | 版本范围协商、细粒度能力声明、未知类型的统一降级规则 |

连接还存在明确关闭路径：lease 过期可使用 4008，token 撤销使用 4003，bridge terminate 使用 1011。这些关闭控制与业务 Session 的 closed/gone 不同。

本节是后续讨论的风险清单，没有提出修复方案，也没有将“快照优先”“原始日志优先”或任何大重构方案视为已接受。

## 9. 后续讨论入口

用户先阅读上下行清单。下一阶段再逐项决定固定协议应保留哪些操作语义、如何区分事件身份与 part 版本、如何保证历史与实时一致，以及 provider 扩展的边界。每次只讨论一个重要决定；此文不要求用户接受任何候选契约。
