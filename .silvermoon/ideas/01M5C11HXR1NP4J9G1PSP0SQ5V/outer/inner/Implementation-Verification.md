# 通用事件同步实施评审与验证

## 评审结论与范围

2026-10-20，主 Agent 按用户“由 subagent 实施、主 Agent 负责所有门限 review”的明确授权，审阅协议、Connector、本地日志、DO、测试、部署配置和包导出。实施门限结论为通过，限于当前 [Implementation.md](Implementation.md) 的通用同步底座范围，不包含新 UI、Supervisor 生产端接入、生产部署或 npm 发布。

实施由同一个 subagent 完成，主 Agent 独立运行下列检查与真实链路验证。Idea 接受记录在 `71dbd213e2c3716df4868532ee754b12c4c9c047`；本文件和交付代码将一同同步，阶段提交必须引用同步后的准确 Inner World revision。

## 交付与关键实现选择

- 新增私有 `@silvermoon-ai/sync-protocol`；Node、Worker 共用平台无关校验与消息定义。
- Connector 新增 `@silvermoon-ai/connector/sync` 导出、可靠源接口和 SQLite 文件源，保留旧入口。私有协议内联进 JS 与声明，不成为消费者无法安装的依赖。
- Worker 新增 `/v1/sync` 与 `DEVICE_SYNC` SQLite DO，路由键是稳定账户/设备，而非 token；旧 Session/tRPC 端点及数据保持原样。
- 序号为规范十进制字符串，最大 int64，以 19 位补零 TEXT 在 SQLite 排序；不会经过 JS 浮点数。
- 追加与流头/用量同事务，持久确认与消费确认分离；持久写入代次和订阅窗口支持休眠/重建恢复。
- v1 不自动裁剪历史，设备日志上限为 64 MiB event JSON 用量或 1,000,000 条；超限明确失败。索引和元数据的实际物理占用另计。
- 单连接累计输出限制为 4 MiB，另加最终错误帧，避免 API 不暴露 transport buffer 时无限输出；健康连接也需轮换，消费者从持久位置续订。
- 文件源需要 Node 22.13+；本轮运行环境为 Node 24。SQLite 仍会提示实验性 API，不能据此宣称所有 Node 22 小版本支持文件源。
- v1 每次同步完整核对源历史，优先保证源端丢失可检测，尚未优化增量 checkpoint。此成本是已知限制，不伪报为高吞吐方案。

使用方式与资源数值见[用户说明](../../../../../docs/event-stream-sync.md)。

## 评审要求与修复

| 主 Agent 发现 | 修复与验证 |
| --- | --- |
| 本地丢失 contentType 时，打开远端 typed stream 可能仍成功 | 同步前校验全部源元数据，严格比较远端返回值，包含 undefined；增加回归 |
| 可选订阅 fanout 的故障可能在追加成功后影响生产者响应 | 请求结果与 fanout 分离；重新检查存活状态，故障只终止相关消费者并记录诊断；增加关闭连接、缺失状态和授权异常回归 |
| 本地源错误被统一包装后丢失实际原因 | 保留具体消息和 cause，仍使用显式同步错误码；增加诊断回归 |
| 最初 smoke 没有真实多流与背压阈值证明 | 增加独立双流重开、五条 64 KiB 事件、真实字节窗口和准确 ACK 额度断言 |

发布测试的临时目录移至仓库忽略的 `.wrangler`，用于隔离并清理生成文件，不改变发布身份、版本或信任策略。

## 主 Agent 独立验证

| 命令或操作 | 结果 |
| --- | --- |
| `pnpm check` | lint、全仓类型检查、测试和构建通过；release 8、旧 protocol 7、新 sync-protocol 12、Connector 57、Worker 48、Web 72 测试通过，Connector 另有 1 个既有 skip |
| `pnpm --filter @silvermoon-ai/web test:browser -- --workers=4` | 桌面、移动与窄屏共 196 通过、2 个既有 skip |
| `pnpm test:sync:smoke` | 实际 Node WebSocket + workerd + D1 migrations + DO SQLite + 本地源通过，详细证明见下 |
| 本地 tarball `verify-pack` 与隔离消费者 `smoke-npm-package.mjs` | 旧 CLI/AHP、新 sync 运行时导出和公共声明均通过；未发布包 |
| `git diff --check` | 通过 |

浏览器测试最初与全仓构建同时以 16 workers 运行，未修改的消息刷新时序用例发生一次超时；该用例三种视口定向重跑均通过，随后不并发构建、以 4 workers 重跑完整集合通过。未修改无关 UI 或放宽断言。既有 React fast-refresh 和 Web 构建体积警告保留，不作为新增错误隐藏。

真实 smoke 使用随机测试凭证及哈希，隔离状态目录，未读取生产秘密；覆盖：

1. 真实健康检查、旧连接端点的 Upgrade 要求和当前全部 D1 迁移。
2. 历史读取、追赶期间追加和连续订阅。
3. 五条 64 KiB 事件的完整 wire 字节窗口：初始只发送三条；ACK 1 放行第四条，重复 ACK 1 不放行第五条，越界 ACK 拒绝，ACK 2 才放行第五条。使用有序 ping 屏障而非时间猜测。
4. WebSocket 代理实际丢弃中心持久确认；同内容重发不增行，不同内容冲突。
5. 两条流独立身份、序号和流头在本地源及整个 Worker 运行时重启后延续；消费者从自己的位置恢复。
6. 跨账户隔离、reader 禁写、凭证轮换、已建立连接撤销及设备移除。
7. 运行结束自动关闭客户端、代理及运行时并清理状态，输出 `stateRetained: false`。

## 包验证边界

主 Agent 重新打包并验证，tarball SHA-256：

`6dead076f4bfe64a5aab58b45ae2c3995e1497dba29165e8159c6345bdae14ec`

使用离线缓存的兼容版本，在独立消费者 fixture 中约束 AHP 1.0.0、tRPC client 11.19.0、ws 8.21.0、yaml 2.9.1、zod 4.6.5、TypeScript 5.9.3，另有 Node/ws 类型。没有改写 packed 或 installed Connector manifest。这证明该依赖集合下的干净安装和类型/运行时可用，不等于最新 registry 解析验证，也不是发布验收。

## 外部与已知限制

Cloudflare 在线文档无法获取，API 和配置通过安装的类型/schema、Wrangler dry-run 和真实 workerd 验证；未凭此推断生产额度。凭证与设备状态在每次操作及交付前验证，空闲连接每 5 秒检查；D1 管理更新与 DO 操作不是跨库原子事务，已经通过该次认证的操作可能先完成。

实施评审通过不等于部署阶段已完成。外部验证仍须按同步后的 Deployment 契约独立执行并记录，不能用本文件代替精确阶段提交。
