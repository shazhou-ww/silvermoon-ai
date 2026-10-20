# Connector 连接与消息设计

## 状态与范围

这是供构想 gate 审阅的目标语义与技术比较，不是已实现协议。业务模型见[模型评审](Business-Data-Model-Review.md)。用户已经确定上下游、单 Connector/单 Supervisor 与固定两方向；下文具体字段、HTTP 路径、状态码、批处理规则和技术选型均为提案，未冒充已批准决定。

本轮只准备设计，不执行应用代码、部署、生产读写或 gate 接受。后续实现与现实世界验证分别由下游契约细化。现有 UI 改版不在本 idea 的设计边界；版本并存首先要求现有页面和设置行为不被破坏，确需改变时再先做 UI 评审。

## 两条业务时序

### ① regulation：上游短请求提交，下游长订阅接收

1. 获授权的用户/客户端产生稳定消息身份及任务关联，HTTP 提交 regulation 到 Relay。短请求可复用 TCP/TLS，不要求每次重建连接。
2. Relay 校验账户、Connector 权限、大小与幂等冲突，原子写入下行日志、去重记录和位置，再返回“Relay 已接收”，随后通知下游订阅。离线 Supervisor 不阻止 Relay 持久接收。
3. 当前有效 generation 的 Supervisor 从自己的持久接收游标补读，先将 regulation 写入本地持久 inbox/去重记录，再推进接收进度；由 Supervisor 自主调度，不由 Relay 冒充执行者。
4. Supervisor 接收、开始执行、完成或失败可作为关联 events 上报；“无回报/结果未知”不得解释为成功，也不得仅因超时自动换 ID 再执行。

### ② events：下游短请求上报，上游长订阅接收

1. Supervisor 在本地先记录事件/outbox，Relay 离线也继续自治；HTTP 单条或批量推送稳定 ID 的 events。
2. Relay 校验下游身份、有效 generation、幂等和配额，持久化上行日志后才确认并通知。响应丢失时沿用相同消息 ID 重试，不能当作未持久化。
3. 多个获授权的浏览器/客户端按各自游标读取/订阅上行 events。每个订阅独立窗口、ACK 和恢复进度；一个客户端 ACK 不得截断其他客户端的历史。
4. 下游收到持久接收确认后可按本地策略释放已确认 outbox 内容；消息去重与执行证据的保留不能因此立即消失。

“双工”只表示两条逻辑业务消息流；不要求共用一个物理 WebSocket。两个方向均有独立历史读入口，长连接是实时加速，不是唯一历史来源。

## 权限矩阵

| 主体 | 提交 regulation | 消费/确认 regulation | 上报 events | 读取/订阅历史 |
| --- | --- | --- | --- | --- |
| 同账户获授权上游客户端 | 是，独立生产者身份和幂等键 | 否，不冒充 Supervisor | 否，不冒充下游执行证据 | events；regulation 历史仅按显式读取权限，不含消费权 |
| 绑定 Connector 的有效 Supervisor | 否，不代替用户授权 | 是，须有效 fencing generation | 是，须有效 generation | regulation；events 自恢复读取须单独声明范围 |
| 同账户未获所需权限或其他账户 | 否 | 否 | 否 | 否 |
| 管理/保留操作主体 | 不是普通消息提交权 | 不是执行权 | 不是执行证据 | 仅依单独授权执行撤销、清理或审计 |

当前浏览器 cookie API 只读；开放 regulation 写入是新能力，不直接复用为“所有登录用户自动能写”。未来需要细化 Origin/CSRF、防跨账户、生产者归属、撤销后的长连接重新授权与服务端拒绝。下游凭证不得交给浏览器。

## 写入、读取与订阅原语（提案）

| 业务原语 | 可选 HTTP/订阅表达 | 语义 |
| --- | --- | --- |
| 提交下行 | `POST /api/v2/connectors/{id}/regulations` | 返回消息身份、Relay 分配位置和持久接收状态，不返回执行成功 |
| 上报上行 | `POST /api/v2/connectors/{id}/events` | 单条或有界批量；建议整批原子接收，混入冲突/越权则整批失败，不靠含糊的部分成功 |
| 历史补读 | `GET .../regulations?after=...` / `GET .../events?after=...` | 授权分页，返回水位/保留下界与续读游标，游标不可跨 Connector/方向借用 |
| 实时订阅 | 按方向建立 SSE、WebSocket 或长轮询 | 先从指定游标补读，再持续通知；补读与实时交界不得漏项，允许去重的重复 |
| 下游所有权与接收进度 | 显式取得/续租 generation，提交持久接收游标 | 不混用浏览器订阅 ACK；精确 wire shape 后续决定 |

候选消息字段包括 `messageId`、`producerId`、`taskId`/`objectiveId`、`regulationId`/`causedBy`、`type`、`payload`；Relay 独立分配方向内 `position`。不是字段定稿，也不把所有业务对象硬归成一个 task 表。位置可沿用 decimal string 的精度边界，不能作为 JavaScript Number 隐式转换。

幂等建议以 `(connector, direction, messageId)` 绑定经授权的生产者及规范化内容指纹，ID 采用足够唯一的生成方案；不同客户端各有生产者身份，不能假定共用一个本地序号。身份相同内容相同返回原位置；相同身份不同生产者或内容冲突拒绝。客户端误换 ID 重试无法由传输去重自动修复，执行侧仍须业务幂等。

批次与重复校验、配额和位置分配须在同一原子边界；通知丢失不影响历史补读。重试身份的保存期限必须覆盖承诺的重试窗口；若消息已清理且无法证明旧内容，不得重新接受为新任务，应明确返回历史不可验证/需人工恢复。

## 三层确认与执行安全

| 层次 | 证明了什么 | 没证明什么 |
| --- | --- | --- |
| Relay HTTP 持久接收 | Relay 已耐久记录该消息或识别同一重试 | Supervisor 已接收、已执行或业务成功 |
| 传输交付/订阅 ACK | 某订阅按其约定消费了一个窗口 | 业务副作用已发生；其他订阅也已接收 |
| Supervisor 持久接收与执行 events | 已落本地 inbox 或明确的接收/执行/完成阶段 | 没有相应业务证据时，不能推断外部系统 exactly-once |

下行至少区分本地持久接收游标与每个 regulation 的执行状态；跨任务并行执行意味着收到较高位置不等于低位置全部完成。Supervisor 本地提交 inbox 和接收游标须原子或可恢复，不能只在内存 ACK 后丢失任务。浏览器自身游标须在可靠处理后持久化。

单活动 Supervisor 使用有期限租约与单调 generation/fencing。接管时协调更新所有权；HTTP 上报、长订阅、进度提交都核验当前 generation，不能只在 WebSocket 握手时检查。旧实例拒绝新工作并停止调度；凭证轮换不等于接管，不重置位置/历史。

Relay fencing 不能取消旧实例已经开始的外部副作用，网络隔离也不能自动证明旧实例停止。执行需使用业务幂等键、可核实外部结果或业务资源侧 fencing；无法做到时标记结果未知并进入对账/人工恢复，禁止盲目重新执行。设备离线自治可继续本地已授权工作和 outbox 积累，但新实例不因取得租约就无条件重放旧任务；允许何种离线任务启动/接管策略在实施前收敛。

取消/撤销任务通过新的关联 regulation 表达，Supervisor 判定是否仍可取消，再回报事件；不能修改旧消息或把传输层取消订阅当业务取消。已完成副作用可能需要补偿而非“删除成功”。

## 顺序、失败与容量

每方向只承诺 Relay 追加顺序、独立游标与至少一次交付；不承诺跨任务因果、跨方向全局总序或端到端 exactly-once。本地事件顺序若有业务意义，需要显式来源序列/因果关联，不能把并发 HTTP 到达顺序当实际发生顺序。

| 场景 | 所需行为 |
| --- | --- |
| 持久化前失败 | 明确失败，客户端用原 ID 重试；不得先确认 |
| 已提交、HTTP 响应或通知丢失 | 原 ID 重试返回同一结果；订阅从持久游标补读 |
| 多上游并发写 | Relay 原子分配位置；独立消息 ID 不冲突，不要求共享客户端计数器 |
| 两个 Supervisor 抢占/旧实例恢复 | 所有权冲突显式拒绝；旧 generation 不得写入或推进进度；副作用按上述执行安全处理 |
| Relay 离线或 Supervisor 重启 | 本地 outbox/inbox、执行记录与游标保留；恢复后补读、去重和上报，状态丢失显式阻断恢复 |
| 慢客户端或大日志 | 有界批次、窗口、连接输出预算、速率与 Connector 配额；限流/背压明确可见，不无限积压内存或立即引入多流 |
| 超过保留期/游标早于保留下界 | 明确 `cursor_expired` 或历史不可验证类失败，返回可恢复范围；禁止静默从最新位置开始或跳过未执行 regulation |
| 凭证/账户权限撤销 | 新请求拒绝，现有订阅及时重新校验/关闭；停用和保留期清理按独立授权执行，不能用 AO 禁止所有法定删除 |

具体窗口、重试退避、配额、保留期、未消费 regulation 的清理约束和超期恢复流程待定，不能直接照搬 v1 常量。大单日志的公平性、按任务筛选与查询可用性应先通过有界分页/索引/调度评估，不再开放用户多 Stream。

## 传输与 DO 分开决定

| 选择 | 优点与约束 | 本轮结论 |
| --- | --- | --- |
| 上游 SSE | 与 HTTP 历史读相近、单向 events 推送；需验证认证、代理重连和游标恢复，浏览器自动重连不是持久处理确认 | 候选，与 WebSocket 比较后决定 |
| 上游 WebSocket | 可显式 ACK/窗口，现有浏览器已有实现；需处理鉴权、心跳、连接配额 | 候选，不因已有实现就绑定新业务协议 |
| 下游 WebSocket | 低延迟下发、显式窗口和所有权控制；有连接生命周期成本 | 候选，与长轮询比较后决定 |
| 下游长轮询 | HTTP 请求模型易复用，断开恢复清晰；需验证等待期限、请求频度和唤醒路由 | 候选，不预设成本/规模优势 |
| 每 Connector 的协调与持久存储 | 当前 DO 合并顺序日志、writer lease/generation、SQLite 持久化和浏览器订阅；HTTP 写入仍可路由到相同协调所有者 | 先明确一致性与路由需求，再决定保留/调整 DO，不因 HTTP 自动移除 |

仅事件上报可以使用 HTTP 与其他耐久存储，并不天然依赖 WebSocket 或 DO；但本目标还包括顺序、幂等、下游单所有权与实时路由，移除 DO 就必须给出替代原子协调/存储/通知方案及故障证明。研究文档不为比较而部署资源，不凭空承诺价格、吞吐或容量。

## 现状证据与差异

以下为本轮直接核实的源代码快照，不是生产探测：

- [sync-protocol](../../../../../../packages/sync-protocol/src/index.ts)：`SYNC_VERSION=1`，`stream.open/list/append/read/subscribe`、`subscription.ack`；decimal string seq，事件主体是 seq/payload，没有新 regulation 业务结构。
- [DeviceSync](../../../../../../apps/worker/src/device-sync.ts)：SQLite streams/events，单 writer lease/generation、事务追加与冲突校验、浏览器订阅；当前配额失败明确报错且不自动清理。不能把已有 `subscription.ack` 当下游执行确认。
- [stream-api](../../../../../../apps/worker/src/stream-api.ts)：浏览器 cookie 只读 GET，按账户/device 授权并以二元组路由 DO；现有写权限不覆盖上游提交 regulation。
- [FileEventSource](../../../../../../packages/connector/src/sync-source.ts)：本地 SQLite WAL/FULL 多 stream 日志，区分创建/重开，丢失状态显式报错；不能直接等同新下行 inbox 和执行去重记录。
- [设备迁移](../../../../../../apps/worker/migrations/0007_devices_and_token_bindings.sql)：从 connectors/bindings 与 `token-*` 建立 device/token 映射；[设备管理](../../../../../../apps/worker/migrations/0011_device_management.sql)有移除和 token 约束。新身份模型需核实这些来源，不能只改显示名称。

当前模型对 Connector 的表示与 device 相连；目标将 Connector 定义为持久 Supervisor 传输身份，而非物理设备或短命连接。建议 v2 隔离、旧历史只读映射，详细边界见[迁移影响](Business-Data-Model-Review.md#迁移影响与未决项)。本轮不改旧 ID、旧历史或现有 UI。

## 待决事项

1. **协议提案：** 字段、路径、状态码、生产者身份签发、幂等规范化/保留期限、批次原子性、关联引用约束与位置格式。
2. **技术验证：** 上游 SSE/WebSocket、下游 WebSocket/长轮询，协调/存储是否沿用 DO；用真实需求与后续获准环境证据决定。
3. **所有权与执行：** 接管/租期策略、离线自治可启动范围、本地 inbox/outbox 恢复、外部副作用幂等/fencing、未知结果对账。
4. **容量与迁移：** 背压/公平性/保留清理、游标超期恢复、旧身份映射、版本并存/退出与安全回退。构想认可仅确定不丢身份/历史的边界，不批准尚无证据的切换细案。
