# Ledger

## Implementation

### Implementation steps

- [x] **I-S01:** 统一过期时间比较语义
- [x] **I-S02:** 增加限流回归覆盖

### Implementation acceptance criteria

- [x] **I-AC01:** 过期事务不再占用名额
- [x] **I-AC02:** 阈值行为保持不变
- [x] **I-AC03:** Worker 验证通过

## Deployment

### Deployment steps

- [ ] **D-S01:** 发布 Relay Worker
- [ ] **D-S02:** 验证生产过期行为

### Deployment acceptance criteria

- [ ] **D-AC01:** 生产 OAuth 启动恢复
- [ ] **D-AC02:** 生产数据无需改写
- [ ] **D-AC03:** Relay 健康状态正常
