# 通用事件同步外部验证证据

## 范围与版本

本轮外部结果是隔离本地验证，不是生产上线：没有推送 release 分支、没有调用远程部署、没有迁移生产数据、没有发布 npm。

- 实现提交：`56fa6e1e2c7dc0849de3217479cf9913f79f5726`。
- 实施验收提交：`4778488528b0192b61797449f58b348ce4b32164`，已确认可从刷新后的 primary 到达。
- 首次部署验证基线：上述验收提交，Outer World revision `5400cd4514d4a7abce197052210c7e64dc9bc06c`。
- Node 24、仓库锁定依赖、Wrangler 4.147.0 所带 Miniflare/workerd；本地实际 HTTP/WebSocket 监听，不是函数替身。
- 本证据同步后，对稳定的最终 Outer World 再次执行同一验证；精确阶段 Submit/Accept 引用由生命周期事件记录，不用短引用猜测。

## 可复现步骤

在仓库根目录运行：

```powershell
pnpm test:sync:smoke
```

此命令只执行本地构建（Worker 使用 `wrangler deploy --dry-run`）和[运行脚本](../../../../scripts/sync-smoke.mjs)。已构建同一实现时可直接运行：

```powershell
node scripts\sync-smoke.mjs
```

脚本创建 `.wrangler/sync-smoke-<uuid>` 独立状态目录，应用当前全部 D1 migrations，使用随机测试凭证及 HMAC 哈希，并启动真正的本地 Worker/DO。它不读取 `.dev.vars` 或生产秘密，不连接远程绑定。

## 实际结果

主 Agent 在同步的实施验收版本上独立执行 `node scripts\sync-smoke.mjs`，退出码 0，返回 `status: passed` 和 `stateRetained: false`。所有下列检查均由运行脚本断言：

| 证明 | 可观察结果 |
| --- | --- |
| 服务与兼容入口 | `/health` 成功；旧 `/v1/connect` 无 Upgrade 时返回 426 |
| 正常链路 | 真实 Node 客户端追加、按序历史读取、追赶期间追加与实时订阅 |
| 背压门限 | 五条 64 KiB 事件初始只能交付三条；统计完整 wire 帧总字节不超过 256 KiB |
| 消费确认 | ACK 1 放行第四条；重复 ACK 1 不增额度；ACK 5 越界被拒；ACK 2 才放行第五条 |
| 确认丢失 | 真正的 WS 代理丢掉已持久提交的追加确认；重连后重发不增行，修改同序号内容被拒绝 |
| 双流与重启 | `generic-smoke` 和 `window-smoke` 分别保存自己的序号；重开源数据库、停止并重新创建整个运行时后，两条流继续追加 |
| 消费恢复 | 从持久位置 2 续订，得到 3、4、5，不重新编号或跳到最新 |
| 身份与权限 | 相同设备局部 ID 的其他账户读不到原流；reader 不能追加；凭证轮换身份不变 |
| 撤销与移除 | 已连接 writer 在撤销后被拒、撤销凭证不能重连、设备移除后已有 reader 被拒 |
| 验证收尾 | 关闭客户端、代理及运行时，删除该次明确拥有的状态目录，不留下监听服务或测试凭证 |

上述运行输出与[实施验证](inner/Implementation-Verification.md)相互补充，不把单元测试冒充外部链路。旧 Session 浏览器回归为 196 通过、2 个既有 skip；适用全仓检查已通过。

## 交付边界与后续生产要求

当前 primary 的 CI 只运行检查；仓库工作流仅对 release 分支执行生产部署。合入 main 不等于生产已具备 `/v1/sync`。

若后续需要生产上线，应另行确认发布版本、生产 DO 迁移、实际凭证范围、成本和网络/区域故障验证；不能用本地结果替代这些外部事实。当前已验证的是协议同步底座，不含 Supervisor 业务适配、新界面或跨设备浏览器授权入口。

生产功能回退可保持旧 Session 路径并停止新同步入口；不得通过重写已存在事件或删除新 DO 历史来伪造兼容。v1 配额满后显式失败，运维恢复或未来保留策略需另行决定。

## 门限结论

主 Agent 根据用户明确委托的门限评审权限，确认本轮隔离外部验证范围满足 Deployment 契约。最终事件只在本证据同步、再次验证稳定 revision 且 ledger 对应条目完成后提交；不把本结论表述为生产部署成功。
