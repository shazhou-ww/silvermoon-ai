# 完成与 Reactivate：实现证据

## 当前：原生 Done / Restore 联动

已接受 Ideal `d9dfb90e315d5601f652194c1e093675b04e8af2`。本节为当前原生联动候选；下方手机与首版独立标记记录均为历史，不能证明当前原生联动真实上线。

- 新可选协议能力及原生命令贯通 Adapter / hosted provider / Connector / Worker。父 Session 与 default chat 使用 Session channel，独立 child 使用自己的 chat channel。确认须匹配 client sequence 与动作类型，并验证实际 native flag 和库存；拒绝不改变状态，不一致/超时/断线明确未确认，不重放。
- Worker 校验账户、设备、Session、当前 connection、原生能力及匹配命令结果；归档项恢复独立于 canSendMessage。旧连接/旧 observation 的既有保护沿用，失败结果不得夹带 Session 状态。最后派发拒绝命令后保留在线订阅，避免拒绝后的合法恢复失去接收入口。
- 0013 增加原生状态和能力，保留所有旧标记、身份和历史。原生库存是工作状态投影权威；普通事件不改原生状态，没有批量归档或自动 Restore。旧 Web 的无 connection 请求被明确拒绝，旧 Connector 与 SDK-only 来源禁用，而不是 Relay-only 伪成功。
- 列表与详情保持共用 glyph、44px 手机触控区与草稿。Show completed 不要求 Show ended；原生状态优先于残留 nativeStatus 标签。动作完成后重新读取当前库存和设备确认，防止操作回执覆写后来的本机状态。详情焦点在 pending 解除后的已提交渲染中恢复，切换 Session/账户后不会抢焦点。

2026-10-12 验证：

| 检查 | 结果与限制 |
|---|---|
| `pnpm check` | lint、全部类型、单元测试、构建通过；后续去除新增 unused import/焦点 effect 警告，lint 仅留两个既有 Fast Refresh warning |
| Connector 自动化 | 39 通过、1 既有跳过；含真实 WebSocket 传输上的模拟 AHP 服务，验证四种正确 channel/action、拒绝/不一致、客户端本机状态通知、旧不兼容 Host、准确 ack、Connector 结果/未确认上传；原生确认后回执上传失败保持 unknown，不误报原生拒绝；不是实际 VS Code 集成 |
| 协议自动化 | 7 通过，验证向后兼容能力、显式原生状态及 archive 命令的 boolean/身份形状 |
| Worker 自动化 | 33 通过；新增在线原生命令接受但不乐观写入、错误 flag 拒绝、确认后投影、原生 Restore、unknown 回执、offline/unsupported、旧标记保留与旧库存保护 |
| Web 单元 | 72 通过；新增 Show completed 无需 Show ended 与显式 native flag 优先 |
| 浏览器 | 13 场景 × desktop / mobile / 320px narrow，共 39 全通过；pending/unknown 不显示成功、不重放，旧 Connector/离线禁用且详情说明，完成/恢复、历史/草稿/焦点、跨浏览器、过期库存、44px 与长标题 |
| 本地 D1 | 0013 在真实本地 D1 成功，远程未应用 |
| 视觉检查 | 查看 1440px 与 320px 实际浏览器截图，glyph 与详情恢复入口可达，无横向溢出；提示不遮挡按钮。测试状态来自 fixture |

待完成：经明确授权的专用真实 VS Code Session 双向 Done / Restore；记录实际 VS Code 版本及原生副作用。尚未操作任何真实 Session、发布新 npm 版本或部署本轮生产变更。I-S03、I-AC01、I-AC02 保持未完成，不将 mock、health 或静态资产检查当作真实联动证据。

## 手机与详情操作更新

已明确接受 `idealRevision=ba3ee658c830adc18c88fa69a78bc08adc61a3ac`，继续现有 idea，不创建新项。以下为本轮实现与验证；后面的首版记录保留为历史证据。

- 列表、桌面详情标题区和手机详情标题区复用同一工作状态动作，保持一致的 glyph、可访问名称、portaled tooltip、pending 禁用及失败反馈；详情内可完成并原地 Reactivate，不需要返回列表。
- 手机与 coarse pointer 设备的两个入口均使用至少 44 × 44 CSS px 点击区，glyph 仍为小图标。手机详情标题、设备和状态在一列中布局，动作独立占位；长标题不挤出动作。
- 详情完成后保留当前历史、路由和草稿；完成项仍禁止发送。Reactivate 不发消息、不解除原生归档或其他筛选、在线及能力限制。
- 请求期间禁用导致的键盘焦点丢失已修复：仅恢复发起操作的详情按钮，在账户未变、节点仍存在且可见、用户没有转移焦点时恢复；切换 Session 后不会抢走新会话的输入焦点。
- 手机通知移到详情动作下方，避免成功或失败浮层阻挡动作；列表的既有焦点回退行为不变。已移除设备的列表和详情均无可执行状态按钮，普通离线设备仍可更改工作标记。
- API、迁移和 Connector 行为未改动；完成与恢复文案及 README 已更新为支持详情入口。

2026-10-12 本轮检查：

| 检查 | 结果 |
|---|---|
| Web lint / typecheck / build | 均通过，仅既有 Fast Refresh 和大 chunk warning |
| Web 单元测试 | 71 项通过 |
| 工作状态浏览器回归 | 5 个新增详情/触控场景与 6 个既有场景 × desktop、mobile、320px narrow，最终 33 项全部通过 |
| 精确触控标准 | 实测手机/320px 与 1440px coarse pointer 的列表和详情按钮宽高均至少 44px；长标题无横向溢出 |
| 行为边界 | 同页双向操作、草稿、焦点、pending/失败一致性、异步导航后不抢焦点、原生归档、离线/移除设备、旧库存、跨浏览器读取与其他筛选均有通过的回归 |
| 视觉核对 | 查看实际 320px completed 详情与桌面长标题截图，动作未被通知遮挡，标题和图标仍可达 |

首轮回归发现禁用按钮丢失焦点和手机通知覆盖新详情动作，均已修复并复测。测试也随新增入口限定列表选择器；隐藏手机列表的状态一致性使用 aria-label 属性断言，不把隐藏元素当作可访问树中的可见入口。最终未使用 force click 绕过遮挡。浏览器 API 使用 fixture，不将此验证称为真实生产账户 smoke。

本轮证据覆盖 **I-S02、I-S03、I-AC03**；**I-AC01、I-AC02** 的底层状态规则与首版一致，并由正式发布流水线重跑全部检查。本轮尚未部署，部署证据由 Outer World 单独记录。

## 首版实现范围

- `0012_session_work_state.sql` 为现有复合身份的 Session 增加 `open / completed`，旧项默认 `open`；标记更新不修改执行状态、原生归档、历史或活动时间，也不级联父子项。
- 账户 API 验证认证、CSRF、输入和完整账户／Connector／Session 身份；普通离线设备可操作，已移除设备保持只读。重复同一状态没有附带命令或时间更新。
- Connector 的 Session upsert、事件和库存不写工作标记；发送 API、入队 SQL 和 Durable Object 的最后派发检查共同阻止对 completed 项发新指令。
- UI 仅在列表项右侧提供完成勾选／Reactivate 回转 glyph，具备可访问名称、焦点、完整的 portaled tooltip 和触屏常显；Show completed 兼容既有浏览器视图偏好。
- 隐藏已完成父项时未完成子项仍可见；选中历史与草稿保留；Reactivate 不发送消息、不解除归档或其他筛选。失败不显示虚假成功，旧库存与退出账户后的请求不会覆盖当前操作。

## 首版验证

2026-10-12 在当前隔离 worktree 验证：

| 检查 | 结果 |
|---|---|
| `pnpm check` | lint、所有类型检查、单元／集成测试及构建通过；8 个 release 脚本测试、6 个 protocol、71 个 Web、29 个 Worker、29 个 Connector 测试通过，Connector 另有 1 个既有跳过项 |
| `pnpm --filter @silvermoon-ai/worker d1:migrate:local` | 真实本地 D1 顺序执行既有迁移及 0012 成功 |
| 新工作状态浏览器场景 | 6 个场景 × desktop / mobile / narrow，共 18 项最终通过 |
| 完整浏览器回归 | 初次 162 通过、2 个既有跳过、13 失败；失败均为新增 glyph 造成旧的按标题匹配按钮选择器歧义，不是发送或历史行为回归 |
| 受影响回归复测 | 将旧选择器限定为 Session 行选择按钮后，5 个旧场景和 6 个新场景 × 3 个项目，共 33 项通过 |
| 最终 tooltip 调整 | 实际截图发现列表行 paint containment 会裁掉 tooltip，改用现有 Radix portal；18 项重新通过，最终 Web typecheck、针对性 lint 和 build 通过 |
| 视觉核对 | 查看实际产品桌面与 320px 窄屏截图，行尾 glyph、两类工作／执行标记和 tooltip 完整显示，无文档级横向溢出 |

Worker 类型检查首次报告生成文件过期；按既有 `wrangler types` 重新生成后检查通过，生成结果无语义 diff。既有两条 UI Fast Refresh lint warning 和 Web 大 chunk warning 没有扩展本次改动范围。

## 首版标准与证据映射

- **I-AC01:** Worker 集成测试覆盖离线状态变更、重复变更、账户隔离、同名跨 Connector Session、无命令副作用、非法输入、CSRF、已移除设备禁止变更；真实迁移默认值和 protocol 输入边界已检查。
- **I-AC02:** Worker 在线集成测试在完成后继续写事件、当前 Session 更新及库存同步，标记仍保持 completed；消息 API 返回要求先 Reactivate，最后派发也不发送 completed 命令。归档历史及父子非级联由 Worker 和浏览器场景共同证明。
- **I-AC03:** 浏览器覆盖成功、失败、请求期间禁用、隐藏父项保留子项、操作不选中其他项、独立浏览器读取同一账户标记、刷新、旧库存、离线、原生归档、已移除设备与键盘访问；保存失败时行仍保持原状态。

## 后续阶段边界

用户明确接受构想，并授权实现验证完成后无需再次实现审阅、直接部署，在线上验收 Deployment。此文档记录实现事实，不声称已经部署，也不声称已操作真实生产 Session；真实账户操作留给线上验收。
