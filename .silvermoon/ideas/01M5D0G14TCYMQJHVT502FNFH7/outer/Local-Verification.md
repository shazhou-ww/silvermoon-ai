# 同步契约后的本地验证

本轮仅执行 [Deployment.md](Deployment.md) 的本地部分，不代替生产启用、上线核验或部署验收；全部 D 复选框保持未勾选。

## 执行前基线

- 契约已同步提交、执行前 `HEAD`/`origin/main`：`5253d483c6c9f12ff7c6804dfed3275e8f64f47d`，分支 `main`，worktree/index clean。
- 执行前准确 Outer tree：`89150c36cd7d1d04b418bcfeb1124555b2977670`；CLI 观测为 `deploying`、Outer unsubmitted。
- 已接受实现提交：`5012c1e9acf930afa3dd229f87dd8572b83c28ec`；准确 Inner tree：`bd92c771f110089179213b99ecff732edf0796a5`，CLI 观测 Inner accepted。
- 观测事件 digest：`d83db69ff594152515b81b0cbf2ecfd5490adaae`。未追加事件或操作门禁。
- 执行时间：2026-10-21 **01:57:48–01:58:31 +08:00**；以下结果均在上述契约同步后重新取得，不沿用 Inner 阶段结果。

## 命令与结果

在 `D:\Code\silvermoon-ai` 执行，未安装依赖、未修改应用源码或契约：

| 命令 | 本次结果 |
| --- | --- |
| `$env:VITE_RELAY_ORIGIN='https://relay.silvermoon.work'; pnpm --filter @silvermoon-ai/web build` | 退出 0，生成正常生产 URL 的页面构建，作为后续字节哈希基线；仅构建，不访问生产 API |
| `pnpm test:devices:smoke` | 退出 0，10.64 秒；真实本地 UI＋workerd/D1/AccountMessages＋Device lib 闭环通过 |
| `$env:PLAYWRIGHT_BUILT_APP='1'; pnpm --filter @silvermoon-ai/web test:browser -- devices.browser.ts --workers=3` | 退出 0，**33/33 通过，15.3 秒，0 skip/0 retry**；使用 Vite preview，三个项目全部运行 |
| `pnpm test:streams:smoke` | 退出 0，13.07 秒；真实 v1 producer→workerd/SQLite DO→cookie 浏览器兼容 smoke 通过 |

构建页面项目 CSS viewport 为 **1440×900、390×664、320×640**，覆盖账户/Device 双向/空态、显式 opt-in、有界 JSON、错误保留、范围/账户隔离、多标签页 Web Lock 竞争、排队连点防重、丢响应/reload 原 key/target/payload 重试、窄屏直达链接与 Back/Forward、键盘/raw 详情。该组页面测试的 HTTP 为本地拦截夹具，不冒充真实后端证据。

真实 Devices smoke 则**不 mock HTTP 响应**：随机本地身份与真实 migration，两个 Client×两个 Device，加另一账户隔离；四条唯一定向下行被实际 lib 各接收两条，读取/格式化不 ACK。一次 POST 真正被 Worker 接受后仅丢弃浏览器交付，reload 后人工原键重试返回同一 ID，无重复消息。真实 lib 上行到两个 Client 的账户/Device UI，筛选期间另一 Device 的账户接收继续；会话撤销、跨账户拒绝、移动详情/键盘、Settings 与 `/legacy` 均通过。旧根 device/stream/seq=18 链接读取独立 v1 原记录，不替换为 v2。

独立 v1 smoke 重新覆盖历史/raw、持续追加、暂停、离线 reload、会话撤销及既有 DOM/cache 上界。两个 smoke 的应用构建都在各自随机隔离目录，不覆盖生产 dist。

## 构建、截图与清理

- 生产 `apps\web\dist` **11 个文件**在正常构建后及全部本地检查后逐文件比较 SHA-256，完全一致；按排序的路径/文件哈希清单计算的摘要均为 `78F09D2322CD1C3EE42F63ED4F9DC7BF58F34FAD31FADA16B289058B05CFCFCA`。没有留下指向本地 Relay 的生产 dist。
- 本轮 **17 张**截图在忽略目录 `.wrangler\device-workspace-outer-evidence-5253d483c6c9\`：真实闭环的 `local-smoke-desktop.png`、`local-smoke-mobile.png`，以及三项目账户/Device/空态与未知/已接受发送的 15 张页面夹具截图；已查看本轮真实桌面/手机及 320px 空态图。仅含本地虚构 payload，没有私有凭证。
- 日志为 `.wrangler\device-workspace-outer-{build,smoke,browser,stream-smoke}.log`，均未提交。真实 Device lib、浏览器、producer、Miniflare 与静态服务器已关闭；两个 smoke 随机状态目录残留均为 **0**，测试端口 4173 listener 为 **0**。
- 执行结束时 HEAD 未变、tracked/index clean；仅新增本证据文件。源码、Inner、Ideal、Deployment、events、ledger、分支与 index 未修改；没有 commit/push/门禁操作。

## 限制与交接

无生产写入、部署、上传、远程 D1 写入或生产设备操作；未读取提供过的 token 文件、用户私有 cookie/凭证文件或共享浏览器。凭证只为随机本地夹具现场生成，没有输出或进入页面。

本次 33 条无跳过；未重跑全仓/全量浏览器，不能据此消除 Inner 已记录的并行旧 fixture 偶发初始化超时风险。现有提示为 Vite >500KiB chunk、Node SQLite experimental、Wrangler 4.147.0 的版本更新提示，均未作为失败或新授权处理。

Web Locks＋localStorage 及安全上下文前提不变；Relay 接受不代表 Device 收据/执行，状态仍为 Unknown，没有 presence/执行投影或容量/灾备证明。生产 preflight、release CI、实际版本、真实登录页面及原生产 18 条历史边界均待主 Agent 独立核验；本文件不能完成任何完整 D 项或作为部署接受事实。
