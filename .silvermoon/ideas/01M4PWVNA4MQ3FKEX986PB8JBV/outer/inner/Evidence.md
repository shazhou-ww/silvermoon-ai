# 实现验证证据

2026-10-12 在独立 worktree 对当前实现运行以下检查。浏览器使用本地 Vite 页面和仓库模拟 API，不是已部署站点；本轮没有发布或部署。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @silvermoon-ai/web exec vitest run src\session-view-preferences.test.ts src\workspace-state.test.ts src\session-list.test.ts` | 3 个文件、44 项测试通过 |
| `pnpm --filter @silvermoon-ai/web typecheck` | 通过 |
| `pnpm --filter @silvermoon-ai/web exec oxlint src\session-view-preferences.ts src\session-view-preferences.test.ts src\App.tsx tests\session-list.browser.ts` | 通过 |
| `pnpm --filter @silvermoon-ai/web build` | 通过；Vite 提示产物大于 500 kB，本次没有扩大范围进行拆包 |
| `pnpm --filter @silvermoon-ai/web exec playwright test session-list.browser.ts settings.browser.ts --workers=3` | 90 项中 88 项通过、2 项桌面下的移动端专属测试按既有配置跳过；无失败 |

## 标准对应

- **I-AC01:** [单元测试](../../../../../apps/web/src/session-view-preferences.test.ts) 与 [列表浏览器测试](../../../../../apps/web/tests/session-list.browser.ts) 覆盖四项全关默认、全部 16 种组合的刷新恢复、菜单开启与关闭保存、离线历史快捷入口、视图指示和既有 AND 筛选语义。恢复分组后展开可见设备，选择属于隐藏离线 Session 时也有可浏览分组。
- **I-AC02:** 浏览器测试使用实际同源标签页的 `storage` 事件验证双向同步、重新打开页面、不同账号隔离、退出与登录失效后重登保留；独立浏览器上下文没有偏好记录。事件重读最新存储、不重放旧值，忽略其他账号及存储区域，记录删除或存储清空恢复默认。
- **I-AC03:** 单元及浏览器测试模拟损坏内容、未知版本、存储访问/读取/写入失败；验证默认回退、失败写入只保留本页选择、不虚假同步、可见提示和结构化错误日志。恢复有效记录可清除错误，提示可关闭。搜索、状态筛选和展开状态不持久化或同步；[Settings 回归](../../../../../apps/web/tests/settings.browser.ts) 证明既有 Session 选择、导航和按账号隔离的草稿恢复/退出清除流程仍有效。[使用说明](../../../../../README.md) 已更新作用域和异常边界。

## 实际界面

测试项目分别覆盖桌面 1440 × 900、移动端 390 × 664、窄屏 320 × 640（CSS 像素）。已检查测试生成的实际页面截图，不以理想世界示意材料代替产品证据。

- [桌面恢复分组](evidence/preferences-restored-desktop.png)：恢复后自定义视图指示、分组和列表一致。
- [窄屏写入失败](evidence/preferences-write-failure-narrow.png)：警告位于列表内联提示区域，不与浮动通知堆叠遮挡开关；提示换行、可关闭、列表仍能浏览，测试同时证明无页面横向溢出。

首次回归发现新增浮动长警告叠加已有通知会遮挡窄屏视图菜单，已改用列表既有内联提示区域并重新通过全部相关检查。
