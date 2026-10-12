# Implementation

实现仅改变授权请求参数；具体检查结果见 [实现证据](Evidence.md)。

## Steps

### I-S01: 确认授权流程与账号选择方案

依据三家官方资料确认 Google、Microsoft、GitHub 的 OAuth 授权端点均支持 `prompt=select_account`；Relay 继续只管理自身 session，账号选择、密码和 MFA 仍由提供商托管。

### I-S02: 实现提供商特定的授权请求

在三种 provider 共用且类型受限的授权 URL 构造中加入 `prompt=select_account`。未改变 callback、Relay sign-out、token exchange、profile 解析或 external identity 解析。

### I-S03: 覆盖正常、取消与失败回归

扩展 Worker 测试，逐一断言三种 provider 的账号选择参数与取消返回，并验证已消费事务拒绝重复 callback；运行既有 state、PKCE、nonce、tenant、浏览器绑定及 Web 登录页回归。

## Acceptance criteria

### I-AC01: 选择流程可用且不改变身份语义

Worker 参数化测试证明三种授权 URL 都请求 `select_account`。代码 diff 仅涉及授权参数，未改变 Relay session、provider profile 或 external identity 逻辑。

### I-AC02: 既有授权校验保持有效

Worker 30 个测试与 TypeScript 编译通过，证明 state、PKCE、OIDC nonce、Microsoft consumer tenant、发起浏览器绑定及重复 callback 保护保持有效；仓库未保存身份或凭据。

### I-AC03: Web 入口与错误路径保持可用

三种取消路径均清理 OAuth cookie 并返回既有登录错误；Web 登录页 9 个桌面、窄屏和移动端浏览器测试通过。选择原账号及真实提供商交互保留到 Deployment 逐家验证。
