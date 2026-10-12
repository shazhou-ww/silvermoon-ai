# Ledger

## Implementation

### Implementation steps

- [x] **I-S01:** 将 AHP provider 提升为完整 adapter
- [x] **I-S02:** 移除 Copilot SDK 控制面
- [x] **I-S03:** 固化 Relay 兼容性与旧数据边界

### Implementation acceptance criteria

- [x] **I-AC01:** 单一 AHP 身份
- [x] **I-AC02:** 完整能力与显式失败
- [x] **I-AC03:** 依赖与兼容性收敛

## Deployment

### Deployment steps

- [ ] **D-S01:** 记录 AHP 切换基线
- [ ] **D-S02:** 发布 AHP-only Connector
- [ ] **D-S03:** 验证单一来源并观察回退

### Deployment acceptance criteria

- [ ] **D-AC01:** 不再产生 SDK 投影
- [ ] **D-AC02:** AHP 操作端到端成功
- [ ] **D-AC03:** 历史数据与回滚安全
