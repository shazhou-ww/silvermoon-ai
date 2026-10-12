# Deployment

## Steps

### D-S01: 兼容发布原生联动能力

确定实际最低支持的 VS Code/Connector 版本、协议兼容性及必要迁移，沿既有发布流程交付，旧 Connector 禁用联动而不是静默降级为 Relay-only。Connector npm 发布需走仓库发布流程和适用授权，不将 Web 部署自动等同 npm 发布。保留旧标记及历史，不批量下发原生归档，明确回滚不会撤销已确认的本机动作。

### D-S02: 提供真实联动验收入口

核对生产部署、能力门控和认证边界，提供升级步骤与专用 Session 验收路径。用户在本机和手机检查 Relay Done/Restore 以及本机手动操作后的双向结果；离线/不支持项应禁用。本机原生操作可能影响 worktree及已读/子项，只在用户明确授权的专用 Session 上验证，不擅自操作真实工作 Session。现有 [Evidence.md](Evidence.md) 仅是独立标记版本的历史部署。

## Acceptance criteria

### D-AC01: 兼容交付与升级明确

发布及必要迁移通过，生产 Web/Worker 与受支持 Connector 可用，最低版本和升级流程可执行；旧设备不伪装联动成功，旧标记不产生批量归档命令。以实际发布、能力与兼容测试结果证明。

### D-AC02: 双向原生联动可线上验收

提供真实专用 Session 的手机/本机 Done与 Restore 验收步骤和实际证据/未执行项。确认本机状态与 Relay 一致、恢复可达、原生副作用及离线行为明确，不把 health 或静态资产检查当作原生操作证明；最终 acceptOuter 仍由用户决定。
