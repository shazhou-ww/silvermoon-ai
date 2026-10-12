# Deployment

## Steps

### D-S01: 兼容发布工作状态支持

通过既有发布路径先交付兼容的持久化与 API，再交付 Web 交互；不要求升级 Connector。发布顺序与回滚需保留用户已保存的标记。

### D-S02: 补验生产双向操作

使用真实账户的专用 Session 在桌面和窄屏完成标记、历史读取、Reactivate、刷新与跨浏览器检查，不操作其他账户或真实工作会话。

## Acceptance criteria

### D-AC01: 兼容部署成功

以迁移、CI 和部署结果证明旧 Connector 继续同步，既有 Session 与历史无丢失，回滚旧 Web 不删除新状态。

### D-AC02: 生产工作状态可逆

生产 smoke 证明完成项默认隐藏、可重新显示、Reactivate 恢复列表，状态在刷新和同步后保留，真实执行能力限制仍有效。
