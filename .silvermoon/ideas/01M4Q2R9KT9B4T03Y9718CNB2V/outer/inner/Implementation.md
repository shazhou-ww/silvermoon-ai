# Implementation

## Steps

### I-S01: 接通原生状态操作与确认

细化 Connector/协议的 Session 级能力和 Done / Restore 命令，用实际 Agent Host 的 Session/chat 绑定下发正确原生动作，验证确认及拒绝。账户 API、入队和派发核对完整身份、当前连接、能力及设备访问；归档项恢复不沿用“可发送消息”门控。记录已确认、失败及未确认，不把下发当作成功、不自动重放。

### I-S02: 同步原生权威与交互

本机手动 Done / Restore 双向同步；旧 Relay 标记保留为非原生权威，不批量转成命令。支持来源经当前连接确认后使用原生结果；未确认、不支持和旧 Connector 明确禁用。列表/详情复用 glyph 与至少 44px 触控区，Show completed 可直接提供原生完成历史和 Restore，不被 Show ended 阻挡；发送仍遵守能力与连接约束。核对父 Session/default chat 和独立子 chat 的不同原生语义。

### I-S03: 验证联动与兼容边界

用自动化验证身份隔离、Session/chat 定位、能力协商、确认/拒绝/断线/旧结果、双向同步、旧标记迁移及列表/详情。验证本机实际受支持版本的 Done / Restore；只在有明确操作授权时使用专用测试 Session，不将协议调查或 mock 当作真实联动证据。既有 [Evidence.md](Evidence.md) 是旧版历史，不证明本轮已完成。

## Acceptance criteria

### I-AC01: 原生联动结果可信

受支持 Session 的两种操作获匹配本机确认后才成功；权限、能力、离线、拒绝及超时路径不伪成功、不自动重放。用 Worker、Connector/Agent Host 协议测试及经授权的专用 Session 集成证据证明。

### I-AC02: 原生状态双向一致且兼容

本机与 Relay 的 Done / Restore 经确认后相同；旧标记不触发自动归档，普通事件不伪造完成，新旧连接结果不错误覆盖。测试同一身份、历史、旧 Connector、子 chat 映射和已移除设备限制，明确实际版本的原生副作用。

### I-AC03: UI 动作及恢复路径明确

桌面/手机/320px 的列表与详情显示一致的状态、pending、未确认与失败，触控区至少 44px。Show completed 可访问原生归档 Session 并恢复；不支持/离线明确禁用，历史与草稿保留，不自动发消息或绕过发送权限。
