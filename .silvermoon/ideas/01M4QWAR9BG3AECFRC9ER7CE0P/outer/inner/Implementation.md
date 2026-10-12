# Implementation

## Steps

### I-S01: 建立跨来源身份契约

确认 Copilot SDK 与 Agent Host 是否能提供稳定关联标识；以不同来源 ID 的 fixture 固化已证明的双投影案例。若没有稳定标识，显式建模来源和未关联状态，不使用标题、时间或消息文本自动合并。

### I-S02: 在 connector 边界协调投影

让具有可证明关联的实时 Agent Host 投影覆盖 SDK 元数据投影的展示状态，同时保留历史恢复、发送消息、事件读取和来源消失后的安全 fallback。

### I-S03: 覆盖 Relay 与 UI 兼容性

验证 Relay upsert/API 与前端状态映射能表达关联、未关联及状态不可用，不破坏现有连接确认、分页、层级和 work state 行为。

## Acceptance criteria

### I-AC01: 证明性去重

自动化测试以不同 SDK/AHP ID 表示同一逻辑会话时只产生一个可展示投影，并证明无稳定关联的相似会话仍保持独立。

### I-AC02: 状态与能力保真

测试证明关联后的投影采用 Agent Host 实时执行状态，且 SDK fallback 的 resume/send/history 能力在 Agent Host 消失后仍可用。

### I-AC03: 现有生命周期不回退

connector、worker 与 web 的针对性测试证明连接 observation、历史同步、session 层级、分页和完成状态行为保持有效。
