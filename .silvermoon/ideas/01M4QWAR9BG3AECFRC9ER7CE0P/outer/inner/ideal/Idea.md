# 以 AHP 统一 Connector Session 控制面

## 问题

Connector 同时把 Copilot SDK 与 Agent Host 目录作为 Relay Session 来源；二者为同一逻辑工作分配不同 ID，且 SDK 历史目录没有执行状态，造成重复行、`Execution state unknown` 与操作路径分裂。详见[调查证据](./Investigation.md)、[UI 对比](./ui-review/index.html)与[业务数据模型评审](./Business-Data-Model-Review.md)。

## 结果

移除 Connector 对 Copilot SDK 的直接运行时依赖，以 Agent Host Protocol（AHP）作为 Session 列表、身份、创建、消息、历史、实时状态、事件与原生归档的唯一控制面；Relay 只接收 AHP Session URI 派生的身份。

## 边界

- Agent Host 不可用时显式报告 offline 或操作失败，不切换到 Copilot SDK namespace。
- 不以标题、时间、消息或工作区推断身份，也不配对两套历史 ID。
- 旧 Relay Session 与事件暂不回填、合并或删除；本方向只停止产生新的 SDK 投影。

## 验收标准

- Connector 运行时与依赖清单不再引用 Copilot SDK，所有 Session 操作和事件均通过 AHP。
- 新同步的 Session 只有 AHP 身份，不再因 SDK metadata 产生重复 `unknown` 行。
- Agent Host 不可用、重连及旧 Relay 数据保留行为有明确测试与生产验证。
