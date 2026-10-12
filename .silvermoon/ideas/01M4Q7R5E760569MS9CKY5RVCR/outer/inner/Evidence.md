# 实现证据

## 原症状与根因

- 在现有 `settings.browser.ts` 的 320×640 项目中，Settings 页面无文档级横向溢出。
- 点击左上角 `Open Sessions` 会打开覆盖 Settings 的 `Sessions` dialog；普通 Session detail 的同位置 `Back to Sessions` 则切换为完整列表。
- 根因是窄屏 Settings 独有的 `SessionNavigation` dialog、drawer 状态与样式，而不是 Settings 卡片布局或滚动位置。

## 修复结果

- 窄屏 Settings 使用既有 `.mobile-back-button`、`ArrowLeft` 与 `Back to Sessions` 可访问名称。
- 返回动作使用产品内部路由；Settings 路由中的 Session selection 在切换到列表 URL 前交给既有 route state，因此列表仍显示原 selection，筛选和草稿不清空。
- Settings 专用 Sessions dialog、drawer 状态和对应 CSS 已移除；desktop Settings 继续显示既有左侧 Sessions rail。

## 验证

- `pnpm --filter @silvermoon-ai/web typecheck`：通过。
- `pnpm --filter @silvermoon-ai/web lint`：通过；仅报告两个与本变更无关的既有 Fast Refresh warning。
- `pnpm --filter @silvermoon-ai/web test`：71 项通过。
- `pnpm --filter @silvermoon-ai/web build`：通过；保留既有 bundle size warning。
- `pnpm --filter @silvermoon-ai/web exec playwright test tests/settings.browser.ts --project=desktop --project=mobile --project=narrow --workers=1`：53 项通过，1 项按预期在 desktop 跳过。
- `pnpm --filter @silvermoon-ai/web exec playwright test tests/session-list.browser.ts --project=mobile --project=narrow --grep "mobile selection and back navigation preserve the list workflow" --workers=1`：2 项通过。

浏览器证据来自 Playwright 的 iPhone 13 与 320×640 模拟视口，不是实体手机测试。未修改真实 Device、Session、账号或生产设置，也未执行生产部署。
