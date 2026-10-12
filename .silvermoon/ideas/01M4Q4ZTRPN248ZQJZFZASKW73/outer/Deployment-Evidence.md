# canary 部署前提观察

## 观察对象与边界

实施验收已同步到 primary `adeba45af6f655057a2c3fa094252f92eec1a33f`。
2026-10-12 针对已同步的部署 revision
`102fbc9fe7fdc3852acaf903a3613e3ae76ea7c0` 执行只读外部前提观察。
本次没有配置账户授权、修改仓库设置、创建发布 tag 或发布包。

## D-S01 / D-AC01：尚未满足的前提

GitHub API 返回：

- `repos/shazhou-ww/silvermoon-ai/environments`：`total_count=0`，尚无 `npm` environment。
- `repos/shazhou-ww/silvermoon-ai/rulesets`：空列表，尚无可观察到的发布 tag ruleset。
- `repos/shazhou-ww/silvermoon-ai/branches/main/protection`：HTTP 404，
  明确返回 `Branch not protected`。

npm Trusted Publisher 不能通过这些公开 registry 查询确认，须由包管理员在
npmjs 上完成并确认。配置应为 GitHub Actions，user `shazhou-ww`、
repository `silvermoon-ai`、workflow `publish-npm.yml`、environment `npm`，
允许直接发布；latest 与 canary 共用该授权，不需要 token。
新配置须在两天内首次成功发布，过期时应重新创建，不使用长期 token 绕过。

在外部配置完成并确认前，D-S01 与 D-AC01 均不完成，停止首发操作。

## D-S02 / D-S03：registry 暂定基线

官方 registry 只读查询结果：

- `latest`：`0.2.0`。
- 未设置 `canary` dist-tag。
- 已发布版本：`0.0.0-stage`、`0.1.0`、`0.2.0`。

该基线仅为前提观察，正式发布前必须重新读取并保存 latest 值。
尚未确认具体未发布 canary 版本/tag，也未完成对应主线 manifest 准备。
本次没有首发 Actions run、真实 OIDC 发布或公开 canary 安装结果；
部署执行及验收条目全部保持未勾选，不提交 submitOuter。

## 后续用户确认与执行边界

用户确认已按要求完成 npm Trusted Publisher，并授权 Agent 应用部署契约中
列出的最小 GitHub 保护方案。npm 配置属于维护者确认，真实 OIDC 接受仍待
canary 发布验证；此授权只涵盖 GitHub environment 与保护规则，不涵盖具体
canary 版本选择、版本修改或发布 tag 创建。
