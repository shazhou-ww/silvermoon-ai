# Settings 实施与验证证据

## 已落地结果

- [App.tsx](../../../../../apps/web/src/App.tsx) 接入 `/settings`、浏览器历史、头像菜单和窄屏模态 Session 抽屉；列表只有一个实例，复用主线的筛选、父子层级、Needs Input 与离线连接确认规则。
- [SettingsPage](../../../../../apps/web/src/components/settings-page.tsx) 仅呈现 Devices 和 Linked identities；创建表单与设备行同级，默认收起、Cancel 无请求，成功收起，失败保留输入。
- [workspace-state.ts](../../../../../apps/web/src/workspace-state.ts) 按账户、设备及会话存储标签页草稿；提交请求和命令回执绑定源草稿版本，失败、结果不确认或后续编辑都不丢失输入。
- 移除浏览器管理 UI 及其 `/api/sessions` 加载；当前浏览器仍通过原 logout API 退出，不改变后端登录有效期、上限或鉴权。
- 完整 connector profile 不放入 URL、历史或草稿缓存；离页清除，迟到响应不重新披露。
- [静态路由规则](../../../../../apps/web/public/_redirects) 随构建输出；本地生产预览 `/settings` 返回 HTTP 200。线上平台规则和真实 OAuth 返回仍属于部署验证，不宣称已完成。

## 兼容上游

本次先同步主线，再适配独立主题已经落地的实现，不重复定义它们的需求：

- 保留新的登录页、provider 图标、错误反馈和视觉资源，仅为 Settings 登录增加站内 `returnTo`。
- Needs Input 选项和自定义回答使用相同的独立草稿状态，不移除或重新实现其提示。
- 保留离线会话默认列表、当前连接确认、分页与状态重试；发送继续携带主线要求的 `connectionId`。
- 主线 `unknown` 命令仍显示结果未确认且不自动重发；停止观察时保留草稿，不把它当作投递失败。

## 自动化验证

| 检查 | 结果与覆盖 |
| --- | --- |
| Web typecheck | 通过 |
| Web 单元测试 | 22 项通过，覆盖路由、账户 / 设备草稿隔离、刷新恢复、版本清理、缓存故障及主线消息 / 列表逻辑 |
| 定向 lint | 修改的源码及测试通过，无新增诊断 |
| Web 生产构建 | 通过，生成 `/settings` 路由回退规则 |
| 上游兼容目标回归 | 15 项通过：桌面、手机、320px 窄屏的离线重连、Needs Input、草稿刷新、导航及实际网格布局 |
| 完整 Web 浏览器回归 | 124 项通过，2 项仅桌面不适用而跳过；覆盖登录、消息流、Needs Input、离线确认、列表与 Settings |
| 最后登录资源更新后的定向回归 | 15 项通过：三个视口的登录加载 / provider / OAuth 错误，以及 Settings 布局和登录返回地址 |

完整回归在主线 `ffb37e6` 上适配的候选通过；随后保留主线 `a15ae34` 的最终登录插画与相关样式，补跑全部受影响的登录和配置布局用例并重新执行类型、lint、单元测试与构建。此前失败定位为测试加载等待、样式优先级和抽屉继承页面网格定位，均已修正并增加直接断言。

浏览器 fixture 使用虚构身份和 token，不读生产凭据。布局检查验证实际 `display: grid`、单列模块、创建 / 设备行同父级同宽同左边界、无额外 panel、抽屉顶部和左侧不留隐式空白，不只检查 CSS 声明。

## 主线持续集成

- [Settings 代码候选 CI](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38144832397) 在 `0e8f3d85b7a8` 上成功。
- [最新同代码快照 CI](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38145346155) 在 `061e13ebb0fb` 上成功；其后的构想接受仅追加事件，没有修改应用代码。
- 这些主线运行验证仓库检查、浏览器回归及本地 D1 迁移；不代表本主题已经执行 release 部署或真实账户验证。

## 真实渲染

以下是现有 Playwright 在固定视口中渲染的实际应用，不是静态设计稿：

- [桌面 Settings](./evidence/settings-desktop.png)
- [桌面 inline 创建](./evidence/settings-create.png)
- [手机 Settings](./evidence/settings-mobile.png)
- [手机 Session 抽屉](./evidence/settings-drawer.png)
- [320px 窄屏创建](./evidence/settings-narrow-create.png)

确认模块单列、名称 / 状态 / 操作横向组织、创建无嵌套 panel、抽屉复用列表且填满高度。键盘打开、Escape 关闭、焦点恢复、Cancel 和前进 / 后退由浏览器测试验证。

## 尚未执行

- 未部署、未使用生产 token、未实际创建生产设备或执行真实身份解绑。
- 构建仍提示大于 500 kB 的单个 chunk；这是非失败警告，本次不扩展为打包架构重构。
- `sessionStorage` 的浏览器恢复标签页行为与关闭时非严格销毁边界保留，不承诺跨标签页同步。
- Silvermoon 精确 revision 的提交 / 接受独立于用户的实施授权；ledger 不代表用户验收。
