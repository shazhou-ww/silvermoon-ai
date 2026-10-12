# 第一信道：Session 状态消息的最小候选

## 结论与定位

本文独立评审第一信道，按当前源码功能检查覆盖与冗余，只给消息类型和职责，不定义字段、schema 或协议版本。

**已明确的方向：**

- 第一信道只上行：Connector → 中继 → 前端；反向请求与回复走第二信道。
- 可重放历史为 Agent Session JSONL 级记录，不包括流式 token/chunk；第三信道的可订阅临时消息本期不实现。
- 中继只承担缓存角色，按整个 Session 淘汰，不截断 Session 的旧历史。

**精简候选：第一信道保留四种消息。** 其中只有历史批次内的记录属于不可变历史；其余是目录、当前观察及同步结果。四种消息及其名称尚未批准。

| 候选消息类型 | 职责 | 是否为不可变领域历史 |
| --- | --- | --- |
| `sessions.snapshot` | 给出明确范围的 Session 清单及其当前摘要，用于初次同步、重新发现及批量刷新 | 否；是带覆盖范围的当前观察 |
| `session.updated` | 上报单个 Session 的完整当前摘要，包括元数据、状态、状态可信度、可写能力和待回答请求 | 否；每次观察可取代旧观察，但不能改写历史 |
| `history.batch` | 上报一个 Session 的新增或回放历史记录；单条也作为一条记录的批次，不另设单事件消息 | 批次只是包装，内部历史记录不可变 |
| `history.sync` | 报告一次历史同步的进度/终点或明确不可用，说明已覆盖范围及是否完整 | 否；同步信息，不是 Agent 领域事实 |

原则：有独立消费职责才增加消息类型，不为每个状态值、字段变化、错误原因或传输优化增加类型。

源码基线：本 worktree 的 `0d25cd8fd4722815e07e3b2a467871c464158f8e`，不是调查期间持续前进的 remote main。本文未修改产品代码。[现状清单](./Current-WebSocket-Primitives.md) 不变，[三信道草案](./Ideal-Channel-Primitives.md) 提供整体上下文。

## 1. 四种消息为何必要

### 1.1 `sessions.snapshot`：解决“设备上有哪些 Session”

当前 `syncSessions` 用于注册后的全量发现与主动刷新；Web 支持 Session 搜索、设备分组及父子层级。只发送“某个 Session 有变化”不能证明设备清单已经同步完整。

清单与单个 Session 摘要使用相同语义，避免同一字段在两种消息中解释不同。分页/批次可作为同一清单的传输方式，不因分页再增加一种领域类型。

需要明确覆盖范围和完成边界；不完整清单或失败不能解释成空目录。即使完整目录不再包含旧 Session，也仅能说明它当前不在该发现范围，不能推断已删除或关闭，更不能清除其缓存历史。

依据：[Connector 初次同步及刷新](../../../../../../packages/connector/src/connector.ts)、[Session 层级和筛选](../../../../../../apps/web/src/session-list.ts)。

### 1.2 `session.updated`：解决“这个 Session 当前能做什么”

统一承载以下必要语义，不再拆成 created/metadata/execution/lifecycle/capability 等消息类型：

- 标题、创建/更新时间、父 Session 关系及列表摘要。
- 当前规范化状态，以及必要的 provider 原生状态说明。
- 当前状态是否确知、观察是否属于有效的当前连接/来源，防止重连后旧状态被当作实时状态。
- 当前是否可发送消息；未确认与明确不可写不能混为一谈。
- 当前待回答请求及其结构化内容；没有请求应能显式清除之前的等待提示。

候选采用完整摘要而非任意 patch，复用当前 `session.updated` 思路。这样不为字段删除、null 与未提供引入一套独立补丁协议；具体必需字段仍待定。

“标题变了”和“running 变成 waiting”都是这条消息的观察更新，不因此要求永久记录所有状态转换。真正存在于 provider 历史中的状态事实仍可进入 `history.batch`。

当前状态不从旧历史可靠推断：设备离线后最后一次 running 不能证明仍运行，读取历史 error 也不能证明当前仍 failed。不可变历史缓存可以长期命中，但当前观察有独立的新鲜度边界。

依据：[当前 Session schema](../../../../../../packages/protocol/src/index.ts)、[worker 观察防旧覆盖](../../../../../../apps/worker/src/connector-session.ts)、[Web 当前确认与发送条件](../../../../../../apps/web/src/App.tsx)。

### 1.3 `history.batch`：解决“这个 Session 发生过什么”

新增发布、初次历史回源、补洞与重放使用同一种数据消息。不再区分 `history.event` 与 `history.batch`，也不为 live/history 定义两套领域记录。

缓存的是内部历史记录，不是网络批次：重放可以换批次划分，但记录身份、顺序及内容不能变化。单个 Session 缓存完整性按连续历史覆盖判断，不按收到多少批次判断。

不要求 provider 有消息分段、turn 生命周期或工具参数结果等全部信息；不能为了统一格式伪造缺失事实。能力差异需说明，但不自动丢掉来源确实提供的内容。

依据：[历史上传](../../../../../../packages/connector/src/connector.ts)、[两种 provider 映射](../../../../../../packages/connector/src/copilot-adapter.ts)、[Agent Host 映射](../../../../../../packages/connector/src/vscode-agent-host-provider.ts)。

### 1.4 `history.sync`：解决“收到的历史是否完整”

用一种同步消息表达覆盖范围、同步终点及不可用，不拆出独立 watermark/gap/reset-required/unavailable 消息。

必须能区别：

- 完整的空历史与尚未收到数据。
- 已追赶到已知终点与仍在加载。
- 缓存未命中后的回源完成与回源不可用。
- 只收到尾部、存在缺口与已有完整连续历史。

第二信道 RPC result 回答“本次读取命令执行得怎样”；本消息描述第一信道已传输历史的覆盖情况。两者是不同职责，不重复携带整份历史或复制错误详情。具体能否把终点放在最后批次中、进度是否需要多次上报，是后续编码选择，不是现在增加类型的理由。

当前只有命令完成与 `history_synced_at`，不足以声明目标模型的完整覆盖保证；不能据此把新同步消息描述成当前已经存在。

依据：[历史同步命令与终态](../../../../../../packages/connector/src/connector.ts)、[worker 历史同步标记](../../../../../../apps/worker/src/connector-session.ts)、[历史同步 API](../../../../../../apps/worker/src/api.ts)。

## 2. 历史批次内部：复用六种职责，不展开 wire 定义

以下是历史记录的语义分类，不是六种额外上行操作，也不要求某个 provider 全部支持。先尽量复用已有 message/tool/status/error/activity 语义，仅明确输入交互边界。

| 历史记录类别 | 职责 | 最小边界及与现状的关系 |
| --- | --- | --- |
| `message` | 已记录的 user/assistant/system 内容 | 消息可以含来源已有的分段及格式信息；不必另设 `message.part.recorded` 消息类型，也不包含流式中间文本 |
| `tool` | 工具调用和结果的历史记录 | 调用与结果可分别追加并关联同一调用；不覆写旧记录。状态是记录内语义，不为 started/succeeded 等各设类型；参数/结果仅在来源提供时保留 |
| `input` | 用户输入请求、接纳回答及请求结束的历史记录 | 用统一类别表达交互阶段，不拆 requested/answered/resolved 三种上行类型；当前编码在 message/request part 中，属于现有语义的明确归类，不宣称 schema 已支持独立 input |
| `status` | 来源实际记录的执行或生命周期事实 | 可保留当前 SDK idle 等历史；不要求补齐全部转换，不用它反推当前可写性，不强制新增 turn.started/finished |
| `error` | 来源历史中的执行错误及必要原因 | 不代替 tool 的失败结果；不混入 RPC 错误、连接断开或历史回源失败 |
| `activity` | 来源确实记录的意图或活动内容 | 为保留当前 assistant.intent 等能力而暂保留；token、短命 UI 提示和未记录进度不进入这里。若后续能无损归入 message 注释，再评估是否合并 |

消息、turn、part 的来源身份及展示顺序仍可作为记录关联信息，但无需因为 Web 要按 turn 分组就新增 turn 事件。记录分类不按 UI 气泡决定。

暂不加入正式消息修订、任意补偿事件、完整原始 provider 日志、附件专用生命周期或人工工作状态；遇到实际需求再讨论，不从潜在扩展反推本期必需类型。

## 3. 与当前 Session 功能逐项对比

| 当前功能/状态 | 源码事实 | 最小候选承载 | 覆盖或缺口 |
| --- | --- | --- | --- |
| 发现已有 Session、重新连接刷新 | Connector listSessions 后 syncSessions | sessions.snapshot | 覆盖；还须定义完整目录覆盖，不能靠 created 事件替代发现 |
| 新建 Session 后出现在列表 | create 命令后 session.updated | session.updated，也可在后续目录出现 | 覆盖；无需另设 session.created 上行类型 |
| 标题、父子关系、列表排序/摘要 | title/parentSessionId/updatedAt/lastMessagePreview；Web 分组和搜索 | Session 摘要，两种同步消息共用 | 覆盖；摘要不依赖中继一定持有完整历史，淘汰历史也不等于删目录 |
| queued/running/waiting/idle/failed | 现有规范化状态；queued 在 schema/UI 支持，所读 provider 映射未直接产出 queued | session.updated 的状态 | 覆盖；不为五个状态各设事件，不凭枚举存在承诺每个 provider 都产出 |
| closed/归档 | Agent Host archived 映射 closed，SDK shutdown 可更新摘要 | session.updated | 覆盖现有显示；归档/关闭是否进一步分离待有需求再决定，不加 archived 事件 |
| gone/不可用 | Agent Host 发现绑定消失时上报 gone | session.updated | 覆盖；gone 不等于数据删除，不能触发历史清除 |
| unknown/状态可信度 | SDK saved metadata 为 unknown；executionStateKnown 与当前连接确认分开判断 | session.updated + 连接有效性 | 覆盖；未知状态不能默认 idle，不需独立 unknown 事件 |
| offline/removed/unknown-device | Web 根据设备连接、删除信息及查询失败派生 | 中继连接/设备管理信息，不属于 Session 历史 | 不增加第一信道领域 event；中继离线时 Connector 无法发送 offline 事实 |
| syncing/sync-failed/unsupported/unconfirmed | 当前取决于 connector sessionSyncState 与连接确认 | 目录完成边界、第二信道结果及中继确认状态 | 不新增 Session 领域类型；应保持旧观察失效与同步失败可见 |
| 是否可发送 follow-up | 当前连接确认、capabilityConfirmed、设备 sendMessage 与 Session canSendMessage 联合判断 | session.updated 的可写观察 + 第二信道能力/连接信息 | 覆盖；不能只看 running/idle，也不能把旧历史当成可写确认 |
| 等待输入、问题与答案显示 | pendingInputRequest；worker 从 input 历史推导，Web 要求当前 waiting | session.updated 的当前 pending + input 历史 | 必要信息覆盖；当前 provider 摘要/worker 存储并未完整直通 pending，目标实现需另核对，不能声称直接换名即完成 |
| message-flow、工具折叠与计数 | Web 折叠 part 快照；SDK 工具开始/完成为分立事件 | message/tool 历史及来源关联 | 类型覆盖；归约语义需调整，当前快照覆盖机制不是不可变 JSONL 历史保证 |
| activity、system、error | SDK intent/error；Agent Host system/error | 六类历史中的对应语义 | 保留已支持内容，不以“精简”为由默默删信息 |
| 离线历史及设备删除后的旧历史 | 当前库持久保留，Web 可继续读取 | 整 Session 缓存命中则可读，未命中须回源 | 有意改变的服务保证，不是类型缺失：不承诺淘汰后或设备不可用时仍能读取；需后续评审确认 UX |
| 历史加载、空历史、回源失败 | 当前命令完成标记及 events 游标 | history.batch + history.sync | 类型补足；稳定身份、覆盖范围、不可变性仍须规范，当前 upsert 不能作为证明 |

源码索引：[Session schema](../../../../../../packages/protocol/src/index.ts)、[SDK 摘要与事件映射](../../../../../../packages/connector/src/copilot-adapter.ts)、[Agent Host 状态/发现映射](../../../../../../packages/connector/src/vscode-agent-host-provider.ts)、[worker Session 与历史存储](../../../../../../apps/worker/src/connector-session.ts)、[worker pending 输入推导](../../../../../../apps/worker/src/api.ts)、[Web 状态投影](../../../../../../apps/web/src/session-list.ts)、[Web 发送与输入条件](../../../../../../apps/web/src/App.tsx)、[transcript 消费](../../../../../../apps/web/src/message-flow.ts)。

## 4. 对上一版清单的删减建议

| 早期候选 | 本期建议 | 理由 |
| --- | --- | --- |
| session.created/metadata.changed/execution.changed/lifecycle.changed | 合并为 session.updated 的当前摘要 | 当前功能消费观察，不需要强制重建所有转换日志；provider 真有历史则作为历史记录保留 |
| session.state.observed | 与 session.updated 合并 | 再单设一套元数据更新会重复定义新鲜度与清除语义 |
| turn.started/turn.finished | 不作为必需类型 | 现有跨 provider 契约不具备一致 turn 生命周期；当前分组可以用关联信息，真实来源记录可留在 status 历史 |
| message.recorded/message.part.recorded | 统一 message 类别，分段是内容结构 | 不同时记录整消息和各 part 来重复表达同一内容 |
| tool.call.recorded/tool.result.recorded | 同一 tool 类别，保留调用/结果阶段 | 统一类别不等于把两次事实覆写为一条可变记录 |
| input.requested/input.answered/input.resolved | 同一 input 类别，保留阶段与回答事实 | 降低类型数量但不丢请求/回答对应关系 |
| history.watermark/unavailable/gap/reset-required | 统一 history.sync 的同步结果语义 | 都回答覆盖及可恢复性，不为每个原因加类型 |
| history.snapshot | 本期不设必需消息 | 已有 Session 当前摘要与可分页历史，尚无独立投影快照的必要性证据；确认性能需要后再加 |
| message.revised | 暂不引入 | 未观察到本期必须处理正式历史修订的功能，不能提前设计通用补偿机制 |
| 独立 capability.changed/status.unknown 等 | 不引入 | 当前摘要中的事实/可信度已可表达；设备级能力仍由连接注册表达 |

## 5. 覆盖结论及未决边界

从**消息类型的表达能力**看，四种上行消息加六类历史职责能够覆盖所读源码的 Session 列表、状态、可写性、输入等待和 transcript 功能；无需保留上一版全部细分类型。

这不是实现已经完备的结论。仍需收敛的是少量协议不变量，而不是继续增加类型：

1. 目录的覆盖范围与完成边界，以及历史完整性/不可用的明确报告。
2. 当前观察与历史游标分离；旧连接观察如何失效，未知、未提供及显式清除如何区别。
3. provider 提供稳定 JSONL 级身份与顺序的边界；不能从最终 part 伪造中间日志，也不能把当前 event upsert 当作不可变记录。
4. pending input、消息/tool 关联如何保持消费一致；能力不足显式说明，不默默补默认值。

**建议当前只审阅这一精简候选，不视为已批准协议。** 后续首先确认“Session 当前观察”与“不可变历史”是否按本文分开表达，再逐项讨论必要内容；不要求先批准详细字段。
