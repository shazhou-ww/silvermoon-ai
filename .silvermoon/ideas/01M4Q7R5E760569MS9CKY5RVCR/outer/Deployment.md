# Deployment

## Steps

### D-S01: 发布获批的导航修复

确认产品实现提交 `95c7d490d8b2` 已随普通 fast-forward 进入 `release`，由既有 GitHub Actions 工作流完成检查、D1、Worker 与 Pages 发布；不重复创建发布提交或执行手工生产变更。版本、workflow 与不可变 Pages URL 记录在 [Deployment-Evidence.md](Deployment-Evidence.md)。

### D-S02: 复验窄屏与桌面导航

对生产自定义域与不可变 Pages 资源做 HTTP 与哈希核对；使用无真实 cookie 的隔离 Playwright context 加载生产 bundle，并以浏览器网络层合成 API 数据复验窄屏 Settings 返回、普通 detail 返回及桌面 Settings。所有证据均为模拟视口，不宣称实体手机验证。

## Acceptance criteria

### D-AC01: 发布结果可确认

release workflow `38212258142` 的 `check` 与 `deploy` jobs 均为 `success`；生产自定义域和不可变 Pages URL 均返回 HTTP 200，并提供相同的 `index-BxDMrtnB.js`，其 SHA-256 与已验收本地构建一致。

### D-AC02: 线上导航正常

生产 bundle 的 390×844 合成数据 smoke 证明 Settings 与普通 detail 均返回完整 Sessions 列表，无 dialog、Settings 残留或横向溢出，并保留原 selection；1440×900 下 Settings 与 Sessions rail 同时可见且无窄屏回退按钮。未使用真实账号、Device 或 Session，也未取得实体手机证据。
