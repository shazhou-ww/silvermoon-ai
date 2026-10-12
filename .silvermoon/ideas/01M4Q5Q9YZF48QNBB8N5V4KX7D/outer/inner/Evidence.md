# 实现证据

## 变更边界

- `apps/worker/src/oauth.ts` 只在 Google、Microsoft、GitHub 共用的授权 URL 构造中加入 `prompt=select_account`。
- callback、Relay sign-out、token exchange、OIDC 校验、GitHub profile 读取及 external identity 解析未改变。
- `apps/worker/src/index.test.ts` 逐家验证参数和取消返回，并覆盖已消费事务的重复 callback。

## 验证结果

- `pnpm --filter @silvermoon-ai/worker test -- src/index.test.ts`：30 个测试通过。
- `pnpm --filter @silvermoon-ai/web test:browser -- tests/login-page.browser.ts`：桌面、窄屏和移动端共 9 个测试通过。
- `pnpm --filter @silvermoon-ai/worker exec tsc -p tsconfig.json --noEmit`：通过。
- `pnpm exec oxlint apps\worker\src\oauth.ts apps\worker\src\index.test.ts`：通过。

标准 Worker `typecheck` 在 TypeScript 编译前报告主线已有的 `worker-configuration.d.ts` 生成状态过期；未为本变更重新生成或提交该并发配置产物。真实账号选择、选择原账号及提供商托管取消交互仍须在 Deployment 中由用户逐家操作验证。
