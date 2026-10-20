# 通用不可变事件同步（v1）

这是独立于旧 Session/tRPC/AHP 的同步底座。入口为 `GET /v1/sync` WebSocket，
使用已有的 `Authorization: Bearer smr1_...` 设备凭证。没有新 UI、Supervisor
生产者适配、远程命令、跨流事务、服务端消费组或业务端到端 exactly-once 承诺。
代码存在不表示已发布 npm 或已部署服务。

## 分层与身份

- 私有 `@silvermoon-ai/sync-protocol`：平台无关类型、Zod 校验、版本和限制。
- 现有 `@silvermoon-ai/connector/sync`：Node WebSocket 传输、重连补传、
  `ReliableEventSource` 接口和可选 SQLite `FileEventSource`。
- 现有 Worker：新增 `DEVICE_SYNC` SQLite Durable Object；旧 `DAEMON_SESSIONS`
  和旧端点保持不变。
- DO 使用 `JSON.stringify([accountId, deviceId])` 稳定路由，不使用 token ID。
  消息不能指定或切换账户/设备。当前 `daemon:connect` 凭证可以在**自己的设备**
  上请求 reader 或 writer 角色；不是跨设备账户读取授权。

服务端在升级时认证，在每个操作、向其他连接交付前重新查询有效凭证及设备，
并每 5 秒通过持久 alarm 检查空闲连接。撤销检查不是与 D1 管理写入的跨库事务：
已经通过该次认证的操作可能先于撤销完成；随后操作被拒绝，空闲连接在下一轮
检查关闭。认证数据库不可用时不继续写入。不会把完整 token 放进 DO 附件或日志。

事件身份为 `(accountId, deviceId, streamId, seq)`。序号从 1 开始，cursor 从 0
开始，必须是规范十进制字符串，最大 `9223372036854775807`；拒绝前导零、
浮点数、指数及 JSON number。SQLite 中使用 19 位补零 TEXT 排序，不经过 JS
number。只保证流内顺序。连接 UUID 和持久 fencing generation 都不属于日志身份。

## 生产者

```ts
import { FileEventSource, runSync } from "@silvermoon-ai/connector/sync";

// 首次显式初始化；以后必须 open，同一身份的源丢失时不能自动 create。
const source = await FileEventSource.create("./device-events.sqlite");
await source.openStream("device-observations", "application/vnd.example.event+json");
await source.append("device-observations", [JSON.stringify({ observed: "example" })]);

const stop = new AbortController();
await runSync({
  url: "wss://relay.example/v1/sync",
  token: process.env.SILVERMOON_TOKEN!,
  onError: (error) => console.error(error.message),
}, source, stop.signal);
// 停止时 stop.abort()；等待 runSync 返回后 source.close()。
```

`FileEventSource` 需要 Node 22.13+（Node 22 的 `node:sqlite` 仍可能输出实验性警告）；
仅使用 `SyncClient` 不会加载 SQLite。文件源使用 SQLite WAL + synchronous=FULL，
同一事务内分配连续序号并保存原始字符串。多个本地句柄的追加由 SQLite 协调；
应用负责保留数据库及其 WAL、备份、磁盘容量和生产时的敏感数据过滤。
对外部文件源，按接口自行提供持久枚举、按位置重放及可取消的变更通知。

`SyncClient.connect()` 协商角色；`synchronize(source)` 枚举完整本地流集，检查远端
是否出现本地未知流/更大流头，然后从 0 重放并核对全部历史。**不**因为远端
报告更大 head 就删除本地数据或跳过未知记录。确认丢失后重发相同字符串，服务端
逐条比较并幂等确认；不同内容是 `event_conflict`。缺失、回退、空洞和格式非法
的源明确失败。`synchronize` 本身不自动重连；`runSync` 对传输失败及可重试错误
执行带抖动退避，并定期补读可靠源；非可重试错误向调用者抛出。

v1 为了避免信任丢失的本地 checkpoint，每次同步均重新核对历史；大日志的重复
校验开销是明确限制，不宣称已优化增量 checkpoint。请求采用滑动节流；每个流最多
一个在途追加，单连接最多 16 个排队/在途请求。业务生产者仍然需要先落本地日志，
不能把内存回调当可靠源。删除某条本地流也会被识别为 `local_state_lost`。

## 消费者与协议

```ts
import { SyncClient } from "@silvermoon-ai/connector/sync";

// cursor 必须从应用自己的持久存储中加载。
const consumer = new SyncClient({
  url: "wss://relay.example/v1/sync",
  token: process.env.SILVERMOON_TOKEN!,
  role: "reader",
  onDelivery: (delivery) => {
    // 将 delivery 放入有界串行处理器；按 seq 幂等更新业务投影，
    // 最好与持久 cursor 同事务提交，然后显式 subscription.ack。
    // 不要仅因网络收到消息就确认。底座不自动 ACK。
    processDeliveryInOrder(delivery);
  },
});
await consumer.connect();
await consumer.request({
  type: "stream.subscribe", streamId: "device-observations",
  subscriptionId: "follow", after: cursor,
});
// 串行处理器提交后：
await consumer.request({ type: "subscription.ack", subscriptionId: "follow", through: cursor });
```

示例中的 `processDeliveryInOrder` 和 `cursor` 是应用负责的持久处理器及位置，不是 SDK
内置业务功能。回调可以返回 Promise，失败会关闭连接而不自动确认；多个回调并不由
SDK 串行化，应用必须维护自己的处理顺序。

客户端请求自动带连接内唯一 `requestId`，原始 wire 客户端必须自己提供。
首先发送 `hello { version: 1, role: "writer" | "reader" }`，收到 `welcome` 后才能操作：

| 请求 | 响应 / 语义 |
| --- | --- |
| `ping` | `pong`；保持连接租约，不释放消费窗口 |
| `stream.open {streamId, contentType?}` | `stream.opened {committedThrough, retainedFrom, contentType?}`；reader 只能打开已存在流，只有 writer 可创建 |
| `stream.list {after?, limit?}` | `stream.listed {streams, next}`；按 streamId 分页 |
| `stream.append {streamId, events}` | `stream.appended {committedThrough}`；一批全成或全败，同位置同内容幂等，不同内容拒绝 |
| `stream.read {streamId, after, limit?}` | `stream.events {events, next, committedThrough}`；`after=N` 不包含 N |
| `stream.subscribe {streamId, after, subscriptionId}` | `subscription.ready` 后连续收到 `subscription.events`；从持久日志读取，不依赖通知缓存 |
| `subscription.ack {subscriptionId, through}` | `subscription.acked`；只推进到已经实际交付的位置；旧/重复 ACK 不增加额度 |
| `subscription.cancel {subscriptionId}` | `subscription.cancelled`；释放该订阅状态 |

订阅批次包含 `caughtUpThrough`，它是当次观察的 head，不是“永远同步完毕”声明。
`contentType` 在创建时冻结，包括“未提供”的状态，不能以后补填/覆盖。
payload 是未解释的 UTF-8 字符串：不解析、规范化或重新序列化业务内容，拒绝孤立
UTF-16 surrogate。幂等比较是原始字符串的 UTF-8 内容，而不是业务 JSON 相等性。

## 持久性、重建与背压

一个设备只有一个 writer，活跃租约期间拒绝第二个 writer（`writer_busy`），不会
静默抢占。租约 60 秒，客户端每 20 秒发送 ping；所有写入检查持久 owner、
generation 及期限。释放/过期后的 writer 增加持久 generation，旧连接即便迟到也
无法继续追加。事件、stream head、用量更新在同一个 SQLite `transactionSync` 中，
成功 ACK 经 DO output gate 才能发出；不以业务投影成功作为同步确认条件。

休眠附件只保存连接 ID，完整且有界的连接/订阅状态（实际已交付位置、每条未确认
事件的 wire 字节数及时间）存 SQLite，避免超过附件的大小限制。休眠唤醒可以恢复
原窗口，不假装“已处理”。整个运行时/进程重启导致 socket 丢失时，重新握手并从
应用持久 cursor 重订阅；构造时清理不再存在的连接，保留 fencing generation 和日志。

窗口同时限制**每个连接合计**的事件数和完整交付帧字节数。额度不足时停止读日志，
不缓存无限历史；单条合法可追加事件总能在空窗口前进。持续未确认超过 60 秒返回
`slow_consumer` 并关闭连接，消费者从自己的已处理位置恢复。不用 heartbeat、
重复 ACK、超越已交付位置的 ACK 来扩大窗口。

## v1 资源和保留策略

以协议导出的 `LIMITS` 为准；这些是本实现限制，不是 Cloudflare 平台额度声明。

| 资源 | 限制 |
| --- | --- |
| 文本帧 | UTF-8 编码后 256 KiB；不接受二进制帧 |
| 单条 payload | UTF-8 64 KiB；转义后的 event JSON 同时受批次限制 |
| 单批追加 / 历史页 | 最多 128 条；events JSON 128 KiB；不是按 JS 字符数 |
| 每设备流 / 连接 | 128 / 8 |
| 每连接订阅 | 8 |
| 每连接未确认交付 | 128 条及完整 wire 帧合计 256 KiB |
| 每连接在途请求 / 固定 5 秒请求额度 | 16 / 64；超额显式失败并关闭 |
| 每条连接累计输出 | 4 MiB（另加最后一条小型错误帧）；达到后明确关闭，重新连接/从持久 cursor 续订 |
| 设备日志保留 | 64 MiB event JSON 用量或 1,000,000 条，先到者为准 |

SQLite 索引、页和元数据有额外物理开销；存储错误明确失败。v1 **没有自动清理**或
静默截断，配额满后新事件返回 `quota_exceeded`，原历史仍可读取、核对重复记录。
空流 `retainedFrom=null`，非空流为 `"1"`。未来若加入清理，需要另行实现
`cursor_expired` / `history_unverifiable`，不能把未知旧内容当已确认成功。

错误为 `error {code, message, retryable, requestId?, streamId?, subscriptionId?, expected?}`。
版本、认证、冲突、本地状态丢失等错误不可通过无限重连修复；`sequence_gap`
附带期望位置。配额、过期租约、慢消费者等需要明确重连/运维恢复，不会自动
改流名、重置序号或跳到最新。解析失败可能无法安全关联 requestId，连接级错误会
关闭连接或由请求超时让调用者显式感知。

累计输出额度不会随请求或 ACK 重置，用于在平台 WebSocket API 不暴露
`bufferedAmount` 时同时约束历史读取、控制响应及虚假 ACK 造成的传输缓存。
这意味着健康的长连接也会定期轮换；生产者 `runSync` 自动重新核对可靠源，
消费者应用必须实现断线后的重连和从持久 cursor 续订。它不是日志保留额度，
不会删除任何历史。休眠时该计数也持久保留。

## 可复现验证（只在本地）

```powershell
pnpm --filter @silvermoon-ai/sync-protocol test
pnpm --filter @silvermoon-ai/connector test -- src/sync.test.ts
pnpm --filter @silvermoon-ai/worker test -- src/device-sync.test.ts
pnpm test:sync:smoke
```

最后一条会先构建 Connector 和 Worker（`wrangler deploy --dry-run`，**不部署**），
再通过当前 Wrangler 自带的固定版本 Miniflare/workerd 启动真正的本地 HTTP/WS
监听器。使用 `.wrangler/sync-smoke-<uuid>` 独立目录；应用现有全部 D1 migrations；
只用运行时随机生成的测试 pepper、凭证及 HMAC 哈希种子，不读取 `.dev.vars`、
生产秘密、生产数据库或远端绑定。使用 Node `ws` 客户端、文件源和真实 DO SQLite。

smoke 覆盖历史/持续订阅、跨账户隔离、reader 禁写、WebSocket 代理实际丢弃持久 ACK
后的补传、内容冲突、整个 Worker 运行时与文件源重开、凭证轮换身份连续、
撤销旧连接、设备移除。正常或失败均清理 socket、运行时、文件；如需检查本地
存储，运行前设置 `$env:SYNC_SMOKE_KEEP="1"`，输出保留目录，用完自行删除。
这不是远程部署验收，也不等于已测试生产网络/区域故障。

开发过程中 Cloudflare 在线文档解析到受限制地址而未能获取；API、SQLite 事务、
WebSocket 附件、alarm、Wrangler 配置以仓库安装的生成类型、配置 schema 和上述
真实 workerd 测试为验证依据，没有据此推断新的平台额度或部署权限。
