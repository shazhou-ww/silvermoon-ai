# Ledger

## Implementation

### Implementation steps

- [ ] **I-S01:** 识别重连后的历史缺口
- [ ] **I-S02:** 协调补偿与实时事件
- [ ] **I-S03:** 暴露同步完整性

### Implementation acceptance criteria

- [ ] **I-AC01:** 断线消息自动补齐
- [ ] **I-AC02:** 重连与实时并发幂等
- [ ] **I-AC03:** 不可恢复缺口可诊断

## Deployment

### Deployment steps

- [ ] **D-S01:** 兼容发布补偿协议
- [ ] **D-S02:** 验证真实断线窗口

### Deployment acceptance criteria

- [ ] **D-AC01:** 生产历史连续
- [ ] **D-AC02:** 重复重连不改变结果
- [ ] **D-AC03:** 部分同步状态真实
