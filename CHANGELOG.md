# Changelog

# 1.0.0-rc.3 - 2026-09-12

- 准备 npm 首发：新增 `.github/workflows/publish.yml`（trusted publishing，`v*` tag 推送与 workflow_dispatch 双通道）。npm OIDC 无法完成新包的首次发布（npm/cli#8544），首个版本需本地 `npm publish` 并在 npmjs.com 绑定 trusted publisher，此后 tag 推送即自动发布。
- 补充 `LICENSE`（MIT）与 `package.json` 仓库元数据（license / repository / bugs / homepage / keywords），`files` 纳入 `README.zh-CN.md` 与 `LICENSE`。
- 全量重写双语 README，开发计划改名并修正基线矛盾表述。1.0.0-rc.2 仅作为 git 里程碑，未发布至 npm。

# 1.0.0-rc.2 - 2026-09-11

- DSH 宿主兼容基线从 `0.1.2-rc.1` 迁移到 `0.1.5-rc.2`：新增 `npm run test:compat` 门禁（隔离 profile 的 add、配置 dump、有限时长启动）与 CI compat job（Windows/Ubuntu × Node 22.19），`.ci/dsh-host` 组合验证夹具同步锁定 `0.1.5-rc.2`。
- 上游 0.1.3~0.1.5 的破坏性变更（`SessionHandle`、异步 `agentLoop.create()`、Session format v2/v3、`ctx.agent` 移除、Inbox API 变更）均不涉及本插件使用的技能 provider 路径，插件代码零改动。
- 提示：DSH 宿主升级到 0.1.5 系后 Session format 迁移为 V3，不可逆；最终用户升级宿主前请备份会话日志。
- `.gitignore` 排除 `.ci/` 下的安装工件（node_modules、tgz），宿主夹具改为现场生成。
- 修复 `src/execution.mjs` 中 `normalizeArrayCommand` 函数体错位导致 `validateExecutionCommand` 等作用域丢失、授权测试执行路径 3 例测试失败的问题（存量损坏，与宿主升级无关）。
- 首次 CI 全矩阵运行暴露并修复四处测试缺陷（均不影响运行时行为）：`test/adapter.test.mjs` 的 fixture 路径在 POSIX 上丢失前导 `/`（改用 `fileURLToPath`）；`test/input.test.mjs` 缓存用例误嵌套进上一测试体导致子测试被取消；`test/fixtures/execution/slow.test.mjs` 改为注册异步测试，避免 Node 22 测试运行器对未注册用例的文件提前退出；compat 的 DSH 安装步骤增加 `--no-audit --no-fund` 并放宽超时至 900s。
- 修复 `executeAuthorizedTests` 的 node:test 环境泄漏（运行时健壮性）：宿主自身运行于 `node --test` 时，派生的 `node --test` 子进程会继承 `NODE_TEST_CONTEXT` 标记、判定"递归调用"而跳过运行文件并立即以 0 退出；spawn 前现在会剥离该标记，超时窗 50ms→250ms。

# 1.0.0-rc.1 - 2026-09-06

- 完成 v1.0 RC：稳定报告 schema、共享扫描缓存与性能预算观测。
- 增加隔离的人工审查测试草稿和显式授权的 allowlist 测试执行流程。
- 增加 Node/OS CI 矩阵、打包安装 smoke test 和 DSH skill provider 组合契约。

## Unreleased / v1.0 release candidate

- 完成 coverage 事实解析、测试矩阵、稳定报告 schema 和 Markdown/JSON 共源生成。
- 增加独立 review-only 测试草稿，默认写入隐藏目录并使用原子写入与覆盖保护。
- 增加显式授权的 allowlist 测试执行 workflow，支持 shell-free 参数、超时、输出上限和脱敏。
- 增加共享 scanner 缓存、冷/热缓存指标、端到端性能预算和超预算置信度降级。
- 增加 Windows、Ubuntu、macOS 与 Node 20/22 CI，以及打包后干净安装 smoke test。
- 增加 DSH skill provider、runbook CLI 示例和发布检查清单。

## 0.1.0

- 创建 Phase 0 npm 项目骨架。
- 声明 `dsh-repo-scanner` 运行时依赖入口。
- 增加初版输出 schema、CLI、插件入口和技能 runbook。
