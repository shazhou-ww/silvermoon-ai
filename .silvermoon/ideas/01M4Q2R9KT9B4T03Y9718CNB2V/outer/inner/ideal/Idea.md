# 从 Relay 完成并重新激活 Session

## 问题

Relay 可以显示 Agent 的执行状态和原生归档状态，但用户不能在 Relay 中把已处理的 Session 标记为完成，也无法重新激活它。工作是否结束与 Agent 当前是否运行因此混在一起，已完成的工作仍占据日常列表。

## 结果

用户可在 Relay 标记 Session 为 Completed，并通过显示已完成项查看历史、执行 Reactivate，让它重新回到日常列表。该标记属于账户下的 Relay 工作状态，与 Agent 执行状态独立，跨浏览器和设备保持一致。支持材料：[UI 对比](./ui-review/index.html)、[业务模型评审](./Business-Data-Model-Review.md)。

## 边界

- 完成不停止 Agent、不删除消息、不修改原机器的归档状态；已完成项先 Reactivate 再发新指令，恢复不自动发送消息或解除原生只读。
- 只管理当前账户拥有的指定 Session，设备仅离线时也可操作；已移除设备的历史保持只读，Reactivate 不恢复设备访问，父子 Session 不级联变更。
- 当前准备候选采用 Relay 独立标记；同步 VS Code/Copilot 原生归档不在本次范围。

## 验收标准

- 标记完成后默认日常列表隐藏该 Session；显示已完成项时可读取历史，并区分 Completed 与实际执行状态。
- Reactivate 后恢复为未完成；列表仍遵守已结束、不可用、离线等筛选，继续对话仍遵守现有能力和原生只读限制。
- 状态变更明确显示成功或失败，刷新、重连与跨浏览器读取不会被 Connector 的执行状态更新覆盖。
