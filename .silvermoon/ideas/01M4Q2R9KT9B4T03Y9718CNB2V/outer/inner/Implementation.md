# Implementation

## Steps

### I-S01: 接通原生状态操作与确认

细化 Connector/协议的 Session 级能力和 Done / Restore 命令，用实际 Agent Host 的 Session/chat 绑定下发正确原生动作，验证确认及拒绝。账户 API、入队和派发核对完整身份、当前连接、能力及设备访问；归档项恢复不沿用“可发送消息”门控。记录已确认、失败及未确认，不把下发当作成功、不自动重放。

采用向后兼容的可选 `setNativeArchive` / `canSetNativeArchive` / `nativeArchived` 及 `session.archive` 命令，继续使用协议 v2；只有新能力确认的来源才收到新命令。0013 添加独立原生状态及操作能力列，旧 `work_state` 原样保留，API 投影优先采用已观测原生状态，不生成迁移命令。操作绑定已有命令记录与当前 connection；结果须匹配指定 Session、请求原生 flag、当前连接及 observation，旧结果不能覆写新库存。原生拒绝为失败，超时/断线/不一致为未确认；Web 收到可信结果后再读取当前库存和连接，不用请求值乐观更新。

### I-S02: 同步原生权威与交互

本机手动 Done / Restore 双向同步；旧 Relay 标记保留为非原生权威，不批量转成命令。支持来源经当前连接确认后使用原生结果；未确认、不支持和旧 Connector 明确禁用。列表/详情复用 glyph 与至少 44px 触控区，Show completed 可直接提供原生完成历史和 Restore，不被 Show ended 阻挡；发送仍遵守能力与连接约束。核对父 Session/default chat 和独立子 chat 的不同原生语义。

原生 Session 使用 `SessionIsArchivedChanged`，独立 child chat 使用 `ChatIsArchivedChanged`，不向默认 chat 下发 child 动作，不额外级联。沿用现有 provider 仅接纳 AHP 0.10.x / 1.x 的兼容范围，并核对 initialize 返回的精确协商版本；每个目标须有显式原生状态，SDK-only 不声明 Session 级能力。列表和详情共用动作；禁用原因在详情明示，原生完成项通过 Show completed 直接可达。原生状态与 Agent 活动标签继续分开，已移除设备不可恢复访问。

原生能力禁用原因属于实时连接信息，放在消息滚动区域外并复用连接提示样式；在线、离线与重连时提示文字换行不能改变历史内部布局或阅读滚动位置。保留原有禁用解释，不通过删除提示、放宽滚动断言或跳过测试来通过部署检查。

### I-S03: 验证联动与兼容边界

用自动化验证身份隔离、Session/chat 定位、能力协商、确认/拒绝/断线/旧结果、双向同步、旧标记迁移及列表/详情。验证本机实际受支持版本的 Done / Restore；只在有明确操作授权时使用专用测试 Session，不将协议调查或 mock 当作真实联动证据。既有 [Evidence.md](Evidence.md) 是旧版历史，不证明本轮已完成。

用户已授权创建专用测试 Session，实际使用 VS Code 1.141.0 / AHP 0.10.0 验证。为让原生目录保留测试 Session，仅在初始化时发送一轮“只回复 Ready，不使用工具、不改文件”；Done / Restore 两方向不追加消息，原生 flag 为 65 ↔ 1，同一身份和一轮历史保留，最终恢复并在连接关闭后重查。独立原生客户端验证底层本机状态，不声称已点击 VS Code UI 或执行生产 Relay smoke。已授权 Connector 0.2.1 / latest / npm/connector/v0.2.1；在实现验收前核对该准确版本的打包及仓库外消费，实际发布由 Outer 阶段完成。

## Acceptance criteria

### I-AC01: 原生联动结果可信

受支持 Session 的两种操作获匹配本机确认后才成功；权限、能力、离线、拒绝及超时路径不伪成功、不自动重放。用 Worker、Connector/Agent Host 协议测试及经授权的专用 Session 集成证据证明。

### I-AC02: 原生状态双向一致且兼容

本机与 Relay 的 Done / Restore 经确认后相同；旧标记不触发自动归档，普通事件不伪造完成，新旧连接结果不错误覆盖。测试同一身份、历史、旧 Connector、子 chat 映射和已移除设备限制，明确实际版本的原生副作用。

### I-AC03: UI 动作及恢复路径明确

桌面/手机/320px 的列表与详情显示一致的状态、pending、未确认与失败，触控区至少 44px。Show completed 可访问原生归档 Session 并恢复；不支持/离线明确禁用，历史与草稿保留，不自动发消息或绕过发送权限。
