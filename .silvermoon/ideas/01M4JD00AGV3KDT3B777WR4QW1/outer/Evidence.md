# Deployment evidence

发布验证日期：2026-10-10；真实登录端到端补验日期：2026-10-12

## D-S01 / D-AC01：已完成

- 已将包含 accepted Implementation `20ac981e6776312ac048a1ebad2b40a2fc8464c2` 的 primary `5d2acda61415db7aaf4528b429e9a4485be0909c` 通过既有 merge 发布模式晋级为 release commit `2367a456b336f4a8fcbf3df22c4250c4f310631f`；合并后的 Git tree 与该 primary 完全一致。
- GitHub Actions [Check and deploy run 38043369999](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38043369999) 成功完成。
  - `check` job 成功：冻结 lockfile 安装、`pnpm check`、本地 D1 migration。
  - `deploy` job 成功：`pnpm check`、远端 D1 migration、Relay Worker 部署、Pages 部署。
- `https://silvermoon.work/` 与本次 JavaScript 资源 `/assets/index-CuDlXnBf.js` 均返回 HTTP 200。
- 生产 bundle 包含当前改造的 `Tool messages are hidden`、tool message 显隐开关及 `Shift+Enter` Composer 提示。
- `https://relay.silvermoon.work/api/me` 在未登录请求下返回预期的 HTTP 401 `authentication-required`，同时返回生产 Web origin 的 credentialed CORS 与 `Cache-Control: no-store`。
- 生产登录页桌面视口 `1681 x 724` 下无 document 级溢出，Google、Microsoft、GitHub 三个登录入口均指向生产 Relay。
- 生产登录页窄屏视口 `390 x 844` 下无横向溢出，三个登录入口均可见。

## D-S02 / D-AC02：已完成

2026-10-12 09:58–10:01（UTC+08:00），用户在受控浏览器自行完成 Google 登录和两步验证；Agent 未操作账户凭据。真实账户的生产工作区成功列出 Session，在线 Device 为 `copilot-sdk-test`。

为避免干扰现有工作，通过生产 UI 新建专用 smoke Session `99442b3c-8fad-479d-ac34-5f859cd3d89a`。首条及两条后续指令均明确禁止工具调用、文件修改和外部操作，只要求返回固定短句。

- 桌面视口 `1886 × 815`：从列表选择验证 Session，读取用户消息、Agent 回复及 idle 状态；初始回复 `UX_SMOKE_READY` 可见，输入区可用，document 无横向溢出。
- 桌面后续消息：通过生产输入区发送固定回复测试，HTTP 202，command `1804bb5c-08d5-4908-86e7-555e1d06f88f`；`GET /api/commands/<id>` 返回 HTTP 200 且最终状态为 `succeeded`，消息流显示 `UX_DESKTOP_OK`。
- 窄屏视口 `390 × 844`：使用返回列表按钮与 Session 列表重新进入同一会话，既有历史可读取；document 无横向溢出，输入框左右和底部边界均在视口内。
- 窄屏后续消息：通过生产输入区发送第二条固定回复测试，HTTP 202，command `a0f4328f-7f20-46e7-93f2-552cf402e048`；命令查询最终状态为 `succeeded`，消息流显示 `UX_MOBILE_OK`。
- 窄屏补验：使用浏览器原生点击工具再次完成“返回列表 → 选择 Session”，三组 smoke 对话及对应状态仍可见。

验证边界：本次使用桌面浏览器的窄屏视口，不代表实体移动设备或软键盘测试。Playwright 的窄屏自动点击曾在等待稳定状态时超时，但按钮位置、命中检查和原生点击均正常；未将该自动化超时作为产品验证通过的依据。既有发布质量证据见上节，本次未重新部署产品代码。
