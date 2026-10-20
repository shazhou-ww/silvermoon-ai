# Devices 工作区行为契约（待评审）

## 请求决定与范围

默认工作区是否改为 Devices 导航、账户全部上行视图及 Device 双向消息/定向发送，同时把 v1 Streams 留在显式只读历史入口？[视觉对比](ui-review/index.html)仅是解释性评审辅助，不是生产界面或行为契约；本文件定义拟议行为。本轮只做设计，不实现、不部署，不使用已提供的凭证文件或继续生产试用。

沿用已完成的 Account/Device/Client/Message 模型与 [v2 使用契约](../../../../../../docs/duplex-messages.md)。Connector 是嵌入 lib；Device 两个方向不是可创建的 Stream。没有新增实体、配对关系、身份键、生命周期或历史迁移决定，因此不另建业务 ER 图。

## Current / Proposed / Why

| 当前已核实行为 | 拟议变化 | 理由 |
| --- | --- | --- |
| 左侧 Streams，Device 分组下选择 stream；新 v2 Device 显示 No Streams produced yet | 左侧 Devices 直接选择设备；有 All devices 入口，无 stream 子层级 | 导航表达业务身份，不再把无旧 stream 当无通信能力 |
| 主区只读 seq/payload，可跟随、分页、定位与原始详情 | 账户区显示全部 Device 上行；Device 区显示有方向的双向 Message，按 ID 补读并定向发送 | 覆盖已上线的双向能力，而非只改菜单标题 |
| v1 writer 状态用于 Sync online / Offline history | v2 Device 状态缺少服务端证据时显示 Unknown；请求/接收状态单独显示 | 不用旧协议在线灯推断新设备活动或执行结果 |
| 页面不支持 v2 发送或 Client 双向历史 | 提案增加相应页面与 Client 只读 API；写入须用户显式启用当前会话 | 静态完整画面不能冒充已有后端能力或自动扩权 |

## 导航与消息范围

1. 默认 All devices 展示当前 Account 的全部上行 Message。Device 列表来自本账户设备清单，空消息设备仍可选；搜索只过滤展示，不新建配对关系，也不改变账户群发接收范围。
2. Device 页按指定 Device 展示上下行，方向明确为 Device→Client / Client→Device；Message ID 是 Account 范围自增十进制字符串，保留 payload 原貌与 raw 详情，不把 task/objective 当必填 schema。
3. 切换设备只是视图选择，不让其他 Device 的上行停止接收或被当作已处理；可以在实现中复用一条账户订阅并按范围缓存，但不在本契约指定具体组件结构。
4. 账户上行与 Device 双向读取范围不同，游标分别保存，不能拿账户上行较高 ID 跳过尚未读的下行。重连按原范围与已处理 ID 补读；过期、未来或失效游标明确报错，不静默跳到最新。
5. 窄屏保持现有“列表 / 详情”单面板模式，有返回 Devices 入口；账户全部上行与 Device 选择仍可达，不把整张双栏桌面缩成不可读的手机页面。

## 定向发送与状态

- Device 页目标固定为该 Device；若允许账户页发送，必须显式选一个目标且不提供“全部 Device”选项。无目标、无有效 JSON、无当前会话写权限时不提交。
- 初始不自动 POST write-access。由用户主动选择启用本会话发送，经现有 cookie、Origin、CSRF 与服务器授权校验；页面只读状态仍可接收账户上行，撤销/过期立即停止访问。
- 发送前持久保存请求幂等键、目标与 payload；发送中禁止误触重复提交。响应未知时保留内容与原键，明确“结果未知，可检查或以原键重试”，不能换键悄悄再发。
- HTTP accepted 只显示“Relay 已接收 #ID”。当前没有面向 Client 的 Device 收据/执行状态 API，不显示已送达、执行中或成功，也不从 opaque payload 猜状态。未来若采用业务 events 投影，需要独立明确 schema 与关联规则。
- 读取、滚动、查看详情、发送成功不提交 Device 消费 ACK；浏览器从不取得 Device token。
- Device 暂时离线或状态未知不等于 Relay 不能持久接收。已经停用/不存在/跨账户的目标由服务器拒绝，页面保留错误和输入，不偷偷改投其他设备。

## 必须补齐的接口与未决项

已上线的 v2 Client 只有账户上行 GET/长轮询和定向 POST；Device 下行 GET 使用 Device 凭证，不能直接拿来给浏览器用。

本提案需要**账户授权的指定 Device 双向只读分页/订阅能力**，以同一权威 Message 表和 ID 安全读取两个方向，校验当前会话与 Device 所属 Account，保持无消费 ACK 权限。路径、过滤参数、如何复用账户订阅及分页水位由实施细化；在接口实际存在并通过测试前，不能发布一个仅靠内存追加“发送气泡”伪装完整历史的 UI。

Device 名单可复用现有元数据，但 v1 writer 在线标志不可当 v2 在线证据。此版先显示 Unknown/状态未提供，不要求为了上线画面另加心跳、Device 管理实体或假在线灯。

服务端只读授权范围须评审确认：本账户 Client 可读该账户指定 Device 的双向历史；不能跨账户，也不把会话写入 opt-in 当设备执行授权。未来若存在委派只读角色，须沿用其真实权限，不能自动提升为 owner。

## v1 历史兼容

- 原 `(account, device, stream, seq)` 仍是 v1 定位，不转成新 Message ID，不按内容猜映射，不合并/重编号/删除。新消息视图不把旧 seq 画成自增 Message ID。
- 提供明确的 v1 Stream history 入口，保留当前只读浏览、跟随、定位和 raw 详情；旧 `?device=...&stream=...` 深链接继续打开原历史或明确转入保留历史页，不替换为另一 Device 的 v2 消息。
- `/legacy` 的旧 Session 页面、账户/设备/token 设置不重做。设备删除、凭证轮换及数据清理仍走既有显式权限流程，不借本次 UI 评审授权生产变更。

## Before 来源与样例边界

2026-10-20 直接核实用户共享的生产标签页，以及 [StreamsApp](../../../../../../apps/web/src/streams.tsx)、[streams.css](../../../../../../apps/web/src/streams.css) 和 [index.css](../../../../../../apps/web/src/index.css)：实际左侧按 Device 展开 Stream，选中页有 read-only、历史范围、Pause/Latest/Previous/Next/Locate 和 raw 详情；无旧 Stream 的新 Device 仅显示 No Streams produced yet。

对比 bundle 采用相同外壳、颜色、设备名、旧日志和新消息的固定虚构数据；保留现有英文产品标签便于比对，中文为评审说明，不提出全站翻译。Before 只呈现当下能访问的 v1 记录，After 展示同一组场景中的 v2 记录；两者命名空间不同，并非把旧 seq 转成新 ID。样例不包含真实账户名、凭证、生产 payload 或用户设备 ID。

## 评审材料验证

已用仓库现有 Playwright/Chromium 实际从本地 file URL 打开入口，逐一访问三种场景，并单独打开 `02-device.html`。1600px 桌面与 390px 窄屏共六个组合均检查通过：桌面并排、窄屏按 Before/After 顺序堆叠，两侧等宽；无文档横向溢出、iframe 嵌套滚动或被裁切的内容，控制台无错误。

实际验证场景链接、ArrowRight/End/Home 切换、当前 tab 状态及可见键盘焦点；查看全部六张渲染截图后确认标签、方向、目标与未确认状态可读，旧日志没有伪装成新 Message。画面中的产品控件是非交互的静态说明，不发网络请求；唯一实际交互是评审场景导航。验证浏览器已退出，用户共享的生产标签页未被导航或修改。

以上仅是评审材料检查；应用实现、API、真实双向收发及部署均未据此宣称完成，所有下游种子保持未勾选。
