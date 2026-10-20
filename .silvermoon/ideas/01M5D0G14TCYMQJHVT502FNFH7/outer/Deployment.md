# Deployment

本契约接续用户前序“部署生产并试用”与本次“按已评审 UI 直接推进、由主 Agent 审核门限”的授权：先重新验证本机真实闭环，再沿既有 release CI 更新同一生产 Worker/Pages，并做不写消息的上线核验。不得扩大到 npm 发布、外部宿主仓库、生产数据清理或凭证文件读取；不得把本地消息夹具说成生产业务执行成功。必须先同步本契约并观测修订，再执行本轮验证/部署。

## Steps

### D-S01: 核对启用与授权范围

核对已接受实现提交、同步契约、生产 `silvermoon-relay` 与 `silvermoon-work` 的现有域名/资源、当前 Worker 版本及 release 祖先。只沿现有 `.github/workflows/check-and-deploy.yml` 正常快进 release，不 force、不绕过全套 check；确认没有新 D1/DO schema 迁移，不覆盖现有凭证/绑定。记录版本与恢复边界。

### D-S02: 验证真实浏览器消息闭环

在同步契约后重新运行真实 loopback `pnpm test:devices:smoke` 和构建页面的 `devices.browser.ts` 桌面/手机/极窄屏回归，覆盖 2×2 定向与群发、显式启用/无 ACK、结果未知原键恢复、多标签页锁、范围/账户隔离、空态与错误。通过后由主 Agent 推进生产 release，等待全仓/浏览器检查和 Worker/Pages 部署成功；不在真实设备上执行 payload。

### D-S03: 核验旧入口与保留数据

重跑真实 v1 浏览器 smoke。部署后核实 Worker 当前版本、健康、公开根与 `/history`、`/legacy`、未授权新 API；在仍共享且已登录的浏览器中只读检查 Devices、空试用设备双向历史、旧深链接及原 18 条历史边界，保留原设备和试用数据，不主动发送、轮换或删除。不访问未共享标签页；若共享会话不可用，保留上线结果并明确该认证核验缺口，不能伪造通过。停止本轮助手并清理仅本轮隔离状态。

## Acceptance criteria

### D-AC01: 启用版本与权限可核验

证据记录执行前同步提交/契约修订、已接受实现、release 源提交、成功 CI URL、实际 Worker/Pages 版本与前一版本。真实 workerd/浏览器检查与部署流程均通过；浏览器无 Device 凭证/消费 ACK，未授权新读 API 明确拒绝。

### D-AC02: 浏览器闭环与恢复有实证

本机真实 UI＋Relay＋Device lib smoke 通过，无 mock HTTP、无外部网络/凭证；构建 UI 回归验证 1440、390、320 CSS 像素、多标签页未知提交/重载原键恢复和明确 Relay 接收文案。生产根实际加载 Devices 构建，新只读接口已上线且会话范围正确，不因上线核验自动 opt-in 或提交生产消息。

### D-AC03: 历史与清理边界保持

旧本机 v1 smoke 通过；生产旧 device/stream/seq 链接仍读取原命名空间，原 18 条历史边界不变，`/history`、`/legacy` 和 Settings 保持可用。没有读取提供过的 token 文件、泄露凭证或清理原数据；记录 Web Locks/localStorage 前提、无执行/presence 投影及并行旧 fixture 风险，不把上线当容量或灾备证明。
