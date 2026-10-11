# Implementation

用户已接受 `idealRevision=aa8c087780c2` 及此前实施 revision `601b5e0e6a22`。生产验证发现 `/settings` 刷新被重定向至首页，用户于 2026-10-11 授权修复路由，发布另行确认；本修订须重新独立验收。

## Steps

### I-S01: 接入 Settings 工作区导航

接入右侧 Settings 路由、现有会话链接兼容及窄屏 Session 抽屉，保留原会话暂离配置时的阅读位置。

静态发布采用 Cloudflare Pages 原生 SPA fallback，移除触发生产 canonical redirect 的 `/settings /index.html 200` 规则；不新增路由或改变 URL。

### I-S02: 简化配置与账户入口

实现 Devices 和 Linked identities 单列模块、同级 inline 创建设备及头像账户菜单；移除浏览器登录管理 UI，保持服务端鉴权规则。

### I-S03: 隔离草稿并验证回归

按账户、设备及 Session 保存标签页草稿，处理缓存故障、异步发送与 profile 离页清理，并验证桌面、手机和窄屏。

## Acceptance criteria

### I-AC01: 导航与响应式布局一致

浏览器测试及实际界面检查证明 Settings 可直达、刷新和前后退，抽屉可访问，布局不溢出且保持单列。

回归须断言规范路径 `/settings` 无 HTTP 重定向并保留 Session query，刷新后仍为 Settings；检查发布产物不含禁用原生 SPA fallback 的配置。本地检查不代替授权发布后的生产验证。

### I-AC02: 配置流程与权限保留

测试证明创建默认收起、Cancel 不发请求、失败保留输入；身份解绑限制及 Sign out 语义保留，浏览器管理列表不再请求。

### I-AC03: 草稿与异步回执可靠

测试证明草稿隔离并跨刷新恢复，失败不丢输入，成功只清源版本，退出后不泄露草稿或迟到的连接 profile；类型、lint、单元测试与构建通过。

代码与验证依据见 [Implementation-Evidence.md](./Implementation-Evidence.md)。ledger 勾选仅记录已完成工作和证明，不代表用户实施验收。
