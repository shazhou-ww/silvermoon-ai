# Account、Device 与 Client 双向业务模型评审

## 请求决定

1. 以 Account 为中心，统一称 Device（下游设备端）与 Client（上游用户客户端），两端为多对多关系；将 Device→Client 单向消息升级为双向：Client 每条 regulation 指定一个 Device，每个 Device 每条 event 群发给同 Account 所有 Client。
2. Device 是唯一的下游业务身份，消息、历史和固定两个方向均归属 Device；Connector 仅是 Device 连接 Relay 的程序，不是额外业务实体，不拥有另一套业务 ID、流或历史。程序更换、重连、重启和凭证轮换不更换 Device。保留设备自治、消息追加不可改写与各方向独立确认，不再开放用户创建多 Stream。
3. 认可先版本隔离、旧历史只读可定位的迁移方向；不在此批准精确字段、物理 schema、传输技术或切换方案。

## Current / Proposed / Why

| Current（已核实源代码） | Proposed（目标模型） | Why |
| --- | --- | --- |
| 现有消息从 Device 上行到 Client；浏览器只读，v1 按 account/device 路由并显式订阅设备内 stream | Account 拥有多个 Device 并授权多个 Client；每条下行只到指定 Device，上行到该 Account 全部 Client，每个 Device 固定两个方向 | 多对多业务通信不等于下行群发；上行群发不依赖 Client 逐设备选择订阅 |
| 同一 device 有单活动 writer lease/generation，浏览器只读订阅 | 单活动 Device 实例消费下行及上报；多个 Client 可并发定向提交，且各自独立接收所有 Device 的 events | 下游单一责任主体不等于上游只有一个写者；一个 Client 的进度不能代替其他 Client |
| token 绑定 device，历史设备 ID 可能来自旧 connector 或 `token-` 前缀 | Device 归属于 Account，消息、凭证与历史归属 Device；Connector 只提供连接程序实现 | 不为程序引入第二个业务身份；重连、重启、轮换或替换程序不能使 Device 身份或历史消失 |

源依据与差异详见[连接与消息设计](Connection-and-Message-Design.md#现状证据与差异)。以下为业务实体，不是拟建表清单。

## 目标 ER：谁拥有身份，谁拥有消息？

```mermaid
erDiagram
  ACCOUNT {
    string account_id PK
  }
  CLIENT {
    string client_id PK
    string account_id FK
  }
  DEVICE {
    string account_id PK, FK
    string device_id PK
  }
  CREDENTIAL["CREDENTIAL &lt;&lt;EI&gt;&gt;"] {
    string credential_id PK
    string account_id FK
    string device_id FK
  }
  MESSAGE["MESSAGE &lt;&lt;AO&gt;&gt;"] {
    string message_id PK
    string account_id FK
    string device_id FK
    string direction
    string position
    string producer_id
    string task_ref
  }
  ACCOUNT ||--o{ DEVICE : owns
  ACCOUNT ||--o{ CLIENT : authorizes
  CLIENT }o--o{ DEVICE : exchanges_via_relay
  DEVICE ||--o{ CREDENTIAL : authorizes
  DEVICE ||--o{ MESSAGE : routes
```

Device 是持久的下游设备端业务身份，以 Account/Device 定位，不是每次进程启动，也不要求某种特定执行框架。每个 Device 固定承载 regulation 下行与 event 上行两个方向；它们是消息属性与交付职责，不是用户可创建的额外业务实体。图中 `routes` 包含下行以 Device 为目标、上行以 Device 为来源。Connector 仅是运行在设备端的连接程序，因此不进入业务 ER 图；连接、租约、游标与物理日志分区也不提升为独立业务身份。

Client 是代表用户操作的上游客户端，可以是浏览器或其他获授权应用；一个 Account 可有多个 Client 和多个 Device，二者通过 Relay 多对多通信。`exchanges_via_relay` 表示同 Account 内的路由能力，不是要维护逐 Client/Device 配对表，也不代表每条下行消息发给多个 Device。所有仍具有效账户访问权的 Client 都是该 Account 上行群发接收方，不要求逐 Device 订阅。

图中 Client 是业务端点视图，`client_id` 为身份提案；消息生产者归属须认证并可追溯，不因此要求新增 Client 资产表。Client 身份不等于某次订阅/连接。Device 的 Account 归属须与消息、凭证一致；凭证/连接不得另设一套可替代 Device 的业务身份。

`message_id` 表示全局唯一消息身份的提案，不是 Client 本地序号；Relay 需按 Account/Device/方向验证归属并为每个方向分配独立 position。精确字段和全局 ID 格式待协议细化。`task_ref` 代表 task/objective/regulation 等业务关联字段族，不在此强加一个统一任务实体；事件可无任务关联，也可通过引用关联 regulation。Client 订阅和连接会话属于运行记录，不是用户可创建的持久业务流。

## 生命周期与关键不变量

| 实体 | 可变内容与有效性终止 | 删除/修正与理由 |
| --- | --- | --- |
| Device | 展示信息与授权状态可变；Account 归属与 Device 身份不因 Connector 程序更换、重连/重启或凭证轮换变化 | 停用不等于删历史；有权删除与保留策略单独执行，禁止静默复用旧身份 |
| Client | 连接和独立消费进度可变；账户访问过期/撤销则停止交付 | 断线不确认消息；历史补读受账户权限及保留期约束，不要求为永不返回的 Client 无限保留 |
| Credential `<<EI>>` | 签发后身份、作用域和绑定固定，轮换签发替代凭证；过期/撤销终止访问 | 可按审计保留规则清理；撤销状态是有效性记录，不是把旧凭证改绑新主体 |
| Message `<<AO>>` | 正常业务只追加；接收、执行、完成、取消通过关联的新消息表达 | 不改写原 regulation 或事件；允许专门授权的保留期清理/删除，必须暴露历史缺口并保留必要归属与去重证据 |
| Device 的方向日志（存储细节） | 位置、水位、保留下界与消费进度可变，归属始终为同一 Account/Device/方向 | 不是 Connector 程序或连接的临时资源；清理历史不能伪造连续记录 |

1. Account 是路由与授权边界。Client 每条 regulation 必须指定同 Account 的一个 Device；目标缺失、不存在、停用或跨账户时明确拒绝，不回退到默认 Device，不隐式群发。每条 Device event 群发给该 Account 所有有效 Client，不只发给任务发起者或当前浏览 Device 的 Client；跨账户禁止交付。
2. 每个方向的消息、幂等身份/内容指纹与位置分配须原子持久化后才确认并通知。不同上游不共用本地序号；重试身份须绑定生产者、方向与目标/来源 Device，相同内容和归属返回原结果，更改内容或改投其他 Device 明确拒绝。
3. 同一 Device 只有一个有效活动实例的所有权 generation；接管、租约与写入/消费进度更新须协调，旧 generation 不得追加或推进。多个 Connector 进程竞争同一 Device 身份不是多个业务 Device；fencing 不能撤回已发生的外部副作用。
4. 订阅传输 ACK 不代表业务接收或执行；下行持久接收进度、执行记录与各 Client 账户级接收游标独立。一个 Client 的 ACK 不确认其他 Client，也不推进 Device 执行状态；断线 Client 在保留范围内可补读，超期明确报错，不能静默漏发。
5. 每个 Device 两方向独立有序、至少一次交付；账户级上行聚合不承诺跨 Device、跨方向全局总序或端到端 exactly-once。保留源 Device 与消息身份供各 Client 去重；任务因果关系依赖显式关联与业务状态。
6. Device 身份、历史及本地 outbox/inbox 和游标不能随 Connector 程序升级/替换、重连/重启或凭证轮换而丢失；本地状态丢失必须显式恢复，不能以原身份重置序号并重放未知副作用。同机需要多个独立业务端点时显式登记多个 Device；仅多开连接程序不自动登记新 Device。

## 迁移影响与未决项

- 建议新协议独立命名空间/协商版本，与 v1 并存。保留原 `(accountId, deviceId, streamId, seq)` 定位及授权，原日志通过只读入口/映射读取，不按内容猜任务、不重新编号混合历史。
- 保留既有 Account/Device 身份是迁移默认方向，不创建新 Connector 业务 ID 或 Connector→Device 绑定。现有 `devices`、旧 `connectors`/daemon binding 与 `token-*` 来源须逐项核实，旧表名只是历史实现证据，不是目标领域实体；不能因去掉模型中的 Connector 就删除旧表/改键、丢弃映射或把 token ID 当新的身份来源。凭证轮换不重建 Device，歧义应阻断，不自动合并。
- 不自动将任意旧 stream 转为新 event 流，更不能转成可执行 regulation。需要显式导入时保留来源引用与去重边界，另审导入/切换策略。
- 新 Account 群发入口不能只是旧逐 Device/stream 订阅改名；需覆盖账户内所有 Device 及后续新增 Device，旧历史仍按原来源定位。账户级恢复游标与设备发现/水位协调是实施前待细化的技术问题，不要求新增用户可管理的 Stream。
- 新版本接收后，回退旧客户端不能抹掉新消息；保留新历史读取/恢复路径。旧接口何时退出、账户删除/设备移除/凭证撤销对历史的精确影响、保留期限与补偿流程在实施前明确。
- 本轮不改变现有 Streams UI、旧 `/legacy` 页面或账户/设备/token 设置。若目标落地需要 UI 改变，必须先做独立的适用 UI 评审，不以“协议调整”隐藏交互变化。

## 评审材料检查

2026-10-20 使用已有缓存 Mermaid CLI 12.0.0 与本机 Chromium 重新渲染移除 Connector 业务实体后的 ER 图，并检查 Device 直接归属 Account、消息/凭证归属 Device、`<<AO>>`/`<<EI>>` 字面显示、Client/Device 多对多、关系动词与连线。关系与路由/群发不变量及源代码差异交叉核对，文档相对链接目标存在。本记录仅证明设计材料检查，不代表运行、迁移或部署验证。

是否认可上述“Account 内多 Device/多 Client、下行定向一个 Device、上行群发所有 Client、Device 拥有身份与历史、Connector 仅是连接程序”的业务模型及迁移边界，同时将精确协议与切换方案保留为后续待决？
