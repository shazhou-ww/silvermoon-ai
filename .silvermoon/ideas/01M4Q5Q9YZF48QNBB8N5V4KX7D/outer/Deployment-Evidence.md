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

## 用户线上验收

2026-10-12，用户在自己的生产浏览器中逐家操作真实登录、账号选择、密码与
适用的 MFA，并确认以下结果。Agent 未操作共享生产页面中的账号，记录不包含账号
身份、邮箱、密码、偏好内容、cookie、token、OAuth state 或其他凭据。

| Provider | 另一现成账号 | 原账号 | 取消/失败 | 桌面/窄屏 | Relay 账号与偏好隔离 |
| --- | --- | --- | --- | --- | --- |
| Google | 通过 | 通过 | 通过 | 通过 | 通过 |
| Microsoft | 通过 | 通过 | 通过 | 通过 | 通过 |
| GitHub | 通过 | 通过 | 通过 | 通过 | 通过 |

用户分别确认三家都明确显示账号选择，选择另一现成 provider 账号后进入对应 Relay
账号，选择原账号仍进入原 Relay 账号；取消和失败安全返回。此前被阻塞的 Session
视图偏好真实账号隔离也逐家确认正确，没有观察到身份误绑定、自动合并、权限变化或
账号/偏好串用。

验证覆盖桌面与窄屏。用户结束后已恢复原账号与验证前偏好；没有创建测试账号，也未
修改真实账号、设备或 Session 数据。URL 探针与每家真实验证仍作为独立证据保留，
没有用一个 provider 的结果替代另一个 provider。
