# Deployment

本次 Outer 交付限定为已授权的本机隔离运行验证，不是 Cloudflare 生产部署或 npm 发布；不读取/修改生产账户、设备、事件、凭证或外部目标宿主仓库。构建产物来自已接受实现，普通宿主夹具不冒充真实 `objective-portfolio-supervisor` 集成。先把本契约同步到 primary 并观测其修订，再执行以下验证；Inner 的既有结果不直接充当本轮 Outer 证据。

## Steps

### D-S01: 明确分阶段启用与恢复边界

核对已接受实现及本契约的 primary 修订，使用既有构建产物和仓库自包含 smoke，仅在 loopback 启动 Miniflare/workerd、隔离 D1/DO、本地 SQLite 与验证 CLI。确认完整本地 migrations、随机测试身份、状态目录、包导出及程序版本，不调用部署/发布或 registry preflight 主程序。

### D-S02: 验证真实网络双向闭环

按同步契约重新运行 `node scripts\duplex-smoke.mjs`：真实 HTTP 下普通宿主嵌入公开 lib，两个 Device×两个 Client 定向/群发、已提交响应丢失重试、新 Device 加入、整个运行时/本地状态重开及 token 轮换、宿主收据后 ACK 与实际 CLI 子进程。运行真实 Workers v2 测试补充跨账户、撤销、fencing、背压和过期边界；只记录脱敏结果。

### D-S03: 验证兼容运行与受控恢复

重新运行 `node scripts\sync-smoke.mjs` 和 `node scripts\stream-browser-smoke.mjs`，验证旧历史/实时/暂停/离线重载和撤销/移除兼容。确认所有临时 runtime、浏览器与 CLI 已退出，仅清理本次随机生成状态目录；记录限制与恢复边界，不操作既有生产测试数据。

## Acceptance criteria

### D-AC01: 启用条件与数据边界可核验

证据给出验证所依据的同步契约提交/修订、实现提交、运行命令与退出码；脚本确认 loopback readiness、完整本地 migrations、公开库/声明可用、薄 CLI 实际执行。使用测试身份且无生产/发布动作；运行结束无遗留助手或本次状态目录。

### D-AC02: 外部路由群发与自治有实证

新 smoke 输出 `ok:true`，断言两个 Device×两个 Client 的目标路由/群发、原请求键返回原 ID、完整运行时重启/凭证轮换后本地状态保留、新设备自动纳入与宿主持久收据去重。CLI receive 打印不 ACK，显式 ACK 才推进。真实 workerd 测试全部通过并证明其他 Account、旧 generation、撤销主体不可推进；不把测试夹具说成真实业务执行成功。

### D-AC03: 历史与恢复无静默损失

两个既有 smoke 均退出 0，旧 account/device/stream/seq 历史仍可按原入口读取，浏览器交互和撤销/移除行为不回归。证据明确无自动清理、满额背压、账户范围 ID、D1 撤销重叠准入及宿主外部副作用责任；不宣称完成生产容量、灾备、发布或外部宿主接入。
