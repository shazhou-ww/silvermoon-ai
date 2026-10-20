# 以 Device 为中心呈现双向消息工作区

## 问题

现有 Web UI 按 Device 下的多个 v1 Stream 导航，新 v2 Device 即使可通信也显示“无 Stream”。用户无法在页面中观察账户上行群发、定向发送或辨别 Relay 接收与业务执行。

## 结果

默认工作区改为 Devices 导航：账户视图展示全部 Device 上行，Device 视图展示双向消息并定向发送。取消可管理的 Stream 层级，保留独立的 v1 只读历史入口。

## 边界

- 沿用 Account/Device/Client/Message 模型；Device 固定上下行两方向，Connector 只是 lib，不新增业务实体。
- Client 不取得 Device 凭证或消费 ACK 权；HTTP 成功只表示 Relay 接收。双向历史所需的 Client 只读 API 必须按账户授权补齐，不能用假数据冒充现有能力。
- 本轮只准备[Before/After 评审](ui-review/index.html)与[行为契约](Device-Workspace-Design.md)，不实现或部署界面，不读取凭证，不继续生产试用。

## 验收标准

- 可比较账户导航、Device 双向发送、空设备/权限/旧历史三种场景，桌面与窄屏均可读。
- 全账户接收与展示筛选分离，方向、Message ID、发送目标和未确认状态明确。
- 原 v1 device/stream/seq 与旧深链接不改号、不合并；待补 API 与未知设备状态在材料中显式说明。
