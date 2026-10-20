# 实现证据

## 主 Agent 独立复核

2026-10-20 主 Agent 直接审查了 v2 协议、HTTP 鉴权/路由、AccountMessages 事务与所有权、通用库、CLI、宿主收据夹具和包入口变更。首轮发现本地状态丢失的启动失败仍保留 generation、未知存储/RPC 错误缺少诊断，以及 stop 不能取消重试间隔；已由同一实现 Agent 修正并补回归，主 Agent 复查了对应分支与断言，没有以自报通过代替复核。

主 Agent 在修正后的完整候选上独立执行，退出码全部为 0：

- `pnpm --filter @silvermoon-ai/worker --filter @silvermoon-ai/connector --filter @silvermoon-ai/sync-protocol -r test`：Worker 63、Connector 70、协议 14 通过；Connector 另有 1 个既有 skip。既有 Worker 故障注入的异常输出与 Node SQLite experimental warning 均明确保留，不作为新增功能失败或跳过证据。
- 相同三个包的 `-r typecheck` 与 `-r build`：通过；Worker 仅 dry-run 构建，没有部署。
- 对全部新增协议/Worker/lib/CLI/测试及相关 smoke/发布契约脚本执行定向 oxlint：通过。
- `pnpm test:release`：8 个契约测试通过，无发布动作。
- `node scripts\duplex-smoke.mjs`：真实 loopback HTTP、构建后公开 API/声明、普通宿主、完整运行时重开与真实 CLI 子进程全部通过，输出 `ok:true`，临时运行时均已停止。
- diff hygiene 通过，已验收 Ideal、Deployment seed、events 与 Web UI 相对实施基线未变化。

接受实现的范围是仓库内的有界协议、服务端、库与验证工具，不包括真实目标宿主跨仓库集成、生产部署或无限保留/容量保证。下述撤销重叠准入、无自动清理及宿主外部副作用限制是显式契约边界，不是隐藏失败或已完成 Outer 验证。本节是复核证据，生命周期接受仍须对同步后的精确修订另记事件。

## 候选与边界

在既有 `D:\Code\silvermoon-ai`、main 基线 `645e35e66f5d` 上实施；没有新建/切换分支或 worktree，没有提交、推送、生命周期事件、门限决定、部署、npm 发布或生产数据操作。Ideal 与 Deployment seed 保持不变。所有测试使用随机本地身份和隔离状态，不记录凭证。此文件是 Inner 实现证据，不是 Outer 验证或验收事实。

## 可复现命令与结果

2026-10-20 本地执行，以下最终命令退出码均为 0：

| 命令 | 最终结果 |
| --- | --- |
| `pnpm --filter @silvermoon-ai/sync-protocol test` | 2 文件、14 测试通过，含 2 个新增 v2 契约测试 |
| `pnpm --filter @silvermoon-ai/worker test` | 4 文件、61 测试通过，含 10 个新增真实 workerd/SQLite 双向测试 |
| `pnpm --filter @silvermoon-ai/connector test` | 8 文件、68 通过、1 个既有测试跳过；含 11 个新增持久库/CLI/故障测试 |
| `pnpm --filter @silvermoon-ai/web test` | 6 文件、76 测试通过；没有修改 UI |
| `pnpm --filter @silvermoon-ai/worker typecheck` | `wrangler types --check` 与 tsc 通过；新增 binding 类型由 Wrangler 生成 |
| `pnpm --filter @silvermoon-ai/connector typecheck`、`pnpm --filter @silvermoon-ai/sync-protocol typecheck`、`pnpm --filter @silvermoon-ai/web typecheck` | 全部通过 |
| `pnpm test:release` | 8 个纯本地契约/fixture 测试通过；未调用 registry preflight 主程序或发布 |
| `pnpm check` | 全仓 lint → typecheck → test → build 全部通过，退出码 0 |
| `pnpm test:duplex:smoke`，随后对最终增强脚本执行 `node scripts\duplex-smoke.mjs` | 真实 HTTP、完整运行时重启、普通宿主持久收据、实际 CLI 子进程和公开声明验证通过，输出 `ok:true`；临时运行时均 dispose，项目内本次状态目录删除 |
| `node scripts\sync-smoke.mjs` | 既有 v1 WebSocket/SQLite、ACK 丢失、窗口、独立来源重开、撤销与移除 smoke 通过 |
| `node scripts\stream-browser-smoke.mjs` | 既有真实 cookie 浏览器历史/实时/暂停/离线重载/撤销 smoke 通过，DOM/cache 有界 |
| `git diff --check` | 通过；仅现有 Windows LF/CRLF 提示 |
| `silvermoon check --worktree --audience agent` | snapshot 验证通过；primary 基线仍为 `645e35e66f5d`，没有修改事件或门限 |

`pnpm check` 的 Worker build 是既有 `wrangler deploy --dry-run --outdir dist`，没有上传/启用任何部署。存在 9 条既有 Web lint warning、Node SQLite experimental warning，Worker 既有故障注入测试会输出 `Test disconnect unavailable`；这些最终均不使检查失败。Connector 既有 skip 不代表目标宿主实际集成通过。

首次针对性检查发现并修正了 ID refine 对非法字符串抛 BigInt 异常、随机 session ID 下划线解析、生成类型的 decoder 选项、递归 JSON 的 RPC 类型展开；公开声明审查还发现私有 subpath 未内联和默认参数类型过窄，已修正并增加真实公开类型 smoke。新增包入口相应更新既有包契约测试，未改变发布授权或流程。以上修复后的最终回归均通过，不保留成功形状的 fallback。

## 稳定 ID 证据索引

### I-S01 / I-AC01：身份、恢复与兼容

- [v2 契约](../../../../../packages/sync-protocol/src/duplex.ts)：Message 五字段、JSON 十进制 ID、独立 submission key、JSON canonicalization，不要求 task/producer 业务字段。
- [库](../../../../../packages/connector/src/duplex.ts)与[公开包配置](../../../../../packages/connector/tsup.config.ts)：独立 `/duplex` surface、无 AHP/Supervisor 依赖；库无环境、日志、信号或 exit 代码。构建后独立子进程将 fetch/console/process 生命周期方法置为报错，导入公开 export/CLI 和构造仍成功；公共声明不残留私有 workspace imports。
- [库测试](../../../../../packages/connector/src/duplex.test.ts)：离线排队；已提交响应丢失后重开原 key 恢复同 ID；凭证供给更新；inbox/游标/远端映射重开；缺失或错误身份状态拒绝；本地容量在半页耗尽时整页与 cursor 一起回滚。
- [真实 smoke](../../../../../scripts/duplex-smoke.mjs)：关闭全部 Connector 与整套 Miniflare/workerd 后重开同一状态目录，换凭证仍保留已接受记录、未 ACK inbox 和历史；普通宿主按 Account＋Message ID 持久收据后 ACK，不重复插入收据。
- v1 源、迁移文件、UI 文件均未修改；既有完整测试及两个既有 smoke 继续验证旧身份和流来源。未改号、合并、复制历史，也没有把历史变成可执行 regulation。

### I-S02 / I-AC02：路由、全账户订阅与顺序

- [AccountMessages](../../../../../apps/worker/src/account-messages.ts)为每 Account 单表/单排序权威，不将 Device DO 的局部 ID 混入账户游标。分配 ID、Message、幂等映射、配额在 `transactionSync` 内，不存在分配后 await 的低 ID 延迟提交窗口；只有已提交事务的有序 ID 能被读取。
- [真实 Worker 测试](../../../../../apps/worker/src/account-messages.test.ts)：2 Client×2 Device 四个组合定向下发；每个 Client 得到两个 Device 全部上行；另 Account 无记录/越权拒绝；第三个 Device 加入后两个已经等待的账户轮询均收到，不需设备订阅清单。
- 15 次并发真实 HTTP 追加、`9007199254740991` 以上 ID、映射插入前 trigger 注入失败（已分配候选 ID 回滚）、已提交后删除的测试空洞、signed 64 位耗尽均有断言。客户端按数值 ID 排序读取，无重复或漏项；测试中的删除/保留边界注入仅在测试 helper 内，不开放生产操作。
- 原 key 重试不追加；更改内容、目标、方向、producer scope 拒绝。真实 HTTP 在 Relay 提交完成后故意丢响应，公开库原 key 重试只留一条。换浏览器会话/Device token 不重置稳定 producer scope 或映射。
- Client 短提交只到指定 Device，Device 短上报不能指定 Client 接收名单；账户长轮询以统一上行历史为权威，各请求窗口/Client cursor 独立。HTTP `accepted` 从未返回执行成功。

### I-S03 / I-AC03：故障、权限与资源

- 真实 Worker 测试拒绝旧 generation 的 append/read/等待 poll/ack/renew/release；显式 takeover 前冲突；同一状态文件的本地 claim takeover 也阻止旧实例更新。轮换 token 维持 generation、host receipt ACK 和原请求映射。
- 已建立的 Client 与 Device 长轮询在会话/凭证撤销后拒绝；删除 Device/Account、跨账户内部 stub 以及路径身份不符拒绝。Client/Device 凭证不可互换，Origin/CSRF 与显式会话 write-access 分别测试。
- 每页 32、等待 20 秒、每主体 4 窗口、载荷/请求/速率/Account/Device/本地容量有界；窗口耗尽不影响另一 Client 的独立补读。显式 retained_after 过期返回 410＋边界，不将空洞误判过期或偷偷推进游标。未来 cursor 与最大 ID 耗尽明确失败。
- 库测试 deadline-bounded 凭证供给、有限重试、offline queued/unknown acceptance、宿主收据提交后 ACK 丢失重放、停止时取消在途接收且不重试。已知 stale generation 不继续本地修改；不会自动执行 payload 或未知外部副作用。
- [薄 CLI](../../../../../packages/connector/src/duplex-cli.ts)调用相同公开方法；真实子进程执行 init/enqueue/flush/receive/state/ack。receive 打印后 pending 仍为 1，显式 ack 后变为 0；stdout 每行可解析 JSON，未知命令 stdout 为空、stderr 有诊断、退出码 1。凭证内容不输出。

## 明确限制与评审重点

1. 本次只交付有界仓库能力：没有目标 `objective-portfolio-supervisor` 跨仓库改造，没有生产接入、负载/容量承诺、发布、部署或 Outer 门限证据。
2. D1 鉴权准入与 DO 原子接收不是分布式事务。重叠撤销之前已准入的操作可完成；完成撤销之后的新准入、等待轮询及所有远端进度仍受授权/fencing。离线实例无法获知另一状态目录上的远端接管；宿主离线自治和外部资源副作用需自身授权/幂等/fencing/对账。
3. 初始 retained_after=0，本版不自动清理、没有 purge/备份回滚恢复 API；日志和幂等证据同寿命并受配额限制。本地已接受/已 ACK 证据也保留，满额明确背压。过期边界通过测试注入验证；真实清理、压缩、灾备或游标重置必须另行评审，不能声称已实现。
4. 同步 lib 没有隐藏后台循环；宿主显式调度 renew/flush/receive，必须在 60 秒租约内续租。`pending()`/state 是检查视图，不是外部副作用执行授权；宿主持久接收和业务执行记录分离，未知执行不自动重放。
5. 现有账户模型是 owner session，写入需当前 session 显式 CSRF opt-in；若未来出现委派只读角色，必须先扩充 grant authority，不能直接继承 owner 权限。没有新增 Client 资产或 Client–Device 配对。
6. Cloudflare 在线文档检索在本环境失败（文档抓取被网络地址策略拒绝、搜索服务不可用）；实现以仓库固定 Wrangler/生成类型、安装包 schema/help 与实际 workerd SQLite/RPC 测试为证据，没有编造在线文档结论。
7. 主 Agent 仍需审核完整未暂存候选、运行 Silvermoon candidate check，决定同步与 gate；本证据和 ledger 勾选均不是接受事件。

## 父 Agent 复核后的故障闭合修正

2026-10-20 22:42 本地完成以下定向修正；不改变 Ideal、Deployment、事件、提交或部署事实：

- AccountMessages 未预期失败记录结构化 `account_messages.failed`，带操作与 DO opaque object ID；HTTP/RPC 外层未预期失败记录 `message_api.failed`，带固定路由操作、角色和方法。仅记录安全分类，不记录原异常文本/SQL、凭证、请求 URL/query、请求键或 payload。预期 DuplexError 不噪声记录。真实 SQLite trigger 故障和拒绝的 RPC Promise 各有回归，断言显式失败和脱敏诊断。
- 远端 durable ACK 高于本地 cursor 时，start 不发布可用 generation，并永久 poison 当前实例：state 为 started=false/fenced=true；receive/flush/enqueue/pending/renew/ack/start 均不能继续，stop 关闭本地资源，stop 后 initialize 也不能清除此实例的 local_state_lost。需核实恢复状态并新建实例；失败启动已获取的远端租约自然到期，不借该租约继续推进。
- 确认并修复 stop 在重试 backoff 期间不能及时取消的问题：等待可中止，生命周期 epoch 同时取消之前排队的操作。fake-timer 回归在首个失败请求之后、100 ms 退避尚未到时调用 stop，断言无第二次请求、无剩余 timer，排队接收失败为 stopped。

最终检查均退出 0：定向 Connector v2 **13/13**、Worker v2 **12/12**；完整 Connector **70 通过、1 个既有 skip**，完整 Worker **63/63**；两个受影响包 typecheck、全仓 lint、`pnpm test:duplex:smoke`（含两个包 build、Worker dry-run、真实公开 API/CLI/runtime restart）通过。既有 9 条 Web lint warning、SQLite experimental warning 和既有 disconnect 故障注入诊断不变。本次没有重跑全仓 `pnpm check`，上表全仓结果属于前一轮；此次复核修正以上述受影响检查为准。
