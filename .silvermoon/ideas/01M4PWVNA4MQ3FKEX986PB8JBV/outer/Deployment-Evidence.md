# 部署执行证据

## 当前结果

2026-10-12 已成功交付并完成本次验收范围内的真实账号偏好验证。用户进一步明确确认真实账号切换为本次部署验收的延期例外，由独立 idea 后续补验；该场景仍为未验证，不记作通过。修订后的部署契约已先同步 primary，再复核生产产物、登录状态及菜单，全部 D-* 条目已有本次范围内的实际证据，现可提交准确修订供正式部署验收；例外确认不等于 acceptOuter。

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

## 首次失败后的公开站点检查

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
- 本任务未创建或推送这些并发 release 提交，未覆盖、回退或重复触发其部署；本 idea 只验收 Session 视图偏好，不替设备管理或其他产品变化作验收。
- `38201102932` 在浏览器测试期间被更新的 release 工作流取代而取消，不是 Connector 测试再次失败；deploy 未执行。
- 后继 [38201298329](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38201298329) 对 `0d25cd8fd4722815e07e3b2a467871c464158f8e` 完整成功：Ubuntu `pnpm check`、浏览器测试、本地 migration 检查通过；deploy 仅构建同提交，D1、Worker、Pages 步骤全部成功。Worker version 为 `22ecd322-0b55-4f44-b8d8-d624099c5810`，Pages 为 https://adace98e.silvermoon-work.pages.dev。
- 2026-10-12T03:56:27.386Z，真实登录页加载 `/assets/index-Cs5No2FO.js`，无缓存读取 HTTP 200，包含偏好命名空间及错误事件标识，随后执行下列验收。
- 验收期间另一条流程又交付设备弹窗标题修正：[38202522318](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38202522318)，commit `809e71abdf1dfde9ee702107b5621bf9f7dda113`，结果成功；Worker version 为 `5885e9a6-cbbd-49f3-9ff1-39b4f16304b0`，Pages 为 https://c254ebe4.silvermoon-work.pages.dev。比较两次交付的 `App.tsx`、偏好模块及其单元测试，没有差异。
- 最终 2026-10-12T04:29:33.890Z，原账号页面实际加载 `/assets/index-BVNwOaAz.js`，无缓存读取 HTTP 200，仍包含 `silvermoon:session-view-preferences:` 和 `session-view-preferences-error`；最终原偏好恢复检查在该产物上完成。

## 真实账号浏览器验收

通过共享浏览器的真实认证、真实 API 与生产页面验证，没有模拟账号或替换 API。账号比较只返回相等/不相等，不在仓库记录身份、Session 内容或凭据。

| 场景 | 实际结果 |
| --- | --- |
| 四项开关全部 16 种组合 | 通过菜单逐项设置 mask 0–15，每组刷新后逐项核对勾选状态，全部恢复正确 |
| 无关存储 | 16 组验证后，其他 localStorage 和 sessionStorage 记录与验证前完全相同 |
| 重新打开 | 同一真实账号的新标签页恢复全部四项，不依赖原页面内存 |
| 多标签页同步 | 第二页修改 Show ended 后原页同步；原页修改 Show unavailable 后第二页同步；第二页搜索文本不受同步影响 |
| 分组恢复 | 实际存在 6 个可见设备组；收起初始展开组后刷新，分组重新按初始化规则展开 |
| 离线快捷入口 | 隐藏离线历史后从 Active 使用 View offline history (switch to All)，刷新后 Show offline Sessions 保持开启 |
| 桌面与窄屏菜单 | 1440×900、390×844 均可操作；菜单和窄屏警告场景 `scrollWidth > innerWidth` 均为 false |
| 损坏记录 | 临时写入损坏 JSON 后刷新，四项回退默认，恢复警告可见；结束后恢复原记录 |
| 写入不可用 | 临时限制偏好存储写入，当前 Show ended 选择仍保留，保存警告可见，无横向溢出，捕获 1 条结构化 save 错误 |
| 读取不可用 | 在已登录页面临时限制 localStorage 读取并触发 storage 通知，四项回退默认；之后仍能修改当前视图，恢复/保存警告可见，分别捕获 1 条 restore/save 错误，窄屏无横向溢出 |
| 退出重登 | 实际 Sign out 后偏好记录保持；用户通过第三方登录回到同一 Relay 账号，逐项恢复 `[false, false, true, true]` |
| 真实账号切换 | 未验证：Google 自动返回原账号，临时强制选择尝试未完成；用户明确要求跳过并另建问题记录 |

浏览器后台状态曾导致点击/等待超时；实际通过的自动化操作使用临时 Chrome focus emulation，完成后撤销，不将工具超时当作产品验证失败。存储异常仅通过浏览器临时注入，不改产品代码；注入、临时标签页、路由拦截均已清理。新文档初始化注入没有生效的尝试不计作读取受限证明，表中的读取受限结果明确是运行中 storage 同步场景。

## 恢复与延期

- 2026-10-12T04:24:45.052Z 确认重新回到原真实账号，恢复验证前四项全 false 和原先不存在的偏好记录；当前页刷新后默认状态正确。
- 原页面视口仍为 1334×815；再次确认所有无关 localStorage、sessionStorage 记录不变，并移除浏览器中的临时偏好备份。没有发送 Session 指令、创建设备、修改历史或发布 npm。
- 用户原话：“这个场景先不验了，直接跳过即可。你新建一个IDEA用来记录这个不能切换账号的bug，我们后续处理”。仅将账号切换标为延期，不把该决定当作账号隔离通过或 `acceptOuter`。
- 已在独立 worktree 登记 [google-account-selection](../../01M4Q5Q9YZF48QNBB8N5V4KX7D/outer/inner/ideal/Idea.md)，ID `01M4Q5Q9YZF48QNBB8N5V4KX7D`；当前 preparing、未提交构想验收、未修改登录实现。该问题记录明确区分登录选择受阻与尚未证明的偏好隔离问题。

### 剩余条件

后续在 Google 账号选择问题解决且两个真实账号可操作时，由对应 idea 补做账号间隔离的生产验证。本轮不再尝试该场景，也不以已有单账号证据替代它。

## 本次验收范围确认与收口

- 用户于 2026-10-12 明确选择“确认延期例外，准备当前部署验收（推荐）”。[Deployment.md](Deployment.md) 已将真实账号切换从本次部署验收前置项明确延期，保留后续 idea 引用；已验收实现的账号隔离功能要求未改变。
- 先验证并同步修订契约到 primary `7ada0df1bb320d87e0bec38da7e683d67ecdbe77`，观察 `deploymentRevision=604d8f2e7992`，再复核外部结果。
- 2026-10-12T04:36:59.002Z，生产页面仍加载 `/assets/index-BVNwOaAz.js`，无缓存资产读取 HTTP 200，偏好命名空间与结构化错误标识均存在；真实 `/api/me` 返回 HTTP 200。四项菜单实际可打开，未出现偏好错误提示，临时备份已清除；本次复核不修改偏好或其他数据。
- 再次确认工作流 `38202522318` 对已记录 release `809e71abdf1dfde9ee702107b5621bf9f7dda113` 成功。原有 16 组合、刷新/重开、退出重登、双向同步、分组/离线入口、桌面/窄屏和异常降级证据仍适用于未变化的偏好实现及当前产物。
- 逐项核对 D-S01、D-S02、D-AC01、D-AC02，除明确延期例外外没有其他未完成验证项。ledger 的完成仅表示修订契约范围内的 Agent 工作就绪；同步证据并提交准确修订后，仍需用户对该修订作正式 acceptOuter 决定。
