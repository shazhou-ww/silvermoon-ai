# Deployment

本契约为后续部署计划，不是发布授权。部署阶段需先将细化后的契约同步主线，
再依据其稳定 revision 执行验证。[发布指南](../../../../docs/npm-package-releases.md)
列出账户配置与操作要求；不得将 local pack 或 smoke 当作真实发布证据。

## Steps

### D-S01: 确认外部发布前提

在实施验收后，由有权限的维护者配置并确认 npm Trusted Publisher、GitHub npm environment、发布 tag 规则和主线保护；只记录非敏感配置证据，不代办授权流。

### D-S02: 执行另行授权的首发

获得具体包、版本和发布 tag 的明确授权，确认新版本未发布且匹配主线 manifest，再按发布指南触发工作流；未获授权时保持等待，不创建或推送发布 tag。

### D-S03: 验证公开发布结果

记录 Actions run、tag 与 commit 及公开 npm 元数据，验证 registry 包字节、频道和公开安装；明确失败或未完成的外部结果。

## Acceptance criteria

### D-AC01: 外部身份与保护一致

以维护者确认和可只读观察的设置证明 Trusted Publisher 对应正确仓库、工作流和 environment，发布 tag 及主线具备预期保护，不保存任何凭据。

### D-AC02: 真实 OIDC 发布成功

以另行授权记录和 GitHub Actions run 证明指定 tag 从主线触发，验证步骤通过，npm 通过 OIDC 接受准确包与版本，不依赖长期 npm token。

### D-AC03: 公开包与候选一致

以发布后 registry 校验和独立公开安装证明版本、dist-tag、完整性及 tarball 字节匹配候选，CLI 与公开入口可用；本结果不宣称真实 Copilot 或 Relay 会话已验证。
