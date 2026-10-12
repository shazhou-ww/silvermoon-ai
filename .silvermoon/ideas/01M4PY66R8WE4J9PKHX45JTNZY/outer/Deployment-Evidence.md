# 设备管理生产发布证据

## 发布结果：成功，等待登录后的端到端验证

- 环境：`https://silvermoon.work` / `https://relay.silvermoon.work`。
- 已发布提交：`0d25cd8fd4722815e07e3b2a467871c464158f8e`，包含设备管理及“新增草稿已展开”焦点修复，保留 main/release 的并发历史。
- [Check and deploy #38201298329](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38201298329)：check 与 deploy 全部成功，生产发布完成于 2026-10-12 03:56:16 UTC。
- release CI 的 `pnpm check`：Protocol 5、Web 50、Connector 30、Worker 28 项均通过，合计 113；完整 lint、类型检查和所有构建通过。全量浏览器 154 通过、2 个按平台场景跳过，本地全部 11 项迁移成功。
- 生产 D1 仅新增应用 `0011_device_management.sql`，成功。迁移追加状态列及触发器，无现有设备的重命名、移除或物理历史清理，不直接执行额外生产 SQL。
- Worker 版本：`22ecd322-0b55-4f44-b8d8-d624099c5810`。
- Pages 部署：[adace98e.silvermoon-work.pages.dev](https://adace98e.silvermoon-work.pages.dev)，自定义域名已提供同一前端。
- 无 Connector 包发布；保留同设备 token 身份与原协议。并发主线已修复 Connector 重连测试时序、移除 deploy job 的重复完整测试；release 仍由 check job 的完整检查和浏览器回归严格前置，本次不绕过校验。

## 生产探测：2026-10-12 03:56:50 UTC

- `/settings`：200。
- `relay /health`：200，`{"service":"silvermoon-relay","status":"ok"}`。
- 生产 HTML 引用的最终 JS/CSS 与本地最终源代码构建结果逐字节 SHA-256 一致：
  - `index-Cs5No2FO.js`：`27b9de89ca321bb1b8faa11bb1d237ff23cf8238ef90eabacbfdfad6259839d0`。
  - `index-Cc4YlTW0.css`：`8b7137b8a4a477dbe0d9090f8c47db2ccc017bc2cf0081afd6e5cdfcf3d36257`。
- 匿名 GET `/api/me`、POST `/api/devices/device-management-verification-nonexistent/rename` 与 DELETE 同一明确不存在的测试 ID 均返回 401；未访问、修改或撤销任何真实设备/凭据。
- 集成浏览器刷新生产 Settings 后仍为未登录。匿名探测不是重命名、在线断开或历史只读的生产端到端证据；不将本地/模拟浏览器用例冒充线上结果。

## 尚未完成

`D-S02` 的已登录设备行为验证与 `D-AC02` 尚未完成。需要用户在已打开的生产页面登录，再创建 `device-management-verification` 前缀的专用测试设备；只允许操作本次明确记录的测试 ID。仍需在线/离线移除、旧凭据拒绝、只读历史、重新添加、真实 Connector 重试以及桌面/窄屏的生产证据。不清空本机数据，不停止或重新执行真实 agent 任务，不在证据中存储 token 明文。

用户已明确要求跳过单独 implementation 人工验收、直接推进上线。已按该授权部署，未伪造 `acceptInner` / `acceptOuter`；Silvermoon 的实施提交代表 Agent 完成证据，不代表用户已经完成线上验收。在线验证完成后再呈现准确 revision 的验收材料。

## 回退边界

优先向前修复。若需回退前端/Worker，保留已应用的迁移、全部撤销记录、`removed_at` 及历史根；不使用数据库还原来复活旧身份。该迁移的 token、连接与历史写入触发器仍限制旧 Worker。重新使用被移除电脑须添加新身份，不通过恢复旧 token 或清除移除标记操作。
