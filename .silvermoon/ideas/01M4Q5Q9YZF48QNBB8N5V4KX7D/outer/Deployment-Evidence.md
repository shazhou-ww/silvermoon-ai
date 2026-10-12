# 部署证据

## 发布结果

- 2026-10-12 将包含已验收 Implementation `9b7925bc47f3` 和实现提交
  `1bf8317202a7` 的 primary 以普通快进发布到 `release`
  `95c7d490d8b2`；没有 force push、数据回滚、npm tag 或 npm publish。
- [Check and deploy run 38212258142](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38212258142)
  的 `check` 与 `deploy` jobs 均为 `success`。
- `pnpm check` 中 Protocol 6、Web 71、Connector 30、Worker 33 个测试通过；
  Playwright 175 个测试通过、2 个既有场景跳过；本地 D1 migration 检查通过。
- 生产 D1 无待应用 migration；Worker `silvermoon-relay` 部署版本为
  `a58aa8ad-279d-4a6e-8eac-a0bc389aaad2`。
- Pages 不可变 deployment URL 为
  [1afbda48.silvermoon-work.pages.dev](https://1afbda48.silvermoon-work.pages.dev)。

## 生产匿名探针

- `GET https://silvermoon.work`：200，HTML。
- `GET https://relay.silvermoon.work/health`：200，
  `{"service":"silvermoon-relay","status":"ok"}`。
- 不携带认证且不跟随重定向访问三种生产授权入口，结果如下。记录不包含
  client ID、state、PKCE、nonce、cookie 或其他 OAuth 数据。

| Provider | HTTP | 官方目标 host | `prompt` |
| --- | ---: | --- | --- |
| Google | 302 | `accounts.google.com` | `select_account` |
| Microsoft | 302 | `login.microsoftonline.com` | `select_account` |
| GitHub | 302 | `github.com` | `select_account` |

客户端未持久化响应 cookie、未进入提供商页面，也未执行 callback。三个探针会创建
各自的短期未消费 OAuth transaction，并按现有十分钟期限过期；没有访问或修改真实
账号、设备、Session 或偏好。

这些结果证明已部署 Worker 为三家请求账号选择，但不是用户看到账号选择器、选择
另一账号或进入对应 Relay 账号的真实证据。

## 待用户线上验收

以下项目仍未执行，不能由 URL 探针或单一 provider 的成功替代：

| Provider | 另一现成账号 | 原账号 | 取消/失败 | 桌面/窄屏 | Relay 账号与偏好隔离 |
| --- | --- | --- | --- | --- | --- |
| Google | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 |
| Microsoft | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 |
| GitHub | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 |

真实登录、账号选择、密码与 MFA 由用户操作。验收记录只保留 provider、结果、时间
和未验证边界，不记录账号身份、邮箱、密码、cookie、token、OAuth state 或其他凭据。
结束后应恢复原账号与验证前偏好。
