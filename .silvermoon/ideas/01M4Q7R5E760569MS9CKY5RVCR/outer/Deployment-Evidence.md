# 部署证据

## 发布结果

- 产品实现提交：`95c7d490d8b201cd16ad3757ae1adf0f6f5ef1d5`。
- `release` 已普通 fast-forward 到该提交；本 idea 复用已完成的发布，不重复推送 release、不 force、不创建 npm tag，也不执行 npm publish。
- GitHub Actions：[Check and deploy 38212258142](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38212258142)，release SHA 与产品实现提交相同。
- `check` job：`success`；冻结 lockfile 安装、`pnpm check`、全量浏览器测试与本地 D1 migration 均成功。
- `deploy` job：`success`；生产 D1 显示无待应用 migration，Worker 与 Pages 步骤均成功。
- Worker version ID：`a58aa8ad-279d-4a6e-8eac-a0bc389aaad2`。
- Pages 不可变 deployment URL：[1afbda48.silvermoon-work.pages.dev](https://1afbda48.silvermoon-work.pages.dev/)。

## 生产资源核对

- `GET https://silvermoon.work/`：HTTP 200。
- `GET https://1afbda48.silvermoon-work.pages.dev/`：HTTP 200。
- `GET https://relay.silvermoon.work/health`：HTTP 200，响应为 `{"service":"silvermoon-relay","status":"ok"}`。
- 自定义域与不可变 Pages 均引用 `index-BxDMrtnB.js` 和 `index-qBMLGCip.css`。
- 本地已验收构建、自定义域与不可变 Pages 的 `index-BxDMrtnB.js` SHA-256 均为 `f282ff7d959c308129337e4c0859bb6cd1102fe0de3aeaf611342192deb76df3`。
- 三份 JavaScript 均包含 `Back to Sessions`，且不再包含旧 drawer 的 `Choose a Session to leave Settings.`。

## 生产 bundle 导航 smoke

在新建的无真实 cookie Playwright context 中加载 `https://silvermoon.work/` 的生产 bundle，浏览器网络层拦截全部 `relay.silvermoon.work` API 请求并返回只读合成数据。没有读取或修改真实账号、Device、Session 或生产设置。

### 390×844 Settings 返回

- `/settings?connector=one&session=same` 显示可聚焦的 `Back to Sessions`，不存在 `Open Sessions` 或 `Sessions` dialog。
- 键盘 Enter 触发后 URL 为 `/`，Settings 卸载，完整 Sessions rail 可见。
- 原 Session 保持 `aria-current="page"`，移动标题为 `Sessions` 且获得焦点。
- document 无横向溢出。

### 390×844 普通 detail 返回

- 既有 `Back to Sessions` 返回 `/`，完整 Sessions rail 与原 selection 可见。
- 不出现 `Sessions` dialog，document 无横向溢出。

### 1440×900 Settings

- Settings 与左侧 Sessions rail 同时可见。
- 不显示窄屏 `Back to Sessions` 按钮，document 无横向溢出。

证据截图保存在执行 session 中，没有提交含合成身份信息的图片。以上为浏览器模拟视口，不是实体手机验证。
