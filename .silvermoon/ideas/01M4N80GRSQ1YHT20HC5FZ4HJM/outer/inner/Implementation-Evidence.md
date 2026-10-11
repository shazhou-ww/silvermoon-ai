# Implementation Evidence

## 交付范围

- 未登录与加载状态使用同一套明亮月色布局；大屏以统一 panel 将整组内容垂直居中，主副标题横跨登录区和人物区。
- 桌面端登录卡位于左侧并向中部移动 3%；右侧复用 Silvermoon 主项目的长发拖地背影 SVG，线图向左移动 15%，二者盒间距约 47px 且不重叠，线图宽度不低于登录卡；移动端按登录、线图、能力介绍排序。
- 本地 SVG 副本使用冷银深浅渐变表现金属质感，只在画布左右各 14% 做水平 alpha 渐隐，上下保持完整，不修改主项目原始素材。
- Google、Microsoft、GitHub 入口使用各品牌官方资源的本地图标并保持原 OAuth start 地址；来源记录在 `apps/web/public/provider-icons/SOURCES.md`。
- 三个价值点位于统一 panel 内部并紧跟主体内容，不再通过 `margin-top: auto` 贴到视口底部。
- OAuth 回调错误显示为可操作的登录卡内提示，三个入口保持可用。

## 自动化证据

`apps/web/tests/login-page.browser.ts` 在 desktop、iPhone 13 和 320px narrow 三个 Playwright 项目上共运行 9 个场景，证明：

- 品牌加载状态在 session discovery 完成前可见；
- 三个 OAuth 入口的标签和目标地址正确；
- 三个官方图标全部加载完成且具有有效自然宽度；
- 桌面统一 panel 的中心与视口中心一致，登录卡位于人物左侧，且登录卡、贯通标题均不遮挡人物；
- 自动化断言线图加载成功、宽度不低于登录卡、二者不重叠，并验证 desktop、mobile、narrow 三个视口无横向溢出；
- 独立 1000、900、761px 检查均保持两栏，登录卡与线图中心线偏差约 0.008px；760px 和共享页面的 553px 视口均隐藏线图区且高度为 0。
- 价值点与 panel 底部保留稳定内边距，三个视口均无文档级横向溢出；
- 移动端登录先于人物，OAuth 错误可理解且不移除任何入口。

## 检查结果

- `pnpm --filter @silvermoon-ai/web lint`：通过；仅有两个既有 UI 组件的 Fast Refresh 警告。
- `pnpm --filter @silvermoon-ai/web typecheck`：通过。
- `pnpm --filter @silvermoon-ai/web test:browser tests/login-page.browser.ts`：9 项通过。
- `pnpm --filter @silvermoon-ai/web test:browser`：124 项通过，2 项按既有条件跳过。
- `pnpm --filter @silvermoon-ai/web build`：通过；保留既有 bundle 大小警告。
