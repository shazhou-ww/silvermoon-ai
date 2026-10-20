# 为自治设备建立通用事件同步底座

## 问题

项目从统一 coding session Relay 转向理解 Agent 驱动的自治设备；现有接入与传输绑定 Session 语义，不能直接承担 Supervisor 等生产者的可靠事件同步。

## 结果

设备可以通过同一套业务无关机制同步不可变事件流，中心提供可靠保存、历史读取和持续订阅，为后续 Supervisor 观测提供底座。

## 边界

- 本轮仅实现 Connector、Stream、Event 同步域；复用账户与设备身份，不加入远程控制、全局排序或多写者合并。见[同步业务模型评审](Business-Data-Model-Review.md)。
- 复用 Node.js、Cloudflare Durable Objects 和现有 Connector/Worker，隔离同步核心与业务适配，保持旧 Session 链路兼容。
- 暂不实施新 UI、完整 Supervisor 投影或 potential-guide 生产端集成。早期[Supervisor 模型](Supervisor-Model-Background.md)和[界面对比](ui-review/index.html)仅保留为后续产品背景，不是本轮验收范围。

## 验收标准

1. 业务无关生产者通过 Connector 同步多条独立有序流，事件持久保存后才确认；重复补传不重复保存，内容冲突和历史缺口明确失败。
2. 历史读取与实时订阅连续、可恢复且有背压；断线、进程或中心实例重建不以静默丢失或覆盖历史维持表面成功。
3. 账户、设备及凭证边界有效，旧 Connector 与 Session 行为保持兼容；验证以可执行测试及授权环境中的真实协议交互为证据，不以新 UI 或静态夹具宣称完成。
