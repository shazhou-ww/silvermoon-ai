# Deployment

将已验收实现通过仓库既有 `release` 工作流交付到 `silvermoon.work` 与 `relay.silvermoon.work`，再由用户逐家操作真实账号完成最终验收。任何非认证 URL 探针只证明已部署参数，不替代真实账号切换证据。

## Steps

### D-S01: 获准交付后检查真实账号选择

将包含已验收 Implementation 的 primary 以普通 merge 合入 `release`，等待 Check and deploy 的 check 与 deploy jobs 成功；记录 release commit、run、Worker version、Pages deployment 与生产 health，不 force、回滚数据或发布 npm。

### D-S02: 分别记录三家实际结果

先以不携带认证的生产授权入口分别确认 Google、Microsoft、GitHub 重定向到各自官方端点并包含 `prompt=select_account`。随后由用户操作真实登录、密码和 MFA，逐家记录选择另一现成账号、进入对应 Relay 账号及此前延期的视图偏好账号隔离结果；一个 provider 或纯 URL 探针不能替代另一个 provider 的真实证据。

### D-S03: 检查取消并恢复原环境

由用户在桌面与窄屏逐家验证选择原账号、取消和失败返回；结束后恢复原账号与验证前偏好。只记录 provider、结果、时间和未验证边界，不记录账号身份、凭据、cookie、token 或 OAuth state。

## Acceptance criteria

### D-AC01: 目标站点可以选择另一个现成账号

release workflow 的 check 与 deploy jobs 成功，生产 health 正常；Google、Microsoft、GitHub 分别以真实登录状态与两个现成 Relay 账号证明选择机会可见、进入所选账号正确，并补做此前延期的视图偏好账号隔离验收。

### D-AC02: 正常与原账号登录保持正确

对三种 provider 分别证明选择原账号仍进入原 Relay 账号；无新增身份绑定、自动合并、权限变化或账号隔离副作用。

### D-AC03: 取消和恢复不产生账号副作用

在目标站点逐家记录取消与恢复结果，证明未误绑定身份或修改真实账号、设备、Session 数据；恢复验证前账号与偏好，并明确任何未执行的真实路径。
