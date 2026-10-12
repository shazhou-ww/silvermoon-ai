# AHP-only Connector 实施证据

## 实施结果

- `0.3.0-canary.1` 发布后生产 create smoke 暴露 deferred backing 顺序缺陷：Host 只有收到 first send 才转为 ready，Connector 却先等待 ready，导致 15 秒超时。修复将顺序改为 create → subscribe → title → first send → wait ready → refresh，并以 lifecycle 初始为 Creating 的 wire fixture 防回归。
- `0.3.0-canary.2` 让 Host 成功 materialize 并执行首条消息，但 create command 仍失败：Connector 在收到 authoritative `root/sessionAdded` 后立即调用 `listSessions`，被 Host reconciliation 的短暂旧快照覆盖并误报 missing。
- `0.3.0-canary.3` 删除 create 后的即时 catalog refresh，改为等待 root notification 已加入同一 URI；wire fixture 在 `SessionReady` 前发送 `root/sessionAdded`，覆盖生产事件顺序。
- `0.3.0-canary.3` 的 create command 已成功，但 generic `ahp-session:/…` 被 VS Code Agent Host 的 external catalog 策略从后续 `listSessions` 隐藏，周期 inventory 将其标为 `gone`。`0.3.0-canary.4` 改用该 Host provider 的原生 AHP resource namespace `copilotcli:/<uuid>`；创建和全部操作仍只通过 AHP。
- `VsCodeAgentHostProvider` 现在直接实现完整 `AgentAdapter`，声明 list/create/send/stream/archive 能力。
- 创建流程在唯一兼容 Agent Host 上发送 AHP `createSession`，使用新的 `copilotcli:/<uuid>` URI，按需派发 `session/titleChanged`，向默认 chat 派发首条消息，等待 ready 与 authoritative root catalog entry。
- inventory、send、history、实时事件、input request 与原生 archive 均沿已有 AHP connection 和 Session/chat resource 执行。
- 没有兼容 Host 时 inventory/create 显式失败；多个 Host 且没有目标选择时 create 显式失败，不任意选取进程。
- 删除 `CopilotAgentAdapter`、SDK 专用 provider contract 与测试；CLI 直接构造 AHP provider。
- 移除 `@github/copilot-sdk` manifest 与 lockfile 依赖，删除 `--copilot-home`、`--model`、`--approve-all` 及对应环境/profile 配置。
- npm 公开导出只保留 `VsCodeAgentHostProvider`、`SilvermoonConnector` 与通用 `AgentAdapter`。

## 身份与兼容边界

- 新 Session ID 只来自 AHP Session resource；SDK metadata 不再进入同步数组。
- Host 不可用或 Session 不存在时不恢复另一个 SDK ID。
- 当前多 Host inventory 继续使用既有 AHP resource 选择规则；create 在多 Host 歧义时阻塞，等待未来明确 Host selector。
- 未新增 D1 migration，未修改 Worker Session schema，未配对、重写或删除任何旧 Relay 行或事件。
- 旧 profile 若包含已删除的 SDK 专用 options，会被 strict schema 明确拒绝，避免静默忽略过期安全设置。

## 自动化证明

### Connector

- `pnpm --filter @silvermoon-ai/connector test`
  - 6 个 test files 通过。
  - 41 个测试通过，1 个平台条件测试跳过。
  - 新增真实本地 WebSocket/JSON-RPC fixture，验证 create → title → prompt 全部通过 AHP。
  - 验证零 Host 显式失败、多 Host create 歧义显式失败且不发送 create 请求。
- `pnpm --filter @silvermoon-ai/connector typecheck`：通过。
- `pnpm --filter @silvermoon-ai/connector build`：通过。
- `pnpm lint`：通过；仅保留两个既有 React fast-refresh warning。

### 仓库与发布候选

- `pnpm test`：通过。
  - release contract 8/8。
  - protocol 7/7。
  - web 72/72。
  - connector 41 通过、1 跳过。
  - worker 33/33。
- `pnpm build`：通过，包括 Web production build、Worker dry-run 与 Connector ESM/DTS build。
- `node --test scripts/npm-release.test.mjs`：8/8 通过。
- 本机等价 npm pack → clean consumer install → `scripts/smoke-npm-package.mjs`：通过。
- tarball 文件列表不含 `copilot-sdk` 或 `copilot-adapter`。

## 已知基线边界

完整 `pnpm check` 在本次未修改的 Worker 类型生成检查处停止：

```text
Types at worker-configuration.d.ts are out of date. Run `wrangler types` to regenerate.
```

未修改该无关生成文件。`pnpm lint`、Connector typecheck、全仓库 test 和全仓库 build 分别执行并得到上述结果，因此本次 AHP-only 变更的代码、类型、测试和构建均有覆盖。
