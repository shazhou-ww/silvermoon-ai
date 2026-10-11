# 部署准备证据

这是 Outer World 的准备观察，不是部署完成证据。部署契约同步后才按其稳定 revision 执行外部检查；当前 D steps/criteria 均未完成。

## 2026-10-11 的配置与只读观察

- 实现接受已记录为 `acceptInner`；被接受的 Inner revision 为 `a92e1a0e0e298e88cb8abe2779e9cf706f60d4ee`。接受事件已同步 primary，未记录 submitOuter 或 acceptOuter。
- [Check and deploy 配置](../../../../.github/workflows/check-and-deploy.yml) 显示 main/release 都运行 check，仅 release push 运行 deploy；依序远程 D1 migrations、Worker、Pages。该流程不包含 npm 包发布。
- [Worker 配置](../../../../apps/worker/wrangler.jsonc) 指向 `silvermoon-relay`、D1 同名数据库和 `relay.silvermoon.work`；[发布说明](../../../../README.md#release) 指明 Pages 项目 `silvermoon-work`。
- 只读 GitHub API 观察 release tip 为 `a3f8db3420d5e7b434d5b58db554352caa79c919`。这是当时观察，不保证执行时仍相同；执行前必须刷新并核对，不能 force-push。
- 对应接受提交 `16be01b7ab3c912aa0cdb16bf31f0b608398a465` 的 [main check run](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38144091795) 当时为 in_progress。没有在结果出来前填 success；早先实现提交 run 因后续 main 推送而取消，不等于其测试失败或部署完成。

## 未执行与剩余前提

- 未合并或推送 release，未远程迁移数据库，未部署 Worker/Pages。
- 未查询或使用生产凭据，未发布 npm 包，未替换任何实际设备上的 connector。
- 尚无实际目标设备、connector 发布范围、备份时点或远程验证证据；不将本地构建或 Inner mock 测试重复登记为 D 证据。
- 下一项操作是明确生产升级授权和设备验证范围；main CI 等外部结果只在有新结果后观察，不轮询不变状态。
