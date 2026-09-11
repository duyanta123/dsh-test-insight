# dsh-test-insight 发布检查清单

## 本地发布前

- [ ] 使用受支持的 Node.js 20.11+；DSH 组合验证使用 Node.js 22.19+。
- [ ] 设置企业网络所需的 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`，仅在环境需要时使用。
- [ ] 执行 `npm ci`，确认 `package-lock.json` 与 `package.json` 一致。
- [ ] 执行 `npm test`。
- [ ] 执行 `npm run pack:check`，确认包内不含 `node_modules`、测试夹具或 scanner 源码。
- [ ] 执行 `npm pack` 后，在空目录安装 tarball，加载插件入口、`./core` 和 `dsh-repo-scanner/scanner`。
- [ ] 检查 `schema/test-insight.schema.json`、README、CHANGELOG 和技能 runbook 与当前实现一致。
- [ ] 在临时 fixture 上分别验证 `all`、`change`、`target`；默认命令不执行目标仓库测试。
- [ ] 验证冷缓存、热缓存和 `perf_budget_ms` 超限降级；报告包含限制、耗时和 warning。
- [ ] 若启用草稿，确认草稿位于独立目录、带 `DRAFT ONLY`/人工审查标记且不覆盖已有文件。
- [ ] 若启用测试执行，仅使用明确授权的 allowlist 命令，并记录超时、输出上限和结果。

## DSH 组合验证

- [ ] 在可安装的 `@deepseek-ai/dsh@0.1.5-rc.2`（Node.js >=22.19）环境加载 bundle。
- [ ] 确认 `inject: ["skills"]` 与 `test-insight-runbook` 技能可见。
- [ ] 确认宿主可观察写入路径用于会话产物；`FS_NOT_OBSERVED` 原样透传。
- [ ] alpha 预发布验证（如执行）单独记录，不纳入默认 CI 门禁。

## 发布后

- [ ] 从全新目录安装发布版本。
- [ ] 运行 `dsh-test-insight --help`。
- [ ] 保存实际 scanner `tool.version` 和报告 `schema_version`。
- [ ] 记录回滚版本和已知限制。
