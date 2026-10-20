# Device 连接与消息设计

## 状态与范围

这是供构想 gate 审阅的目标语义与技术比较，不是已实现协议。业务模型见[模型评审](Business-Data-Model-Review.md)。用户已确定以 Account 为中心连接多个 Client 与多个 Device，两端多对多通信：Client 每条下行指定一个 Device，Device 每条上行群发给同 Account 所有 Client。每个 Device 固定两个方向，Connector 仅是 Device 连接 Relay 的程序，不是业务实体。本次是单向业务升级为双向，不只是改名。下文具体字段、HTTP 路径、状态码、批处理规则和技术选型均为提案，未冒充已批准决定。

本轮只准备设计，不执行应用代码、部署、生产读写或 gate 接受。后续实现与现实世界验证分别由下游契约细化。现有 UI 改版不在本 idea 的设计边界；版本并存首先要求现有页面和设置行为不被破坏，确需改变时再先做 UI 评审。

## 业务术语与能力变化

| 概念 | 本 idea 的统一含义 |
| --- | --- |
| Account | 多 Device、多 Client 的共同归属、路由和授权边界，不接受客户端自行声明的账户作为授权事实 |
| Client | 上游用户客户端，例如浏览器或其他获授权应用；不要求只有一个实例或写者 |
| Device | 下游设备端业务身份，负责接收 regulation、自主调度并上报 events；不绑定特定执行框架，也不等于短命连接/进程 |
| Relay | 两方向消息的授权、持久接收与交付中介，不冒充 Device 执行者 |

**实现术语：** Connector 只是 Device 连接 Relay 服务的设备端程序，不属于上述业务实体，不拥有独立业务 ID、消息流、历史或配额主体；它使用 Device 身份和凭证进行通信。程序进程/连接 ID、所有权 generation 可用于运行协调，但不能替代 Device ID。设备端程序可升级/替换而不迁移业务身份或清空本地持久状态。

保留并扩展 **任一 Device→Relay→同 Account 全部 Client** 的 events 上行，新增 **任一 Client→Relay→同 Account 指定的一个 Device** 的 regulation 下行。Client 从只读消息接收方扩展为可按授权提交下行消息的主体，Device 从只上报扩展为可接收和处理下行消息的主体。传输控制帧/ACK 本来可以双向往返，不代表既有业务已经支持双向消息；双向业务也不要求两端拥有相同写权限。

Device 重启、重连或同一身份的实例接管不新建业务 Device；单活动所有权约束作用于同一 Device 的活动实例。一个程序实例使用一个 Device 身份，多开程序争用同一身份时必须 fencing；同机要运行多个独立业务端点时显式登记多个 Device，不能因多开程序自动创建身份。既有 Account/Device ID 应优先保留；旧数据来源仍需核实，不能因去掉 Connector 概念直接删除历史表。Client 的认证生产者归属与订阅身份也不能被统一命名掩盖。

## Account 路由与群发规则

- **下行定向：** 每条 Client 消息必须指定一个目标 Device；Relay 从认证上下文确定 Account，再校验目标 Device 归属与有效状态，只写入该 Device 下行日志。不能省略目标后猜默认值，不能将同一条下行隐式广播到所有 Device；无效/停用/跨账户目标明确拒绝。
- **上行全量群发：** 任一 Device 的每条持久上行 event 都进入 Account 的逻辑群发范围，向该 Account 所有有效 Client 交付，不以 Client 是否发起相关任务、正在查看哪个 Device 或是否单独订阅该 Device 为条件。所有有效在线 Client 都应收到；同一 Client 的多个有效连接不能因其他连接已 ACK 就被跳过。
- **账户级订阅：** Client 订阅的是 Account 内全部 Device 的 events；Relay 负责发现、聚合与扇出，不要求 Client 逐设备枚举才能满足群发。新 Device 加入后也必须纳入，发现与订阅/补读交界不得漏项；可有展示层筛选，但不能缩小底层要求的群发范围。
- **离线恢复：** 各 Client 独立持久化接收游标，断线不代表已收。恢复后在仍具账户访问权及历史保留范围内补读全部来源的缺口；新 Client 可从显式历史起点读取保留事件，不能把浏览器自动重连当完整恢复。超过保留范围须明确报告缺口，不承诺为永久离线或已撤销 Client 无限保留。
- **逻辑聚合而非新业务流：** Device 各自固定两个方向；Account 群发是服务端路由/聚合能力，不新增用户可创建的 Stream，也不把消息按 Client 复制成不同业务消息。每份交付保留 Account、源 Device 与原消息身份；重复交付由各 Client 独立去重，Connector 程序不成为新的消息归属。

这些规则适用于各方向的每条消息，不按 task/objective 关联、消息类型或是否有任务发起 Client 缩小范围；设备状态、自主产生的 events 也要群发。

账户聚合的恢复游标需覆盖多个 Device 的位置与来源发现进度，不能把不同 Device 的 position 当成同一计数器。可选择复合游标/服务端恢复状态，或可恢复的账户索引；精确机制待实现设计验证，但必须保证持久接收与群发故障之间可补偿、既有及新增 Device 都不会漏发。此处不承诺账户内跨 Device 总序，也不强行把原历史重新编号成统一日志。

## 两条业务时序

### ① regulation：Client 短请求提交，Device 长订阅接收

1. 获授权的 Client 产生稳定消息身份、目标 Device 与任务关联，HTTP 提交 regulation 到 Relay。短请求可复用 TCP/TLS，不要求每次重建连接。
2. Relay 校验认证 Account、目标 Device 归属与状态、写入权限、大小与幂等冲突，仅原子写入该 Device 下行日志、去重记录和位置，再返回“Relay 已接收”，随后只通知该 Device 订阅。目标 Device 暂时离线不阻止持久接收，但目标已停用则拒绝。
3. 当前有效 generation 的 Device 实例从自己的持久接收游标补读，先将 regulation 写入本地持久 inbox/去重记录，再推进接收进度；由 Device 自主调度，不由 Relay 冒充执行者。
4. Device 接收、开始执行、完成或失败可作为关联 events 上报；“无回报/结果未知”不得解释为成功，也不得仅因超时自动换 ID 再执行。

### ② events：Device 短请求上报，Client 长订阅接收

1. Device 在本地先记录事件/outbox，Relay 离线也继续自治；HTTP 单条或批量推送稳定 ID 的 events。
2. Relay 校验下游 Account/Device 归属、有效 generation、幂等和配额，持久化上行日志后才确认并发起账户群发。HTTP 成功不等于所有 Client 已收到；响应丢失时沿用相同消息 ID 重试，不能当作未持久化。
3. Relay 将每条 event 扇出给同 Account 全部有效 Client；Client 通过账户级入口按各自游标读取/订阅所有 Device 的上行 events。每个订阅独立窗口、ACK 和恢复进度；一个 Client ACK 不得截断其他 Client 的历史，慢/离线 Client 通过独立补读恢复。
4. 下游收到持久接收确认后可按本地策略释放已确认 outbox 内容；消息去重与执行证据的保留不能因此立即消失。

“双工”只表示两条逻辑业务消息流；不要求共用一个物理 WebSocket。两个方向均有独立历史读入口，长连接是实时加速，不是唯一历史来源。

## 权限矩阵

| 主体 | 提交 regulation | 消费/确认 regulation | 上报 events | 读取/订阅历史 |
| --- | --- | --- | --- | --- |
| Account 下有效 Client | 是，指定同 Account 的一个 Device，独立生产者身份和幂等键，须有写入权限 | 否，不冒充 Device | 否，不冒充下游执行证据 | 接收该 Account 所有 Device 的 events；regulation 历史按显式读取权限，不含消费权 |
| 持有效 Device 身份的活动实例 | 否，不代替用户授权 | 仅自身下行，须有效 fencing generation | 仅自身上行，须有效 generation，不选择或缩小 Client 接收名单 | 自身 regulation；events 自恢复读取须单独声明范围，不取得其他 Device 消费权 |
| 账户访问已失效或其他 Account 主体 | 否 | 否 | 否 | 否 |
| 管理/保留操作主体 | 不是普通消息提交权 | 不是执行权 | 不是执行证据 | 仅依单独授权执行撤销、清理或审计 |

上行“全部 Client”指仍具该 Account 有效访问权的 Client，不引入与需求冲突的逐 Device 订阅白名单；账户会话失效/撤销后停止交付。下行写入权限与上行接收权分开校验。当前浏览器 cookie API 只读；开放 regulation 写入是新能力，不直接复用为“所有登录用户自动能写”。未来需要细化 Origin/CSRF、防跨账户、生产者归属、撤销后的长连接重新授权与服务端拒绝。下游凭证不得交给浏览器。

## 写入、读取与订阅原语（提案）

| 业务原语 | 可选 HTTP/订阅表达 | 语义 |
| --- | --- | --- |
| 提交下行 | `POST /api/v2/devices/{deviceId}/regulations` | 直接指定同 Account 的 Device，无需 Connector ID；返回消息身份、目标、Relay 分配位置与持久接收状态，不返回执行成功 |
| 上报上行 | `POST /api/v2/devices/{deviceId}/events` | 认证身份须与路径 Device 一致；单条或有界批量，建议整批原子接收，混入冲突/越权则整批失败，不靠含糊的部分成功 |
| 历史补读 | Device 下行 `GET .../regulations?after=...`；Client 上行 `GET /api/v2/account/events?after=...` | 授权分页；下行按目标日志，上行聚合账户全部 Device，返回来源、水位/保留下界及续读游标；游标绑定其 Account/范围，不可跨范围借用 |
| 实时订阅 | Device 下行按自身 Device 身份；Client 上行 `GET /api/v2/account/events/subscribe` 等账户级表达 | SSE、WebSocket 或长轮询均为候选；先补读再持续交付，上行覆盖所有既有/新增 Device，不要求 Client 手动逐设备订阅 |
| 下游所有权与接收进度 | 显式取得/续租 generation，提交持久接收游标 | 不混用浏览器订阅 ACK；精确 wire shape 后续决定 |

候选消息字段包括 `messageId`、`producerId`、下行 `targetDeviceId` 或等价路径目标、上行 `sourceDeviceId`、`taskId`/`objectiveId`、`regulationId`/`causedBy`、`type`、`payload`。Account/源 Device 由认证上下文绑定，不能信任可伪造的 payload；路径、消息声明与认证约束的 Device 不一致须拒绝，已持久化消息不得通过重试改投另一个 Device。Relay 独立分配每 Device 方向内 `position`，不添加 Connector 业务字段。不是字段定稿，也不把所有业务对象硬归成一个 task 表。位置可沿用 decimal string 的精度边界，不能作为 JavaScript Number 隐式转换。

幂等建议以 `(account, messageId)` 绑定经授权的生产者、方向、目标/来源 Device 及规范化内容指纹，ID 采用足够唯一的生成方案；不同 Client 各有生产者身份，不能假定共用一个本地序号。身份、内容与归属相同返回原位置；相同身份不同生产者、改方向、改投 Device 或内容冲突均拒绝。跨 Device 的重试身份绑定需可原子校验，不能只在目标日志中局部去重而允许改投；具体协调机制在实施前确定。提交方误换 ID 重试无法由传输去重自动修复，执行侧仍须业务幂等。

批次与重复校验、配额和位置分配须在同一原子边界；通知丢失不影响历史补读。重试身份的保存期限必须覆盖承诺的重试窗口；若消息已清理且无法证明旧内容，不得重新接受为新任务，应明确返回历史不可验证/需人工恢复。

## 三层确认与执行安全

| 层次 | 证明了什么 | 没证明什么 |
| --- | --- | --- |
| Relay HTTP 持久接收 | Relay 已耐久记录该消息或识别同一重试 | Device 已接收、已执行或业务成功 |
| 传输交付/订阅 ACK | 某订阅按其约定消费了一个窗口 | 业务副作用已发生；其他订阅也已接收 |
| Device 持久接收与执行 events | 已落本地 inbox 或明确的接收/执行/完成阶段 | 没有相应业务证据时，不能推断外部系统 exactly-once |

下行至少区分本地持久接收游标与每个 regulation 的执行状态；跨任务并行执行意味着收到较高位置不等于低位置全部完成。Device 本地提交 inbox 和接收游标须原子或可恢复，不能只在内存 ACK 后丢失任务。Client 自身游标须在可靠处理后持久化。

同一 Device 的单活动实例使用有期限租约与单调 generation/fencing。接管时协调更新所有权；HTTP 上报、长订阅、进度提交都核验当前 generation，不能只在 WebSocket 握手时检查。旧实例拒绝新工作并停止调度；凭证轮换不等于接管，不重置位置/历史。

Relay fencing 不能取消旧实例已经开始的外部副作用，网络隔离也不能自动证明旧实例停止。执行需使用业务幂等键、可核实外部结果或业务资源侧 fencing；无法做到时标记结果未知并进入对账/人工恢复，禁止盲目重新执行。Device 离线自治可继续本地已授权工作和 outbox 积累，但新实例不因取得租约就无条件重放旧任务；允许何种离线任务启动/接管策略在实施前收敛。

取消/撤销任务通过新的关联 regulation 表达，Device 判定是否仍可取消，再回报事件；不能修改旧消息或把传输层取消订阅当业务取消。已完成副作用可能需要补偿而非“删除成功”。

## 顺序、失败与容量

每 Device 每方向只承诺 Relay 追加顺序、独立游标与至少一次交付；不承诺跨任务因果、跨 Device/跨方向全局总序或端到端 exactly-once。不同 Client 可能看到不同 Device 事件的不同交错顺序，但每条都应交付且来源内顺序不变。本地事件顺序若有业务意义，需要显式来源序列/因果关联，不能把并发 HTTP 到达顺序当实际发生顺序。

| 场景 | 所需行为 |
| --- | --- |
| 持久化前失败 | 明确失败，提交方用原 ID 重试；不得先确认 |
| 已提交、HTTP 响应或通知丢失 | 原 ID 重试返回同一结果；订阅从持久游标补读 |
| 多 Client 并发写 | Relay 原子分配位置；独立消息 ID 不冲突，不要求共享 Client 计数器 |
| 目标缺失/不存在/停用/跨账户 | 明确拒绝，不默认路由、不投其他 Device；停用与提交竞争需有协调的授权/接收边界 |
| 群发中断或账户新增 Device | 从持久来源/恢复状态补齐；既有及新增来源均纳入账户级订阅，不把一次内存通知当唯一交付依据 |
| 某个 Client 断线、慢或已 ACK | 不阻塞其他 Client，不代替其他 Client 确认；各自限流、窗口与补读，超期明确报错 |
| 同一 Device 两个实例抢占/旧实例恢复 | 所有权冲突显式拒绝；旧 generation 不得写入或推进进度；副作用按上述执行安全处理 |
| Relay 离线或 Device 重启 | 本地 outbox/inbox、执行记录与游标保留；恢复后补读、去重和上报，状态丢失显式阻断恢复 |
| 慢 Client 或大日志 | 有界批次、窗口、连接输出预算、速率与 Device/Account 配额；限流/背压明确可见，不无限积压内存或立即引入多流 |
| 超过保留期/游标早于保留下界 | 明确 `cursor_expired` 或历史不可验证类失败，返回可恢复范围；禁止静默从最新位置开始或跳过未执行 regulation |
| 凭证/账户权限撤销 | 新请求拒绝，现有订阅及时重新校验/关闭；停用和保留期清理按独立授权执行，不能用 AO 禁止所有法定删除 |

具体窗口、重试退避、配额、保留期、未消费 regulation 的清理约束和超期恢复流程待定，不能直接照搬 v1 常量。Account 级聚合还需评估多个 Device 对多个 Client 的扇出量、来源发现和复合游标大小，避免一个嘈杂 Device 饿死其他来源或一个慢 Client 拖住全账户。先通过有界分页/索引/公平调度评估，不再开放用户多 Stream。

## 传输与 DO 分开决定

| 选择 | 优点与约束 | 本轮结论 |
| --- | --- | --- |
| 上游 SSE | 与 HTTP 历史读相近、单向 events 推送；需验证认证、代理重连和游标恢复，浏览器自动重连不是持久处理确认 | 候选，与 WebSocket 比较后决定 |
| 上游 WebSocket | 可显式 ACK/窗口，现有浏览器已有实现；需处理鉴权、心跳、连接配额 | 候选，不因已有实现就绑定新业务协议 |
| 下游 WebSocket | 低延迟下发、显式窗口和所有权控制；有连接生命周期成本 | 候选，与长轮询比较后决定 |
| 下游长轮询 | HTTP 请求模型易复用，断开恢复清晰；需验证等待期限、请求频度和唤醒路由 | 候选，不预设成本/规模优势 |
| 每 Device 的协调与持久存储 | 当前 DO 合并顺序日志、writer lease/generation、SQLite 持久化和浏览器订阅；HTTP 写入仍可按 Account/Device 路由到相同协调所有者 | 先明确一致性与路由需求，再决定保留/调整 DO，不因 HTTP 自动移除，也不因连接程序更换而换存储归属 |
| Account 级聚合与群发 | 现有逐 Device DO 不能自动覆盖全部 Device→全部 Client；需要账户范围发现、可恢复 fan-in/fan-out、隔离背压与权限撤销 | 在保留来源身份/独立顺序前提下评估路由与恢复机制，不预先承诺新增 Account DO 或统一存储 |

仅事件上报可以使用 HTTP 与其他耐久存储，并不天然依赖 WebSocket 或 DO；但本目标还包括顺序、幂等、下游单所有权与实时路由，移除 DO 就必须给出替代原子协调/存储/通知方案及故障证明。研究文档不为比较而部署资源，不凭空承诺价格、吞吐或容量。

## 现状证据与差异

以下为本轮直接核实的源代码快照，不是生产探测：

- [sync-protocol](../../../../../../packages/sync-protocol/src/index.ts)：`SYNC_VERSION=1`，`stream.open/list/append/read/subscribe`、`subscription.ack`；decimal string seq，事件主体是 seq/payload，没有新 regulation 业务结构。
- [DeviceSync](../../../../../../apps/worker/src/device-sync.ts)：SQLite streams/events，单 writer lease/generation、事务追加与冲突校验、浏览器订阅；当前配额失败明确报错且不自动清理。不能把已有 `subscription.ack` 当下游执行确认。
- [stream-api](../../../../../../apps/worker/src/stream-api.ts)：浏览器 cookie 只读 GET，按账户/device 授权并以二元组路由 DO；订阅显式指定 Device/stream，尚不是账户级所有 Device 群发，现有写权限也不覆盖上游 regulation。[session](../../../../../../apps/worker/src/session.ts)将有效浏览器会话解析为 `userId`；目标 Account 是业务归属概念，不因此另造账户表或直接更改现有键。
- [FileEventSource](../../../../../../packages/connector/src/sync-source.ts)：本地 SQLite WAL/FULL 多 stream 日志，区分创建/重开，丢失状态显式报错；不能直接等同新下行 inbox 和执行去重记录。
- [设备迁移](../../../../../../apps/worker/migrations/0007_devices_and_token_bindings.sql)：从 connectors/bindings 与 `token-*` 建立 device/token 映射；[设备管理](../../../../../../apps/worker/migrations/0011_device_management.sql)有移除和 token 约束。新身份模型需核实这些来源，不能只改显示名称。

现有实现中 `connectors` 等旧名称与 device 相连，消息能力主要是 Device→Client 上行；目标业务模型只以 Account/Device/Client 和消息表达归属与路由，Connector 仅保留为设备端程序名称，不新建 Connector 业务 ID、绑定或注册资源。保留既有 Account/Device 身份、核实旧实现映射后，新增定向下行并将上行扩展为账户内全部 Client 群发。建议 v2 隔离、旧历史只读映射，详细边界见[迁移影响](Business-Data-Model-Review.md#迁移影响与未决项)。本轮不改旧 ID、旧历史或现有 UI；历史表/接口带有旧词不等于必须立即改名或删除。

## 待决事项

1. **协议提案：** 字段、路径、状态码、Client 生产者身份/恢复身份、幂等规范化/保留期限、批次原子性、关联引用约束与位置格式。下行单目标与上行同账户全量群发是确定要求，不是待决。
2. **技术验证：** 上游 SSE/WebSocket、下游 WebSocket/长轮询，协调/存储是否沿用 DO，账户级聚合、动态发现与恢复游标机制；用真实需求与后续获准环境证据决定。
3. **所有权与执行：** 接管/租期策略、离线自治可启动范围、本地 inbox/outbox 恢复、外部副作用幂等/fencing、未知结果对账。
4. **容量与迁移：** 背压/公平性/保留清理、游标超期恢复、旧身份映射、版本并存/退出与安全回退。构想认可仅确定不丢身份/历史的边界，不批准尚无证据的切换细案。
