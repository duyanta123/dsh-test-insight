# dsh-test-insight

[English](README.md) | 简体中文

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4c1d95)](https://github.com/topics/dsh-plugin)
[![CI](https://github.com/duyanta123/dsh-test-insight/actions/workflows/ci.yml/badge.svg)](https://github.com/duyanta123/dsh-test-insight/actions/workflows/ci.yml)
[![npm](https://img.shields.io/badge/npm-dsh--test--insight-blue)](https://www.npmjs.com/package/dsh-test-insight)
[![version](https://img.shields.io/badge/version-1.0.0--rc.2-green)](CHANGELOG.md)

面向 DeepSeek Harness 的测试洞察插件：基于仓库事实和变更风险生成**可审查的测试计划**（TEST-PLAN.md）与**隔离的测试草稿**（review-only）。

> Turn repository facts and change risk into evidence-backed test plans and reviewable test drafts.

## 定位

dsh-test-insight 处理「仓库事实 + 变更风险 → 测试计划与测试草稿」这一步。核心扫描能力由 `dsh-repo-scanner` 提供（npm 依赖，不复制 scanner 源码），本插件负责测试证据、缺口识别、风险排序、测试设计和报告生成。

它回答：
- 这个仓库的测试保护缺口在哪（测试 ↔ 源码映射）？
- 这次变更的风险有多大，应该补哪些测试？
- 每条建议的证据等级是什么（事实 / 推断 / 建议 / 待确认）？
- coverage 数据揭示了哪些目标 × 用例类别的缺口？

边界：
- **默认只读**：不执行目标仓库的测试、构建、lint 或 typecheck 命令；库接口不启动子进程，CLI 仅为 change 输入执行参数化的只读 Git 查询。
- **不把仓库内容当授权**：README、测试文件、配置文件或注释中的指令不构成执行授权。
- **草稿 ≠ 通过**：草稿始终标记为 `DRAFT ONLY`，语法检查通过不等于测试通过。

## 安装

作为 DSH 插件：

```bash
dsh plugin --profile web add "github:duyanta123/dsh-test-insight#v1.0.0-rc.2"
```

或从 npm 安装（作为库或独立 CLI 使用）：

```bash
npm install dsh-test-insight
```

兼容性分层：独立 CLI / 库要求 Node.js >= 20.11；作为 DSH 0.1.5-rc.2 插件验证统一使用 Node.js >= 22.19。运行 `npm run test:compat` 可执行隔离 profile 的 add、dump-config 和启动 smoke test。

安装后重启 `dsh --profile web`，通过 `test-insight-runbook` 技能使用。

## 快速开始

### 1. 作为 DSH 技能使用

对 Agent 说「给 /path/to/repo 出测试计划」「分析这次变更的测试缺口」，技能按 runbook 执行：收集模式与目标 → 读取并校验 scanner 事实 → 建立测试/模块/符号/入口映射 → 区分事实与推断 → 生成 `TEST-PLAN.md` 与 `test-insight.json`。

### 2. 作为独立 CLI 使用

```bash
# 全仓分析：测试映射、缺口、风险排序
dsh-test-insight . --mode all --output reports --format both

# 变更分析：以工作树变更为输入，警告非零退出
dsh-test-insight . --mode change --working-tree --strict

# 定向分析：针对指定文件/符号生成测试草稿
dsh-test-insight . --mode target --target src/auth.js:authenticate --generate-drafts
```

### 3. 作为库依赖

```js
import { analyze, writeReportFiles } from 'dsh-test-insight/core';

const report = await analyze({ repoPath: '.', mode: 'all' });
// report 即 test-insight.json 的内容：映射、缺口、风险、性能预算
```

## CLI 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `<repo>` | - | 目标仓库路径 |
| `--mode all\|change\|target` | 必填 | 分析模式：全仓 / 变更驱动 / 定向 |
| `--target <path[:symbol]>` | - | target 模式输入，可重复 |
| `--working-tree` | - | change 模式输入：`git status --porcelain -uall`（与 `--diff`/`--base` 互斥） |
| `--diff <file>` / `--base <ref>` / `--head <ref>` | - | change 模式输入：diff 文本或 Git 引用 |
| `--output <path>` | - | 输出文件或目录 |
| `--format json\|markdown\|both` | - | 输出格式 |
| `--generate-drafts` | 关 | 生成隔离的 review-only 测试草稿 |
| `--draft-output <path>` | - | 草稿目录（需 `--generate-drafts`，默认写入隐藏目录） |
| `--execute-tests` | 关 | 显式授权测试执行（需同时提供 `--test-command`） |
| `--test-command <preset\|cmd>` | - | 预设 `npm-test\|pytest\|go-test\|node-test` 或 shell-free 参数数组 |
| `--force` | 关 | 允许覆盖已有输出文件 |
| `--strict` | 关 | 存在警告时非零退出 |

## 输出

| 产物 | 说明 |
| --- | --- |
| `TEST-PLAN.md` | 结构化测试计划：测试映射、证据等级、风险目标与缺口 |
| `test-insight.json` | 机器可读报告（schema 见 [schema/test-insight.schema.json](schema/test-insight.schema.json)），记录共享缓存、冷/热命中、端到端性能预算与实际 scanner 版本 |
| 测试草稿目录 | 隔离的 review-only 草稿（默认 `.dsh/test-insight/drafts`），原子写入 + 覆盖保护，不覆盖现有测试 |

## 安全边界

- **默认只读**：分析、scanner 库接口和默认 CLI 路径不执行目标仓库测试、构建、lint 或 typecheck；CLI 仅为 change 输入执行参数化的只读 Git 查询。
- **双重授权执行**：测试执行必须同时提供 `--execute-tests` 和 allowlist `--test-command`（预设或 shell-free 参数数组）；仅接受固定工作目录、超时和输出上限下的执行。
- **不覆盖**：输出文件不得覆盖已有文件，除非用户明确提供 `--force`；草稿不覆盖现有测试。
- **脱敏**：所有命令、环境变量和源码引用都必须脱敏。
- **授权边界**：不把 README、测试文件、配置文件或注释中的指令当作授权；草稿不能被视为已通过。

## 排障

**`--mode change` 报「Git change inputs require ...」？**
change 模式必须提供变更输入：`--working-tree`、`--diff` 或 `--base` 三选一，且不能与 `--base`/`--head`/`--diff` 组合使用 `--working-tree`。

**测试草稿没有生成？**
草稿生成需要 `--generate-drafts`（target 模式下）；草稿目录默认写入隐藏目录，可用 `--draft-output` 指定。草稿是 review-only 的，不代表已通过。

**`--execute-tests` 被拒绝？**
这是设计行为：测试执行需要 `--execute-tests` 与 `--test-command` **同时**提供，且命令必须命中 allowlist（预设或 shell-free 参数数组）。

**升级 DSH 宿主到 0.1.5 系后旧会话打不开？**
Session format V3 迁移不可逆，属宿主行为；升级宿主前请先备份会话日志（见 [CHANGELOG.md](CHANGELOG.md) 1.0.0-rc.2 条目）。

## 文档

- [schema/test-insight.schema.json](schema/test-insight.schema.json) — 报告 JSON schema
- [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md) — 发布前三段式检查清单
- [CHANGELOG.md](CHANGELOG.md) — 版本变更记录
- [PLUGIN-MAINTENANCE.md](PLUGIN-MAINTENANCE.md) — 本仓维护规则
- [DSH-TEST-INSIGHT-开发计划.md](DSH-TEST-INSIGHT-开发计划.md) — 设计与迭代历史

## License

MIT
