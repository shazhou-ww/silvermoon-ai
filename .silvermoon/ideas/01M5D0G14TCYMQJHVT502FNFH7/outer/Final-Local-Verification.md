# 修正候选的最终本地验证

本报告取代 [Local-Verification.md](Local-Verification.md) 对**当前发布候选**的本地验证适用性；旧文件原样保留为前一候选的历史记录。以下结果全部在 Settings 修正对应的新 Inner 已接受、当前候选已同步之后重新取得，不复用旧候选的批准或测试结果，也不构成完整 D 项完成/部署验收。

## 执行前准确基线

- `main`、`HEAD`、`origin/main`：`46481a333ecd1566866b372bf6abea7c54dbbd3b`；执行前 worktree/index clean。
- 实际 `git rev-parse 'HEAD:.silvermoon/ideas/01M5D0G14TCYMQJHVT502FNFH7/outer'`：`7d949feeac7f0f8ac7298688865651f7b0853c53`，以现场 Git 结果为准。
- 实际 Inner tree：`97dc6ea65e21b17c2d83c399e813e8a5228789b7`；本轮 CLI 观测 `acceptInner#7`、Inner accepted、`deploying`、Outer unsubmitted。
- 实现基础提交 `5012c1e9acf930afa3dd229f87dd8572b83c28ec`，Settings 修正提交 `5e3f8cfb2c08b869b3b0d629fde4dbac1c9bfc29`；两个提交均已用 `git merge-base --is-ancestor` 验证为当前候选祖先。
- [Deployment.md](Deployment.md) 的实际 blob：`5beb07f3287390bbb81a764c6f9f6964f65192fc`；行为契约未改。观测事件 digest：`aab32368142ec4a6dedbd3f6879ddba2f5431b3a`。
- 本次执行时间：**2026-10-21 02:13:46–02:15:02 +08:00**；执行前再次校验 primary、Outer、Inner 精确值后才运行检查。

## 本次命令与结果

工作目录 `D:\Code\silvermoon-ai`；没有安装依赖或修改应用代码。

| 命令 | 现场结果 |
| --- | --- |
| `$env:VITE_RELAY_ORIGIN='https://relay.silvermoon.work'; pnpm --filter @silvermoon-ai/web build` | 退出 0；正常生产 URL 的构建，只生成本地文件，不调用生产 API |
| `pnpm test:devices:smoke` | 退出 0，10.55 秒；真实本地 UI＋workerd/D1/AccountMessages＋Device lib 闭环及清理通过 |
| `$env:PLAYWRIGHT_BUILT_APP='1'; pnpm --filter @silvermoon-ai/web test:browser -- devices.browser.ts settings.browser.ts --workers=2` | 退出 0，**92 通过、1 原有 skip，48.5 秒，无自动 retries**；全部 Devices 与 Settings 用例，三项目实际构建页面 |
| `pnpm test:streams:smoke` | 退出 0，12.59 秒；真实 v1 producer→workerd/SQLite DO→cookie 浏览器兼容与清理通过 |

页面项目的默认 CSS viewport 为 **1440×900、390×664、320×640**。覆盖账户全部上行/Device 双向/空态、方向和原始详情、有界缓存/请求、显式 opt-in、错误保留、独立游标、多标签页锁竞争与排队防重、丢响应/reload 原 key/target/payload 重试、直达链接/Back/Forward/键盘。现代 Settings 的 Devices / Account messages / Back to Devices 在桌面和手机实际返回根 Devices；旧 Settings 仍以 Sessions 导航、选择/返回 `/legacy`，管理功能原断言保留。

上述页面测试使用本地 HTTP 夹具，**不把它冒充真实后端证据**。独立 Devices smoke 无 mock HTTP 响应：随机本地身份、真实 migration、两个 Client×两个 Device 加另一账户，实际 lib 接收四条唯一下行、读取/格式化不 ACK，真实已接受响应仅丢浏览器交付后原键重试不产生重复；lib 上行出现在账户/Device UI，筛选不停止另一 Device 的账户接收，跨账户拒绝与真实会话撤销通过。真实 UI 同时验证桌面/手机详情和 Settings/legacy；真实 v1 seq=18 深链接仍读独立旧记录。独立 v1 smoke另覆盖 raw/follow/暂停/离线 reload/撤销和既有资源上界。

## 构建、留证与清理

- 正常构建后与全部本地检查结束后，生产 `apps\web\dist` 的 **11 个文件**逐文件 SHA-256 完全一致；排序路径/文件哈希清单摘要均为 `FC9E9AFABC246F6FA52CEE38843A63CF74758E5CC759D0F4270095B3697FA8F8`。两个 smoke 的本地 Relay 构建仅在各自随机隔离目录，未留下指向 localhost 的生产 dist。
- 本轮 **23 张截图**保存在忽略目录 `.wrangler\device-workspace-final-outer-evidence-46481a333ecd\`：15 张三宽度 Devices 夹具图、6 张新旧 Settings 导航图、真实闭环 `local-smoke-desktop.png` / `local-smoke-mobile.png`。已查看本轮现代桌面 Settings、真实手机闭环及 320px 空态图；只有虚构本地 payload，无私有凭证。
- 本轮日志：`.wrangler\device-workspace-final-outer-{build,smoke,browser,stream-smoke}.log`。浏览器、Device lib、producer、Miniflare、静态服务器均已停止；Device/v1 smoke 随机状态目录残留均 **0**，端口 4173 listener **0**。
- 结束时 HEAD 未变，tracked/index clean；只新增本报告。源码、Inner、Ideal、Deployment、events、ledger、历史 Local-Verification.md、分支/index 未改，无 commit/push/门禁操作。

## 限制与交接

本轮仅本地检查，无生产 API/消息写入、部署、上传、远程 D1 写入、生产设备操作或共享标签访问；未读取用户提供的 token/私有 cookie/凭证文件。真实闭环所用凭证均在本地现场生成，不进入页面或输出。

92 条中唯一 skip 是原有 desktop 不适用的窄屏 Session 导航用例，无新增 skip。本轮未重跑全仓或全量浏览器；Inner 已记录的并行旧 fixture 偶发初始化超时风险仍由完整 release CI 继续观察。既有提示为 Vite >500KiB chunk、Node SQLite experimental、Wrangler 4.147.0 更新提示，没有依赖升级或额外授权。

Web Locks＋localStorage/安全上下文前提不变；Relay accepted 不是 Device 收据/执行成功，v2 presence 仍 Unknown，无容量/灾备证明。全部 D 复选框保持未勾选；主 Agent 仍须完成 release CI、生产版本与真实认证页面/原生产历史边界核验及精确 Outer 门禁。
