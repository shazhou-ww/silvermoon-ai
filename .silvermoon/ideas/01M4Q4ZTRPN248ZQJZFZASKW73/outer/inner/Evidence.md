# npm 自动发布实施证据

## 复核范围

2026-10-12 在构想验收同步后的提交
`425a26e7aeb3582ba64f38fd192f90fddd6cc411` 上重新验证已入主线的实现。
实现来源提交为 `74560a2`；未修改参考仓库，未更改 Connector 版本，
未创建或推送发布 tag、执行 npm 发布或配置外部账户。

参考仓库实际发布流程采用 `npm/<release-key>/v<version>`、npm environment、
Node 24、npm 11.6.2 与 OIDC。此次复用这些方式，但不引入其 daily canary、
deploy key、恢复特例或自动 GitHub Release。

## I-AC01：发布指令与信任边界

[工作流](../../../../../.github/workflows/publish-npm.yml)与
[发布脚本](../../../../../scripts/npm-release.mjs)的复核结果：

- 仅 `npm/**` tag push 触发；只接受公开 Connector 的精确匹配版本。
  未知 key、旧式 tag、版本不一致、非规范版本、私有包和非官方 registry 均拒绝。
- 发布前刷新主线并检查 commit 可达；官方 Actions 使用完整 SHA 固定，
  checkout 不保留凭据，权限仅 `contents: read` 和 `id-token: write`。
- `npm` environment 和 tag/main 保护须由管理员配置；代码检查不能替代
  tag 保护。PR 不触发发布，无 npm write token 或凭据 artifact。
- 全部发布共享并发组且不取消运行中的发布；已存在版本明确失败，不重发或修改
  dist-tag。外部竞态由 npm 的版本不可变性拒绝重复发布。
- 真实执行 `plan npm/unknown/v0.1.0` 与 `plan npm/connector/v0.1.0`：
  前者报告 tag 格式错误，后者查询官方 registry 后报告版本已存在，
  两者均非零退出；未尝试发布。

## I-AC02：验证命令与结果

| 检查 | 结果 |
| --- | --- |
| `pnpm test:release` | 8 项通过；覆盖触发规则、版本、认证边界、registry 错误、重复发布、实际 tarball 和发布后字节核对 |
| `pnpm lint` | 通过；仅既有 web button/badge 的两处 Fast Refresh warning |
| `pnpm --filter @silvermoon-ai/connector... typecheck` | protocol、rpc、connector 全部通过 |
| `pnpm --filter @silvermoon-ai/connector... --if-present test` | protocol 5 项、connector 29 项通过；connector 1 项既有测试跳过 |
| `pnpm --filter @silvermoon-ai/connector... build` | 依赖图构建通过，Connector JavaScript 和类型声明产出成功 |
| `npm pack` 与 `verify-pack` | 实际 manifest、必需入口、CLI shebang、私有导入和摘要校验通过 |
| 外部干净目录安装实际 tarball 与 `smoke-npm-package.mjs` | CLI `--help`、root/adapter 运行时入口、消费者 TypeScript 检查通过 |

实际输出 `@silvermoon-ai/connector@0.1.0` 仅作为本地验证候选，不是新发版：

- 14 个文件；压缩 64,404 字节；解包 290,273 字节。
- SHA-256：`219e7fcb1dca3c581d3d286339a3e255fac5e60bc71565d618eff31de5eadaf5`。
- integrity：`sha512-dM+fj8QcN18w38llgR3TJALJSjHCSNNf+pyawmTrvZEw+uO0vGKM6lAAlpDwswmoJ5VtFi1aISd2Iht8HMUXFA==`。

安装位于 monorepo 外部，仅安装 tarball 的公开运行时依赖和消费者开发工具
`@types/node@24`。私有 protocol/rpc 不作为消费者依赖安装。
消费者检查沿用仓库 `ESNext.Disposable`、`skipLibCheck`，不检查上游声明体；
独立 tarball 校验仍检查运行时代码和声明中的私有导入。该 smoke 不登录 Copilot、
不连接 Relay、不运行真实 agent 会话。临时包和消费者目录在验证后清理。

## I-AC03：维护说明与验证边界

[发布指南](../../../../../docs/npm-package-releases.md)及 root/Connector README
已覆盖准确 tag、官方 registry、OIDC 一次性配置、最小权限、主线/tag 信任边界、
并发排队限制、重复及部分成功的处理方式，以及维护者打 tag 和推 tag 的步骤。
发布契约测试已接入 root `test`，常规 CI 会运行，不依赖一次性手工验证。

本次结果仅证明源码契约和本地输出包；没有真实验证 GitHub-hosted tag run、
npm Trusted Publisher 授权或 provenance 发布。发布后检查已以测试输入验证
版本、频道、完整性和精确字节要求，但不是实际 registry 首发证据。
这些外部结果继续按[部署计划](../Deployment.md)追踪，部署条目全部未勾选。

## latest / canary 评审反馈

用户于 2026-10-12 明确选择维护者打 tag 的方式，不增加每日 canary 自动化。
现有 `releasePlan` 对稳定版本返回 `latest`，对
`1.2.3-canary.42.g0123456789ab` 返回 `canary`；两者均要求精确匹配 manifest。
已有发布契约测试覆盖该双频道映射，工作流将该输出作为显式 `--tag` 参数。
本次按反馈补充契约和维护说明，不需要修改发布算法。

真实外部验收限定为 canary，需记录并核对 latest 前后不变；latest
仅以源码与测试验证支持，不执行稳定发版。该要求不代表具体 canary 版本/tag
已经选定，也不代表 npmjs 或 GitHub 授权已配置。

## 授权的 0.2.1-canary.1 候选准备

后续用户明确授权仅准备 `0.2.1-canary.1`，未授权本步骤创建/推送 tag 或发布。
GitHub 配置的独立验证记录见[部署证据](../Deployment-Evidence.md)。
本次代码变化只有 Connector manifest 版本从 `0.1.0` 改为
`0.2.1-canary.1`，未改变运行时、依赖、打包方式或 latest 使用示例。

2026-10-12 重新执行并通过：

- `pnpm install --frozen-lockfile`：锁文件保持一致；无新增依赖。
- `pnpm test:release`：8 项通过。
- `node scripts/npm-release.mjs plan npm/connector/v0.2.1-canary.1`：
  官方 registry 预检通过，输出 package_directory 为 `packages/connector`、
  version 为 `0.2.1-canary.1`、dist_tag 为 `canary`。
- Connector 构建通过；以 npm 11.6.2 对该版本实际 pack 并执行 verify-pack，
  manifest 和准确 tag 匹配，必需文件、私有导入、摘要验证通过。
- monorepo 外干净安装实际 tarball，仅增加消费者工具 `@types/node@24`；
  CLI、root/adapter 导出和消费者声明使用检查通过。
- `pnpm lint`、`git diff --check` 通过；lint 仍只有两处既有 UI warning。

本次输出包为 14 文件、压缩 64,408 字节、解包 290,282 字节：

- SHA-256：`2ef794d5eb1ee0a01d13ae8e68654ece4c5a83ab668a26a37a5d4ebba3a8fd73`。
- integrity：`sha512-KLLWdO5Cxf1FpcWUwRf6B0WWeEHykM7D+6oZOqPw5hfgjpDeda4tJVorRSHm/W6Dq0p9eYXNTVtxYxulo2FIiQ==`。

registry 只读观察仍为 `latest=0.2.0` 且无 canary，未执行真实发布。
临时 tarball 和安装目录验证后清理；准确版本的实现候选需重新 submitInner/acceptInner，
之后才能继续部署及单独确认具体发布 tag 的操作授权。
