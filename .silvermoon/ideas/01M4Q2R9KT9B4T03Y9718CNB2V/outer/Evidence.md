# Deployment Evidence

## 本轮手机与详情操作发布

- 生产入口：[Silvermoon Relay](https://silvermoon.work)。
- Release commit：`939aef1a6d92528033054553dd47e884df87e0e8`，包含已接受实现 `981a973a692bcca413d69794886eb7e06419c6b1`；在已发布 `95c7d490d8b201cd16ad3757ae1adf0f6f5ef1d5` 上普通快进，没有覆盖其他 Session 的发布历史。
- [Check and deploy #38217130214](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38217130214)：check、deploy 均 success；2026-10-12 07:28:59 UTC 完成 Pages 发布。
- `pnpm check` 与本地迁移通过；完整浏览器回归 **190 passed、2 skipped**，包括本轮新增详情内双向操作、44px 手机/coarse pointer 触控区、pending/失败一致性、焦点、异步导航、长标题及既有工作状态场景。
- remote D1 检查明确返回 `No migrations to apply!`；本轮未新增迁移，首版 0012 保留。没有手工更改生产数据，没有 npm 发布。
- Worker version：`888109d8-e63f-459d-8bb7-53d83aa1892d`。
- [Pages deployment](https://3581f7a0.silvermoon-work.pages.dev) 成功；生产域名资产为 `index-Ce_KNLy0.js`、`index-B-n1Wb-Z.css`，与本轮正式构建一致。

## 本轮线上检查

在正式部署成功后访问生产域名并严格断言：

- Web、JavaScript、CSS 与 `/health` 均为 200；health 返回 `{"service":"silvermoon-relay","status":"ok"}`。
- Web 资产包含 `desktop-detail`、`mobile-detail`、Show completed、详情顶部 Reactivate 文案和状态更新路由；旧的 `Reactivate from the Session list` 指令不再存在。
- CSS 包含详情动作/手机状态布局以及 `.session-work-glyph` 的 `width:44px; height:44px` 规则。实际点击尺寸和交互由本轮浏览器回归证明，资产检查只证明对应构建已上线。
- 未认证、对专用不存在身份 `deployment-auth-probe/nonexistent` 的 work-state POST 返回 401、`authentication-required`，CORS 来源为 `https://silvermoon.work`。未使用生产账户凭据，未修改真实 Session。

本轮已提供可用的手机列表和详情入口。真实账户完成/Reactivate、跨浏览器账户读取及生产 Connector 同步 smoke 仍留给用户最终线上验收；不把 fixture 或只读线上检查当作上述真实操作，也未记录 acceptOuter。

## 首版发布结果

- 生产入口：[Silvermoon Relay](https://silvermoon.work)；API：`https://relay.silvermoon.work`。
- Release commit：`89613d0b75cccf5c31668b3031fd2fa31fc89eac`，包含产品实现 `e3011a6e80170532cbe93dcf00ed46ffae09fcb2`；普通快进 release，保留并发主线历史，没有 force、npm tag 或 npm publish。
- [Check and deploy #38206158263](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38206158263) 的 check、deploy 均为 success；2026-10-12 UTC 完成。
- `pnpm check` 成功；protocol 6、Web 71、Worker 29、Connector 30 项测试通过。完整浏览器回归 175 passed、2 skipped；跳过项不是本次新增完成/恢复场景。
- 本地全量迁移与生产 remote 迁移均确认 `0012_session_work_state.sql` 成功。发布顺序为 D1、Worker、Pages。
- Worker version：`f535f035-0ebf-493b-b46a-f3f02d968517`。
- [Pages deployment](https://0e186821.silvermoon-work.pages.dev) 成功；生产域名返回同一次构建的 `index-UXsCyXSA.js` 与 `index-CvJT6bVm.css`。

## 首版线上只读及认证边界检查

发布完成后从生产域名获取并严格断言：

- `GET https://relay.silvermoon.work/health`：200，`{"service":"silvermoon-relay","status":"ok"}`。
- `GET https://silvermoon.work` 及其 JavaScript/CSS：均为 200；资产名称与本次流水线构建日志一致。
- JavaScript 包含 `Show completed`、`Mark completed`、`Reactivate`、`/work-state`；CSS 包含 `.session-work-glyph` 与 `.session-work-tooltip`。
- 不携带认证、对专用不存在身份 `deployment-auth-probe/nonexistent` 发起 work-state POST：401、`authentication-required`，允许来源精确为 `https://silvermoon.work`。没有修改任何真实账户 Session。

首次资产探针错误地要求 Web 包含服务端专属错误码 `session-completed-reactivate-first`，该断言不适用于 Web；改为核对实际 UI 标识、样式及认证边界后全部通过。这不是产品部署失败，也不以字符串检查替代交互测试。

## 最终线上验收

用户已明确授权验证完成后直接部署，不再安排实现人工验收；最终 Deployment 验收仍由用户决定。

在 [生产站点](https://silvermoon.work) 登录，按 [Deployment.md](Deployment.md) 的 D-S02 使用自己的专用测试 Session：

1. 从手机列表或当前 Session 的详情顶部点击勾选 glyph 完成，确认默认隐藏、当前详情与草稿仍保留；开启 Show completed 可读历史，完成项不能发送新指令。两处触控区至少 44px。
2. 不退出详情，点击顶部回转 glyph Reactivate；也可从列表执行同一动作。确认恢复未完成，没有自动发消息或解除原生归档，其他筛选及在线/能力限制仍生效。
3. 刷新或在另一浏览器登录同一账户，确认标记保留；桌面和窄屏都可直接从详情操作，长标题及通知不遮挡动作。

Agent 未使用生产账户凭据，未执行真实账户完成/Reactivate、跨浏览器账户读取或 Connector 生产同步 smoke，未逐一核验生产历史，也未执行回滚。真实账户双向操作留待用户线上验收；已交付可用部署和可执行验收入口，不声称已通过用户验收。

## 兼容与回滚边界

迁移为既有记录提供默认 open；Connector 库存与事件不写工作标记，相关自动化回归在正式发布检查中通过。迁移未删除 Session 或历史。若需回滚，保留 D1 新列与标记，优先回滚 Web、必要时回滚 Worker，不执行真实数据回滚。旧客户端忽略状态不等于遵守新版 completed 发送限制。
