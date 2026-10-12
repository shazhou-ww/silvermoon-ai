# AHP-only Connector 部署证据

## Registry 与发布基线

- 发布前：`latest=0.2.1`，`canary=0.2.1-canary.1`。
- `0.3.0-canary.1` source/tag：`20fd476fc2d77f0b9a84d1b6275b73b22501ebf3` / `npm/connector/v0.3.0-canary.1`。
- GitHub Actions run：[38254352473](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38254352473)，所有步骤通过，包括 OIDC publish 与 registry byte verification。
- Registry 发布后：`canary=0.3.0-canary.1`，`latest=0.2.1` 未变；官方 registry clean install 与 public smoke 通过。

## canary.1 生产 smoke 失败

Home PC `device-0q6jdqArkbQMgAHR` 升级到 `.1` 后：

- Connector 注册为 `GitHub Copilot via Agent Host`，sync state `ready`。
- 当前 inventory 63 行全部 `execution_state_known=1`，current unknown 为 0；85 个旧行保留为未确认历史，没有清理。
- AHP create command `c018963a-95bc-45fa-9113-3c9579e0fea4` 被 Relay 发送并接受，但最终明确失败：

```text
Timed out waiting for Agent Host session creation:
ahp-session:/8e530782-1b75-4963-b06c-dd8545df7afd
```

VS Code Agent Host 同时记录：

```text
Chat created; its backing stays deferred until the first send
```

根因是 Connector 在 first send 之前等待 `SessionReady`，而 Host 在 first send 之前有意保持 deferred，形成顺序死锁。失败 command 没有不确定结果，也没有 Relay Session/event 数据写入。

## canary.2 前置修复

- 修复顺序：create → subscribe → optional title → first send → wait ready → refresh inventory。
- wire fixture 的 Session snapshot 初始为 `Creating`，只在 `ChatTurnStarted` 后发 `SessionReady`。
- `pnpm --filter @silvermoon-ai/connector test -- agent-host-adapter.test.ts`：3/3 通过。
- `pnpm --filter @silvermoon-ai/connector typecheck`：通过。
- 已明确授权 `0.3.0-canary.2`；`.1` 保持不可变，不重发、不删除。

## canary.2 发布与生产结果

- tag/source：`npm/connector/v0.3.0-canary.2` / `8970cf637da8ad0e42289196781ea06c755786c2`。
- Actions run：[38256177553](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38256177553)。
- npm 接受 publish 并返回 `+ @silvermoon-ai/connector@0.3.0-canary.2` 与 provenance；registry processing 超过 workflow 的 12×15 秒验证窗口，run 因暂不可见失败。稍后公开版本可见，shasum `e87f44b2e21861b5bddf6c60a3185e3055366279`，`latest` 仍为 `0.2.1`。
- public clean install 与 smoke 通过。
- Home PC create smoke 让 Host 成功 materialize `ahp-session:/0b4ca31e-0a77-4184-a96b-a6ba7a430f9b`、执行首条消息并生成固定回复，但 Connector 在 `root/sessionAdded` 后用 reconciliation 期间的旧 `listSessions` 覆盖 catalog，command 误报 missing 并发布瞬时 `gone`。

## canary.3 修复候选

- create 不再在 ready 后主动 refresh catalog；等待 root catalog 已包含创建 URI，再由 provider rebuild inventory。
- wire fixture 按生产顺序发送 `root/sessionAdded` → `session/ready`，防止旧快照覆盖 authoritative notification。
- 精确候选：`@silvermoon-ai/connector@0.3.0-canary.3`；`.1` 与 `.2` 均保持不可变。

## canary.3 结果与 canary.4 候选

- `.3` Actions run：[38258367993](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38258367993)，成功；registry/public smoke 通过，`latest=0.2.1`。
- Home PC create command `6732fe00-7217-4c1b-8bf3-b18cb9ce95e3` 在约 2 秒内成功，证明 deferred lifecycle 与 authoritative notification 竞态已修复。
- generic `ahp-session:/0039aaa4-3309-4535-99b2-8bda02328327` 随后被 Agent Host 的 external catalog 策略从周期 `listSessions` 隐藏，Relay 因而收到 `gone`。这是资源 namespace 兼容性问题，不是 SDK fallback。
- `.4` 仍通过 AHP `createSession`，但选择 Host provider 已用于持久 Session 的 `copilotcli:/<uuid>` resource namespace；wire test 锁定该 URI。

## canary.4 结果与 Worker migration

- `.4` Actions run：[38267496687](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38267496687)，成功；registry/public smoke 通过，`latest=0.2.1`。
- create command `87d9c9ba-3ea3-441d-8204-246109fcad15` 成功；Session `ed69299f-05b6-4b3f-a317-a0402fcea538` 在周期 inventory 后保持 `idle`、`execution_state_known=1`。
- 首条回复 `AHP_ONLY_CREATE_OK` 与 follow-up `AHP_ONLY_FOLLOWUP_OK` 均写入 Relay history；follow-up command `9fe34640-d76c-4d53-8e84-50bbbf858179` 成功。
- Done 请求触发 Worker exception。production tail 证明 D1 CHECK 仍只允许 list/create/message/history，`session.archive` INSERT 失败。
- 新增 migration 0014 重建 `connector_commands`，加入 `session.archive`，保留 connection/result columns、索引和 `devices_remove_access` trigger。Worker tests 实际应用 migration 后 33/33 通过。
- `pnpm check` 全量通过；隔离本地 D1 的 0001→0014 migration chain 全部成功。

## Device 边界

- 本机可控 Connector 是 Home PC `device-0q6jdqArkbQMgAHR`。
- 原始案例的 Office PC `copilot-sdk-test` 是另一在线 Connector，不是本机 supervisor；不得将 Home PC 升级结果冒充为 Office PC 结果。

## 最终 canary 与发布

- `0.3.0-canary.3` Actions run：[38258367993](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38258367993)，成功。
- `.3` create 成功但 generic `ahp-session:/…` 被 Host external catalog 策略隐藏，故改用原生 `copilotcli:/…`。
- `0.3.0-canary.4` Actions run：[38267496687](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38267496687)，source `aa9e35699a63e72d01f5debd3a9671a48e629118`，成功。
- Registry：`canary=0.3.0-canary.4`，shasum `7fde73cf026160fce28797f29746fd919d78a4a9`；`latest=0.2.1` 未变。
- 官方 registry clean install 和 clean-consumer smoke 通过。

## Worker migration 与部署

- production migration 前 `connector_commands=203`，`devices_remove_access` trigger=1。
- 0014 remote migration 成功，203 条 command 全保留，trigger 仍为 1，table CHECK 明确包含 `session.archive`。
- Worker 从 accepted primary `579a48b9840a5226e5358bb7880554d59ef24191` 部署，version `a4b34b81-8745-48b0-92ab-3c5bb114296b`。
- production tail 的原异常为旧 CHECK 拒绝 `session.archive`；migration 后相同 UI 路径正常返回命令，不再产生无 CORS exception response。

## Home PC 端到端证明

Connector：`device-0q6jdqArkbQMgAHR`，公开 canary.4，agent `GitHub Copilot via Agent Host`。

- 新 Session：`ed69299f-05b6-4b3f-a317-a0402fcea538`，标题 `AHP-only canary.4 smoke 20261012`。
- create command `87d9c9ba-3ea3-441d-8204-246109fcad15` 成功；周期 inventory 后仍为 `idle`、native status `1`、状态已知。
- history 含首条 user prompt 与最终 `AHP_ONLY_CREATE_OK`。
- follow-up command `9fe34640-d76c-4d53-8e84-50bbbf858179` 成功；history 含 user prompt 与 `AHP_ONLY_FOLLOWUP_OK`。
- Done command `ccfe2559-c0f7-4c29-a785-900467b5497b` 成功，Session `closed`、native archived=1。
- Done 后 Relay connection 更新；使用旧 connection ID 的 Restore 被安全拒绝为 unconfirmed。
- 使用 current connection 的 Restore command `2e57bc41-06b4-400a-a082-39aa0d480fe4` 成功，Session 恢复 `idle`、native archived=0、状态已知。
- 当前 inventory 65/65 confirmed Session 状态已知，current unknown=0；87 个旧行保留为未确认历史。
- 本机 Connector Node 进程路径指向 `connector-0.3.0-canary.4`，没有 Connector-owned `copilot-runtime` 子进程。

## Office PC 原案例收敛

Office PC `copilot-sdk-test` 通过既有 AHP Session 接收受限升级指令，发现旧 managed install `0.2.0`、两个 supervisor 与 Connector-owned SDK runtime；随后安装公开 canary.4、原子切换 persistent launcher、停止精确旧进程树并通过原 Scheduled Task 重启。

- Connector 重连后 agent name 为 `GitHub Copilot via Agent Host`，sync state ready。
- 98 个 current confirmed Session 全部 `execution_state_known=1`，current unknown=0。
- Agent Host 行 `9df9ca7a-22e9-41e3-87ec-7bbccff5d79d` 为 current、running、状态已知。
- 旧 SDK 行 `9090f04f-63e6-4dc1-9f52-03ac6c9ca406` 保持 unknown 但不再 current confirmed，仅作为历史数据保留。
- Office PC 总计 104 个历史未确认行，未执行配对、重写或删除。

## 最终完整性

- production command 总数在两个成功 archive command 后由 203 正常增长到 205。
- `devices_remove_access` trigger 仍为 1。
- `latest` 保持 `0.2.1`，可按应用版本回滚；D1 migration 不删除 Session/event 数据。
