# 本机隔离运行验证证据

## 执行依据与环境（D-S01 / D-AC01）

本轮在 Deployment 契约同步并重新观测为 deploying/downstream 后，于 **2026-10-20 22:50–22:51（+08:00）** 独立执行；不以 Inner 的旧结果替代以下运行。

| 项目 | 执行前核实值 |
| --- | --- |
| primary、HEAD、origin/main | `36c340d7169ed3991d5aadbbc19ad54dd4c999c3` |
| 已同步、执行所依据的 outer tree | `8a1f09619f2ea1f4f4d2e4e63863cb0d88e66cea` |
| 已接受实现提交 | `44ca14dad6aa48179fb98acc81efbf22138ca863` |
| 已接受 Inner tree | `a9b2fdd8915cb9263065aaa8150897a709d6d910` |
| 观测事件 digest | `9cee54de93459a1a3db60aaa7491e93e6e4a9146` |
| 程序 | Node `v24.12.0`、pnpm `10.27.0`、仓库 Wrangler `4.147.0`、Connector manifest `0.3.0-canary.4` |

执行前工作区干净；应用、包和脚本相对实现提交无变化。复用父 Agent 已于 22:43:34 构建的 `packages\connector\dist` 与 `apps\worker\dist\index.js`，本轮没有重新构建或部署。此处版本号不表示 npm 已发布。

三个 smoke 的 Miniflare/workerd 明确绑定 `127.0.0.1`，首次端口由 `0` 分配；各脚本等待 `runtime.ready` 并断言 `/health` 返回 200 后才继续。v2 整套重启复用首次分配的本地端口，浏览器静态服务器和 v1 ACK 丢失代理也只监听 loopback。独立 D1/SQLite 状态位于项目内 `.wrangler\{duplex-smoke,sync-smoke,stream-browser-smoke}-<UUID>`，三个 smoke 均逐条应用 `0001_initial.sql` 至 `0014_connector_archive_commands.sql` 全部 **14** 个本地 migrations。

三个 smoke 的凭证 ID/secret 与状态目录、v2 提交请求键随机生成；duplex/sync 的 Account/Device 显示夹具名在各自全新隔离 D1 内固定，浏览器 Account/Device 则为随机 UUID，不接触任何既有账户。Workers suite 使用本地专用 fixture/测试 secret，经本地 cloudflare Vitest runtime/`SELF.fetch` 执行，其 URL 的生产样式 hostname 不是外部网络访问目标。没有生产绑定操作、外部目标宿主访问、registry preflight、上传、发布、提交、推送或门限事件。

## 本轮命令与观察（D-S02 / D-AC02）

| 实际命令 | 退出码 | 本轮结果 |
| --- | --- | --- |
| `node scripts\duplex-smoke.mjs` | 0 | 输出 `ok:true`，全部 5 组检查通过 |
| `pnpm --filter @silvermoon-ai/worker test -- src/account-messages.test.ts` | 0 | 真实 workerd/SQLite **1 文件、12/12 测试通过** |
| `node scripts\sync-smoke.mjs`（本次进程 `SYNC_SMOKE_KEEP=0`） | 0 | 输出 `status:"passed"`、9 组检查、`stateRetained:false` |
| `node scripts\stream-browser-smoke.mjs` | 0 | 输出真实 producer→workerd/SQLite→cookie 浏览器 `PASS`，断言全部通过 |

本轮没有代码改动；以上检查无失败。Node 的 SQLite experimental warning 不影响退出码。

### 双向链路与隔离

- 构建后的公开包 export/声明可用；独立子进程验证导入/构造无网络、输出和进程生命周期副作用，公共类型可接受宿主自定请求键和有界 flush 参数，无私有 workspace import 残留。
- 真实 HTTP 下两个 Client 各向两个 Device 提交，下行各 Device 接收两条且校验自身归属；两个 Device 的上行在两个 Client 账户历史中相同。提交后故意丢弃 HTTP 响应，库沿原请求键重试而不重复追加。
- 关闭 Connector 和完整 Miniflare/workerd 后重开原 SQLite/D1/DO 状态，轮换 Device token；已接受映射、未 ACK inbox 与历史仍在。接收可重复观察而不隐式 ACK；普通宿主以 `(account_id,id)` 存储收据后才 ACK，最终四条对应收据、pending 归零，不将业务执行结果作为传输成功。
- 第三个 Device 加入后，两个既有账户长轮询都收到该来源，无逐设备登记订阅名单。
- 实际 CLI 子进程执行 init/enqueue/flush/receive/state/ack：receive 打印后 pending=1，显式 ack 后 pending=0；stdout 单行 JSON 可解析，未知命令 stdout 为空、stderr 诊断、退出码 1，不输出凭证。
- 12 个真实 Worker 测试补充另一 Account、会话写入 opt-in、Origin/CSRF、Client/Device 凭证隔离、内容/目标/方向幂等冲突、15 次并发追加与精度/回滚/空洞、旧 generation 全路径 fencing、已建立轮询撤销、Device/Account 删除、换 token 后进度保留、页/窗口/速率/配额/过期 cursor，以及安全的未预期故障诊断。

## 兼容、恢复和资源退出（D-S03 / D-AC03）

- v1 smoke 通过真实 WebSocket 追加/历史/连续补读、字节窗口及精确/重复/越界 ACK、跨账户与只读写入拒绝、真实 ACK 丢失后的同内容重试与冲突拒绝。两个独立来源保留原 stream/seq，生产者数据库＋完整运行时重启后从原 cursor 恢复；已建立连接撤销、Device 移除与重新连接拒绝通过。
- 实际 Chromium 浏览器完成 cookie 授权的旧历史、raw detail、连续追加、暂停、设备离线后重载和 session 撤销；页面无预期外错误、不加载 token 管理 API。DOM≤200、cache≤2000 条且≤8 MiB 是测试中的既定断言，不是生产性能结论。
- 每个 smoke 的 finally 已执行 Connector/WebSocket/SQLite、runtime dispose；v1 代理 socket 终止并关闭；浏览器 close、静态 HTTP server close；实际 CLI 子进程均等待退出。Vitest runner 正常结束。
- 运行后三个 smoke Node PID **19564、20804、46580** 均已退出；检查无 workerd/headless Chromium 助手，亦无本轮新启动的 Playwright Chromium 进程。三个 smoke 状态目录模式均无遗留，执行后 Git 工作区仍干净；没有删除既有目录或按进程名终止其他程序。

## 已验证范围与限制

主 Agent 已复核本轮证据与同步契约的六项 D 要求：运行依据先于执行同步，四条命令均退出 0，真实运行/恢复/显式确认及旧浏览器兼容覆盖契约，限制没有冒充成功。再次核对工作树仅本证据与 D 清单变化，应用、Ideal、Inner、Deployment 契约及事件均未被实现 Agent 改动；本次 smoke 状态目录无遗留。门限决定针对证据同步后的精确 Outer 修订，不把清单勾选视为接受。

1. Message ID 是 **Account 范围**的单表自增十进制 cursor，不跨账户比较，也不混合 Device 局部 ID；旧 account/device/stream/seq 来源不改号、不并表为可执行 regulation。
2. 无自动保留清理、压缩或灾备恢复能力。本轮的 cursor_expired 是 Worker 测试注入边界的明确拒绝；存储满额背压，不静默删历史/幂等证据或跳过未接收下行。整套本地重启不等于完成备份回滚/灾备演练。
3. D1 撤销鉴权准入和 DO 原子追加不是跨服务事务：已准入的重叠操作可完成；撤销完成后的新准入、等待轮询和远端进度仍受授权及 fencing。
4. 库不执行 payload；宿主负责持久接收、业务幂等、外部资源 fencing、未知副作用对账及其离线自治策略。普通收据夹具不是真实 `objective-portfolio-supervisor` 集成，也不证明业务执行 exactly-once。离线实例不能凭空获知远端接管。
5. 本轮只接受同步契约指定的本机隔离验证结果，不声称生产容量/延迟、Cloudflare 生产部署、npm 发布、外部宿主接入或清理/DR 支持；没有操作生产账户、设备、事件或凭证。
6. 本证据增加后 outer tree 将变化；上表 tree 是**执行前已同步契约的依据**，不是新增证据后的提交或接受。ledger 勾选仅记录本轮已验证工作；父 Agent 仍负责复核、同步、submitOuter 与最终决定。
