# Implementation Evidence

## 交付范围

- 未登录与加载状态使用同一套明亮月色全屏布局，主副标题横跨登录区和人物区。
- 桌面端登录卡位于左侧，复用既有银月全身图并完整显示在右侧；移动端按登录、人物、能力介绍排序。
- Google、Microsoft、GitHub 入口带对应图标并保持原 OAuth start 地址。
- OAuth 回调错误显示为可操作的登录卡内提示，三个入口保持可用。

## 自动化证据

`apps/web/tests/login-page.browser.ts` 在 desktop、iPhone 13 和 320px narrow 三个 Playwright 项目上共运行 9 个场景，证明：

- 品牌加载状态在 session discovery 完成前可见；
- 三个 OAuth 入口的标签和目标地址正确；
- 桌面登录卡位于人物左侧，且登录卡、贯通标题均不遮挡人物；
- 桌面能力介绍位于首屏内，三个视口均无文档级横向溢出；
- 移动端登录先于人物，OAuth 错误可理解且不移除任何入口。

## 检查结果

- `pnpm --filter @silvermoon-ai/web lint`：通过；仅有两个既有 UI 组件的 Fast Refresh 警告。
- `pnpm --filter @silvermoon-ai/web typecheck`：通过。
- `pnpm --filter @silvermoon-ai/web test:browser tests/login-page.browser.ts`：9 项通过。
- `pnpm --filter @silvermoon-ai/web build`：通过；保留既有 bundle 大小警告。
