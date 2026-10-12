# 完成与 Reactivate：实现证据

## 实现范围

- `0012_session_work_state.sql` 为现有复合身份的 Session 增加 `open / completed`，旧项默认 `open`；标记更新不修改执行状态、原生归档、历史或活动时间，也不级联父子项。
- 账户 API 验证认证、CSRF、输入和完整账户／Connector／Session 身份；普通离线设备可操作，已移除设备保持只读。重复同一状态没有附带命令或时间更新。
- Connector 的 Session upsert、事件和库存不写工作标记；发送 API、入队 SQL 和 Durable Object 的最后派发检查共同阻止对 completed 项发新指令。
- UI 仅在列表项右侧提供完成勾选／Reactivate 回转 glyph，具备可访问名称、焦点、完整的 portaled tooltip 和触屏常显；Show completed 兼容既有浏览器视图偏好。
- 隐藏已完成父项时未完成子项仍可见；选中历史与草稿保留；Reactivate 不发送消息、不解除归档或其他筛选。失败不显示虚假成功，旧库存与退出账户后的请求不会覆盖当前操作。

## 验证

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

## 标准与证据映射

- **I-AC01:** Worker 集成测试覆盖离线状态变更、重复变更、账户隔离、同名跨 Connector Session、无命令副作用、非法输入、CSRF、已移除设备禁止变更；真实迁移默认值和 protocol 输入边界已检查。
- **I-AC02:** Worker 在线集成测试在完成后继续写事件、当前 Session 更新及库存同步，标记仍保持 completed；消息 API 返回要求先 Reactivate，最后派发也不发送 completed 命令。归档历史及父子非级联由 Worker 和浏览器场景共同证明。
- **I-AC03:** 浏览器覆盖成功、失败、请求期间禁用、隐藏父项保留子项、操作不选中其他项、独立浏览器读取同一账户标记、刷新、旧库存、离线、原生归档、已移除设备与键盘访问；保存失败时行仍保持原状态。

## 后续阶段边界

用户明确接受构想，并授权实现验证完成后无需再次实现审阅、直接部署，在线上验收 Deployment。此文档记录实现事实，不声称已经部署，也不声称已操作真实生产 Session；真实账户操作留给线上验收。
