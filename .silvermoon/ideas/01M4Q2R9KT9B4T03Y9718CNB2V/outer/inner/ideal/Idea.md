# 从 Relay 完成并重新激活 Session

## 问题

Relay 的完成 / Reactivate 目前只改变独立工作标记，本机 VS Code 不会随之 Done / Restore，导致用户在手机与本机看到不一致的工作状态。

## 结果

对于确认支持能力的 VS Code Session，Relay 完成 / Reactivate 联动原生 Done / Restore；以本机确认的原生状态为准双向同步，本机操作也反映到 Relay。保留列表与详情顶部 glyph、至少 44 × 44 CSS px 的手机触控区，不在正文增加大按钮。支持材料：[UI 对比](./ui-review/index.html)、[业务模型评审](./Business-Data-Model-Review.md)。

## 边界

- Done / Restore 即 VS Code 原生归档 / 取消归档，不等于 Agent 执行结束；不发送消息、不由 Relay 主动停止 Agent 或删除历史。原生操作可能影响附加 worktree 生命周期、已读标记及父子只读，必须遵守本机语义，不能承诺原生副作用完全不存在。
- 仅当前账户的指定、在线且已确认能力的 VS Code Session 可操作；离线、旧 Connector 或不支持的来源禁用并说明原因。已移除设备历史仍只读；请求超时或断线显示结果未确认，不伪成功、不自动重放。
- 既有 Relay 独立标记不是原生 Done 的证明，也不自动批量转成归档命令；支持联动的 Session 经本机状态确认后采用原生结果，未确认历史明确区分。Reactivate 后发送仍需通过原有在线及能力检查。

## 验收标准

- 从 Relay 完成并确认后，本机 VS Code 显示 Done；从 Relay Reactivate 并确认后，本机显示 Restore 后的状态。同一 Session 身份与已保存历史保留，列表默认隐藏原生完成项，Show completed 可读并可在详情直接恢复，不被 Show ended 的历史默认关闭阻挡。
- 本机手动 Done / Restore 在刷新或重新确认后反映到 Relay，与执行状态区分；旧独立标记不会触发自动归档。普通消息和执行更新不能伪造本机完成或恢复成功。
- 列表与详情动作一致且手机点击区至少 44 × 44 CSS px；进行中、拒绝、断线未确认、离线及能力不支持均明确反馈。恢复不自动发消息，已移除设备和原有发送权限不可绕过。
