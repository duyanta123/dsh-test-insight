# Changelog

# 1.0.0-rc.4 - 2026-10-24

- 补齐计划 §10/§13 验收缺口：新增 Python、Go 与入口/传播 fixture 仓库（`test/fixtures/{python,go,entry}-repo`），测试映射覆盖 `test_*.py`、`*_test.go`（scanner 归类为 source，插件层按命名约定补充识别并保留 source/confidence）与入口链传播；映射实现 §5.3 优先级 3（镜像路径，`mirror`/C 级）与 4（名称包含，`name`/D 级，歧义不猜）。
- 补齐计划 §11 契约测试：退出码 0/1/2/3 全路径、working-tree 与 --diff 的 CLI 端到端采集、无效 ref、非 Git 目录、无测试项目、相邻测试弱关联、源码与测试同时变更、coverage 可用/缺失/格式错误、多级依赖与入口传播端到端、快照示例 `examples/test-insight.example.json`（Phase 0 交付要求）、跨平台专项（CRLF、UTF-8 BOM、路径空格、中文路径、Windows 盘符路径）与 2000 文件性能回归。
- 修复：CLI 未显式传 `--coverage-format` 时输入归一化误拒（`coverage.format must be a non-empty string`），导致所有携带 coverage 选项的 CLI 运行以退出码 2 失败。
- 修复：报告输出目录创建失败（如父路径为已有文件）误报为 `SCAN_FAILED`，现在按契约映射为 `OUTPUT_FAILED`（退出码 3）。
- 修复：全仓模式下仅有弱静态关联（C/D 级）的目标不进入缺口清单——`weak_test_association` 现按计划 §6.1 在全仓模式输出。
- 输出安全（计划 §8/Step 3）：报告与草稿写入前检查符号链接与路径穿越（`src/output-security.mjs`）；草稿文件名对穿越形目标/符号保持根目录内约束。
- 草稿生成读取项目 manifest、相邻测试文件、框架识别与目标导出方式（计划 §7.3），草稿元数据新增 `context`；设计用例补充计划 §7.1 的 `expected` 字段。
- 风险排序补充计划 §6.2 因子：反向依赖模块数、依赖环、长函数与上帝对象（来自 scanner facts，不重新解析源码）。
- 测试框架识别落地（计划 §5.2）：`src/frameworks.mjs` 输出 Jest/Vitest/pytest/Go testing/node-test 与候选测试命令，均保留 source/confidence；报告新增可选 `test_frameworks`/`suggested_commands` 字段（schema 同步），`TEST-PLAN.md` §7 在未授权执行时展示 run_methods/框架来源的候选命令（仅展示，不自动执行）。
- 修正用户可见的过期文案：草稿章节不再声称「v0.1 仅输出设计，不自动写入现有测试目录」（与 `--generate-drafts` 实际写盘行为矛盾），coverage 提示去除 v0.1 版本措辞；报告 `tool.version` 从 package.json 读取，不再硬编码 0.1.0。
- 兼容垫片：scanner 0.1.x 的 statusText 解析器不识别 porcelain v1 未暂存行（`" M path"`），插件在 facts 边界规范化该形态；库接口 `diffPath` 通道在 adapter 层解析为 `diffText`（原样透传会被 scanner 静默忽略、变更事实恒为空）；change 模式扫描加入 `entry` 模式使 run_methods 可用于 §7 命令建议。
- CLI：`--all` 别名补进 `--help` 与双语 README 参数表，消除未文档化入口；`main()` 支持注入 analyze 便于退出码契约测试。
- 版本元数据对齐：`package-lock.json` 与双语 README 徽章/安装示例同步至 `1.0.0-rc.3`（此前停在 rc.2，违反发布一致性规则）；开发计划追加 2026-10-24 修订记录（v0.1→1.0.0-rc.3 范围演进、--draft-output 语义、test_matrix 内嵌化）并按现状勾选 Phase 0 清单。
- 测试稳定性：恢复 2b8ab2e 引入、被 de6d90c 重写时丢失的授权命令超时用例重试（5 次尝试 + 诊断信息）。`node --test` 子进程在高负载 runner 上偶发不等测试文件子进程即以 0 退出，使单次 spawn 断言 `timed_out` 偶发失败（CI 复现 1/85；实现本身正确终止，属测试对偶发环境的加固）。
- 修复：`analyze()` 管线把不含 targets 的 scanner 原始报告传给 `collectDraftContext`，草稿上下文在真实链路中恒为空——所有草稿 `adjacent_test` 恒 null、`export_style` 恒 unknown，与声明行为不符。现与 `buildDrafts` 共用合并 targets 后的报告，并新增走 `analyze()` 全链路的集成用例锁定（既有草稿单测直接调 `buildDrafts`/`collectDraftContext`、绕过 engine，正是该断裂此前不可见的原因）。
- 修复：`examples/` 未进 `package.json` 的 `files` 白名单，随包 README 两处相对链接装后 404（`npm pack --dry-run` 实证）；`files` 加入 `examples`，PLUGIN-MAINTENANCE 与 PUBLISHING 的打包清单同步。
- 映射：`MIRROR_TEST_ROOTS` 补 `integration-test`（对齐 scanner `TEST_DIR_NAMES`），该根目录下的镜像测试不再降级为名称弱关联，并补对应断言。
- 文档：awesome 收录状态更新为已收录——[awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 条目 `data/plugins/duyanta123__dsh-test-insight.yml`（2026-09-13，PR #4914，分类 dev）；收录门槛按上游现行口径修正（仓库满 1 天、无提交数门槛）。
- DSH 宿主兼容基线 `0.1.5-rc.2` → `0.2.1-rc.2`（npm `latest`）：`test/dsh-compat.test.mjs` 的 `DSH_VERSION`、CI compat job 名与约 8 处文档基线引用同步；插件代码零改动，兼容性由 `npm run test:compat` 实跑裁决。
- `dsh-repo-scanner` `0.1.1` → `0.1.3`（npm `latest`，`^0.1.3`）：全量测试确认事实 API 兼容（adapter-repo 快照除 `tool.scanner` 外零差异），`examples/test-insight.example.json` 的 `tool.scanner` 同步 `0.1.3`。

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
