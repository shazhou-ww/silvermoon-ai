# 事件流工作区实施评审

## 结论与交付

主 Agent 根据用户明确委托的技术门限审批权限完成代码、测试和实际浏览器评审，实施结论通过。用户后续在线体验验收仍由用户亲自完成，不以此文件代记。

- 现有品牌、顶栏、账户菜单、19rem 左栏及窄屏清单/详情结构保持；左栏使用原 Session 行和设备分组视觉组件，主体改为 Streams。
- 默认事件表格真正切片挂载 DOM，44px 预览行，长 payload 在独立详情区；序号保留十进制字符串，不转换成 JS Number。
- 数据缓存独立限制为 2,000 条、8 MiB 原始 UTF-8 payload；实际事件 DOM 不超过 200 行。不会先取完 10 万条历史。
- Cookie 登录态账户级只读 API 与 WebSocket 访问原 DO SQLite 日志；Origin、归属、会话有效性和设备移除在接入及持续交付时检查。网页不需要设备 token，Settings 显式创建/轮换凭证的原行为保留。
- 默认原始视图始终可用，内置类型注册表生产版本为空；测试组件验证类型选择、错误隔离和切回原始内容，不声称交付 Supervisor 视图。
- `/legacy` 与 `/legacy/settings` 保留旧 Session 功能和适用测试；旧 Session 查询链接明确提供兼容入口，不偷偷转换流身份。
- 新增从 checkout 运行的生产者脚本与安全凭证步骤，无需 npm 发布。

使用说明见[工作区文档](../../../../../docs/stream-workspace.md)。

## 主 Agent 评审修复

| 发现 | 修复与验证 |
| --- | --- |
| 初版左栏使用不存在的 wrapper 样式，不能保证原视觉结构 | 改用原 `session-list-item`、状态点、标题结构、设备分组和 selected 状态；主 Agent 查看实际桌面和 320px 截图 |
| 清单状态只在手工刷新时更新 | 加入可取消、非重叠的五秒刷新，保持用户已加载分页前缀、选择、订阅和恢复位置；失败保留已载元数据并报错 |
| Previous 假设每页总是 128 条，长 payload 的字节分页可能跳过中间历史 | 加入受字节限制的反向 SQLite 读取和精确边界；不连续页明确重置窗口而非伪装连续；验证 64 KiB 单事件页 |
| 焦点事件在缓存淘汰后可从 DOM 消失 | 明确恢复到表格焦点并通知，不无界固定所有历史；验证缓存淘汰与焦点行为 |

主 Agent 直接审阅前后端授权路径、虚拟窗口/缓存、分页与订阅、恢复/错误、生产者与实际 smoke；没有把静态 Before/After 图当性能证据。

## 独立验证

主 Agent 在修复完成后独立执行：

| 命令 | 结果 |
| --- | --- |
| `pnpm check` | lint、全仓类型、构建与测试退出 0；release 8、protocol 7、sync-protocol 12、Connector 57、Worker 51、Web 76 测试通过；Connector 1 个既有 skip |
| `pnpm --filter @silvermoon-ai/web test:browser -- --workers=4` | 241 通过、2 个既有 skip；包括 retained legacy、Settings、桌面/移动/320px 和新增 Streams 场景 |
| `pnpm test:streams:smoke` | 实际 Node 生产者、workerd/DO SQLite、完整 D1 migrations、Cookie 登录浏览器通过；无 mocked API，无生产秘密 |
| `pnpm --filter @silvermoon-ai/web build` | smoke 的本地地址构建后重新恢复默认生产地址构建，通过 |
| `git diff --check` | 通过 |

真实 smoke 覆盖历史读取、原始内容、持续追加、暂停、离线重载、会话撤销及 DOM/缓存计数。Worker 使用实际 SQLite 的 100,000 条历史验证分页及大于 2^53 的序号；浏览器通过分页的 100,000 条数据集验证实际 DOM、缓存上限、淘汰/回读、定位、滚动锚点和键盘，另验证长 UTF-8 payload 及单事件页。

已有 Session 浏览器测试移至明确兼容路径，未为新工作区删除或跳过覆盖；同时修正其移动端导航 readiness helper 的既有竞态。接受构想的文档提交 `c9123bb` 曾在 CI 上因该旧 helper 超时，修复后完整集合通过。

仍有非阻塞的 React fast-refresh/部分 effect lint 警告及现有 bundle-size 警告；未通过关闭规则隐藏错误。Cloudflare 在线文档获取受限，使用已安装类型、schema、dry-run 和真实 workerd 验证，不声称验证未知生产额度。

## 上线前边界

本文件仅为实现门限证据。必须先同步本实现、提交准确 Inner World revision，并记录主 Agent 的委托技术批准，然后才允许 subagent 将精确已审版本交付 release。

生产基线为 `1095c3430801ab95e9afac3d8977758b5c9dab29`，当时为 main 的祖先；新增上线差异包括已审通用同步 DO 和既有 `0014_connector_archive_commands.sql` 数据保留迁移。上线前重新 fetch，保留任何并发 release 历史，不强推。生产检查不得绕过 OAuth 或向生产数据库注入测试身份；合法登录后的最终体验由用户验收。
