# 实现 Account 内 Device 与 Client 的双向消息路由

## 问题

现有消息主要由 Device 上行到 Client，缺少以 Account 为中心、面向多个 Device 与多个 Client 的双向路由与群发能力。

## 结果

同一 Account 下 Client 与 Device 多对多通信：下行指定一个 Device，上行群发全部 Client。Relay 先持久化再交付；Connector 以通用 lib 提供设备端可靠双向同步，由宿主嵌入，薄 CLI 复用同一库验证。

## 边界

- 消息、历史与固定两方向归属 Device；Connector 是通信库，不是业务实体。`objective-portfolio-supervisor` 是目标宿主，不进入通用协议；不开放用户多 Stream 或按任务建流。
- 保留设备自治、历史归属和授权清理；不承诺端到端 exactly-once，不绑定某种长连接或存储技术。
- 按已讨论设计实施仓库代码与验证 CLI；不实现独立本地中继服务或完整管道运行形态，不改现有 UI，不执行生产部署、npm 发布或生产数据操作。

## 验收标准

- 同账户指定 Device 路由、全部 Client 群发与跨账户隔离清晰可验证，见[业务模型](Business-Data-Model-Review.md)。
- Message 自增 ID 兼作排序与补读依据，不另设 position；接收、执行、请求幂等与各 Client 独立补读不混用，见[连接与消息设计](Connection-and-Message-Design.md)。
- 库可被普通宿主嵌入且无导入副作用，CLI 不另写传输逻辑；旧协议/历史保持兼容，见[宿主与库边界](Connection-and-Message-Design.md#connector-lib-与宿主边界)。
