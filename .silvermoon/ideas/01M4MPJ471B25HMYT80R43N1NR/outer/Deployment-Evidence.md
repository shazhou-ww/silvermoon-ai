# Deployment Evidence

## 发布基线

- Worktree 与 `origin/main` 同步到 `13a2534ba7fb6181617f55a7516951b7dfd96a9e`，`packages/connector` 与该 revision 无差异。
- `origin/release` 包含实现提交 `aa4e8507b806a720e4e5fd39eb0d7a71a8066e1f`；release workflow [38129579920](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38129579920) 成功完成 check、D1 migration、Worker 与 Pages 部署。
- `https://silvermoon.work` 返回 HTTP 200；Relay 未认证 `/api/me` 返回预期 HTTP 403。
- 从最新 main 构建并更新本机 connector；安装产物包含 `isArchivedStatus` 和 archived binding 保留逻辑。Provider 定向测试通过：1 个 test file、18 项测试全部通过。

## D-S01：真实 Done 与恢复

测试 Session ID：`87dcfc90-c7b0-4a9b-bd0e-60683317bb1b`。

| 阶段 | status | nativeStatus | 可发送 | 可见完整对话 |
| --- | --- | --- | --- | --- |
| Done 前 | `idle` | `33` | 是 | 1 条 user + 1 条 assistant |
| Done 后 | `closed` | `97` | 否 | 同一条 user 与 assistant，事件 ID 和内容哈希保持一致 |
| 恢复后 | `idle` | `33` | 是 | 同一条 user 与 assistant，事件 ID 和内容哈希保持一致 |

线上 Relay 将 Done 状态显示为只读，且两条完整对话继续可见。首次观测到的 3 个 AHP event 是 Session 刚完成时的瞬态投影；Done 后与恢复后均稳定为用户确认的完整 2 条可见对话，因此不构成活动丢失。

## D-S02：持久化事件与失败重试

使用正式 `SilvermoonConnector`、真实 production Relay/Worker/Web 与临时受控 adapter：

1. 通过 `session.event` 通道为 `deployment-failure-session` 发布一条 user 和一条 assistant message。
2. `loadSessionHistory` 明确返回 `Forced deployment history failure.`。
3. Web 同一详情页同时显示：
   - 两条已持久化 message；
   - `History sync failed.` 与具体失败原因；
   - `Retry sync`。
4. 点击 `Retry sync` 后，失败提示重新出现，两条 message 仍保持可见，Retry 仍可再次使用。
5. 验证结束后将合成 Session 更新为 `gone`，停止受控 adapter，并恢复真实 connector。持久 connector 获得 Relay connection ID `ee27fcc6-c37b-423d-8eea-1afa19db81d7`。

## 观察到的非阻塞后续问题

- Agent Host registry 中存在已失效 endpoint 与旧 AHP 0.9 entries，产生重复诊断日志，但活动 AHP 0.10 endpoint 可正常工作。
- Windows 全局 npm shim 下的 `silvermoon-connector` 入口判定会静默退出；直接运行同字节的 `dist/cli.js` 正常。此次已用后者启动持久 connector。
- 当 connector 在线但临时看不到本地历史源时，Relay 旧 Session 行仍可能显示 `Available`；这是现有 missing-session 同步语义，不影响本 idea 对 archived/Done 与持久化历史的验收，但应另行跟进。
