# Deployment Evidence

## 发布结果

- 生产入口：[Silvermoon Relay](https://silvermoon.work)；API：`https://relay.silvermoon.work`。
- Release commit：`89613d0b75cccf5c31668b3031fd2fa31fc89eac`，包含产品实现 `e3011a6e80170532cbe93dcf00ed46ffae09fcb2`；普通快进 release，保留并发主线历史，没有 force、npm tag 或 npm publish。
- [Check and deploy #38206158263](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38206158263) 的 check、deploy 均为 success；2026-10-12 UTC 完成。
- `pnpm check` 成功；protocol 6、Web 71、Worker 29、Connector 30 项测试通过。完整浏览器回归 175 passed、2 skipped；跳过项不是本次新增完成/恢复场景。
- 本地全量迁移与生产 remote 迁移均确认 `0012_session_work_state.sql` 成功。发布顺序为 D1、Worker、Pages。
- Worker version：`f535f035-0ebf-493b-b46a-f3f02d968517`。
- [Pages deployment](https://0e186821.silvermoon-work.pages.dev) 成功；生产域名返回同一次构建的 `index-UXsCyXSA.js` 与 `index-CvJT6bVm.css`。

## 线上只读及认证边界检查

发布完成后从生产域名获取并严格断言：

- `GET https://relay.silvermoon.work/health`：200，`{"service":"silvermoon-relay","status":"ok"}`。
- `GET https://silvermoon.work` 及其 JavaScript/CSS：均为 200；资产名称与本次流水线构建日志一致。
- JavaScript 包含 `Show completed`、`Mark completed`、`Reactivate`、`/work-state`；CSS 包含 `.session-work-glyph` 与 `.session-work-tooltip`。
- 不携带认证、对专用不存在身份 `deployment-auth-probe/nonexistent` 发起 work-state POST：401、`authentication-required`，允许来源精确为 `https://silvermoon.work`。没有修改任何真实账户 Session。

首次资产探针错误地要求 Web 包含服务端专属错误码 `session-completed-reactivate-first`，该断言不适用于 Web；改为核对实际 UI 标识、样式及认证边界后全部通过。这不是产品部署失败，也不以字符串检查替代交互测试。

## 最终线上验收

用户已明确授权验证完成后直接部署，不再安排实现人工验收；最终 Deployment 验收仍由用户决定。

在 [生产站点](https://silvermoon.work) 登录，按 [Deployment.md](Deployment.md) 的 D-S02 使用自己的专用测试 Session：

1. 点击列表项右侧勾选 glyph 完成，确认默认隐藏；开启 Show completed，检查历史仍可读、不能发送新指令。
2. 点击回转 glyph Reactivate，确认恢复未完成；没有自动发送消息，也没有解除原生归档，其他筛选及在线/能力限制仍生效。
3. 刷新或在另一浏览器登录同一账户，确认标记保留；桌面与窄屏均可使用行尾动作。

Agent 未使用生产账户凭据，未执行真实账户完成/Reactivate、跨浏览器账户读取或 Connector 生产同步 smoke，未逐一核验生产历史，也未执行回滚。真实账户双向操作留待用户线上验收；已交付可用部署和可执行验收入口，不声称已通过用户验收。

## 兼容与回滚边界

迁移为既有记录提供默认 open；Connector 库存与事件不写工作标记，相关自动化回归在正式发布检查中通过。迁移未删除 Session 或历史。若需回滚，保留 D1 新列与标记，优先回滚 Web、必要时回滚 Worker，不执行真实数据回滚。旧客户端忽略状态不等于遵守新版 completed 发送限制。
