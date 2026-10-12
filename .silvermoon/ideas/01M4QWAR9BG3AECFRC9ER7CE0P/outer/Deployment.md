# Deployment

## Steps

### D-S01: 记录 AHP 切换基线

保存 `latest=0.2.1`、发布前 `canary=0.2.1-canary.1`、200 行 Session、102 行未知状态及两个指定记录的只读生产基线，并确认旧数据不在部署变更范围。保留 `.1` 的发布与失败 smoke 证据，不重发或删除该版本。

### D-S02: 发布 AHP-only Connector

通过 tag `npm/connector/v0.3.0-canary.4` 和既有 Trusted Publishing workflow 发布修复后的 `@silvermoon-ai/connector@0.3.0-canary.4` 到 `canary`；不得移动 `latest=0.2.1`。先应用 D1 migration 0014 扩展 command type，再部署同一 primary 的 Worker 以恢复 Done/Restore。

### D-S03: 验证单一来源并观察回退

从官方 registry clean-install 精确 `.4` canary，升级并重连可控 Device 后验证新 inventory、create、send、history、status 与 archive 均来自 AHP；观察 Host 断开时只出现 offline/error，并保留回滚到 `0.2.1` 的应用版本路径。Office PC 的 `copilot-sdk-test` 属于另一运行实例，若无法管理其进程则作为明确外部阻塞记录，不伪造升级。

## Acceptance criteria

### D-AC01: 不再产生 SDK 投影

Actions 与 registry 证明精确 canary 发布成功且 `latest` 未变；生产只读查询证明升级后新增或更新的 Session 只有 AHP 身份，未再产生新的 metadata-only `execution_state_known=0` 行。

### D-AC02: AHP 操作端到端成功

生产 UI 与命令证据证明 list、create、send、history、实时状态和 Done/Restore 通过 AHP 成功，Host 不可用时没有 namespace fallback。

### D-AC03: 历史数据与回滚安全

D1 行数与事件检查证明旧 Session 未被自动配对、重写或删除；出现能力回退时可回滚 Connector 版本且无需数据恢复。
