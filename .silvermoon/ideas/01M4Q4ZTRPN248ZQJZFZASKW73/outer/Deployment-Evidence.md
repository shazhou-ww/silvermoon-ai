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

## D-S02 / D-AC02：真实 canary 发布成功

依据已同步部署 revision `eb91e6530b6a674412f4cd3ac29b955e262f11d5` 执行：

- 仅创建并推送 `npm/connector/v0.2.1-canary.1`。
- remote tag 指向 `9d96370f60e1fd8804a58b3c3c32a1accae40560`，
  推送前确认该 commit 可达刷新后的主线，manifest 准确匹配，tag 与版本此前不存在。
- tag push 触发 [Actions run 38215506558](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38215506558)，
  event 为 `push`，headSha 为上述准确 commit，结果 `success`。
- publish job 于 `2026-10-12T07:01:43Z` 开始、`07:04:02Z` 完成。
  主线可达检查、安装、8 项发布契约测试、依赖图检查及构建、实际 pack、
  runner 外部安装 smoke、OIDC publish、registry byte verification 均成功。
- npm 日志明确使用官方 registry、`canary` 和 public access，并记录成功签署
  GitHub Actions 来源的 provenance。没有添加 npm 长期 token 或执行本地 publish。
  公开 npm 元数据提供 SLSA v1 provenance attestations。
- registry 包元数据首次传播时尚未可见，前六次有明确失败日志；
  有界重试在第七次确认准确版本、频道、完整性和下载字节，与 Actions 候选一致。
  不曾重新发布或移动 tag。

## D-S03 / D-AC03：公开包验证成功，latest 未变化

公开版本为 `@silvermoon-ai/connector@0.2.1-canary.1`，
registry 下载地址：
`https://registry.npmjs.org/@silvermoon-ai/connector/-/connector-0.2.1-canary.1.tgz`。

| 核对项 | 结果 |
| --- | --- |
| 发布前 latest | `0.2.0` |
| 发布后 latest | `0.2.0`，未改变 |
| 发布后 canary | `0.2.1-canary.1` |
| 文件数 / 解包大小 | 14 / 283,256 字节 |
| SHA-256 | `f5f5c1c0c48ae9dd25fa36d56034e3aa5fe244ba7afcf578a0d9ff6ba94fd6ee` |
| npm shasum | `e78ebf49832d9a5d4c72a7b947ffaa0bef6ff575` |
| npm integrity | `sha512-a67CQ1DOo+cxNvIxFBQJcIfxIPc/wd02mFud4fMzEXAZ3tjGIbMVJ9RkWiMmsIuGybUsgz346m8h1tq/48THHQ==` |

SHA-256 和 integrity 分别与 Actions pack 步骤输出逐字一致；
另从官方 registry 下载准确版本 tarball，重新计算 SHA-256 并执行
`verify-published npm/connector/v0.2.1-canary.1`，精确字节和频道检查通过。
本次实际 Actions 产出的包是发布验证基准，不把此前 Windows 本地候选的摘要
冒充本次发布产物。

在 monorepo 外的新目录中使用官方 registry 安装
`@silvermoon-ai/connector@0.2.1-canary.1`（非本地 tarball），
确认安装 manifest 版本；`smoke-npm-package.mjs` 的 CLI `--help`、
root/adapter 运行时入口和消费者 TypeScript 检查全部通过。
仅额外安装消费者开发工具 `@types/node@24`，私有 protocol/rpc 无需安装。
临时公开安装和下载目录验证后清理。

没有发布 latest 版本、修改 latest dist-tag、创建 GitHub Release、登录 Copilot
或运行真实 Relay/agent 会话。本次证明的是授权的 tag/OIDC canary 发布及公开包消费，
不是生产 agent 会话验证。所有部署步骤和标准已有对应证据，可提交现实验收。
