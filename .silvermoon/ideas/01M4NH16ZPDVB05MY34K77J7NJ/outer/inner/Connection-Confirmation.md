# 连接确认、快照与命令结果契约

这是 Implementation 的支持契约，沿用已接受的业务身份与可达性方向，不定义另一套生命周期 gate。

## 当前确认与能力

- 设备仍用账号与设备 ID 复合身份，Session 再加本地 Session ID；存量历史不重命名或删除。
- Relay 每个连接签发 UUID；连接绑定写入设备当前记录，旧连接无法注册、刷新心跳或用旧观测恢复新连接的 Session。
- 更新后的 connector 注册显式声明 `confirmationVersion: 1`。Session 快照带当前 `connectionId` 与单调正序号；更低序号不更新执行状态、可写能力和预览，activity 时间不回退。
- Session 的 `executionStateKnown` 与 `canSendMessage` 独立。只有声明执行状态已知时才参加三类当前执行计数；能力必须明确由当前连接确认，不能依赖旧默认值。
- SDK 磁盘 metadata 是 unknown，不宣称 Idle。当前可恢复能力允许用户主动继续；只读、不可达、未确认能力或无权限仍禁止操作。
- 快照和历史分别更新：旧缓冲的正文可以补传，不能修改当前执行状态或能力。inventory 内产生的新观测保留原序号，inventory 应答不覆盖较新实时观测。

## HTTP 读写与历史

- 设备 GET 返回当前连接及同步状态；Session GET 返回确认归属、执行可信度和能力确认。Web 只在连接一致时恢复当前信息；成功读到旧记录或已同步历史不作为替代证据。
- 原 Session 数组响应保留兼容，新 Web 请求 `paged=1`，按稳定 Session ID 游标加载全部页，每页 500 条，并对循环游标显式报错。每页仍包含上游输入请求事件投影，不丢弃当前问题和选项。
- `POST /api/connectors/:id/sessions/sync` 发出当前连接的只读 sessions.list，复用当前在途同步，不误送 session.create。失败明确显示，后续成功恢复 ready。
- 发送请求携带本次连接；API 与最终 Relay 派发都核对归属、设备能力、Session 可写性。已有 waiting 问题与选项继续走既有消息发送 API。
- 历史同步独立。旧结果未知的历史任务保留记录，但不阻塞用户主动只读重试；原有上游历史序号合并与输入请求加载行为保留。

## 结果未知与补传

- 发出业务命令前保存 sent 和原连接归属，避免重连清理把已经实际交付的命令误标成未交付失败。
- 未交付失败与 adapter 真实执行失败可以明确报告；已交付但尚无结果的命令在重连后为 unknown，不自动重发。
- Connector 在内存中保留真正观察到的 succeeded/failed；上传失败、执行中断连只重试结果上传，记录原 `commandConnectionId`，Relay 校验同一账号/设备及原命令归属。
- 新连接不能仅用当前绑定替旧命令声明结果；持有可信原结果时可提交原绑定。停止 UI 观察只停止本地跟踪，不改变服务端结果。
- 进程重启丢失内存证据时不得伪造结果；此实现不承诺从无法提供结果查询的 SDK/AHP 自动找回所有结果。

## 兼容与发布边界

迁移 0010 只为现有连接、Session、command 表增加确认及不确定性字段，主键与历史身份不变。协议版本保持 2，新增声明与 envelope 是显式能力扩展。旧 connector 仍可上传历史，但不能确认当前状态或开放远程 follow-up；UI 提示更新 connector。

启用需要迁移和 Relay 先更新，再更新 connector/Web；实际数据库、包发布、服务部署和真设备断网验证仍由已同步的 Deployment 契约驱动。当前实施验证只使用内存数据库、本地测试 WebSocket 和 mocked Web API，不把它们当作外部部署证据。
