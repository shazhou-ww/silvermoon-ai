# Connector 双向业务模型评审

## 请求决定

1. 以 Account 为中心，统一称 Device（下游设备端）与 Client（上游用户客户端），两端为多对多关系；将 Device→Client 单向消息升级为双向：Client 每条 regulation 指定一个 Device，每个 Device 每条 event 群发给同 Account 所有 Client。
2. 认可一个持久 Connector 对应一个 Device，固定两条方向性消息流，不再开放用户创建多 Stream；同一物理设备运行多个独立设备端实例时，分别使用独立 Connector。业务身份独立于连接与凭证，消息追加不可改写、各方向独立确认，保留设备自治与可恢复历史。
3. 认可先版本隔离、旧历史只读可定位的迁移方向；不在此批准精确字段、物理 schema、传输技术或切换方案。

## Current / Proposed / Why

| Current（已核实源代码） | Proposed（目标模型） | Why |
| --- | --- | --- |
| 现有消息从 Device 上行到 Client；浏览器只读，v1 按 account/device 路由并显式订阅设备内 stream | Account 拥有多个 Device/Connector 并授权多个 Client；每条下行只到指定 Device，上行到该 Account 全部 Client，每个 Connector 固定两个方向 | 多对多业务通信不等于下行群发；上行群发不依赖 Client 逐设备选择订阅 |
| 同一 device 有单活动 writer lease/generation，浏览器只读订阅 | 单活动 Device 实例消费下行及上报；多个 Client 可并发定向提交，且各自独立接收所有 Device 的 events | 下游单一责任主体不等于上游只有一个写者；一个 Client 的进度不能代替其他 Client |
| token 绑定 device，历史设备 ID 可能来自旧 connector 或 `token-` 前缀 | Connector ID、Device 绑定与消息归属持久，凭证和连接仅授予暂时访问权 | 重连、重启、轮换不能使身份或历史消失；领域不耦合某种设备端执行框架 |

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
  CONNECTOR {
    string connector_id PK
    string account_id FK
    string device_id FK, UK
  }
  DEVICE {
    string device_id PK
  }
  CREDENTIAL["CREDENTIAL &lt;&lt;EI&gt;&gt;"] {
    string credential_id PK
    string connector_id FK
  }
  DIRECTION_LOG {
    string connector_id PK, FK
    string direction PK
  }
  MESSAGE["MESSAGE &lt;&lt;AO&gt;&gt;"] {
    string message_id PK
    string account_id FK
    string connector_id FK
    string direction FK
    string position
    string producer_id
    string task_ref
  }
  ACCOUNT ||--o{ CONNECTOR : owns
  ACCOUNT ||--o{ CLIENT : authorizes
  CONNECTOR ||--|| DEVICE : binds
  CLIENT }o--o{ DEVICE : exchanges_via_relay
  CONNECTOR ||--o{ CREDENTIAL : authorizes
  CONNECTOR ||--|{ DIRECTION_LOG : fixes_two
  DIRECTION_LOG ||--o{ MESSAGE : orders
```

图中 `fixes_two` 的精确业务基数是恰好两条，ER 的一到多符号只表达下界；唯一方向值为 regulation 与 event。Device 是持久的下游设备端业务身份，不是每次进程启动，也不要求某种特定执行框架。一个 Connector 绑定一个 Device；同机多个独立设备端实例各有独立身份与 Connector，而重连/重启或同一身份的故障接管不新建 Device。物理主机不是新增的持久传输层级。

Client 是代表用户操作的上游客户端，可以是浏览器或其他获授权应用；一个 Account 可有多个 Client 和多个 Device，二者通过 Relay 多对多通信。`exchanges_via_relay` 表示同 Account 内的路由能力，不是要维护逐 Client/Device 配对表，也不代表每条下行消息发给多个 Device。所有仍具有效账户访问权的 Client 都是该 Account 上行群发接收方，不要求逐 Device 订阅。

图中 Client 是业务端点视图，`client_id` 为身份提案；消息生产者归属须认证并可追溯，不因此要求新增 Client 资产表。Client 身份不等于某次订阅/连接。Device/Connector 的两个业务概念也不要求落成两张新表或生成两套新 ID，必须先核实既有 device 身份的映射。Message 的 Account、Connector/Device 归属必须一致。

`message_id` 表示全局唯一消息身份的提案，不是 Client 本地序号；Relay 需按 Connector/方向验证归属并为每个方向分配独立 position。精确字段和全局 ID 格式待协议细化。`task_ref` 代表 task/objective/regulation 等业务关联字段族，不在此强加一个统一任务实体；事件可无任务关联，也可通过引用关联 regulation。Client 订阅和连接会话属于运行记录，不是用户可创建的持久业务流。

## 生命周期与关键不变量

| 实体 | 可变内容与有效性终止 | 删除/修正与理由 |
| --- | --- | --- |
| Connector / Device | 展示信息与授权状态可变；绑定身份不因连接/凭证轮换变化，重新绑定须显式另议 | 停用不等于删历史；有权删除与保留策略单独执行，禁止静默复用旧身份 |
| Client | 连接和独立消费进度可变；账户访问过期/撤销则停止交付 | 断线不确认消息；历史补读受账户权限及保留期约束，不要求为永不返回的 Client 无限保留 |
| Credential `<<EI>>` | 签发后身份、作用域和绑定固定，轮换签发替代凭证；过期/撤销终止访问 | 可按审计保留规则清理；撤销状态是有效性记录，不是把旧凭证改绑新主体 |
| Message `<<AO>>` | 正常业务只追加；接收、执行、完成、取消通过关联的新消息表达 | 不改写原 regulation 或事件；允许专门授权的保留期清理/删除，必须暴露历史缺口并保留必要归属与去重证据 |
| Direction log | 身份固定于 Connector 和方向；水位、保留下界与消费进度可变 | 不是连接临时资源；清理历史不能伪造从未存在过的连续记录 |

1. Account 是路由与授权边界。Client 每条 regulation 必须指定同 Account 的一个 Device；目标缺失、不存在、停用或跨账户时明确拒绝，不回退到默认 Device，不隐式群发。每条 Device event 群发给该 Account 所有有效 Client，不只发给任务发起者或当前浏览 Device 的 Client；跨账户禁止交付。一个 Connector 不容纳多个 Device。
2. 每个方向的消息、幂等身份/内容指纹与位置分配须原子持久化后才确认并通知。不同上游不共用本地序号；重试身份须绑定生产者、方向与目标/来源 Connector，相同内容和归属返回原结果，更改内容或改投其他 Device 明确拒绝。
3. 每个 Connector 只有一个有效下游所有权 generation；接管、租约与写入/消费进度更新须协调，旧 generation 不得追加或推进。Relay fencing 不能撤回已发生的外部副作用。
4. 订阅传输 ACK 不代表业务接收或执行；下行持久接收进度、执行记录与各 Client 账户级接收游标独立。一个 Client 的 ACK 不确认其他 Client，也不推进 Device 执行状态；断线 Client 在保留范围内可补读，超期明确报错，不能静默漏发。
5. 每个 Connector 两方向独立有序、至少一次交付；账户级上行聚合不承诺跨 Device、跨方向全局总序或端到端 exactly-once。保留源 Device/Connector 与消息身份供各 Client 去重；任务因果关系依赖显式关联与业务状态。
6. Connector 重连/重启/凭证轮换保留身份、outbox/inbox 和游标；本地状态丢失必须显式恢复，不能以原身份重置序号并重放未知副作用。

## 迁移影响与未决项

- 建议新协议独立命名空间/协商版本，与 v1 并存。保留原 `(accountId, deviceId, streamId, seq)` 定位及授权，原日志通过只读入口/映射读取，不按内容猜任务、不重新编号混合历史。
- 现有源码/数据中的 `device` 与本文业务 Device 的映射必须逐项核实，不因名称一致就假定一一对应或直接改键。旧 device ID 与新 Connector ID 是否直接沿用仍待核实：旧 connector、daemon binding 与 `token-*` 来源不同，不能把 token ID 当新的持久身份来源。凭证轮换不重建映射；映射歧义应阻断，不自动合并。
- 不自动将任意旧 stream 转为新 event 流，更不能转成可执行 regulation。需要显式导入时保留来源引用与去重边界，另审导入/切换策略。
- 新 Account 群发入口不能只是旧逐 Device/stream 订阅改名；需覆盖账户内所有 Device 及后续新增 Device，旧历史仍按原来源定位。账户级恢复游标与设备发现/水位协调是实施前待细化的技术问题，不要求新增用户可管理的 Stream。
- 新版本接收后，回退旧客户端不能抹掉新消息；保留新历史读取/恢复路径。旧接口何时退出、账户删除/设备移除/凭证撤销对历史的精确影响、保留期限与补偿流程在实施前明确。
- 本轮不改变现有 Streams UI、旧 `/legacy` 页面或账户/设备/token 设置。若目标落地需要 UI 改变，必须先做独立的适用 UI 评审，不以“协议调整”隐藏交互变化。

## 评审材料检查

2026-10-20 使用已有缓存 Mermaid CLI 12.0.0 与本机 Chromium 重新渲染 Account/Client/Device 版本的 ER 图，并检查实体标签、`<<AO>>`/`<<EI>>` 字面显示、账户一对多、Client/Device 多对多、关系动词与连线。关系与路由/群发不变量及源代码差异交叉核对，文档相对链接目标存在。本记录仅证明设计材料检查，不代表运行、迁移或部署验证。

是否认可上述“Account 内多 Device/多 Client、下行定向一个 Device、上行群发所有 Client、单 Connector / 单 Device 与持久历史”的业务模型及迁移边界，同时将精确协议与切换方案保留为后续待决？
