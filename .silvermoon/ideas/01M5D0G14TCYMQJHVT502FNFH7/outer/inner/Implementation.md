# Implementation

依据已验收的[工作区行为契约](ideal/Device-Workspace-Design.md)实现默认 Devices 工作区；不修改 Ideal、不执行部署，不声称生产界面已更新。实现范围、验证结果和边界见[实施证据](Verification.md)。保留 I-S01..03、I-AC01..03 的稳定身份。

## Steps

### I-S01: 补齐 Client 工作区读取契约

增加 `GET /api/v2/devices` 的稳定 ID 分页元数据清单及 `GET /api/v2/devices/:id/messages` 的账户会话双向只读分页/长轮询。复用 AccountMessages 权威表、字符串 ID、保留边界及会话/账户/目标设备持续授权；不借用 Device token、lease 或 ACK。可选 `x-account-id` 只校验当前会话账户，不能提供授权，避免切换账户竞态。现有 Device、Client、v1 与 v2 surface 保持兼容；不新增配对、心跳或业务实体。

### I-S02: 实现 Devices 与消息交互

默认 `/` 为 Devices，独立账户上行接收不因搜索/选设备而停止；Device 视图双向显示，不用旧 writer 状态推断 v2，统一显示 Unknown。每个读取范围持久保存自身 cursor 与有界缓存，游标错误不跳最新；独立历史分页/定位不推进实时游标。同账户所有标签页的共享持久状态修改使用排他 Web Lock 串行化，锁内重新读取，禁止游标/已接受状态回退或旧标签清除另一 pending；不支持协调机制时明确阻止未持久发送。发送 guard 在等待锁前设置，持久保存幂等键、唯一目标与有界 JSON 后才 POST；必须显式启用本会话写权限，未知响应/重载仅允许人工原样重试，切换账户/退出不展示别人的 pending。仅显示 Relay accepted #ID，不推断执行。窄屏 Device URL 的初始/前进后退均进入对应详情。`/history` 保留 v1 全套只读交互，旧 device/stream/seq 链接仍读原命名空间，Settings 与 `/legacy` 不重做。

### I-S03: 验证权限恢复与兼容

用真实 workerd SQLite 测试、浏览器状态单元测试、实际构建后的 Chromium 桌面/手机/极窄屏测试验证授权、空态、错误保留、未知发送恢复、范围独立与资源上界。增加确定性交错持久写入与同 context 两页锁竞争/丢响应/reload 的回归，以及真实构建 UI + 本地 Miniflare/workerd/D1/AccountMessages + Device lib 的可复跑集成 smoke；随机夹具、不 mock HTTP、不把本地 Relay URL 写入生产 dist，有界停止与完整清理。保留并运行现有浏览器回归，v1 初始入口改到 `/history`，不削弱原断言。运行 `pnpm check`，将实际命令、计数、截图位置、原有 skip/warning 与限制写入 Inner 证据；只勾选已完成验证的 I 项，D 项保持未勾选。

## Acceptance criteria

### I-AC01: 路由与读取权限一致

真实 Worker 夹具至少两个 Device × 两个 Client 加另一账户：两个 Client 均读所有设备上行与指定设备双向历史，定向发送无串投；会话只读不要求 write grant 或 Device token/lease，浏览器不拥有消费 ACK。跨账户/缺失/移除目标、撤销/过期会话及删除账户被拒绝；长轮询重验权限。覆盖空设备清单、32 项分页、独立范围与超过 2^53 的 ID、未来/过期游标，且不迁移旧记录。

### I-AC02: 消息交互状态可信

状态单元与真实页面测试证明目标、有效有界 JSON、显式会话写权限缺一不可，提交前持久化/跨标签协调失败不发送；pending 禁止重复提交、换目标和自动重发。确定性交错与真实同 context 两页证明账户 feed 写入不能覆盖另一页 pending，等待锁时连点不重复发；旧页不能回退已接受状态、旧 key 不能清除新请求。未知响应经 reload 后可用相同 key/payload/target 人工重试，成功仅显示 Relay ID 与 Device 收据/执行未确认；登出/账户变化取消旧读取并隐藏旧 payload。账户/设备持久游标与缓存独立，记录/字节/DOM/请求有界；错误保留已有内容，空历史不同于失败，Unknown 状态不借用 v1 灯号。

### I-AC03: 视觉与旧历史兼容

在实际构建应用的 1440×900、390×664、320×640 Chromium 中验证账户、Device 双向发送、空设备/权限三个场景，保存虚构夹具截图；验证键盘、raw 详情、窄屏列表/详情与 Back to Devices、错误/重试。旧 device/stream/seq 深链接仍定位原 v1 只读历史，既有 follow/分页/定位/raw 回归、`/legacy` 与 Settings 测试通过；`pnpm check` 与受影响检查通过，明确报告原有 skip/warning。截图不含生产数据，未执行部署或真实 Supervisor 集成。
