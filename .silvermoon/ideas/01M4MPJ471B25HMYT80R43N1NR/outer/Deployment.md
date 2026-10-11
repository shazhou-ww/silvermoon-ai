# Deployment

## Steps

### D-S01: 验证真实 Done 生命周期

在真实 VS Code Agent Host 中对测试 Session 执行 Done 与恢复，核对同一 Session ID 的 native status、发送能力和历史内容稳定性。

### D-S02: 验证生产链路兼容性

在已部署 Worker/Web 与最新 main connector 组合中验证已有 events、首次补同步和失败重试；使用受控 adapter 制造 history loader 失败，不直接修改生产数据库。

## Acceptance criteria

### D-AC01: Done 后活动可回看

真实环境证据显示 Session 点击 Done 后不可继续发送，但 Done 前已落库和可补读的 activities 均可查看。

### D-AC02: 失败状态可诊断

断开 connector 或制造 history command 失败时，已存 events 仍显示，界面给出明确失败状态和有效重试路径。

外部验证记录见 [Deployment-Evidence.md](./Deployment-Evidence.md)。
