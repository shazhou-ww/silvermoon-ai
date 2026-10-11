# Deployment Evidence

## 发布

- Session 列表实现通过 release workflow
  [38114630134](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38114630134)
  首次发布；远程 D1 migration、Worker 与 Pages jobs 均成功。
- 自由设备折叠与 sticky 标题补丁通过 release workflow
  [38116059281](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38116059281)
  发布；check 与 deploy jobs 均成功。
- `0008_agent_session_native_status.sql` 已在远程 D1 成功应用，后续
  `wrangler d1 migrations list silvermoon-relay --remote` 返回无待应用迁移。
- `https://relay.silvermoon.work/health` 返回 HTTP 200 与
  `{"service":"silvermoon-relay","status":"ok"}`；
  `https://silvermoon.work/` 返回 HTTP 200。

## 生产真实数据验证

2026-10-11 在已登录生产账户中，以 6 个设备、360 个默认可见 Session
完成桌面与 390px 移动视口验证：

- 动态 badge 显示 `Active 6` 与 `Needs input 1`；Needs input 视图只显示
  1 个匹配 Session。
- 默认列表为 360；启用 Show ended 后为 400，再启用 Show unavailable
  后为 404；关闭两项后恢复 360。
- Group by Device 初始只展开当前设备；展开组数依次验证
  `1 → 0 → 2 → 0`，证明可全收起、可多开且不会自动重开第一组。
- 在包含 103 个 Session 的设备组内滚动 961px，sticky 设备标题与列表
  滚动容器顶边差值为 0。
- 真实数据包含 5 个父 Session 与 6 个 subsession。父节点默认状态点和
  chevron 的 opacity 为 `1/0`，hover 后为 `0/1`；折叠与展开使可见子项
  数量 `6 → 5 → 6`。
- 搜索 subsession“只读追踪 gone session 根因”时保留父级
  “调研 gone session activities”作为 Context。
- 390px 视口无文档级横向溢出；选择 Session 后 URL 包含 connector/session，
  详情与返回按钮可见，返回后 URL 清除选择且列表重新可见。
