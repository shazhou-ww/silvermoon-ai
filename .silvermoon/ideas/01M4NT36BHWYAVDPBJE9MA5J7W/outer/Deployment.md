# Deployment

## Steps

### D-S01: 发布 Relay Worker

将通过验证的查询修复部署到生产 `silvermoon-relay`，不执行 D1 schema 或数据迁移。

### D-S02: 验证生产过期行为

通过只读 D1 查询和 OAuth 启动请求确认实际已过期事务不再导致错误限流。

## Acceptance criteria

### D-AC01: 生产 OAuth 启动恢复

存在十条文本比较误判但实际过期的记录时，生产 GitHub OAuth 启动端点不再返回 `oauth-rate-limit`；以 HTTP 响应为证。

### D-AC02: 生产数据无需改写

部署过程中没有修改或删除已有 OAuth transaction；以部署记录和 D1 只读核验结果为证。

### D-AC03: Relay 健康状态正常

部署后 Relay 健康端点正常，OAuth 启动能重定向到提供方；以生产 HTTP 状态和 `Location` 响应头为证。
