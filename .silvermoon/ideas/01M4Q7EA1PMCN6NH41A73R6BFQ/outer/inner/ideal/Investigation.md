# 网站告警调查

## 结论摘要

截至 2026-10-12 13:01（UTC+8），匿名公开访问未复现手机或 Teams 告警，因而不能确定根因，也不能将用户报告归类为网站入侵或误报。当前生产 HTML、部署 bundle 与对应 release 源码均未观察到 Cloudflare Web Analytics 的 `beacon.min.js`、`cloudflareinsights` 或 `sendBeacon`；观察到的是 Cloudflare 托管响应中的 Network Error Logging（NEL）响应头，两者不是同一种机制。

域名于 2026-10-06 注册，域名低龄是需要由实际检测产品核对的信誉因素，但注册日期本身不能证明它触发了任何告警。手机浏览器告警、Teams 基础 Malicious URL Protection、Defender Safe Links、ZAP、企业 DLP/端点策略可能使用不同判定与动作，必须以原告警和管理员事件为准，不能互相替代。

## 已取得证据

### 公开部署与源码

| 项目 | 观察 | 边界 |
| --- | --- | --- |
| 生产入口 | `http://silvermoon.work/` 返回 `301` 到 HTTPS；`https://silvermoon.work/` 返回 `200` 和应用 HTML。 | 仅证明调查时该访问路径可用，不代表手机或企业网络放行。 |
| HTML 脚本 | 生产 HTML 只声明同源 `/assets/index-BVNwOaAz.js`；无 `static.cloudflareinsights.com/beacon.min.js`、挑战脚本或其他第三方脚本。 | Cloudflare 控制台状态未访问；结论限于本次实际响应。 |
| 部署 bundle | 586,470 字节 bundle 中未出现 `cloudflareinsights`、`beacon.min.js`、`sendBeacon`；外部业务 URL 仅有 `https://relay.silvermoon.work`，其余 URL 为 React、HAST 与 XML/SVG 命名空间引用。 | 静态字符串检查不能描述扫描器自身会访问哪些信誉服务。 |
| release 源码 | release commit `809e71abdf1dfde9ee702107b5621bf9f7dda113` 的入口无分析脚本，应用以 `fetch` 调用 `https://relay.silvermoon.work`。对应 GitHub Actions 部署 run `38202522318` 于 2026-10-12 04:13:38Z 成功。 | 未读取 Cloudflare 私有配置或秘密值。 |
| Cloudflare 响应 | HTML 和静态资源带 `Report-To`、`NEL`，端点为 `a.nel.cloudflare.com`；Cloudflare 文档将其描述为浏览器网络错误报告。 | NEL 是响应头驱动的浏览器功能，不是已嵌入的 Web Analytics JavaScript；存在 NEL 不足以解释信誉封禁。 |
| 匿名 relay | `relay.silvermoon.work/` 返回 JSON `404`；未登录访问 `/api/me` 返回 JSON `403` 和 `Cache-Control: no-store`。 | 未登录、未使用 cookie，未操作任何账号。 |
| SPA fallback | `/robots.txt` 和随机不存在路径均返回应用 HTML `200`。 | 这是可观察的托管路由行为；目前没有证据证明它导致任一告警。 |
| 域名生命周期 | `.work` 注册局 RDAP 显示注册时间为 2026-10-06 08:53:26Z，最近变更为 2026-10-11 08:53:30Z。 | 域名低龄只构成待核对的信誉假设，不等于恶意判定。 |

Cloudflare 官方说明：Pages 启用 Web Analytics 后会在后续部署自动注入 analytics beacon；当前生产响应未出现该 beacon。[Pages Web Analytics](https://developers.cloudflare.com/pages/how-to/web-analytics/) 与 [Network Error Logging](https://developers.cloudflare.com/network-error-logging/) 分别描述这两种机制。

### 手机浏览器

当前只有用户报告，浏览器、系统、告警原文、触发 URL 与时间均未知，不能声称独立复现。Chrome 官方说明 Android 的危险网站警告可由 Google Safe Browsing 对钓鱼、恶意软件、不受欢迎软件或社会工程页面的判断触发；Safari 官方说明 Fraudulent Website Warning 会在疑似钓鱼或恶意软件时使用 Apple、Google Safe Browsing，特定地区还可能使用 Tencent Safe Browsing。具体产品必须由告警界面确认。

- [Chrome Android：危险网站警告](https://support.google.com/chrome/answer/99020?hl=en&co=GENIE.Platform%3DAndroid)
- [Safari 与隐私：Fraudulent Website Warning](https://www.apple.com/legal/privacy/data/en/safari/)

### Teams

当前只有用户报告“类似检测阻止发送”，未取得客户端提示、租户策略或管理员事件，不能断言是 Safe Links。微软官方对当前机制的区分为：

- Teams 基础 Malicious URL Protection 对消息中的潜在恶意 URL 显示警告，不负责点击时阻断，不要求 Defender 附加许可。
- Defender for Office 365 Safe Links 按租户策略在点击时检查并阻断，需要相应 Defender 许可。
- Defender Plan 2 的 ZAP 可按策略移除内部消息中的恶意 URL 或内容。

如果实际表现是消息无法发送，还需由管理员排查企业 DLP、条件访问、端点/网络防护或其他消息策略，不能只凭相似文案归因于 Safe Links。[Microsoft Teams Malicious URL Protection](https://learn.microsoft.com/en-us/microsoftteams/malicious-url-protection-teams) 与 [Safe Links](https://learn.microsoft.com/en-us/defender-office-365/safe-links-about) 是当前核对依据。

## 假设状态

| 假设 | 当前状态 | 所需证据 |
| --- | --- | --- |
| Cloudflare Web Analytics JavaScript 导致告警 | 本次生产响应不支持；未观察到 beacon。 | 获授权管理员只读核对 Pages Web Analytics 开关及对应部署，不做配置变更。 |
| Cloudflare NEL 导致告警 | 已观察到 NEL，但无因果证据。 | 实际检测产品给出的 URL 分类、检测名称或事件详情。 |
| 应用加载其他可疑第三方脚本 | 本次 HTML、bundle 与 release 源码不支持。 | 原告警对应的精确路径与时间；必要时对该公开路径重复同类匿名检查。 |
| 域名信誉或低龄导致告警 | 合理但未证实；域名注册不足一周。 | 浏览器检测提供方或企业威胁情报中的 verdict、分类、首次/最近判定时间。 |
| 企业策略而非公共信誉导致 Teams 动作 | 合理但未证实。 | Teams/Defender/DLP 管理员确认实际功能、策略或事件 ID。 |
| 两处告警是同一根因 | 未知。 | 两处告警分别确认检测产品、精确 URL、时间与 verdict 后再比对。 |

## 最小补证路径

用户无需绕过警告或再次向真实群聊发送测试消息，只需在下次自然出现时去敏保存：

1. 手机端的浏览器名称与版本、系统、完整告警原文、显示的检测/帮助链接、发生时间，以及去掉查询参数和片段后的 `scheme + host + path`。截图应遮盖账号、通知、公司信息和其他页面内容。
2. Teams 的客户端类型与版本、完整提示和时间、去掉查询参数和片段后的 URL；若消息未发送，记录是发送按钮不可用、发送后回退，还是服务端提示拒绝。
3. 企业管理员只读核对 Teams Messaging safety、Defender Safe Links/ZAP、DLP 或端点事件，返回功能名称、verdict/分类、策略或事件 ID、检测时间；不要关闭保护或加入普遍信任列表。
4. 获授权的 Cloudflare 管理员只读核对 Pages Web Analytics、Workers/Transform Rules 与相同时间附近的安全事件；不得改变生产设置。

若检测产品确认误报，可由对应管理员或站点所有者向该产品的官方渠道提交以下去敏说明，提交前仍需用户明确授权：

> 请求复核公开站点 `https://silvermoon.work/` 的 URL 信誉判定。我们于 `[UTC 时间]` 在 `[产品与策略/告警名称]` 观察到 verdict `[分类]`，触发路径为 `[不含查询参数的公开 URL]`。站点当前通过 Cloudflare Pages 发布；公开 HTML 与部署 bundle 未观察到 Cloudflare Web Analytics beacon 或其他第三方脚本，业务前端仅调用 `https://relay.silvermoon.work`。请提供判定类别、命中时间与复核结果。此请求不包含账号、cookie、登录回调、查询参数或私有内容。

## 方向判断

当前不应修改产品代码、Cloudflare、DNS 或企业策略。下一阶段先以原告警和管理员 verdict 确定检测来源；只有证据指向站点资源或配置时才实施最小修复，否则由对应信誉服务或企业管理员处理，并分别在原手机与原 Teams 环境复验。
