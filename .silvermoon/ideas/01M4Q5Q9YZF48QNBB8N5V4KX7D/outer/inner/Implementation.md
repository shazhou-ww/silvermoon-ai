# Implementation

下列内容是构想验收前的可调整轻量种子，不授权实现。

## Steps

### I-S01: 确认授权流程与账号选择方案

依据三家官方资料与当前 OAuth 构造，分别确认 Google、Microsoft、GitHub 登录请求的账号选择参数及提供商托管交互；保留 Relay、提供商和身份绑定三类边界，不引入账号合并或绑定变化。

### I-S02: 实现提供商特定的授权请求

仅在构想获准后修改必要的授权 URL 构造，让三种提供商各自明确进入账号选择；不改变 callback、Relay sign-out 或身份解析语义。

### I-S03: 覆盖正常、取消与失败回归

为三种提供商分别补充授权参数测试，并验证正常登录、选择原账号、取消、失败、浏览器不匹配和重复 callback 等既有保护。

## Acceptance criteria

### I-AC01: 选择流程可用且不改变身份语义

通过定向测试证明三种提供商的授权 URL 各自请求账号选择，且 Relay session、provider session 与 external identity 的职责没有改变。

### I-AC02: 既有授权校验保持有效

通过现有和新增定向测试证明各提供商适用的 state、PKCE、OIDC 校验及账号权限边界未被放宽；不保存身份、cookie 或凭据到仓库。

### I-AC03: Web 入口与错误路径保持可用

通过 Web 与 Worker 定向测试证明三种入口、选择原账号、取消、失败和重复 callback 路径保持可用且返回既有安全结果。
