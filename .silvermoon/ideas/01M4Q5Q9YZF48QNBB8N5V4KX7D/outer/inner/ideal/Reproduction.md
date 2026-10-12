# Google、Microsoft 和 GitHub 账号切换问题记录

## Google 已观察到的行为

2026-10-12，在 https://silvermoon.work 的共享内置浏览器中：

1. 登录已有 Relay 账号，并保留浏览器中的 Google 登录状态。
2. 从 Relay 账号菜单 Sign out，回到登录页。
3. 点击 Continue with Google。
4. 用户报告没有出现账号选择机会，而是直接进入一个账号；后续只比较账号相等性，确认返回的是原 Relay 账号。

## Microsoft 与 GitHub 的补充报告

2026-10-12，用户明确订正：“不只是Google登录有问题，Microsoft和GitHub账号登录都有同样的问题。”

因此问题范围包含三种提供商。Microsoft 和 GitHub 当前来源为用户报告，Agent 尚未独立复现其各自流程；后续应分别验证，不将 Google 的复现或授权参数直接当作另两种提供商的证据。

期望：用户通过 Google、Microsoft 或 GitHub 登录时，能够明确切换用于登录的账号，进入现成的另一个 Relay 账号。

## 当前证据与边界

- 当前 [Google 授权 URL 构造](../../../../../../apps/worker/src/oauth.ts) 设置了 scope、state、PKCE、nonce 等参数，但未设置强制账号选择参数。浏览器已有登录状态与这一现象一致；后续需确认修复方案，不将单一参数直接当作完整修复结论。
- 本次临时浏览器拦截尝试未成功完成账号选择；已撤销拦截，未修改产品代码。没有把这些尝试计作成功验收。
- 用户明确要求跳过本次真实账号切换验收，另建本 idea 后续处理。原账号登录及偏好已恢复，见 [原部署证据](../../../../01M4PWVNA4MQ3FKEX986PB8JBV/outer/Deployment-Evidence.md)。
- 当前记录的是三种提供商的登录切换流程问题，不是视图偏好的账号隔离实现失败；三者的根因和所需切换机制仍需分别核实。
- 本记录不保存账号身份、邮箱、Session 内容、cookie、OAuth state 或凭据。
