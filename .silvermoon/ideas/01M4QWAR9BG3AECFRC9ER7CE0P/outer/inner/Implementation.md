# Implementation

## Steps

### I-S01: 将 AHP provider 提升为完整 adapter

让 Agent Host provider 独立实现 Session inventory、create、send、history、实时事件、状态、输入请求与原生 archive；以规范化 AHP Session URI 和稳定 Host 路由身份承载 Session ID。

### I-S02: 移除 Copilot SDK 控制面

删除 Connector 对 `@github/copilot-sdk` 的运行时依赖及 metadata inventory、create、resume、send、history 和 event fallback。Agent Host 不可用或 URI 不存在时显式失败，不切换 namespace。

### I-S03: 固化 Relay 兼容性与旧数据边界

调整 Connector/协议测试、配置与文档，证明新同步只产生 AHP 行；保持 Relay schema、既有行与事件不变，不实现旧 ID 配对或清理。

## Acceptance criteria

### I-AC01: 单一 AHP 身份

自动化测试证明 list 与所有命令只使用 AHP Session 身份；相同逻辑工作不会再因 SDK metadata 产生第二条新 Session。

### I-AC02: 完整能力与显式失败

测试覆盖 create、send、history、status、event、input 与 archive；Agent Host 断开或目标 URI 缺失时得到明确 offline/error，且没有 SDK fallback。

### I-AC03: 依赖与兼容性收敛

Connector manifest、源码和构建产物不再引用 Copilot SDK；connector、protocol、worker 与 web 的针对性测试通过，既有 Relay 数据未被迁移或删除。
