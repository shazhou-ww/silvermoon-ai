# Deployment Evidence

## 发布结果

- release commit：`1ad0b56b293129cdcdef035d25d44c24ded3e0b5`
- GitHub Actions：[Check and deploy 38145243518](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38145243518)
- 结果：全仓检查、浏览器测试、D1 迁移、Relay Worker 部署和 Pages 部署全部成功。
- 公开页面：<https://silvermoon.work/>

## 页面证据

- [桌面登录页](./evidence/desktop-login.png)：1440×900，统一 panel 居中，登录卡与长发背影线图向中部靠拢且不重叠，价值点位于 panel 内。
- [移动登录页](./evidence/mobile-login.png)：390×844，登录、线图和能力介绍按顺序单列显示。
- [OAuth 错误状态](./evidence/oauth-error.png)：390×844，错误提示位于登录卡内，三个提供商入口保持可见。

独立 Chromium context 证明 desktop `innerWidth=1440`、mobile `innerWidth=390`；两个视口均加载 `/silvermoon-line-art.svg` 和三个官方 provider 图标，文档级横向溢出均为 `false`。

## OAuth 冒烟验证

在本 idea 首次公开部署验证中，三个公开 start 端点均返回 HTTP 302：

- `/auth/google/start` 跳转到 `accounts.google.com`，callback 为 `https://relay.silvermoon.work/auth/google/callback`。
- `/auth/microsoft/start` 跳转到 `login.microsoftonline.com`，callback 为 `https://relay.silvermoon.work/auth/microsoft/callback`。
- `/auth/github/start` 跳转到 `github.com/login/oauth/authorize`，callback 为 `https://relay.silvermoon.work/auth/github/callback`。

最终部署没有修改认证代码或 OAuth 配置，公开页面仍渲染上述三个精确 start 地址。最终复验时 Google 再次返回 302；随后 Microsoft 和 GitHub 因本会话反复创建 OAuth transaction 命中服务端限流并返回 429。该限流结果被保留为测试环境约束，不冒充提供商跳转成功。

访问 `https://silvermoon.work/?authError=provider-verification-failed` 后，页面显示可操作的登录失败提示，同时保留全部三个入口。
