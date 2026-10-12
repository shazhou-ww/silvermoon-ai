# 部署执行证据

## 当前结果

2026-10-12 已按用户授权推进既有 release 流程，首次交付受 CI 阻塞。独立维护修复已同步 main；另一条并发流程已推进 release，其外部部署正在观察中。用户随后共享登录后的内置浏览器并授权实际验收。所有 D-* 条目在完整证据就绪前保持未完成，不记录 `submitOuter` 或推断部署验收。

## 交付边界

- 先将细化后的 [Deployment.md](Deployment.md) 验证并同步到 primary `fc38b00a4aa3833d95dada65f0d288c50c69d632`，观察到 `deploymentRevision=459bd028fc92` 后执行外部流程。
- 在独立交付 worktree 从原 release `26b83bb0ced4ece9b4ace201fbc583f49ec8d7bf` 创建普通 merge，完整保留 primary 和 release 历史；候选通过 Silvermoon worktree、staged 与 committed snapshot 检查。
- 普通非强制 push 后，release 为 `16680b96b90528f6af5e5b93c0273b35ccab9f0f`，包含已验收实现 `14360ba6e1b63c8c442367fdb69434fd79d2409a`。相对原 release 的产品差异仅是四项视图偏好实现及相关测试；另有已在 primary 的 README 和 idea 元数据，无新增 Worker 代码或 migration。
- 使用 [Check and deploy 工作流](https://github.com/shazhou-ww/silvermoon-ai/blob/16680b96b90528f6af5e5b93c0273b35ccab9f0f/.github/workflows/check-and-deploy.yml)，没有直接部署、发布 npm、跳过检查或修改已验收实现。

## 工作流结果

工作流：[38199209309](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38199209309)，交付 commit 固定为上述 release merge。

| 执行 | 结果 |
| --- | --- |
| 首次 check job | `pnpm check`、全部浏览器测试和本地 D1 migration 检查通过 |
| 首次 deploy job | 再次运行 `pnpm check` 时 Connector 单元测试失败 |
| 同提交重跑失败 job | 再次在同一 Connector 测试失败；[attempt 2](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38199209309/attempts/2) |
| Apply D1 migrations / Deploy relay Worker / Deploy Pages application | 两次均 skipped，没有执行生产变更 |

两次失败均为未在本次变更中修改的 `packages/connector/src/connector.test.ts:222`：

`connection-scoped connector uploads > reports an observed result after reconnect with the original command connection without re-executing`

断言要求 `register` 调用数恰好为 2，首次实际为 10，重跑实际为 5；同一提交的 check job 已通过此测试。当前证据说明是重复检查中的重连测试阻塞，不足以确定其根因；没有将问题静默忽略或在 deployment 阶段修改测试/产品代码。

## 公开站点检查

2026-10-12T03:31:40.045Z 在集成浏览器重新加载 https://silvermoon.work/，无真实登录账号：

- 页面显示正常登录入口；未登录 `/api/me` 的 401 与该状态一致。
- 实际模块资产为 `https://silvermoon.work/assets/index-DccAhzrw.js`，无缓存读取返回 HTTP 200。
- 资产中不含新实现的 `silvermoon:session-view-preferences:` 命名空间或 `session-view-preferences-error` 事件标识，符合部署步骤未执行、站点仍加载此前产物的结果。
- 此次检查仅证明公开页面/产物状态，不证明四项偏好、真实账号隔离、重登或多标签页行为已经在生产验证。没有读取或保存账号身份、Session 内容、cookie 或凭据。

## 恢复条件

### 独立维护修复

- 用户同意保留本地 Connector 重连 CI 覆盖，按实际连接身份和 RPC 事件等待，取消对瞬时全局注册次数的脆弱断言；不访问真实 Copilot、设备或生产连接。
- 修复提交 `3c44c5a847a908bfe224bcadcd6e02740e8b0e01` 已通过 Silvermoon worktree、staged 和 committed snapshot 检查并普通同步 main，含规定 Co-authored-by trailer。
- 本地重连 fixture 全套 4 项连续运行 20 轮，共 80 次成功；Connector 全套 29 项通过、1 项 Windows 平台跳过。Connector typecheck、全仓 lint 和 build 通过。
- Windows 全仓 `pnpm check` 在既有 Worker 生成类型检查失败，并出现 libuv 原生退出；没有修改无关生成类型或宣称全仓检查通过。Ubuntu 完整检查以实际工作流结果为准。
- deploy 仍依赖完整 check job，仅将 deploy 内重复的 `pnpm check` 改为 `pnpm build`，未跳过前置单元、浏览器或 migration 检查。

### 并发 release

- 用户选择仅移植上述修复到原 release，不把新增设备管理功能及 migration 纳入本次主动交付。
- 刷新远端后发现另一条流程已将 release 推进到 `f0e319897e99c73a839918d8536b7dd55542d005`，该提交已经包含本次修复和并发设备管理变更。[工作流 38201102932](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38201102932) 已运行。
- 本任务未创建或推送该 release 提交，未覆盖、回退或重复触发其部署。2026-10-12 观察到该流程 Ubuntu `pnpm check` 成功，浏览器测试仍在执行；后续外部结果以实际观测补充。
- 已共享真实登录页，但当前页面仍加载旧资产 `index-DccAhzrw.js`；等待交付产物可用后再执行偏好验收，避免把旧产物结果归到新实现。

### 剩余条件

先确认完整工作流成功和目标站点加载新产物，再完成 D-AC01、D-AC02 并恢复验证前偏好。仅对可操作的真实账号记录结果；缺少第二个真实账号或重新登录能力时保留对应未完成项。完整证据同步 primary 后方可提交 `submitOuter`。
