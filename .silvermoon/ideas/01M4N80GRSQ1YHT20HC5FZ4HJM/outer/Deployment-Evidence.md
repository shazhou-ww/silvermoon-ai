# Deployment Evidence

## 发布结果

- release commit：`6699772150afeecaf096ecef1a3f17434738b7b9`
- GitHub Actions：[Check and deploy 38138941801](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38138941801)
- 结果：全仓检查、浏览器测试、D1 迁移、Relay Worker 部署和 Pages 部署全部成功。
- 公开页面：<https://silvermoon.work/>

## 页面证据

- [桌面登录页](./evidence/desktop-login.png)：1440×900，登录卡位于左侧，银月完整位于右侧，能力介绍处于首屏且无横向溢出。
- [移动登录页](./evidence/mobile-login.png)：390×844，登录、人物和能力介绍按顺序单列显示，素材加载完成且无横向溢出。
- [OAuth 错误状态](./evidence/oauth-error.png)：390×844，错误提示位于登录卡内，三个提供商入口保持可用。

独立 Chromium context 报告 desktop `innerWidth=1440`、mobile `innerWidth=390`；两个视口的文档级横向溢出均为 `false`，银月图片 `naturalWidth=768`。

## OAuth 冒烟验证

公开 start 端点均返回 HTTP 302：

- `/auth/google/start` 跳转到 `accounts.google.com`，callback 为 `https://relay.silvermoon.work/auth/google/callback`。
- `/auth/microsoft/start` 跳转到 `login.microsoftonline.com`，callback 为 `https://relay.silvermoon.work/auth/microsoft/callback`。
- `/auth/github/start` 跳转到 `github.com/login/oauth/authorize`，callback 为 `https://relay.silvermoon.work/auth/github/callback`。

访问 `https://silvermoon.work/?authError=provider-verification-failed` 后，页面显示可操作的登录失败提示，同时保留全部三个入口。
