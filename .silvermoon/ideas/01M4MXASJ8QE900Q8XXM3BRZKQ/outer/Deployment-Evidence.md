# Settings 生产验证

## 授权与发布观察

用户已接受实施 revision `601b5e0e6a22`，授权先执行生产只读验证；副作用操作另行确认。本 session 未操作 release、未重复部署，也未进行真实设备创建、身份绑定或退出。

- [现有 release 运行](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38145243518) 的代码版本为 `1ad0b56b2931`；check 和 deploy 成功，包含 D1 migrations、Worker 与 Pages 发布步骤。
- Settings 代码提交 `0e8f3d85b7a8` 是该 release 的祖先。该 release 与实施接受记录所在主线 `89f60224f92e` 在 `apps/web`、`apps/worker`、`packages` 下无代码差异。
- 现有发布证明代码已随其他主题 release 上线，不代替本主题的生产行为验证。

## 只读检查及阻塞

2026-10-11 从当前执行环境检查：

- `https://silvermoon.work/` 返回 HTTP 200。
- `https://silvermoon.work/settings` 的 curl 初次及再次检查均在 TLS 阶段连接失败（`SSL_ERROR_SYSCALL`，未获得 HTTP 响应）；集成浏览器同样返回 `ERR_CONNECTION_CLOSED`。
- Pages origin 的 `/settings` 返回 HTTP 308；尚未追踪并验证重定向目标，不将其算作生产路由成功。
- 补取发布日志时 GitHub API 返回 EOF；已取得的运行状态仍可作为发布观察，但未取得最终产物 URL。

这些结果不能判定是站点故障还是当前环境的网络问题。待生产地址可访问后，先针对已同步部署契约重新检查路由、刷新、登录返回和受控账户界面；副作用流程继续按授权边界逐项确认。所有 Deployment 清单项暂保留未完成，不提请部署验收。

## 登录后的生产检查

2026-10-11 22:32 后用户共享已登录的生产页面，连接恢复，按现有授权执行只读检查；没有发送消息、编辑草稿或操作真实设备与身份。不保存账户信息、Session 内容或未脱敏截图。

- 键盘打开账户菜单后可见 Settings 和 Sign out；进入 Settings 后路径为 `/settings`，保留原 Session query 上下文。
- 实际页面仅包含 Devices 与 Linked identities，未出现 Browser sessions；971 CSS px 的集成视口无水平溢出，六个设备行均为 grid，宽度一致（587 CSS px）。这个视口不代替手机验证。
- 刷新 Settings 后实际回到 `/`，未保留 Settings 页面。浏览器只读 fetch `/settings` 也观测到重定向后 HTTP 200，最终路径为 `/`。
- 独立 curl 响应确认 `/settings` 返回 HTTP 308、`Location: /`；`/settings/` 返回 HTTP 200。问题已从连接失败明确为生产平台路由重定向，不是应用内 Settings 无法打开。
- 账户菜单自动化点击及后续一次键盘重入发生超时，未完成 inline 创建 / Cancel 或窄屏验证，不据此宣称通过或判定新的应用缺陷。

**D-AC01 未通过：** 当前规范路径 `/settings` 的直达与刷新会丢失 Settings 位置；`/settings/` 的 HTTP 200 不是规范路径通过的替代证据。需要在后续修复中核对 Cloudflare Pages 对 `/index.html` rewrite 目标的 canonical redirect 行为，并用生产规范 URL 验证，而不能仅依赖本地 preview HTTP 200。本部署阶段不修改已接受的应用实现，不重复发布；修复及其发布须另行授权。其余尚未验证的 D 项保持未完成，不提交 submitOuter。

## 路由修正接受后的复验

用户接受路由修正 `0b6f5f91a78d` 后，本 session 仅同步接受事件，没有触发发布。核对发现其他主题的 [成功 release](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38149527216) `220af0adf498` 已包含路由修正提交 `c0ffe5195594`；check 与 deploy 均成功，无需重复发布。

- 当前 curl 对规范 `/settings` 返回 HTTP 200，无 Location 重定向。
- 共享浏览器先访问此前使用过的带 Session query 地址时仍回到首页，可能涉及缓存，原因未确认，不隐去该失败观察。
- 换用未访问过的 `/settings?settings-route-check=20261011` 后，生产直达 HTTP 200、无重定向；刷新同样 HTTP 200 且保留 `/settings`，实际呈现 Devices 与 Linked identities。该结果证明新请求的规范路径生效，不代替旧链接缓存及 Session query 的复验。
- 未执行创建、身份绑定或退出；窄屏及真实草稿验证仍待完成。D-AC01 的真实身份绑定返回与旧链接复验尚未完成，不提交部署验收。

## 经单独授权的临时设备验证

用户明确允许创建验收临时设备并立即撤销；未操作其他已有设备。实际生产 inline 创建使用明确的测试名称及 1 天有效期，创建后出现唯一对应设备行，离页后重新进入仍可见。未读取或保存一次性完整 token，未启动 connector。

随后仅对该唯一测试设备执行 Revoke，等待实际行显示 `No active connection token`，并确认 Revoke / Rotate token 按钮均消失。清理结果为测试连接凭据已撤销；设备元数据仍保留在列表中，不宣称设备记录被删除。身份绑定及 Sign out 尚未授权或执行，其他未完成的生产标准保持未完成。

## 经单独授权的退出验证

用户确认无须保留未发送草稿，并明确允许退出共享浏览器。通过账户菜单 Sign out 成功返回真实登录页面，当前路径保持 `/settings`；本标签页 `silvermoon:session-drafts:` 缓存键计数为 0。三个 provider 登录入口均携带当前 Settings 路径及 query 的 `returnTo`，未点击 provider 或代用户认证。真实登录完成后的返回仍等待用户手动操作，不把链接参数正确当作 OAuth 回调已验证。

## 2026-10-12 登录后的继续检查

用户完成手动登录后，共享页面为已登录首页，保留此前测试 query。用户未留意登录后的第一屏，因此无法区分 OAuth 首次返回首页与登录后另行选择 Session；不判定登录返回已通过，也不直接认定为新缺陷。

- 用当前实际 Session query 直接访问 `/settings`，响应 HTTP 200、无重定向；刷新后 HTTP 200，仍为 Settings 且完整 query 保留。这补充了此前带 Session query 的复验，但不声称已消除浏览器中所有旧 308 缓存。
- 生产窄屏下 Settings 无水平溢出，Open Sessions 打开抽屉、Escape 关闭后仍在 Settings。请求视口为 390px，但集成浏览器测得实际宽度为 487 CSS px；证据按实际宽度记录，不称作精确 390px 手机验证。检查后恢复检查前视口。
- 临时测试设备仍显示无有效连接 token，未再次创建或修改凭据。
- 未重复退出、未绑定或解绑身份、未编辑或发送 Session 草稿。真实 OAuth 返回、身份绑定返回及真实草稿恢复仍待验证，D-AC01 / D-AC02 不勾选，不提交部署验收。

## 真实 OAuth 首次返回确认

2026-10-12 00:32，用户明确允许再次退出并确认无须保留草稿；从 `/settings?settings-return-check=20261012` 退出后，由用户手动登录且不选择 Session。用户确认登录后直接进入 Settings，Agent 同时核对实际页面：路径 `/settings`、测试 marker 保留、`auth=signed-in`、Settings region 可见且账户菜单存在。真实登录返回 Settings 通过；此前无法确认第一屏的记录不再作为登录返回阻塞。

身份绑定模式的真实返回与生产 Session 草稿恢复仍未验证，不把登录模式成功扩大为所有 OAuth 模式成功。
