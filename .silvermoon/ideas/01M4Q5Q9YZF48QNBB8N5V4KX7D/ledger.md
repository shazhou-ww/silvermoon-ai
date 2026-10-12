# Ledger

## Implementation

### Implementation steps

- [x] **I-S01:** 确认授权流程与账号选择方案
- [x] **I-S02:** 实现提供商特定的授权请求
- [x] **I-S03:** 覆盖正常、取消与失败回归

### Implementation acceptance criteria

- [x] **I-AC01:** 选择流程可用且不改变身份语义
- [x] **I-AC02:** 既有授权校验保持有效
- [x] **I-AC03:** Web 入口与错误路径保持可用

## Deployment

### Deployment steps

- [x] **D-S01:** 获准交付后检查真实账号选择
- [ ] **D-S02:** 分别记录三家实际结果
- [ ] **D-S03:** 检查取消并恢复原环境

### Deployment acceptance criteria

- [ ] **D-AC01:** 目标站点可以选择另一个现成账号
- [ ] **D-AC02:** 正常与原账号登录保持正确
- [ ] **D-AC03:** 取消和恢复不产生账号副作用
