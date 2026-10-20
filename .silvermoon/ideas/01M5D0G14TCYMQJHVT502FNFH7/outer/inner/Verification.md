# Devices 工作区实施证据

## 生产必需 CI 的账户切换阻塞 — 本地 FIXED，待新候选 CI

修正 Settings 后的 release `39473467729` 没有通过必需浏览器检查：276 通过、2 原有 skip，desktop 的“账户切换清除旧 pending 并停止旧订阅”用例在切换后等待新账户发送 opt-in 控件失败。deploy job 为 skipped，未上传本候选。该用例属于新增的账户边界验证，不能作为既有并行 fixture 风险忽略，也不能靠反复重跑或放宽断言批准上线。

主 Agent 已将 I-S03、I-AC02、I-AC03 重新打开。本次基于 `0a8da0d0b72a88e77339eb651ea1ba3e867c4924` 定位并修正根因，没有重试生产 CI、放宽超时或弱化原断言；原 CI 仍是失败记录，部署未执行，必须对新的精确 Inner 修订重新提交/验收，再让新候选通过必需 CI。

### 已确定的竞态与修正

旧账户 A 的 v2 请求在 cookie 已切到 B 时返回 `account_changed`（或旧会话返回 401），原 `useAccountApi` / `api` 将错误变成无身份归属的全局事件。Devices 根处理器把任何这类事件都当作当前会话失效，调用 `accountCheck.current.abort()`；这个 ref 此时可能已经是正在确认 B 的 `/api/me`。因此 A 的私有 pending 被隐藏，CI 的第一个断言通过，但 B 的确认也被取消，新的 opt-in 控件一直没有出现。等待旧组件 passive cleanup 才 abort 原请求也不能可靠封住“B 已确认但 A 的旧异步结果尚在队列中”的窗口。

先只加受控 Promise 屏障测试、不改应用源码，强制“旧请求已在途 → B 的 `/api/me` 已开始但暂不交付 → 交付 A 的 account_changed → 隐私消失 → 交付 B 确认”，原源码稳定失败在新账户控件缺失；日志 `.wrangler\device-workspace-auth-red.log`，不是靠重复原随机失败用例推测原因。

修正范围为共享 `api` 的可选认证回调（旧调用者默认全局通知不变）、Devices 的账户确认/请求生命周期，以及独立小型 `device-auth.ts`：

- 每个已确认 Account＋session 对应一个本地 generation 和取消 signal；新身份采用时，在 React 提交/旧组件清理前同步取消旧范围请求。失效回调只归属于捕获的 scope 对象，旧身份/旧 session/返回同一身份的旧 generation 均不能清除当前身份。
- Devices 的 401 与 account_changed 直接通知其身份所有者，不再发布/消费无归属全局失效事件。旧范围失败立即隐藏旧数据，但不取消正在发现新身份的 `/api/me`。若重叠确认竟返回刚被失效的同一身份，必须再做一次新确认，不能复活其私有 pending。
- `/api/me` 的每次 attempt 单独 fencing；旧成功/401 不能覆盖更新的确认。确认处理与清除在途引用在同一个 async try/finally continuation 完成，不留“已处理的确认仍被当成在途”的 Promise 链交接窗口；刚完成 A 确认后再收到旧拒绝也会立即开始新发现。当前 scope 的真实撤销仍清空页面、取消全部 scoped 读取；手动退出同样按当前所有者处理。session 轮换重新挂载只读 Composer，原账户 pending 可恢复但不自动 opt-in/resend；另一账户不能看到它。

### 本次确定性证据

新增 4 条纯状态测试覆盖立即取消、旧回调、同账户换 session、A→B→A 同值身份下的旧 generation 及真实当前撤销。新增 9 个浏览器用例各运行三宽度：旧 400/401 在 B 确认前交付、已完成确认后的拒绝主动触发新发现、旧 `/api/me` 成功/401 乱序交付、无效 A 确认不得短暂复活隐私（MutationObserver）、B/新 session 已确认后的迟到旧 401、当前撤销后用虚拟时钟推进确认全部订阅停止。通过显式屏障控制交付顺序，没有增加等待睡眠/超时或 skip。原 CI 失败用例原断言保持，另固定重复五次。

| 本次命令 | 结果 |
| --- | --- |
| `pnpm --filter @silvermoon-ai/web typecheck`；`pnpm --filter @silvermoon-ai/web test`；`pnpm --filter @silvermoon-ai/web build` | 通过；8 个测试文件、87/87 单元测试通过；构建仍只有既有 chunk 提示 |
| `pnpm check` | 退出 0，全部 lint/types/unit/build 通过；新增 auth 文件无新 lint warning |
| `$env:PLAYWRIGHT_BUILT_APP='1'; pnpm --filter @silvermoon-ai/web test:browser -- devices.browser.ts --grep 'old scoped\|completed account verification\|reordered account verification\|overlapping invalidated\|late scoped\|current-session revocation\|sign-out and account switching' --repeat-each=5 --workers=2` | **150/150 通过，58.8 秒**，1440×900 / 390×664 / 320×640，原 CI 用例与九种确定性顺序固定重复五次，而非失败重试 |
| `pnpm --filter @silvermoon-ai/web test:browser -- devices.browser.ts settings.browser.ts login-page.browser.ts --workers=2`（沿用构建页面设置） | **128 通过、1 原有 skip，55.9 秒**，包含全部 60 条 Devices 测试；认证、现代/legacy Settings 与导航均保留 |
| `pnpm test:devices:smoke`；`pnpm test:streams:smoke` | 均退出 0；真实本地 UI/backend/lib 的会话撤销与双向闭环、真实 v1 兼容通过；生产 dist 逐文件哈希前后不变 |
| `pnpm --filter @silvermoon-ai/web test:browser -- --workers=1` | 最终源码完整回归 **304 通过、2 原有 skip，10.4 分钟**；无自动 retries，原 CI 账户切换及全部 legacy/auth/Settings/Streams 断言保留 |

一次双 worker 中间候选全量运行有 300 通过、2 原有 skip，另一个旧 narrow Stream 用例在初始等待 `.session-state-dot` 时失败，未进入 keyboard 断言；这不是本次新增账户边界用例，也不抵消原真实 CI 失败。未修改该测试或旧页面，其原断言单独串行重复五次通过。随后补充“确认已完成后再拒绝”的确定性用例并收紧同一 async continuation 内的确认交接；最终完整串行回归 304 通过、2 原有 skip，不使用自动 retries。

本次最终日志为 `.wrangler\device-workspace-auth-final-{check,repeat,compat,smoke,stream-smoke,full}.log`，红测日志为 `.wrangler\device-workspace-auth-red.log`。I-S03 / I-AC02 / I-AC03 在上述新证据后重新勾选，全部 D 项保持未勾选。源码与本地新证据不宣称 Linux 必需 CI 已通过；以下旧 Settings/完整套件/Outer 验证仍仅为历史候选证据，所有 Outer 文件及 Ideal/Deployment/events 未改，生产操作和生命周期门禁仍由主 Agent 处理。

主 Agent 已直接审查身份 generation、同步取消、限定失效回调、`/api/me` attempt fencing 与同一 continuation 的交接分支，并独立运行 auth/持久状态 11/11 单元测试、Web typecheck 及定向 lint。构建页的两次三宽度受控顺序回归有 59/60 通过，唯一未运行到应用的用例在 `page.goto` 即遇到 Windows `ERR_NO_BUFFER_SPACE`；没有将其算作通过，另以单 worker 将原 CI desktop 账户切换用例固定重复三次，3/3 通过。原 CI 的应用内 opt-in 缺失与本地 OS 导航失败区分记录；仍须让新源码实际通过必需 Linux CI 才能部署。

## 最终导航复核退修 — FIXED

生产 release 检查期间，主 Agent 继续核对共享外壳，发现 `App.tsx` 的现代 Settings 仍以 Streams 为侧栏标题及 “Back to Streams” 返回标签，而实际根路径已经切换为 Devices。该问题由本次根路由改变直接引起，不是设置功能重做范围。主 Agent 已取消本次 release `39471185944`，确认 check/deploy 均为 cancelled、没有进行生产部署；要求修正现代 Settings 的导航语义并补桌面/窄屏回归，旧 `/legacy/settings` 的 Sessions 语义必须保留。

2026-10-21 在 `a81a80ea57857d5abd7bc07493849063fba31b7c` 上完成本次精确修正：仅现代 Settings 的移动返回 accessible name 改为 `Back to Devices`，现代侧栏的 label/标题/说明/返回链接改为 `Devices` / `Account messages` / `Back to Devices`。返回地址仍是原来的 `/`，未改设置管理、状态来源、token/identity 功能或 `/legacy/settings` 的 Sessions 分支。

新增三宽度回归不只检查字符串：桌面实际点击返回链接、手机实际点击返回按钮，断言根页面为 Devices、All devices 可见且请求账户 v2 上行；旧 Settings 仍为 Sessions，桌面可选择原 Session，窄屏返回 Sessions 后路径仍是 `/legacy`。原管理功能断言全部保留，只将旧现代返回文案期望更新为正确目的地；fixture 新增 v2 空页/清单响应以允许真正进入根 Devices 页面。

| 本次命令 | 实际结果 |
| --- | --- |
| `pnpm --filter @silvermoon-ai/web typecheck` | 退出 0 |
| `pnpm --filter @silvermoon-ai/web test` | 7 个文件、83/83 通过 |
| `pnpm --filter @silvermoon-ai/web build` | 退出 0，保留既有 >500KiB chunk 提示 |
| `pnpm exec oxlint apps\web\src\App.tsx apps\web\tests\settings.browser.ts` | 退出 0；仅 App 原有 fast-refresh export warning |
| `$env:PLAYWRIGHT_BUILT_APP='1'; pnpm --filter @silvermoon-ai/web test:browser -- devices.browser.ts settings.browser.ts --workers=2` | **92 通过、1 原有 skip，48.3 秒**；1440×900、390×664、320×640 实际构建页面，含新导航回归及全部原 Settings 工作流；skip 为 desktop 不适用的窄屏 Session 导航用例，无新增跳过或自动重试 |
| `pnpm test:devices:smoke` | 退出 0，真实本地 UI＋Relay/D1/DO＋Device lib、Settings/legacy、未知响应原键恢复等闭环通过 |
| `pnpm test:streams:smoke` | 退出 0，真实旧 v1 历史/raw/follow/离线 reload/会话撤销通过 |

新旧 Settings 的三宽度截图共六张在 `.wrangler\device-workspace-settings-rework-evidence\`，文件名为 `settings.browser.ts-modern-c16db-retains-Sessions-navigation-{desktop,mobile,narrow}-{modern-settings-devices,legacy-settings-sessions}.png`；已查看本次桌面/窄屏实际渲染。日志在 `.wrangler\device-workspace-settings-rework-{build,browser,smoke,stream-smoke}.log`。两个本地 smoke 前后生产 dist 逐文件哈希不变；随机状态目录与端口 4173 listener 均为零，没有生产/私有凭证/共享标签操作。

本次重新证明并勾选 I-S03 / I-AC03，全部 D 项仍未勾选。以下既有完整测试是前一候选的历史证据，本次未冒称重跑全仓或全量浏览器；新的精确 Inner 修订仍须由主 Agent 重新提交/验收，不能沿用旧修订的批准。Outer `Local-Verification.md` 保持未改，待新 Inner gate 后重新按新候选取得 Outer 验证。

主 Agent 复查了两处精确外壳修改，并独立执行构建模式下 `settings.browser.ts --grep 'modern Settings' --workers=3`：三宽度共 6/6 通过，实际点击现代返回与旧 Sessions 导航保持正确；Web typecheck 和 diff hygiene 亦通过。没有把执行错文件而未匹配到测试的初次选择器当作验证。

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
