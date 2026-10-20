# Devices 工作区实施证据

## 主 Agent 独立复核

主 Agent 直接审查了 Client 只读 API/账户隔离、路由兼容、Devices 页面、持久游标与发送恢复、实际桌面/窄屏截图。首轮指出同账户多标签页 localStorage 读改写可能覆盖未确认请求，以及手机直达链接未进入详情；已由同一实现 Agent 退修为账户范围 Web Locks、提交前同步重入保护、单调游标与按原 key 清除，并补齐两标签页/直达/前进后退回归。还要求增加真实本地 UI＋Relay＋Device lib 闭环，不能仅以 mock API 通过冒充集成。

主 Agent 在修正候选上独立执行，全部退出 0：Worker v2 测试 15/15、持久状态测试 7/7；Worker/Web/sync-protocol 类型检查；Web 生产构建；全部新增/核心变更的定向 oxlint；构建后真实页面的 33/33 桌面/手机/极窄屏回归（含两标签页、锁不可用与旧深链接）。`pnpm test:devices:smoke` 也独立运行通过，真实 loopback UI、workerd/D1/DO、Device lib 的 2×2 路由、原键恢复、显式 ACK、账户上行、双向历史及旧 seq=18 链路均有断言，且没有 mock HTTP、生产写入、凭证泄漏或生产 dist 改写，助手已清理。

主 Agent 接受下文列明的 Web Locks/localStorage 前提、未知 presence/执行状态及旧并行 fixture 偶发超时限制；没有削弱既有断言或把串行通过说成并行稳定。Ideal、Deployment 种子和事件相对实施基线保持不变。本节仅为实现复核证据，后续运行/部署必须先同步相应 Outer 契约，再由主 Agent 对准确修订记录门限决定。

## 候选边界

2026-10-21，在原 `main` checkout 上实现；没有创建分支/worktree、提交、推送、追加生命周期事件或执行部署。Ideal 目录、`events.jsonl` 和 Deployment 种子未改。以下为本地夹具证据，不是生产部署或真实 Supervisor 集成结论。

协议模块仅将 `DuplexError` 的 TypeScript 参数属性展开为等价显式 readonly 字段，以便 Web 的 `erasableSyntaxOnly` 配置直接消费现有 v2 入口；没有改变构造参数、错误码、包导出或 Connector 语义。初次 Web 类型检查暴露的 TS1294 已通过该精确修改解决。

关键入口：

- [Devices 页面](../../../../../apps/web/src/devices.tsx)、[持久状态与读取范围](../../../../../apps/web/src/device-messages.ts)、[页面路由](../../../../../apps/web/src/main.tsx)。
- [Worker HTTP 路由](../../../../../apps/worker/src/message-api.ts)、[AccountMessages 权威读取](../../../../../apps/worker/src/account-messages.ts)。
- [真实 Worker 测试](../../../../../apps/worker/src/account-messages.test.ts)、[状态单元测试](../../../../../apps/web/src/device-messages.test.ts)、[真实页面测试](../../../../../apps/web/tests/devices.browser.ts)、[保留的 v1 浏览器回归](../../../../../apps/web/tests/streams.browser.ts)。
- [真实本地 Devices 集成 smoke](../../../../../scripts/device-workspace-smoke.mjs)、[保留的真实 v1 浏览器 smoke](../../../../../scripts/stream-browser-smoke.mjs)。
- [实际使用/权限/缓存契约](../../../../../docs/duplex-messages.md#devices-workspace-checkout)、[v1 兼容入口](../../../../../docs/stream-workspace.md)。

## 已验证行为

### I-S01 / I-AC01

新增元数据清单 `GET /api/v2/devices`，按 Device ID 稳定分页，每页至多 32 条，不触发旧 writer presence、不返回凭证。新增 `GET /api/v2/devices/:id/messages`，账户会话只读同一权威 Message 表中的双向记录，复用既有字符串 ID、32 条分页、长轮询配额和游标错误；不新增存储表、配对实体、消费者身份或 ID。

真实 workerd SQLite 夹具包含两个 Device、两个 Client 及另一账户，断言：

- 同账户两个 Client 都能读全部设备上行、指定 Device 的上下行；更高的账户游标不影响 Device 从零读取较早下行。定向 POST 仍只写目标设备。
- 未授予写权限的会话可读双向历史；撤销 Device token 不影响所有者会话读取。Device 凭证不能成为 Client 凭证，Device principal 不能调用内部双向读取，浏览器没有 ACK 路由，读取后真实 lease 的 ACK 仍为零。
- 非法 Origin、跨账户/不存在/移除目标、会话撤销、账户删除均拒绝；等待中的请求重验会话和目标。`x-account-id` 不匹配时，读写都在操作前拒绝。
- 空设备仍在清单；清单分页不重叠、无凭证/假在线字段。双向分页覆盖超过 `2^53` 的 ID、精确下一页、未来游标 409、过期游标 410 和明确保留边界。

### I-S02 / I-AC02

默认账户上行订阅与选中设备订阅分别存在，搜索/选择只是展示操作；独立持久游标与缓存存于账户命名空间。持久状态单元测试覆盖有效目标、显式 opt-in、有界 JSON、原请求恢复、账户隔离、范围隔离、损坏/失败存储和缓存上界。

共享 localStorage 对象的所有修改现以账户命名的排他 Web Lock 串行化，锁内重新读取再修改，不依赖 storage event 假装事务。确定性交错测试在 feed 读取旧快照时排入另一标签的 pending 写入，证明最终 feed 与原请求都保留；并发新 key 只能一个获得 pending。较旧游标不能回退新游标，旧请求不能清除新 pending，已持久接受的请求不会被旧页降为未知；原键重试若读到已接受记录直接显示原 ID，不再 POST。获取锁限时十秒，无 Web Locks 时明确失败；guard 在 await 锁之前设置，避免排队期间连点提交两次。

实际页面测试覆盖：未 opt-in/无效 JSON 禁止提交；发送前本地保存失败时没有 POST；丢失响应后只保留原 key/target/payload；切换设备不能改投；reload 不自动启用或重发；人工原键重试后只显示 Relay accepted #ID 和收据/执行未确认。pending 时按钮禁用，接受后的新请求必须显式开始。账户变化、退出及 401 撤销清除旧页面并取消读取，不向新账户显示旧 pending。

同一 browser context 的两个真实标签页共用实际 Web Locks/localStorage：第一页持锁，第二页连点发送；锁等待期间零 POST，释放后只发一次，第一页随后接收并保存新上行消息；第二页丢失响应后 reload 仍保留完整原 key/target/payload，人工重试体完全相同。另有禁用 Web Locks 的显式失败与 320px Device 直达链接/Back/Forward 详情回归。测试 HTTP 夹具与真实本地闭环的证据边界如下，不相互冒充。

失败读取保留已加载消息，显示原游标/范围 Retry；空历史明确不同于错误。实时和历史分页游标互不推进。220 条长 payload、超过 `2^53` 的夹具验证缓存 ≤128 条/512KiB、实时 DOM ≤32 条、有限分页请求和从零补读；Device 状态只显示 Unknown。账户接收在初次即时读取后长轮询；Device 展示用 `wait=0`、空页后一秒再读，避免切换目标时不可取消的服务端 DO RPC 长轮询占满同一会话订阅槽位，API 自身仍支持双向长轮询。所有 Relay URL 在新浏览器测试中均由本地夹具拦截，拒绝未预期 API，不存在浏览器 Device ACK/token 请求。

### I-S03 / I-AC03

真实构建后的应用用 Chromium 打开，非 Ideal 静态 HTML：

| 项目 | 实际 CSS viewport | 验证 |
| --- | --- | --- |
| desktop | 1440×900 | 账户、双向设备、空设备/权限、未知/已接受发送；桌面侧栏、raw 详情 |
| mobile | 390×664 | 同样场景，列表/详情单面板、Back to Devices、可读换行 |
| narrow | 320×640 | 同样场景，无文档横向溢出，按钮及 JSON 输入可达 |

键盘 Enter 打开原始详情，关闭恢复消息列表焦点；Home/End 操作有界列表，Back 恢复所选 Device 按钮焦点。`/?device=…` 初始及浏览器前进/后退均打开该 Device 详情，移动 Back 只回列表；`?stream=…` 路由仍保留 v1。保留 `/history` 的全部既有 v1 follow、分页、定位、raw、授权、缓存与窄屏断言；原根 `?device=one&stream=observations&seq=18` 读取原 v1 seq=18 文本，没有请求 v2 消息。现有 Settings 与 `/legacy` 回归保持原断言。

HTTP 夹具构建应用截图 15 张保存在本 checkout 的忽略目录 `.wrangler\device-workspace-evidence\`，另有下节真实闭环的两张截图，不提交夹具 payload 或浏览器状态：

- `devices.browser.ts-account-a21e6-oard-detail-and-mobile-Back-{desktop,mobile,narrow}-{01-account,02-device,03-empty}.png`
- `devices.browser.ts-explici-83457-the-original-target-and-key-{desktop,mobile,narrow}-{02-device-unknown,02-device-accepted}.png`

已检查桌面、手机与极窄屏实际渲染图；截图为 1×/3× 设备像素比，CSS viewport 以上表为准。应用自身采用可滚动详情区，截图可能停在操作后的滚动位置；这是实际产品滚动状态，不是静态对比 iframe。

## 真实本地 UI → Relay → Device lib 闭环

新增可复跑的 `pnpm test:devices:smoke`：真实构建应用、Miniflare/workerd、全部真实 D1 migration、SQLite AccountMessages/DeviceSync 与现有 DeviceConnector lib 同时运行；三个随机本地账户会话 context（同账户两个 Client，加另一账户）、两个目标 Device 加另一账户 Device。不使用 HTTP 响应 mock，页面网络只允许 `127.0.0.1`：

- 两个 Client 均能在账户视图读到两个 Device 的真实 lib 上行；各自向两个 Device 显式 opt-in 后分别提交，共四条唯一下行。实际 lib 各接收两条，目标/方向正确，另一账户 Device 接收零条；读取/JSON 格式化/re-receive 后 pending 仍为二，浏览器与 lib 均没有 ACK 请求。
- 对第一次 POST 使用 `route.fetch` 真实转发至 Worker，消费真实 accepted 响应后只丢弃浏览器交付；reload 不重发，人工相同 body/key/target 重试返回原 ID。真实 Device 历史只有两条下行，没有把丢响应重试变成第五条唯一消息。
- 两个 Client 的各 Device 视图都展示真实双向记录。选中第一台 Device 时，第二台 lib 再上行；账户后台游标持久收到该 ID，两个 Client 切回 All devices 均可见。跨账户双向读取 404；实际撤销一个 D1 session 后页面回登录。
- 1440×900 桌面及 390×664 窄屏实际打开/键盘 raw 详情/恢复焦点/Back，无横向溢出。另以真实 v1 FileEventSource/SyncClient 写入 18 条独立记录，旧根 device/stream/seq=18 链接显示原 `original v1 fixture 18`，没有替换成 v2。真实 `/legacy` 与 Settings 页面可开。
- Device 凭证只在 Node 内存里生成/使用，从不进入页面代码或输出；检查页面 HTML 不含本地 Device secret/完整 token，浏览器从未带 Device authorization 或请求 Device `/v2/...`。没有读取任何用户凭证、生产数据或共享会话。

真实闭环截图为同一忽略证据目录中的 `local-smoke-desktop.png`、`local-smoke-mobile.png`，均已查看。应用本地 Relay URL 的 build 输出仅在唯一 `.wrangler\device-workspace-smoke-<uuid>\web`，绝不覆写 `apps\web\dist`；调整现有 v1 smoke 同样使用私有 build 并打开 `/history`。验证前后逐文件比较生产 dist 字节哈希，两个 smoke 均未改变它。

新 smoke 总体限时 120 秒，Node HTTP 10 秒、构建 30 秒、浏览器操作 10 秒/导航 15 秒，客户端/runtime 清理各 15 秒、HTTP 关闭 5 秒；finally 停止真实 Device lib、浏览器、v1 producer、Miniflare、静态服务器，并删除唯一随机目录。成功输出仅在清理完成后出现。首次试跑已通过全部业务断言但清理误用了不存在的 lib `close()`，退出 1；已改为公开 `stop()`、补齐有界 finally 并删除该次自有目录，之后完整 smoke 退出 0，目录残留为零。

## 命令与结果

所有命令在 `D:\Code\silvermoon-ai` 执行；依赖已存在，没有安装包。

| 命令 | 实际结果 |
| --- | --- |
| `pnpm --filter @silvermoon-ai/worker test -- src/account-messages.test.ts` | 15/15 通过，真实 workerd/SQLite |
| `pnpm --filter @silvermoon-ai/web test -- src/device-messages.test.ts` | 7/7 通过，包含确定性交错与多 key 竞争 |
| `pnpm --filter @silvermoon-ai/worker typecheck` | 生成绑定类型检查与 TypeScript 通过，未修改配置 |
| `pnpm --filter @silvermoon-ai/web build`；`$env:PLAYWRIGHT_BUILT_APP='1'; pnpm --filter @silvermoon-ai/web test:browser -- devices.browser.ts --workers=3` | 最终构建应用 33/33 通过，15.4 秒；包含三宽度两标签页、锁不可用及直达链接回归 |
| `pnpm check` | 通过：lint、全部类型检查、8 条 release 测试；protocol 7、sync-protocol 14、web 83、worker 66、connector 70 通过/1 原有 skip；全部构建通过，Worker 仅 dry-run |
| `pnpm test:devices:smoke` | 退出 0，真实本地 UI + Worker + D1/DO + Device lib 闭环及完整清理通过；无 mock HTTP |
| `pnpm test:streams:smoke` | 退出 0，真实 v1 producer→workerd→cookie 浏览器历史/raw/持续追加/暂停/离线 reload/会话撤销通过 |
| `pnpm --filter @silvermoon-ai/web test:browser -- streams.browser.ts --project=narrow --grep 'decimal locate' --repeat-each=5 --workers=1` | 原断言未改，5/5 通过 |
| `pnpm --filter @silvermoon-ai/web test:browser -- session-list.browser.ts --project=desktop --grep 'status views, parent context' --repeat-each=5 --workers=1` | 原断言未改，5/5 通过，10.7 秒 |
| `pnpm --filter @silvermoon-ai/web test:browser -- --workers=1` | 最终完整回归 274 通过、2 原有 skip，10.2 分钟，无自动 retries；保留全部旧断言和 test-only registry harness |

首次尝试把全部 v1 回归也放到 preview 时，66 条通过、3 条 test-only registry harness 失败：该开发测试 HTML 不属于生产构建，preview 的 SPA fallback 打开了普通页面。没有修改/跳过原断言，改为构建应用单独验证新工作区，保留完整开发服务器回归运行原 harness。首次全量开发服务器回归 262 通过、2 原有 skip；随后增加撤销用例，最终回归 265 通过、2 原有 skip。

可靠性补充后第一次三 worker 全量运行有 273 通过、2 原有 skip，另一个未改业务逻辑的 narrow v1 decimal-locate 用例在初始选择 Stream 时 30 秒超时（尚未执行 locate 断言）；未修改/放宽/跳过其断言。该用例随后串行重复五次全部通过。两 worker 全量运行同样 273 通过、2 原有 skip，但不同的 desktop Session 旧用例在 fixture 初始加载等待 5 秒失败（尚未执行状态/hover 业务断言）；该用例也单独串行重复五次全部通过。没有据此修改旧页面或削弱测试，最终单 worker、无自动 retries 的完整回归 274 通过、2 原有 skip；并行 fixture 初始化的偶发超时作为评审风险保留。

## 原有提示与限制

- lint 有 9 条既有 React fast-refresh/effect/ref 提示，无 error，新增 Devices/持久状态/新测试没有新增 lint warning。构建仍有 >500KiB chunk 提示；Node SQLite 仍有 experimental 提示；Wrangler 提示有新版本，没有更新依赖。
- Connector 的 1 个原有 skip 是 Windows 不运行的 POSIX 权限用例。浏览器 2 个原有 skip 是仅移动导航用例在 desktop 上不适用；未新增 skip。
- Durable Objects 在线文档抓取被网络工具地址策略阻止。没有增加新平台机制；使用仓库已安装 Cloudflare 插件、生成类型、现有 RPC/SQL 模式和真实 workerd 测试验证。
- 需要可用的浏览器 localStorage 及安全上下文中的 Web Locks；无锁、损坏、配额或获取锁超时显式阻止未持久化发送/游标推进，没有不安全 fallback。pending 为重载恢复而按账户保留在本地；退出或另一账户的 UI 不显示它，但这不等同于对不受信任浏览器配置文件提供加密存储。
- 缓存不是完整归档；被逐出设备范围连同游标一并移除，再选时从零补读。游标过期/未来不会自动重定位或删除数据。未知请求不提供静默放弃/换键/改投捷径，只能核查或原样重试。
- 页面和新读接口尚未生产部署；没有真实 Device 收据/执行状态 API、presence 系统、objective-portfolio-supervisor 适配或容量/灾备承诺。本轮没有接触生产设备、日志、凭证文件、共享浏览器会话或远程 D1。
- Git 同步、独立代码评审与所有生命周期提交/验收由父会话处理；此证据不代替这些门禁。
