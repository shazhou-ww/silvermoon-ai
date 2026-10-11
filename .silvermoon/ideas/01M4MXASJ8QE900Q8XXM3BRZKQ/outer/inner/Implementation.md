# Implementation

用户于 2026-10-11 明确授权在独立 worktree 实施，并已接受 `idealRevision=aa8c087780c2`。实施候选已同步到 primary，等待精确实施 revision 的独立验收；尚未授权部署。

## Steps

### I-S01: 接入 Settings 工作区导航

接入右侧 Settings 路由、现有会话链接兼容及窄屏 Session 抽屉，保留原会话暂离配置时的阅读位置。

### I-S02: 简化配置与账户入口

实现 Devices 和 Linked identities 单列模块、同级 inline 创建设备及头像账户菜单；移除浏览器登录管理 UI，保持服务端鉴权规则。

### I-S03: 隔离草稿并验证回归

按账户、设备及 Session 保存标签页草稿，处理缓存故障、异步发送与 profile 离页清理，并验证桌面、手机和窄屏。

## Acceptance criteria

### I-AC01: 导航与响应式布局一致

浏览器测试及实际界面检查证明 Settings 可直达、刷新和前后退，抽屉可访问，布局不溢出且保持单列。

### I-AC02: 配置流程与权限保留

测试证明创建默认收起、Cancel 不发请求、失败保留输入；身份解绑限制及 Sign out 语义保留，浏览器管理列表不再请求。

### I-AC03: 草稿与异步回执可靠

测试证明草稿隔离并跨刷新恢复，失败不丢输入，成功只清源版本，退出后不泄露草稿或迟到的连接 profile；类型、lint、单元测试与构建通过。

代码与验证依据见 [Implementation-Evidence.md](./Implementation-Evidence.md)。ledger 勾选仅记录已完成工作和证明，不代表用户实施验收。
