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

- **下行定向：** 每条 Client 消息必须指定一个目标 Device；Relay 从认证上下文确定 Account，再校验目标 Device 归属与有效状态，仅以该 Device 为目标写入 Message。不能省略目标后猜默认值，不能将同一条下行隐式广播到所有 Device；无效/停用/跨账户目标明确拒绝。
- **上行全量群发：** 任一 Device 的每条持久上行 event 都进入 Account 的逻辑群发范围，向该 Account 所有有效 Client 交付，不以 Client 是否发起相关任务、正在查看哪个 Device 或是否单独订阅该 Device 为条件。所有有效在线 Client 都应收到；同一 Client 的多个有效连接不能因其他连接已 ACK 就被跳过。
- **账户级订阅：** Client 订阅的是 Account 内全部 Device 的 events；Relay 按 Account 和上行方向读取/推送 Message，不要求 Client 逐设备枚举或维护配对关系。新 Device 的上行写入相同账户范围后自然纳入；补读与实时交界不得漏项，可有展示层筛选，但不能缩小群发范围。
- **离线恢复：** 各 Client 独立持久化接收游标，断线不代表已收。恢复后在仍具账户访问权及历史保留范围内补读全部来源的缺口；新 Client 可从显式历史起点读取保留事件，不能把浏览器自动重连当完整恢复。超过保留范围须明确报告缺口，不承诺为永久离线或已撤销 Client 无限保留。
- **逻辑聚合而非新业务流：** Device 各自固定两个方向；Account 群发是服务端路由/聚合能力，不新增用户可创建的 Stream，也不把消息按 Client 复制成不同业务消息。每份交付保留 Account、源 Device 与原消息身份；重复交付由各 Client 独立去重，Connector 程序不成为新的消息归属。

这些规则适用于各方向的每条消息，不按 task/objective 关联、消息类型或是否有任务发起 Client 缩小范围；设备状态、自主产生的 events 也要群发。

账户级补读直接使用统一 Message 的自增 ID，不再合并多个 Device 的独立 position 或引入复合游标。旧 v1 历史仍留在原命名空间，不为了统一新表而重新编号。

## 最小消息模型与自增 ID

核心 Message 提案只有 `id`、`account_id`、`device_id`、`is_upstream`、`payload`。`id` 是 Relay 在权威 Message 表中持久分配的自增主键，兼作排序与历史补读依据；不再额外设置 position。`is_upstream=true` 表示 Device→Client，false 表示 Client→Device，始终以 Device 为参照，不随观察者改变。

两个方向先共用一张 Message 表：下行 `device_id` 是目标，上行是来源。按 Account、Device 和方向过滤即可形成所需读取范围，不为两个方向或每个 Client 各复制一份消息表；交付/执行状态单独保存，不改写已追加的 Message。精确字段拼写、索引与数据库产品待实施细化。

- **排序与补读：** 在已授权范围中按 `id > after ORDER BY id` 有界分页。Client 读取同 Account 的上行，Device 读取同 Account/自身 Device 的下行；各自仅在可靠处理后保存已处理 ID。实时交付也须与该补读顺序衔接，不能先推进到较大 ID 再漏掉较小记录。
- **作用域：** 自增 ID 在同一权威 Message 表内唯一且不复用；不能把多个 Device DO 各自生成的局部 ID 当成这个共同 ID。后续若物理分区，仍须满足账户查询范围内单一可排序/恢复的 ID 语义；不能静默换回复合游标或要求额外 position。
- **提交可见性：** 自增分配本身不保证事务提交顺序。必须由存储事务/单写协调等机制保证，小 ID 尚未提交时不会先发布较大水位让读者越过去。并发、回滚、提交延迟与推送乱序需专门测试，不满足就不能宣称 ID 可安全补读。
- **空洞与保留：** 回滚、其他 Account/方向的记录和授权清理都会产生可见 ID 空洞；读取不要求 `next = previous + 1`，缺号不等于丢消息或游标过期。过期判定依据读取范围的保留记录/下界，授权、清理与恢复不能仅看某个 ID 是否存在。
- **精度与恢复：** ID 在 JSON/游标中使用不会丢精度的表示（可沿用 decimal string）；删除/清理/恢复备份后也不能复用已发出的 ID。ID 只表达 Relay 存储顺序，不代表设备本地发生顺序、业务因果或执行完成顺序。

`producer_id` 不作为 Message 业务必填字段：鉴权上下文确定提交归属，必要的来源审计/重试校验放在服务端元数据。`task_ref`、task/objective/regulation 关联是可选 payload 内容，由上层解释，Relay 不要求每条消息关联任务。Client–Device 通信能力由同一 Account 推导，不添加直接绑定关系。

## 两条业务时序

### ① regulation：Client 短请求提交，Device 长订阅接收

1. 获授权的 Client 产生稳定请求幂等键与目标 Device，HTTP 提交 regulation 到 Relay；任务关联仅按上层需要放在 payload。此时尚无 Relay Message ID。短请求可复用 TCP/TLS，不要求每次重建连接。
2. Relay 校验认证 Account、目标 Device 归属与状态、写入权限、大小与幂等冲突，原子写入下行 Message、分配自增 ID 并保存幂等对应关系，再返回“Relay 已接收”和 Message ID，随后只通知该 Device 订阅。目标 Device 暂时离线不阻止持久接收，但目标已停用则拒绝。
3. 当前有效 generation 的 Device 实例从自己的持久接收游标补读，先将 regulation 写入本地持久 inbox/去重记录，再推进接收进度；由 Device 自主调度，不由 Relay 冒充执行者。
4. Device 接收、开始执行、完成或失败可作为关联 events 上报；“无回报/结果未知”不得解释为成功，也不得仅因超时换幂等键再次提交/执行。

### ② events：Device 短请求上报，Client 长订阅接收

1. Device 在本地先记录事件/outbox 与稳定幂等键，Relay 离线也继续自治；HTTP 单条或有界批量提交，不能要求离线 Device 预知 Relay 自增 ID。
2. Relay 校验下游 Account/Device 归属、有效 generation、幂等和配额，原子持久化上行 Message、自增 ID 与幂等对应关系后才确认并发起群发。HTTP 成功不等于所有 Client 已收到；响应丢失沿用原幂等键重试并取回原 Message ID，不能当作未持久化。
3. Relay 将每条 event 扇出给同 Account 全部有效 Client；Client 通过账户级入口按各自游标读取/订阅所有 Device 的上行 events。每个订阅独立窗口、ACK 和恢复进度；一个 Client ACK 不得截断其他 Client 的历史，慢/离线 Client 通过独立补读恢复。
4. 下游收到持久接收确认后可按本地策略释放已确认 outbox 内容；消息去重与执行证据的保留不能因此立即消失。

“双工”只表示两条逻辑业务消息流；不要求共用一个物理 WebSocket。两个方向均有独立历史读入口，长连接是实时加速，不是唯一历史来源。

## 权限矩阵

| 主体 | 提交 regulation | 消费/确认 regulation | 上报 events | 读取/订阅历史 |
| --- | --- | --- | --- | --- |
| Account 下有效 Client | 是，指定同 Account 的一个 Device，持认证归属和稳定请求幂等键，须有写入权限 | 否，不冒充 Device | 否，不冒充下游执行证据 | 接收该 Account 所有 Device 的 events；regulation 历史按显式读取权限，不含消费权 |
| 持有效 Device 身份的活动实例 | 否，不代替用户授权 | 仅自身下行，须有效 fencing generation | 仅自身上行，须有效 generation，不选择或缩小 Client 接收名单 | 自身 regulation；events 自恢复读取须单独声明范围，不取得其他 Device 消费权 |
| 账户访问已失效或其他 Account 主体 | 否 | 否 | 否 | 否 |
| 管理/保留操作主体 | 不是普通消息提交权 | 不是执行权 | 不是执行证据 | 仅依单独授权执行撤销、清理或审计 |

上行“全部 Client”指仍具该 Account 有效访问权的 Client，不引入与需求冲突的逐 Device 订阅白名单；账户会话失效/撤销后停止交付。下行写入权限与上行接收权分开校验。当前浏览器 cookie API 只读；开放 regulation 写入是新能力，不直接复用为“所有登录用户自动能写”。未来需要细化 Origin/CSRF、防跨账户、生产者归属、撤销后的长连接重新授权与服务端拒绝。下游凭证不得交给浏览器。

## 写入、读取与订阅原语（提案）

| 业务原语 | 可选 HTTP/订阅表达 | 语义 |
| --- | --- | --- |
| 提交下行 | `POST /api/v2/devices/{deviceId}/regulations` | 直接指定同 Account 的 Device，无需 Connector ID；带稳定幂等键，返回自增 Message ID、目标与持久接收状态，不返回执行成功 |
| 上报上行 | `POST /api/v2/devices/{deviceId}/events` | 认证身份须与路径 Device 一致；单条或有界批量，建议整批原子接收，混入冲突/越权则整批失败，不靠含糊的部分成功 |
| 历史补读 | Device 下行 `GET .../regulations?after=<id>`；Client 上行 `GET /api/v2/account/events?after=<id>` | 按授权范围过滤统一 Message 表，按自增 ID 升序分页；返回来源、保留范围与续读 ID，身份/读取范围变化不能直接继承旧游标 |
| 实时订阅 | Device 下行按自身 Device 身份；Client 上行 `GET /api/v2/account/events/subscribe` 等账户级表达 | SSE、WebSocket 或长轮询均为候选；先补读再持续交付，上行覆盖所有既有/新增 Device，不要求 Client 手动逐设备订阅 |
| 下游所有权与接收进度 | 显式取得/续租 generation，提交持久接收游标 | 不混用浏览器订阅 ACK；精确 wire shape 后续决定 |

Account/源 Device 由认证上下文绑定，不能信任可伪造的 payload；路径、消息声明与认证约束的 Device 不一致须拒绝。下行与上行入口可由服务端确定 `is_upstream`，不让提交者通过改 bool 越权。

**自增 ID 不代替提交幂等：** 提交方在发送前持久保存幂等键（例如协议头/每条批量记录的同步元数据，不是 Message 业务字段），Relay 在账户范围内校验该键与认证归属、方向、Device、内容指纹的绑定，并保存其 Message ID。完全相同的重试返回原 ID；冲突、改方向或改投 Device 明确拒绝，不追加新 Message。不同 Client 独立生成足够唯一的键，不共用本地计数器；更换浏览器会话/设备凭证后的合法恢复不能仅因连接 ID 改变就失去重试映射。

消息、自增 ID、批次/重复校验、配额与幂等映射须在同一原子边界，跨目标改投不能只靠目标局部去重。HTTP 响应丢失时，提交方不知道 ID 也能以原键取回原结果；通知丢失不影响按 ID 补读。映射须覆盖承诺的重试窗口；内容已清理且无法验证旧请求时明确阻断，不将旧请求重新当成新任务。超出窗口的行为与恢复流程须在实施前定清，不能无限承诺去重。业务副作用仍需要执行侧幂等，不能把 Relay 去重当端到端 exactly-once。

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

各授权读取范围按 Message 自增 ID 升序交付，重复记录由接收方按 ID 去重，Device 下行和各 Client 上行的确认/消费进度独立。统一表提供存储排序，不承诺现实发生顺序、跨任务因果、业务执行/完成总序或端到端 exactly-once。本地事件的业务关联若有意义，由 payload 表达，不把 Relay 自增顺序当外部世界因果。

| 场景 | 所需行为 |
| --- | --- |
| 持久化前失败 | 明确失败，提交方用原请求幂等键重试；不得先确认 |
| 已提交、HTTP 响应或通知丢失 | 原键重试返回原 Message ID；订阅按已处理 ID 补读 |
| 多 Client/Device 并发写、低 ID 提交延迟或回滚 | Relay 原子分配 ID 与记录映射，保证提交可见水位安全；不要求连续 ID 或共享客户端计数器，不能推进到高 ID 后遗漏低 ID |
| 目标缺失/不存在/停用/跨账户 | 明确拒绝，不默认路由、不投其他 Device；停用与提交竞争需有协调的授权/接收边界 |
| 群发中断或账户新增 Device | 从持久来源/恢复状态补齐；既有及新增来源均纳入账户级订阅，不把一次内存通知当唯一交付依据 |
| 某个 Client 断线、慢或已 ACK | 不阻塞其他 Client，不代替其他 Client 确认；各自限流、窗口与补读，超期明确报错 |
| 同一 Device 两个实例抢占/旧实例恢复 | 所有权冲突显式拒绝；旧 generation 不得写入或推进进度；副作用按上述执行安全处理 |
| Relay 离线或 Device 重启 | 本地 outbox/inbox、执行记录与游标保留；恢复后补读、去重和上报，状态丢失显式阻断恢复 |
| 慢 Client 或大日志 | 有界批次、窗口、连接输出预算、速率与 Device/Account 配额；限流/背压明确可见，不无限积压内存或立即引入多流 |
| 超过保留期/游标早于保留下界 | 明确 `cursor_expired` 或历史不可验证类失败，返回可恢复范围；禁止静默从最新位置开始或跳过未执行 regulation |
| 凭证/账户权限撤销 | 新请求拒绝，现有订阅及时重新校验/关闭；停用和保留期清理按独立授权执行，不能用 AO 禁止所有法定删除 |

具体窗口、重试退避、配额、保留期、未消费 regulation 的清理约束和超期恢复流程待定，不能直接照搬 v1 常量。需评估统一消息写入/自增协调及账户扇出负载，避免一个嘈杂 Device 饿死其他来源或一个慢 Client 拖住全账户。先通过有界分页/索引/公平调度评估，不因此恢复多 Stream、额外 position 或按方向拆表。

## 传输与 DO 分开决定

| 选择 | 优点与约束 | 本轮结论 |
| --- | --- | --- |
| 上游 SSE | 与 HTTP 历史读相近、单向 events 推送；需验证认证、代理重连和游标恢复，浏览器自动重连不是持久处理确认 | 候选，与 WebSocket 比较后决定 |
| 上游 WebSocket | 可显式 ACK/窗口，现有浏览器已有实现；需处理鉴权、心跳、连接配额 | 候选，不因已有实现就绑定新业务协议 |
| 下游 WebSocket | 低延迟下发、显式窗口和所有权控制；有连接生命周期成本 | 候选，与长轮询比较后决定 |
| 下游长轮询 | HTTP 请求模型易复用，断开恢复清晰；需验证等待期限、请求频度和唤醒路由 | 候选，不预设成本/规模优势 |
| Message 存储与 Device 所有权协调 | 当前逐 Device DO 同时持有多流日志、writer lease/generation、SQLite 和订阅；各 DO 局部自增不能直接满足统一 Message ID | 以统一 Message 表、自增 ID 与安全补读为设计约束，另评估 Device lease/fencing 与消息写入的一致性；不因改 HTTP 自动移除 DO，也不假装可原样复用旧存储 |
| Account 级群发 | 统一 Message 按 Account/上行过滤并用 ID 补读，新增 Device 自动落入范围；仍需实时扇出、背压与撤销校验 | 不再为各来源维护复合游标；具体存储产品/通知路由与是否保留 DO 待证，不凭空承诺成本/规模 |

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

1. **协议提案：** 精确字段/路径、状态码、认证归属、请求幂等键及保留期限、批次原子性、ID 的安全 wire 表示与超期恢复。自增 ID 排序/补读、下行单目标与上行同账户全量群发是确定要求，不另加 position。统一表和布尔方向是本版模型提案。
2. **技术验证：** 上游 SSE/WebSocket、下游 WebSocket/长轮询，统一 Message 存储/事务与 ID 提交可见顺序，Device 所有权协调及是否沿用 DO、账户群发路由；用需求与后续获准环境证据决定。
3. **所有权与执行：** 接管/租期策略、离线自治可启动范围、本地 inbox/outbox 恢复、外部副作用幂等/fencing、未知结果对账。
4. **容量与迁移：** 背压/公平性/保留清理、游标超期恢复、旧身份映射、版本并存/退出与安全回退。构想认可仅确定不丢身份/历史的边界，不批准尚无证据的切换细案。
