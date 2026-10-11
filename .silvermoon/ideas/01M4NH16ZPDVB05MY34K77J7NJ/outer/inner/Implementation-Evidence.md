# 实施验证证据

本文件记录 2026-10-11 最新上游整合后的验证，不使用先前隔离候选的通过结果。下面结果来自本次候选；没有实际迁移、部署或包发布。

## 候选与回归范围

- 保留上游输入请求 schema、历史事件序号合并、问题/选项/自定义回答及最新登录品牌布局。
- 恢复本轮当前连接确认、离线列表、未知结果与草稿实现；六个冲突文件逐处整合，保留两边行为。
- 状态重试 HTTP 入口已补独立路由并覆盖请求复用/成功应答；分页保留每页输入请求投影。
- 本地 Connector WebSocket 测试使用虚构 adapter，真实关闭并重连测试 socket，不访问用户 agent。
- 浏览器测试使用模拟 API；默认端口被共享进程占用时，临时等价配置使用 4187，不终止未知进程。

## 最终结果

| 检查 | 本轮实际结果 | 对应标准 |
|---|---|---|
| `pnpm test` | 73 项通过：协议 5、Web helper 16、Connector/adapter 30、Relay 22 | I-AC01、I-AC02 |
| 完整 Playwright browser 回归 | 84 项，83 通过、1 桌面专属移动导航检查按设计跳过；桌面、移动、320px 窄屏均覆盖 | I-AC02 |
| `pnpm typecheck` | 全工作区通过，Worker 生成类型检查未修改配置 | I-AC03 |
| `pnpm lint` | 通过；仅原有两个 UI 组件 Fast Refresh 警告 | I-AC03 |
| `pnpm build` | Web/协议/RPC/Connector 构建通过，Worker dry run 通过；Web 保留大 chunk 提示，没有无关拆包 | I-AC03 |
| 全部迁移依序检查 | 10 个 SQL 迁移在内存 SQLite 应用通过，确认列存在；未操作实际 DB | I-AC03 |
| 冲突与格式 | 六个冲突文件无标记，类型/测试通过；diff whitespace 检查通过；Ideal tree 保持已接受的 `e652e7b88655ed143dd6d2b45e9a515ba7b80862` | I-S03 |

浏览器验证使用临时等价配置，唯一变化是将默认 4173 端口改为 4187；命令为 `pnpm --filter @silvermoon-ai/web exec playwright test --config playwright.offline-verification.config.ts`。默认端口已有未知共享进程，本轮没有终止它或复用其服务。临时配置在测试后删除，正式配置不变。

## 核心证明索引

- [Connector 传输测试](../../../../../packages/connector/src/connector.test.ts)：inventory 期间的实时观测保留、新旧序号、初始失败与状态重试、结果上传失败仍保持真实 outcome、执行中真实断开测试 WebSocket 再重连补传原命令结果；业务执行次数为 1。
- [Relay RPC/HTTP 测试](../../../../../apps/worker/src/index.test.ts)：旧连接和低序号拒绝、被更新观测超越的 inventory 不回退、原连接结果归属、metadata 可继续但状态未知、超过 500 条分页、未知历史任务不阻塞显式重试；状态重试 HTTP 独立路由可达，重复请求复用，完成后 ready。
- [Relay 输入事件投影测试](../../../../../apps/worker/src/api.test.ts)：原上游 structured/legacy 输入请求选择与 resolved 过滤保持通过。
- [列表 helper 测试](../../../../../apps/web/src/session-list.test.ts)：关键词 facet 独立于已选状态、离线/Ended/Gone组合、当前连接确认、未知设备、元数据执行状态未知。
- [列表 browser 测试](../../../../../apps/web/tests/session-list.browser.ts)：原问题/选项/自由回答回归、菜单 N、搜索 AND 状态、选中零保留、设备分组与移动导航；新增离线和未确认重连期间等待输入面板隐藏，恢复当前确认后原操作可用，草稿保持。
- [消息 browser 测试](../../../../../apps/web/tests/message-scroll.browser.ts)：原输入答案顺序、历史和滚动控件回归；掉线 URL/阅读位置、独立草稿、确认门槛、结果未知不重发、metadata 显式继续、刷新失败恢复、慢 inventory 不重叠、失去会话后清除正文及状态失败重试。
- [登录页 browser 测试](../../../../../apps/web/tests/login-page.browser.ts)：最新上游品牌/图标与响应式登录流程保持通过。

## 发布前提与限制

- 更新需要[迁移 0010](../../../../../apps/worker/migrations/0010_session_confirmation.sql)及匹配的 Relay/connector。先迁移和 Relay，后 connector/Web；旧 connector 可以保留上传历史，但不能作为当前确认，远程消息拒绝并显示更新要求。
- 协议版本保持 2；注册显式启用 `confirmationVersion: 1`，未声明确认的旧快照不被视为当前执行事实。
- 已观测结果证据只在 connector 进程内保存；进程重启可能失去证据，未知结果不伪造完成，不自动重执行业务。
- 测试使用本地运行时、虚构数据和 mocked Web API，不等于真实生产设备断网、访问变化或线上发布验收。没有 npm 发布、实际 DB 迁移或服务部署；D ledger 全部未勾选。
