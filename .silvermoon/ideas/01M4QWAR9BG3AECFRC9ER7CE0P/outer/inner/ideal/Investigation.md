# 重复 Session 与未知执行状态调查

## 调查目标

比较生产 connector `copilot-sdk-test` 中以下记录的 UI 映射、Relay 持久化、事件历史及 connector 生命周期，判断它们是否为数据库重复、为何出现未知执行状态，并界定可观察规模与最可信根因：

- `9090f04f-63e6-4dc1-9f52-03ac6c9ca406`
- `9df9ca7a-22e9-41e3-87ec-7bbccff5d79d`

## 方法与边界

- 2026-10-12 以只读 Wrangler D1 查询观察生产 `silvermoon-relay`；所有查询均报告 `rows_written: 0`。
- 生产页面可公开加载，但 Relay API 要求登录；登录后，本调查不读取或转移浏览器 cookie，而以生产持久化数据结合确定性的前端映射复核 UI 状态。
- 时间邻近、标题相似和消息相同只作为关联证据，不作为未来自动合并键。
- 未查询或修改用户凭据、connector token，也未修改产品代码、生产数据或部署。

## 指定记录的端到端证据

| 维度 | `9090f04f…` | `9df9ca7a…` |
| --- | --- | --- |
| Relay 主键 | 独立 ID | 独立 ID |
| 创建时间 | `2026-10-12T03:49:25.013Z` | `2026-10-12T03:49:19.438Z` |
| 标题 | 首条长提示词的截断内容 | `跟进 Relay Session 完成与 Reactivate` |
| 持久化状态 | `status=unknown`、`native_status=NULL`、`execution_state_known=0` | `status=running`、`native_status=40`、`execution_state_known=1` |
| 连接确认 | 当前连接 `fd582f82…`，observation 5 | 同一当前连接，observation 2 |
| 事件规模 | 1,076 条，首条为 `role=user` | 4,405 条，首条为 Agent Host `role=system` |
| UI 映射 | `Execution state unknown` | `Running` |

两行不是数据库层面的重复：Relay 以 `(user_id, connector_id, id)` 为主键，二者 ID、标题、状态、事件 ID 与事件规模均不同。然而它们是同一逻辑会话的两个来源投影，证据如下：

1. 创建时间相差约 5.6 秒，首条非空消息文本完全相同，均为同一份 Silvermoon 工作交接提示。
2. `9090f04f…` 的事件采用 Copilot SDK UUID；`9df9ca7a…` 的首条事件 ID 带 `ahp:` 前缀并包含 Agent Host turn ID。
3. 两套事件 ID 没有交集，但 SDK 记录中有 40 条事件能在 Agent Host 记录中找到相同类型与相同 payload；这符合两个协议分别投影同一底层对话，而非同一 Relay 行被重复写入。

## 代码路径与根因

### Connector 来源合并

[`CopilotAgentAdapter.listSessions`](../../../../../../packages/connector/src/copilot-adapter.ts) 并行读取：

- `CopilotClient.listSessions()` 的持久化目录；
- `VsCodeAgentHostProvider.listSessions()` 的实时 Agent Host 目录。

它先以 Copilot SDK `metadata.sessionId` 建立 `persisted` Map，再以 Agent Host `session.id` 覆盖 `hosted` 项。该逻辑只在两个来源恰好提供相同字符串 ID 时去重。现有单元测试也只覆盖了相同 ID 被实时记录覆盖的情形。

指定记录中，SDK ID 为 `9090f04f…`，Agent Host session resource 解析出的 ID 为 `9df9ca7a…`，因此 Map 将它们保留为两行。Copilot SDK 的公开 `SessionMetadata` 只有 `sessionId`、时间、summary、remote 与 context；Agent Host `SessionSummary` 提供自身 resource、provider、时间、状态、project、`_meta` 等，但当前生产证据和 connector 映射均未暴露可直接等同这两个 ID 的稳定字段。因此“缺少稳定跨来源关联键”是已界定的产品约束，不能用时间或文本猜测替代。

### 未知执行状态

[`metadataSummary`](../../../../../../packages/connector/src/copilot-adapter.ts) 对 Copilot SDK 持久化目录项明确写入：

- `status: "unknown"`
- `executionStateKnown: false`
- `nativeStatus` 缺省

这是因为 SDK `listSessions()` 元数据不包含当前运行状态，而不是 Relay 丢失了一个已知状态。Agent Host 路径则由 [`agentHostSummaryToSession`](../../../../../../packages/connector/src/vscode-agent-host-provider.ts) 将 status bitset 映射为 `running`、`waiting`、`idle`、`failed` 或 `closed`，并设置 `executionStateKnown=true`。

Connector 在注册或 `sessions.list` 时把两个来源的合并数组同步给 Relay；[`upsertSession`](../../../../../../apps/worker/src/connector-session.ts) 按来源 ID 分别 upsert，并只在带 observation 且来源声明状态已知时写入 `execution_state_known=1`。Relay API 原样序列化该字段。前端 [`sessionDisplayStatus`](../../../../../../apps/web/src/session-list.ts) 在连接确认有效但 `executionStateKnown!==true` 时返回 `unknown`，最终标签为 `Execution state unknown`。因此该 UI 文案准确反映当前数据契约，但双来源拆行放大了未知行的数量和用户困惑。

## 可观察规模

2026-10-12 11:05Z 左右的生产快照：

- connector 共有 200 行 Session。
- 102 行（51%）满足 `execution_state_known=0`；这 102 行全部同时满足 `status=unknown` 且 `native_status IS NULL`。
- 其余 98 行为状态已知的实时/活动投影，其中 81 行 closed、15 行 idle、1 行 running，另有 1 行 idle 但没有 native status。
- 68/102 个未知行在创建时间前后 30 秒内存在状态已知行；该数字只说明疑似配对规模，不能证明身份。
- 仅 20 个未知行已在 Relay 拉取过首条消息历史，其中 8 个能找到首条消息完全相同的状态已知行；这为至少 8 对逻辑重复提供强证据，但不是全量下界之外的精确重复率。
- 按标题、创建时间与 preview 完全相同分组没有发现重复，说明简单字段分组会漏掉本问题。

## 结论与置信边界

1. **指定两行不是同主键的存储重复，但高置信度属于同一逻辑会话的双来源投影。**
2. **`unknown` 的直接根因已确认：Copilot SDK 持久化目录没有执行状态，adapter 有意标记未知；Relay 与 UI按契约传递。**
3. **大量“重复 + unknown”的根因已确认到 connector 合并边界：两来源使用不同 ID，而当前仅按 ID 相等覆盖。**
4. **全量重复率尚不能精确确定。** 68 个时间邻近对是宽松上界信号；8 个同首条消息对是已验证样本。缺少稳定关联键前，不应清理、迁移或隐式合并生产行。
5. **修复方向仍需实施阶段验证。** 优先寻找或新增来源提供的稳定关联标识；若协议无法提供，应先显式建模来源与关联置信度，而不是采用时间/文本启发式去重。

## 支撑后续决策的最小要求

- 为 SDK 与 Agent Host fixture 使用不同 ID 复现同一逻辑会话，防止现有“相同 ID 覆盖”测试掩盖问题。
- 任何关联方案都必须保持 SDK 历史会话的 resume/send 能力、Agent Host 实时状态与完整历史读取。
- 生产验证先采用只读或 shadow 统计，确认匹配精度后再讨论展示折叠、持久化迁移或数据清理。
