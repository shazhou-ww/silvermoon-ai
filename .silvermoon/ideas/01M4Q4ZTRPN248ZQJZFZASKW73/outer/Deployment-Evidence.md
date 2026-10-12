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

## D-S01 / D-AC01：已配置并回读确认

依据已同步部署 revision `9a3d8f583aeff6308e566310c5c95790678d92d2`，
在用户明确确认方案后应用以下外部设置，并通过 GitHub API 回读核对：

| 设置 | 公开标识 | 实际结果 |
| --- | --- | --- |
| `npm` environment | policy `62745916` | custom deployment policy；唯一条目 `npm/*/*`，type 为 `tag`，无 branch 条目或 reviewer |
| main 历史保护 | ruleset `24908461` | active；仅 `refs/heads/main`；禁止 non-fast-forward 和删除，无 bypass |
| npm tag 创建限制 | ruleset `24908462` | active；`refs/tags/npm/**`；creation 限制，仅 User `242885595`（`shazhou-ww`）always bypass |
| npm tag 不可变 | ruleset `24908463` | active；`refs/tags/npm/**`；update/deletion 限制，无 bypass |

`rules/branches/main` 返回两条有效规则，来源均为 `24908461`。
发布工作流 `publish-npm.yml` 状态为 `active`。
没有添加 required PR、required checks、deploy key 或 npm credential。
主线普通非 force push 路径保持不变。npm Trusted Publisher 身份由用户确认；
OIDC 是否被 npm 实际接受仍不视为已证明。

D-S01 / D-AC01 的配置前提已满足。随后 registry 查询仍为
`latest=0.2.0`，无 canary。Connector 当前 manifest 为 `0.1.0`，不能作为新发布版本。
下一步等待具体未发布 canary 版本/tag 与版本准备的明确授权；在此之前不创建 tag，
不执行发布，也不勾选真实发布及公开包验证条目。

## 准确 canary 发布授权

2026-10-12，用户接受 `implementationRevision=fece879ca6dc`；
对应 acceptInner 已同步到 commit `9d96370f60e1fd8804a58b3c3c32a1accae40560`。
随后用户通过聚焦确认明确授权创建并推送
`npm/connector/v0.2.1-canary.1`，经 GitHub Actions 真实发布并验证
`@silvermoon-ai/connector@0.2.1-canary.1` 的 canary，不发布 latest。

授权前只读预检：准确版本规划输出 `dist_tag=canary`，registry 尚无该版本，
remote 无该 tag；latest 为 `0.2.0`，npm environment 与三项 active ruleset 仍有效。
本节记录授权与基线，不表示发布已执行或成功。
