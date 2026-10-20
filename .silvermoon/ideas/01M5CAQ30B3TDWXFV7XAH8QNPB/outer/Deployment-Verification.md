# 事件流工作区生产交付与技术验收

## 交付对象与批准边界

用户已接受当前构想，并明确委托主 Agent 技术门限审批、subagent 实施和生产部署。主 Agent 在完成独立实现 review、全仓检查、真实浏览器/DO 链路与 UI 检查后批准精确版本交付。

- 实现提交：`21b6c113550ca300fd38c4180dd58fbc3d1e78f1`。
- 实施接受及上线提交：`53bbb0e550aae53a2c7d58d0d8fd2f4735f07e71`。
- 上线时已同步 Outer World：`23f2a837441eb2fac743e43abf08b9f955cda968`。
- 原 release tip：`1095c3430801ab95e9afac3d8977758b5c9dab29`；subagent 重新 fetch 后确认是已审提交祖先，以普通非强推推进 release。
- 生产入口：[silvermoon.work](https://silvermoon.work)；管理入口：[Settings](https://silvermoon.work/settings)；旧会话兼容：[Legacy](https://silvermoon.work/legacy)。

本技术验收确认已审版本完成部署、必要自动验证和线上可达性；不代表主 Agent 代替用户确认最终使用体验。用户后续登录与数据体验验收仍独立保留。

## 实际部署结果

[Check and deploy 工作流 39413641909](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/39413641909) 的 `headSha` 精确为上述上线提交，check 与 deploy 均 success。

- Worker 版本：`53077658-63a0-4f29-b508-3b606463385f`。
- Pages 部署：[0ba25ba6.silvermoon-work.pages.dev](https://0ba25ba6.silvermoon-work.pages.dev)。
- D1 迁移步骤成功，实际没有待应用迁移；未重复修改已经迁移的数据。
- 新通用同步 DO 的 v2 配置随 Worker 部署；旧 Session 兼容绑定保留。
- release 工作流执行全仓检查、241 个浏览器用例通过、2 个既有 skip，并完成 Worker 和 Pages 发布。
- 未发布 npm、未修改 secrets、未向生产数据库种入测试账户或凭证、未删除未知历史。

## 主 Agent 独立核验

主 Agent 重新获取工作流和 release，确认状态成功且 release 为 `53bbb0e550aae53a2c7d58d0d8fd2f4735f07e71`。公开网络检查：

| 请求或对象 | 结果 |
| --- | --- |
| `https://silvermoon.work/` | HTTP 200，加载已审 Streams 版本 |
| `/assets/index-B-s2mbYT.js` | HTTP 200；SHA-256 `fdc702ea5365df948d002d26e1dbbde703a85baa44936aa1cdc1c17b215775da` |
| `/assets/index-DuSOctLK.css` | HTTP 200；SHA-256 `f5920883624f4e4f16ec7030f4bb66daf5b6fc54b6ba41423fa0341cbdfbb94f` |
| Relay `/health` | HTTP 200，`silvermoon-relay` / `ok` |
| 允许 Origin、无登录态的 `/api/stream-connectors` | HTTP 401，`authentication-required` |
| 错误 Origin 的同接口 | HTTP 403，`origin-forbidden` |
| 无 Upgrade 的 `/v1/sync` | HTTP 426，`websocket-upgrade-required` |

生产资产 hash 与 subagent 独立获取的已审构建一致。部署后主 Agent 在浏览器已有的合法登录态中仅进行只读检查：Streams 标题、304px 左栏、无错误提示、已有设备的“尚无生产者”空状态，以及 Settings 区和 Add device 入口均可见；随后返回主工作区。没有创建、轮换或复制该账户 token，没有注入身份、读取私有 payload 或制造生产事件。

当前该账户未发布通用流，因此生产空状态是预期结果，不是把旧 Session 隐藏成错误。完整有数据读取、实时追加与授权撤销的端到端证据来自隔离本地真实 Node/workerd/登录浏览器验证，不冒称已经验证生产有数据行为。

## 性能、恢复与兼容证据

见[实施 review](inner/Implementation-Verification.md)：实际 SQLite 的 100,000 条历史、分页浏览器数据集、超过 2^53 的序号、64 KiB payload、反向单事件页、缓存淘汰/回读、滚动锚点、焦点恢复、会话失效和设备移除均有测试。

DOM 事件行不超过 200，缓存不超过 2,000 条且原始 UTF-8 payload 不超过 8 MiB；这些分别是 DOM 与缓存约束，不是总 JS heap 承诺。默认视图是真实虚拟表格，不是 CSS 隐藏全量节点。

真实本地 smoke 使用随机隔离身份、全部 D1 migrations 和实际 WebSocket，不 mock API；结束时关闭运行时、客户端和浏览器并清理自有状态。线上仅执行授权只读检查，原有 Connector 进程不被终止。

## 用户线上验收步骤

1. 打开 [主工作区](https://silvermoon.work)，保留原登录方式；若浏览器缓存旧资产，刷新页面。
2. 在 Settings 使用现有设备 profile，或由用户自己添加一台专用测试设备。网页不需要粘贴设备 token。
3. 使用 Node 22.13+（建议 24）和 checkout，先运行 `pnpm --filter @silvermoon-ai/connector build`。
4. 按[生产者安全启动说明](../../../../docs/stream-workspace.md)通过隐藏输入设置 `SILVERMOON_CONNECTION_TOKEN`；首次运行 `node scripts\stream-producer.mjs --init`，以后去掉 `--init`。保留本地 SQLite/WAL，同一设备不要同时运行两个 writer。
5. 左栏选择 `checkout-observations`，检查右侧默认事件表格、完整原始内容/复制、定位、Latest history、Follow/Pause；停止生产者后确认状态刷新而历史仍可读。
6. 使用同一本地源再次运行生产者，会追加新事件并延续序号。此前旧 Session 可从 `/legacy` 查看，不会自动转换为流。

不要删除旧源后在同一设备身份下反复初始化来“清空”中心历史；本地历史丢失会显式报错。凭证仅留在生产者端，验证结束后清除临时环境变量。

## 回滚与后续

如需回滚 UI，可通过普通 release 提交恢复前端入口或切换已知 Pages 版本；保留新增 DO 历史和 D1 当前 schema。旧 Session `/legacy` 是明确兼容入口，不通过回写或删除不可变事件来回退。

技术交付通过后仍由用户在线确认体验；后续反馈作为新的修订处理，不将沉默视为用户验收。最终门限事件引用同步后的准确 Outer World，而不是部署代码的 Git SHA。
