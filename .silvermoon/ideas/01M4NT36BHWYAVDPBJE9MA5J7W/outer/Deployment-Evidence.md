# 部署证据

## 发布

- 目标：Cloudflare Worker `silvermoon-relay`
- 生产域名：`relay.silvermoon.work`
- Worker Version ID：`d9ba4f87-5423-441a-b5cf-a9fe7af05539`
- 发布时间：2026-10-11 16:17 UTC
- 发布内容：OAuth transaction 过期时间比较修复
- 数据操作：未运行 D1 schema 或数据迁移，未修改或删除已有 transaction

## 外部验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Relay 健康状态 | 通过 | `GET /health` 返回 200 和 `{"service":"silvermoon-relay","status":"ok"}` |
| GitHub OAuth 启动 | 通过 | `GET /auth/github/start` 返回 302，`Location` 指向 `github.com/login/oauth/authorize` |
| 过期记录判断 | 通过 | 只读 D1 查询显示文本比较会误计 13 条，但 `datetime(expires_at)` 只识别 1 条真实有效记录 |
| 历史过期记录 | 通过 | 27 条未消费记录已真实过期，不再阻止 OAuth 启动 |
| 数据只读核验 | 通过 | D1 查询元数据显示 `rows_written=0`、`changed_db=false` |

生产 OAuth 验证请求创建了 1 条新的正常有效 transaction；这是启动流程的预期行为，不是数据迁移。
