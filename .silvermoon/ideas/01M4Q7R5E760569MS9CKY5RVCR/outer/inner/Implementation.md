# Implementation

## Steps

### I-S01: 复现并统一窄屏回退行为

在 320×640 模拟窄屏复现 Settings 左上角入口打开覆盖式 Sessions dialog；Settings 内容本身无横向溢出。移除该专用 drawer 状态与样式，让入口复用普通 Session detail 的 `ArrowLeft`、`Back to Sessions` 可访问名称和内部列表切换。切换前从 Settings 路由保留原 Session selection，再把 URL 更新为列表路由，避免使用浏览器 history 返回站外。

### I-S02: 补充导航回归验证

在现有 Playwright runner 中覆盖 iPhone 13、320px narrow 与 desktop：验证 Settings 返回完整列表、普通详情页返回、760/761px 边界切换、键盘触发与目标焦点，并检查筛选、selection 高亮和 Session 草稿保持。以 [Evidence.md](Evidence.md) 记录定向与完整验证结果。

## Acceptance criteria

### I-AC01: 窄屏返回列表正确

`settings.browser.ts` 的窄屏回归证明按钮不再打开 dialog，键盘触发后 Settings 卸载、完整 Sessions rail 可见且可操作，URL 为站内列表路由，标题获得焦点，文档无横向溢出。

### I-AC02: 既有导航保持一致

完整 Settings 浏览器套件、普通 detail 定向回归、web 单测、类型检查、lint 与生产 build 证明 desktop Settings 与既有 detail 返回未回归；窗口切换后筛选、selection 和草稿仍按既有语义保留。
