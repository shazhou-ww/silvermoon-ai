# 设备管理生产发布证据

## 首次发布结果：成功，等待登录后的端到端验证

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

## 长标题反馈修正：已发布

- 已发布提交：`809e71abdf1dfde9ee702107b5621bf9f7dda113`；[Check and deploy #38202522318](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38202522318) 完整 check 与 deploy 成功，Pages 于 2026-10-12 04:13:36 UTC 发布。
- 设备管理弹窗不再显示右上角 Close；删除标题单行省略，完整名称保留为可访问文本与悬停提示。取消、Escape、操作中关闭保护和焦点返回保持原行为；其他弹窗的关闭按钮不变。
- 本地三视口设备回归 21 项通过；本次 release 全量 113 项单元/集成测试、157 项浏览器测试通过，2 项按场景跳过。新增 79 字符名称测试断言真实溢出省略、单行高度、标题与弹窗均不越界，不以仅存在 CSS 类名代替验证。
- 无新增数据库迁移，发布日志明确 `No migrations to apply`。Worker 版本为 `5885e9a6-cbbd-49f3-9ff1-39b4f16304b0`，Pages 为 [c254ebe4.silvermoon-work.pages.dev](https://c254ebe4.silvermoon-work.pages.dev)。
- 2026-10-12 04:14:33 UTC 生产 `/settings` 返回 200；生产 HTML 的最终资源与本地修正后构建 SHA-256 逐字节一致：
  - `index-BVNwOaAz.js`：`ff2eb704a348e1b58394a5287c60d917aafecb4983c70a282d7709e869bc58be`。
  - `index-CJhxa6fA.css`：`7e20f0c8498ae466eeab87b3058b292b1135c8660ac2cef9f8898edf5bb2bc11`。
- 本次修正不操作真实设备/token，不将模拟数据浏览器测试记作登录后的真实设备验证。

## 人工线上验证：用户已确认通过

2026-10-12 12:19:09 +08:00，用户明确反馈：“验证通过，可以Accept deployment了”。这项结果来源于用户的线上确认，不是 Agent 新增的登录测试、Connector 日志或逐项数据核对；用户没有提供测试样本或日志，不能补造这些证据。此前的 Agent 浏览器未登录记录仅描述当时的自动验证限制，不再将其等同于用户尚未验证。

发布及用户确认结果已记录至 D-S02、D-AC02。正式 `acceptOuter` 仍须满足 Silvermoon 的前置状态：当前实施版本 `c68f31bb0925` 已提交，但还没有 `acceptInner`。已请求用户确认是否一并补齐这项前置接受，交互工具未取得明确答复；不把“用户不可用”作为授权，也不声称部署接受事件已经完成。

用户已明确要求跳过单独 implementation 人工验收、直接推进上线。已按该授权部署，未伪造 `acceptInner` / `acceptOuter`；Silvermoon 的实施提交代表 Agent 完成证据，不代表用户已经完成线上验收。在线验证完成后再呈现准确 revision 的验收材料。

## 回退边界

优先向前修复。若需回退前端/Worker，保留已应用的迁移、全部撤销记录、`removed_at` 及历史根；不使用数据库还原来复活旧身份。该迁移的 token、连接与历史写入触发器仍限制旧 Worker。重新使用被移除电脑须添加新身份，不通过恢复旧 token 或清除移除标记操作。
