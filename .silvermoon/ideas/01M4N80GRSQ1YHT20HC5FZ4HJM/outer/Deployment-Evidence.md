# Deployment Evidence

## 发布结果

- release commit：`220af0adf4982bf909132e7d28826865a71fff56`
- GitHub Actions：[Check and deploy 38149527216](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38149527216)
- 结果：全仓检查、浏览器测试、D1 迁移、Relay Worker 部署和 Pages 部署全部成功。
- 公开页面：<https://silvermoon.work/>

## 页面证据

- [桌面登录页](./evidence/desktop-login.png)：1440×900，统一 panel 居中，登录卡与金属线图向中部靠拢且不重叠。
- [过渡宽度登录页](./evidence/transition-login.png)：900×900，保持左右两栏，登录卡与线图中心线偏差约 0.008px。
- [移动登录页](./evidence/mobile-login.png)：390×844，线图隐藏且不占空间。
- [OAuth 错误状态](./evidence/oauth-error.png)：390×844，错误提示位于登录卡内，三个提供商入口保持可见。

独立 Chromium context 还验证了 1000px 与 761px 保持两栏且中心线偏差约 0.008px；760px 与共享页面所用 553px 均隐藏线图区。所有检查视口的文档级横向溢出均为 `false`。

## OAuth 冒烟验证

本 idea 的公开验证已证明三个 start 端点均使用正确地址和 callback：

- `/auth/google/start` 指向 `accounts.google.com`，callback 为 `https://relay.silvermoon.work/auth/google/callback`。
- `/auth/microsoft/start` 指向 `login.microsoftonline.com`，callback 为 `https://relay.silvermoon.work/auth/microsoft/callback`。
- `/auth/github/start` 指向 `github.com/login/oauth/authorize`，callback 为 `https://relay.silvermoon.work/auth/github/callback`。

最终实现没有修改认证代码或 OAuth 配置，公开页面继续渲染上述三个精确 start 地址。重复冒烟曾触发服务端 429 限流，该测试环境约束不被冒充为提供商跳转成功。

访问 `https://silvermoon.work/?authError=provider-verification-failed` 后，页面显示可操作的失败提示，同时保留全部三个入口。
