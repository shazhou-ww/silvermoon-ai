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

## 修复候选

- 修复顺序：create → subscribe → optional title → first send → wait ready → refresh inventory。
- wire fixture 的 Session snapshot 初始为 `Creating`，只在 `ChatTurnStarted` 后发 `SessionReady`。
- `pnpm --filter @silvermoon-ai/connector test -- agent-host-adapter.test.ts`：3/3 通过。
- `pnpm --filter @silvermoon-ai/connector typecheck`：通过。
- 已明确授权 `0.3.0-canary.2`；`.1` 保持不可变，不重发、不删除。

## Device 边界

- 本机可控 Connector 是 Home PC `device-0q6jdqArkbQMgAHR`。
- 原始案例的 Office PC `copilot-sdk-test` 是另一在线 Connector，不是本机 supervisor；不得将 Home PC 升级结果冒充为 Office PC 结果。
