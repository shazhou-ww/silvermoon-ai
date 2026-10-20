# Devices 工作区最终运行与生产上线证据

## 当前候选与执行依据

本报告是当前发布结果的最终证据，取代前三份本地报告对当前候选的适用性；历史文件原样保留，不把失败/取消的 CI 改写为成功。

| 项目 | 实际值 |
| --- | --- |
| 当前实施基础 / Settings 修正 / 认证竞态修正 | `5012c1e9acf930afa3dd229f87dd8572b83c28ec` / `5e3f8cfb2c08b869b3b0d629fde4dbac1c9bfc29` / `a2b49bac2199843435bc6f094e2fca25dac8b373` |
| 最后测试就绪修正 | `cc08dd3e25e8ff5b2ccbf374af931e33e33d2275`，只改 helper/测试与证据，产品源码未改 |
| 已接受准确 Inner | `33ea7cd097e5cdca927c61d1938fcc4a521cf142` |
| 本轮执行前同步提交 / 实际发布源 | `b285efc0867d0853e4cd139641c0909a30c9a71e` |
| 本轮检查前准确 Outer | `c207091ffc4f87f67f529a4a0d81293ab0ffab1a` |
| 已同步 Deployment 行为契约 blob | `5beb07f3287390bbb81a764c6f9f6964f65192fc`，行为要求未改 |

主 Agent 在新的 Inner 精确验收与上述同步观测之后，重新执行本轮检查再正常快进 release；未沿用旧修订批准，没有 force、绕过必需 CI 或盲目重跑失败源码。

## 本轮本地验证

以下由主 Agent 在当前同步提交上重新执行，全部退出 0；日志在本会话私有状态目录，未提交日志或凭证。

- `pnpm test:devices:smoke`：真实构建 UI＋workerd/D1/AccountMessages＋Device lib 的 2 Client×2 Device、另一账户隔离、显式 opt-in、接受后丢响应原键恢复、目标唯一、读取不 ACK、账户全量接收、双向历史、桌面/手机/键盘、原 v1 seq=18、Settings/legacy 与撤销均通过。无 mock HTTP，无外部/生产写入。
- `$env:PLAYWRIGHT_BUILT_APP='1'; pnpm --filter @silvermoon-ai/web test:browser -- devices.browser.ts --workers=1`：三宽度 **66/66 通过，53.9 秒，0 skip/retry**，包括所有认证顺序、导航就绪、多标签页、未知提交与旧链接断言。
- `pnpm test:streams:smoke`：真实 v1 producer→workerd→cookie 浏览器的历史/raw/follow/暂停/离线 reload/撤销通过，原 DOM/cache 上界仍保持。

三宽度为 1440×900、390×664、320×640 CSS 像素；本轮复用正常生产 URL 构建，两个 smoke 的本地构建仅在各自随机隔离目录，没有覆盖生产 dist。所有本轮助手和随机状态清理结束，工作区在发布前保持 clean。

## 必需 CI 与部署（D-S01 / D-AC01）

成功运行：[Check and deploy 39487776073](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/39487776073)，source 为上述 `b285efc0867d`，check/deploy 两个 job 均 success：

- 冻结锁文件安装、完整 `pnpm check`、真实 Linux Chromium 全量浏览器：**310 通过、2 原有 skip，8.8 分钟**；未增加 retries 或跳过产品断言。
- 本地 D1 migration 检查、生产 D1 migration 检查通过；远端无待应用 migration。本次不增加或重命名 DO/D1 schema，不修改现有绑定/凭证。
- Worker 与 Pages 均成功部署。生产 Worker 当前 **100%** 为 `6f8b5d98-4541-460c-ba8d-ddc90e111c3f`，创建时间 `2026-10-20T20:07:32.144749Z`；上一版本为 `875a4196-d982-46b8-b072-b3e03d993c86`。
- Pages 部署地址为 <https://22dff131.silvermoon-work.pages.dev>，生产前端 <https://silvermoon.work>；Relay 为 <https://relay.silvermoon.work>。

前序取消运行 `39471185944` 未部署；失败运行 `39473467729` 与 `39484389883` 的 deploy 均 skipped。认证竞态和测试 helper 就绪问题都经过红测、精确修正、新修订验收及新的完整 CI，不将原失败记作通过。

## 生产只读核验（D-S02 / D-S03 / D-AC02 / D-AC03）

- 生产 `/health` 返回 200；前端 `/`、`/history`、`/legacy` 返回 200。无 cookie 的新 inventory 和 Device 双向 history API 均返回 `401 unauthorized`，没有放开读取权限。
- 使用用户明确共享且已登录的同一浏览器标签，只做 GET、DOM 读取与 URL 导航：新 Device 清单 200，已有独立试用 Device 的双向历史 200、0 条；没有创建新 Device、提交消息、消费 ACK、启用发送、轮换或删除。
- 新根实际渲染 Devices / All devices、账户全量接收、v1 history 入口；选定试用 Device 后显示正常空态、Unknown 状态、显式会话发送 opt-in，发送按钮保持 disabled。现代 Settings 的 Devices 侧栏与 `Back to Devices` 的 `/` href 正确。
- 原 `?device=...&stream=checkout-observations` 链接仍实际进入 v1 Streams，原 18 条历史可读，`committedThrough=18`；没有合并、改号、删除或把旧日志当新 Message。
- 共享标签为 hidden：指针点击的工具等待和默认 rAF 等待不能作为现场交互通过证据，未强制点击或伪造成功。生产核验使用 URL 导航、真实请求与 DOM 状态；桌面/窄屏实际点击、键盘及前进后退由本地真实闭环和必需 CI 覆盖。标签最终停留在原有独立试用 Device 的新工作区，未访问未共享页面。

## 验收范围与限制

当前候选已完成本契约要求的真实本地闭环、必需 CI、生产发布及认证只读可用性核验；没有进行生产消息业务执行测试，不声称外部 `objective-portfolio-supervisor` 已接入。

Web Locks、localStorage 与安全上下文前提、有限缓存/配额、未知 presence/Device 执行状态、原键人工恢复及无容量/灾备保证仍有效。未读取用户提供的 token 文件、输出私有凭证、发布 npm、修改外部宿主或清理生产设备/历史。既有 chunk/lint/CI action 提示未隐藏，但均不影响本次成功退出。

本报告与 D 清单仅为已验证工作证据；新增证据后的最终 Outer 修订仍需同步、精确 submitOuter 和主 Agent 受委托的接受事件，不能以清单代替门限。
