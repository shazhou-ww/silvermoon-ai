# 部署准备证据

这是 Outer World 的准备与执行观察，不是完整部署完成证据。部署契约同步后才按其稳定 revision 执行外部检查；尚未核对真实设备的 D steps/criteria 不提前勾选。

## 2026-10-11 的配置与只读观察

- 实现接受已记录为 `acceptInner`；被接受的 Inner revision 为 `a92e1a0e0e298e88cb8abe2779e9cf706f60d4ee`。接受事件已同步 primary，未记录 submitOuter 或 acceptOuter。
- [Check and deploy 配置](../../../../.github/workflows/check-and-deploy.yml) 显示 main/release 都运行 check，仅 release push 运行 deploy；依序远程 D1 migrations、Worker、Pages。该流程不包含 npm 包发布。
- [Worker 配置](../../../../apps/worker/wrangler.jsonc) 指向 `silvermoon-relay`、D1 同名数据库和 `relay.silvermoon.work`；[发布说明](../../../../README.md#release) 指明 Pages 项目 `silvermoon-work`。
- 只读 GitHub API 观察 release tip 为 `a3f8db3420d5e7b434d5b58db554352caa79c919`。这是当时观察，不保证执行时仍相同；执行前必须刷新并核对，不能 force-push。
- 对应接受提交 `16be01b7ab3c912aa0cdb16bf31f0b608398a465` 的 [main check run](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38144091795) 当时为 in_progress。没有在结果出来前填 success；早先实现提交 run 因后续 main 推送而取消，不等于其测试失败或部署完成。

## 未执行与剩余前提

- 未合并或推送 release，未远程迁移数据库，未部署 Worker/Pages。
- 未查询或使用生产凭据，未发布 npm 包，未替换任何实际设备上的 connector。
- 尚无实际目标设备、connector 发布范围、备份时点或远程验证证据；不将本地构建或 Inner mock 测试重复登记为 D 证据。
- 以上是部署准备时的未执行状态；后续明确授权与新的外部观察如下，不将历史状态覆盖成成功。

## 生产服务升级授权与执行前基线

- 用户明确选择“授权通过 release 部署 Relay/Web 及数据库迁移；connector 发布另行确认”。不发布 npm，不替换实际设备上的 connector，不发送用户消息或执行真实 agent 工作。
- 最新代码基线 `0e8f3d85b7a8a6a07a701e7bbe2b969846969e65` 的 [main check run 38144832397](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38144832397) 已 success，check 成功、deploy 按 main 规则 skipped。后续 `916e8171dde1f5e22e7801274f329244d25519d9` 只改变其他 idea 的事件，不改变应用源码。
- release 当时仍为 `a3f8db3420d5e7b434d5b58db554352caa79c919`；对应 [run 38142451654](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38142451654) 在 browser 检查失败，deploy skipped，因此不能据 release tip 认为已上线。此前成功版本来自 `6699772150afeecaf096ecef1a3f17434738b7b9` 的 [run 38138941801](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38138941801)。
- Wrangler 只读 `d1 time-travel info` 成功取得远程恢复 bookmark：`0000000e-0000dca9-00005101-667103ca6f7756c6c3eaa1bc9894f984`。这是本次迁移前可恢复位置，不执行 restore，也不自动回退用户数据库。
- 远程只读查询确认已应用 0001–0009、尚未应用 0010；变更前聚合为 6 个设备、404 条 Session、25,517 个事件。查询 `rows_written=0`，未读取/登记用户消息正文。
- 实际 Worker 基线版本 `0f1deccc-c4b4-444e-ad97-19b287c43213`，Pages production deployment `accec838-578d-4a20-954d-7fa347cb9381`，来源 `6699772`。这些来自 Wrangler deployment 列表，执行后以新版本另行核对。
- 待同步本次授权/操作范围的部署契约后，再由隔离 release worktree 触发服务升级。真实设备版本与断网验证仍未授权/取得证据，不能提交完整 submitOuter。

## 本次服务端生产升级结果

### 发布来源与并发处理

- 本次执行前同步并观察的部署 revision 为 `3a7160935fe2a3ff10486db3648849c93d16ce81`，位于 primary `061e13ebb0fb551baae487ee56e96d48d70dff96`。
- 准备隔离 release 合并时，发现 release 已被并发任务更新到 `1ad0b56b293129cdcdef035d25d44c24ded3e0b5`，对应 [release run 38145243518](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38145243518) 正在运行。
- 对比本次授权源码和该 release 的 `apps/`、`packages/`、workflow，无差异；本次合并只新增部署说明及事件。为避免取消并重跑相同应用部署，本轮没有再推送 release，也没有把对方触发的 run 伪称本轮触发；等待并核实其实际外部结果。
- 临时 release worktree 的合并候选通过 Silvermoon worktree/staged 检查；确认无需额外发布后仅撤销 operation-owned 合并并移除该 worktree，不影响 main、release、应用源码或其他历史。

### 外部成功证据

| 项目 | 实际观察结果 |
|---|---|
| Release 工作流 | `38145243518` 已 completed/success，check 成功（4m58s），deploy 成功（49s） |
| 迁移顺序 | run 日志显示 D1 迁移先于 Worker 和 Pages；`0010_session_confirmation.sql` 标记成功，远程再次 SELECT 证实已在 d1_migrations 中 |
| Worker 版本 | `c86d108e-8d3e-4869-9ad8-e31f195bf3ab`，deployment 时间 `2026-10-11T14:03:14.742Z`，100% 当前版本 |
| Pages 版本 | production deployment `2ce69833-78a7-4748-b17b-8a89fc78f2c7`，来源 `1ad0b56`，对应 [部署地址](https://2ce69833.silvermoon-work.pages.dev) |
| 数据聚合 | 迁移前后均为 6 个设备、404 条 Sessions、25,517 个事件；只读核对 rows_written=0。这证明数量未因本次迁移减少，不冒充逐条正文完整性校验 |
| Relay 公共健康检查 | `https://relay.silvermoon.work/health` HTTP 200，service=silvermoon-relay、status=ok |
| Web 公共检查 | `https://silvermoon.work/` HTTP 200，生产浏览器能打开登录页、三种 OAuth 入口可见；未登录的鉴权拒绝保持有效 |

### 已完成范围与未完成边界

- 用户授权的数据库／Relay／Web 服务升级已由上述匹配源码的成功 release run 完成，本轮完成版本、迁移和公开访问验证。
- 远程设备聚合为 3 online、3 offline，全部 `session_sync_state=unsupported`；这与旧 connector 尚未升级相符，不把 Online 当作本次能力已确认。
- 本轮没有发布 `@silvermoon-ai/connector`、修改实际设备配置或执行用户 agent 工作；没有登录凭据，不绕过鉴权查看 Session 正文。
- 因设备端升级未完成且无已登录的授权 Session 验证，D-S02/D-AC01 只完成服务子范围，D-S03/D-AC02/D-AC03 的真实会话、断网、重连及结果验证未完成。D-S01 中实际设备版本/恢复范围也尚待落实，所有 D ledger 继续未勾选。
- 不提交 submitOuter、不请求 acceptOuter。下一步由用户另行确认 connector 发布／设备升级及登录后的真实验证范围；当前产品与实现接受记录不回退。
