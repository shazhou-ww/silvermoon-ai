# Deployment

## Steps

### D-S01: 兼容发布工作状态支持

将已同步主线的候选以普通非 force push 推进到 release，使用现有 Check and deploy 流水线。完整 check、浏览器回归和本地迁移通过后，依次应用 remote D1 迁移、部署 Worker、部署 Pages；不要求升级 Connector。0012 为既有 Session 添加默认 open 的工作标记，Connector 不拥有该字段。记录 release commit、run、迁移和部署结果。

如需回滚，优先回滚 Web，必要时回滚 Worker；保留已增加的列和用户保存的标记，不执行 DROP COLUMN、不回滚真实数据。旧客户端忽略工作标记，不以旧客户端可发送 completed Session 作为新功能的安全保证。

### D-S02: 准备线上验收入口

用户已明确免去再次实现验收并授权完成后直接部署，最终在线上验收 Deployment。Agent 核对线上 health、Web 构建资产与 work-state API 的未认证边界，交付生产入口和专用 Session 验收步骤；不提取账户凭据、不修改真实工作 Session，也不将本地 mock 或只读线上检查称为真实账户双向 smoke。

用户可选择自己的专用测试 Session，在桌面与窄屏点击行尾完成 glyph，确认默认隐藏、Show completed 可读历史且禁止发送；点击 Reactivate，确认恢复工作列表但不自动发消息、不解除原生归档。刷新或从另一浏览器登录同一账户，确认标记保留；原有在线、能力和筛选限制仍适用。此真实账户检查由用户在最终部署验收时执行。

## Acceptance criteria

### D-AC01: 兼容部署成功

release 流水线的完整检查、本地与 remote 迁移、Worker 和 Pages 部署均成功，线上服务可访问。以迁移 SQL、库存/事件不覆盖标记的回归与实际发布记录证明兼容路径；只读生产检查不声称已逐一核查真实账户的全部历史或 Connector。回滚不删除新状态的策略明确。

### D-AC02: 上线验收准备就绪

线上 Web 资产包含已验证的完成、Show completed 与 Reactivate 交互，未认证状态修改被拒绝；完整浏览器回归证明默认隐藏、重新显示、恢复、刷新读取及执行限制。生产入口、上述真实账户验收步骤和未执行的操作均如实记录在 [Evidence.md](Evidence.md)，便于用户最终线上验收；该准备标准不替代用户的真实账户验证或 acceptOuter。
