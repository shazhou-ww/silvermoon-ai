# Deployment

## Steps

### D-S01: 兼容发布原生联动能力

确定实际最低支持的 VS Code/Connector 版本、协议兼容性及必要迁移，沿既有发布流程交付，旧 Connector 禁用联动而不是静默降级为 Relay-only。Connector npm 发布需走仓库发布流程和适用授权，不将 Web 部署自动等同 npm 发布。保留旧标记及历史，不批量下发原生归档，明确回滚不会撤销已确认的本机动作。

本轮准确发布授权为 **@silvermoon-ai/connector@0.2.1 / latest / npm/connector/v0.2.1**，仅该不可变 tag 经现有 Trusted Publishing workflow 发布；baseline latest=0.2.0、canary=0.2.1-canary.1。先冻结并验收准确 Inner，同步本部署合同，再发布 npm 并核对公网安装、完整性与 provenance；随后按既有 release 分支流水线部署 Web/Worker 和 remote D1 0013。已验证实际 VS Code 1.141.0 / AHP 0.10.0，现有 provider 兼容范围 0.10.x / 1.x，未知或旧来源必须由当前连接能力门控，不宣称所有更老 VS Code 版本都可用。

### D-S02: 提供真实联动验收入口

核对生产部署、能力门控和认证边界，提供升级步骤与专用 Session 验收路径。用户在本机和手机检查 Relay Done/Restore 以及本机手动操作后的双向结果；离线/不支持项应禁用。本机原生操作可能影响 worktree及已读/子项，只在用户明确授权的专用 Session 上验证，不擅自操作真实工作 Session。[Evidence.md](Evidence.md) 分开记录当前原生交付与旧版独立标记的历史部署。

升级保留原 secure profile：停止旧 Connector，启动 `npx --yes @silvermoon-ai/connector@0.2.1 --working-directory .`，不要同 token 双开，刷新至新 inventory 确认。用户已授权专用测试 Session，可沿用该测试项；生产账户的设备、token 或浏览器凭据仍不能擅自读取/使用。仅当具备授权的实际账户访问时执行生产写入；否则提供专用 Session 的手机/本机验收路径，分别记录已执行的本机原生证据与未执行的生产写入，不把 health 或未认证 401 当作联动证明。

## Acceptance criteria

### D-AC01: 兼容交付与升级明确

发布及必要迁移通过，生产 Web/Worker 与受支持 Connector 可用，最低版本和升级流程可执行；旧设备不伪装联动成功，旧标记不产生批量归档命令。以实际发布、能力与兼容测试结果证明。

### D-AC02: 双向原生联动可线上验收

提供真实专用 Session 的手机/本机 Done与 Restore 验收步骤和实际证据/未执行项。确认本机状态与 Relay 一致、恢复可达、原生副作用及离线行为明确，不把 health 或静态资产检查当作原生操作证明；最终 acceptOuter 仍由用户决定。
