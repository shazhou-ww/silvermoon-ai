# 认证竞态修正后当前候选的本地验证

本报告对**当前发布候选**取代 [Local-Verification.md](Local-Verification.md) 和 [Final-Local-Verification.md](Final-Local-Verification.md) 的本地验证适用性；旧报告原样保留为历史。以下检查在认证竞态修正的新 Inner 已接受并同步后重新执行，不沿用此前候选的测试或批准，不代表完整 D 项完成或生产部署验收。

## 执行前现场基线

- 分支 `main`，`HEAD`/`origin/main`：`118c0caf02fa24cf5133f495c0597ae51c31bb8e`；worktree/index clean。
- 实际 Outer tree：`cfc915f2c88f6eac7c3d946e52b95ba3cc8e30eb`；实际 Inner tree：`ce6922503aa3528ec9a31fbe23a0f84d5c038f51`，均由本轮 `git rev-parse` 取得。
- 本轮 `silvermoon whats-next device-workspace --audience agent` 观测 `deploying`、`acceptInner#9`、Inner accepted、Outer unsubmitted；事件 digest `9a725e39145131b78cdc32d2b2475150cab65f22`。
- 认证修正提交 `a2b49bac2199843435bc6f094e2fca25dac8b373` 已验证为当前候选祖先。[Deployment.md](Deployment.md) 行为契约未改，实际 blob 仍为 `5beb07f3287390bbb81a764c6f9f6964f65192fc`。
- 本轮时间：**2026-10-21 03:28:07–03:30:19 +08:00**。命令执行前再次校验 primary、Outer、Inner 精确值，未猜测修订或修改生命周期状态。

## 命令与结果

均在 `D:\Code\silvermoon-ai` 执行，未安装依赖或改源码；浏览器采用单 worker，不扩大超时、不增加 retries 或跳过断言。

| 命令 | 本次结果 |
| --- | --- |
| `$env:VITE_RELAY_ORIGIN='https://relay.silvermoon.work'; pnpm --filter @silvermoon-ai/web build` | 退出 0；正常生产 URL 的本地构建，不访问生产 API |
| `pnpm test:devices:smoke` | 退出 0，10.24 秒；真实本地 UI＋workerd/D1/AccountMessages＋Device lib 闭环通过 |
| `$env:PLAYWRIGHT_BUILT_APP='1'; pnpm --filter @silvermoon-ai/web test:browser -- devices.browser.ts settings.browser.ts --workers=1` | 退出 0，**119 通过、1 原有 skip，1.7 分钟**；全部 60 条 Devices（含认证交付顺序）及全部 Settings，三个项目完整执行 |
| `pnpm test:streams:smoke` | 退出 0，13.24 秒；真实 v1 producer→workerd/SQLite DO→cookie 浏览器兼容及清理通过 |

构建页面默认 CSS viewport 为 **1440×900、390×664、320×640**。本次重新覆盖原 CI desktop 账户切换用例、旧 scoped 400/401 不取消新账户确认、旧 `/api/me` 成功/401 乱序、同账户换 session、A 的失效确认不得复活私有 pending、已完成确认后的新发现、真实当前撤销后所有订阅停止；并保留原 key 重载/重试、多标签页锁、范围/账户隔离、空态/错误、JSON/opt-in、raw/键盘、直达/Back/Forward 等断言。现代 Settings 实际返回根 Devices，旧 Settings 仍保留 Sessions/legacy 行为和完整管理用例。

页面组使用本地 HTTP 夹具，不能冒充真实后端。独立 Devices smoke 则无 mock HTTP 响应：随机本地账户/设备/会话、真实 migration、两个 Client×两个 Device 加另一账户；四条唯一下行定向到实际 lib 各两条，读取/格式化/re-receive 不 ACK；真实 Worker 接受后仅丢浏览器交付，reload 人工原键重试返回原 ID，无重复消息。真实上行同时进入账户/Device UI，筛选不停止另一设备的账户接收，跨账户拒绝、会话撤销、移动详情/键盘、Settings/legacy 与独立旧 seq=18 深链接均通过。v1 smoke另验证 raw/follow/暂停/离线 reload/撤销和既有资源上界。

## 构建、留证与清理

- 生产 `apps\web\dist` **11 个文件**在正常构建后及全部本地检查后逐文件 SHA-256 完全一致；排序路径/文件哈希清单摘要均为 `F0F59AB42ED0D0CFAFDF70CB17FE3AD36DBEFD952E4BCF6385FFF0E192B1C922`。两个 smoke 的 localhost 构建仅在其随机隔离目录，未覆盖正常 dist。
- 本轮 **23 张截图**在忽略目录 `.wrangler\device-workspace-auth-outer-evidence-118c0caf02fa\`：15 张三宽度 Devices 夹具图、6 张新旧 Settings 图、真实闭环 `local-smoke-desktop.png` / `local-smoke-mobile.png`；已查看本轮真实桌面/手机渲染，均只有本地虚构 payload，无私有凭证。
- 日志前缀 `.wrangler\device-workspace-auth-outer-{build,smoke,browser,stream-smoke}.log`。Device lib、producer、浏览器、Miniflare 与静态服务器已停止；两个 smoke 随机状态目录残留均 **0**，端口 4173 listener **0**。
- 完成本地检查时 HEAD 未变、tracked/index clean。仅新增本报告；源码、Inner、Ideal、Deployment、events、ledger、所有前序 Outer 证据及分支/index 均未改，无 commit/push/门禁操作。

## 限制与交接

唯一 skip 为原有 desktop 不适用的窄屏 Session 导航用例，无新增跳过。本轮单 worker 未观察到 `ERR_NO_BUFFER_SPACE`，但不能据此消除主 Agent 已观察到的 Windows 资源噪声或既有并行 fixture 风险；未重跑全仓/全量浏览器，也不复用 Inner 阶段的重复/完整套件计数充当本轮结果。

提示仍为 Vite >500KiB chunk、Node SQLite experimental 和 Wrangler 4.147.0 更新提醒，无依赖升级。Web Locks＋localStorage/安全上下文前提、无 Device 执行/presence 投影、无容量/灾备证明等边界不变。

本轮未调用生产 API、部署/上传/发布、远程 D1 或生产设备；未读取用户私有 token/cookie/凭证文件或共享标签。真实闭环凭证仅现场随机生成，不进入页面或输出。**Linux 必需 CI 尚待主 Agent 对新候选触发并通过**，本报告没有重跑失败生产 job 或宣称 CI 已成功；全部 D 复选框保持未勾选，真实 release/版本/登录页面与原生产历史边界核验仍由主 Agent 完成。
