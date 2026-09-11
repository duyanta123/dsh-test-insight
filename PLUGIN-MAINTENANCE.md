# dsh-test-insight 维护规则（Maintenance Runbook）

> 本文档是 dsh-test-insight 仓库的专属维护基准，与工作区顶层 docs/PLUGIN-MAINTENANCE.md 通用规则配套使用（该文件位于本仓库之外）。本文件聚焦本仓库的细节。
> 原则：**不改不动，要改就一步到位**——代码/技能、测试、CHANGELOG、版本号、tag 一起改，不留下半成品版本。

## 1. 仓库概况

| 项 | 值 |
|---|---|
| 类型 | 测试型（仓库事实 → 测试计划与测试草稿） |
| 当前版本 | 1.0.0-rc.2 |
| 分发状态 | 已转正（2026-09-11，github.com/duyanta123/dsh-test-insight）；awesome 收录条目待建 |
| 运行时 | 零构建 ESM，独立 CLI/库 Node >=20.11；DSH 宿主 >=22.19 |
| 核心依赖 | npm `dsh-repo-scanner`（唯一带 dependencies 的插件仓；不复制 scanner 源码） |
| 核心模块 | `src/`（engine / input / analysis / mapping / coverage / drafts / execution / report / scanner-adapter / redaction）+ `scripts/cli.mjs` |

## 2. 目录结构与职责

```text
dsh-test-insight/
├── package.json              # npm 包 + dsh.bundle.patch + bin（dsh-test-insight）+ exports ./core
├── cordis.patch.yml          # DSH bundle patch
├── plugin/index.js           # FileSystemSkillProvider 注册 skills/
├── skills/test-insight-runbook/SKILL.md   # 测试洞察 runbook
├── src/                      # 共享核心（exports 子路径 dsh-test-insight/core）
│   ├── engine.mjs            # analyze() 库入口（normalize → facts → mapping → analysis → report）
│   ├── input.mjs             # all/change/target 输入归一化与三条 Git 通道
│   ├── analysis.mjs          # 证据等级、缺口、风险排序、测试矩阵
│   ├── drafts.mjs            # 隔离草稿（默认 .dsh/test-insight/drafts，原子写入）
│   ├── execution.mjs         # 双重授权的 allowlist 测试执行
│   └── ...                   # mapping / coverage / report / scanner-adapter / redaction / errors
├── scripts/cli.mjs           # CLI 实现（bin 指向 scripts/test-insight.mjs）
├── schema/test-insight.schema.json        # 报告 JSON schema
├── docs/RELEASE-CHECKLIST.md # 发布前三段式检查清单
└── test/                     # 10 个测试文件 + dsh-compat 门禁 + fixtures
```

## 3. CI 与测试门禁

- **独立回归**：`npm test`，10 个测试文件（smoke / input / adapter / analysis / report / cli / contract / coverage / draft-execution / performance）。
- **发布自检**：`npm run release:check` = test + `npm run pack:check` + 三处 `node --check`（plugin/index.js、scripts/cli.mjs、src/index.mjs）。
- **DSH 宿主兼容**：`npm run test:compat` 固定 `@deepseek-ai/dsh@0.1.5-rc.2`，要求 Node >=22.19，执行隔离 profile 的 add、dump-config 和有限时长启动。
- **GitHub Actions**：ubuntu + windows + macos × Node 20.11/22 + 包级 smoke；DSH compat Windows/Ubuntu × Node 22.19。
- **组合验证夹具**：`.ci/dsh-host` 现场生成（安装工件不入库，`.gitignore` 排除）。

## 4. 一次完整变更的动作序列

1. 改代码 / 技能 / 文档
2. 补或更新 `test/` 对应用例（报告 schema 变化必须同步 `schema/test-insight.schema.json` 与 contract 测试）
3. 更新 `CHANGELOG.md`（先写 `Unreleased`）
4. 本地跑 `npm test` 与 `npm run release:check` 全绿
5. 有行为变更时改 `package.json` 的 `version`（semver；1.0 正式版发布前用 rc 后缀）
6. 推送 `main`，GitHub Actions 全绿
7. 打 tag `vX.Y.Z` 并推送

## 5. 分场景维护细则

### 5.1 报告 schema 变更（`schema/test-insight.schema.json` / `src/report.mjs`）
- `REPORT_SCHEMA_VERSION` 是报告契约版本，已发布字段不删除；Markdown 与 JSON 共源生成，改一处必须验证两通道输出一致（`test/report.test.mjs`）。

### 5.2 scanner 依赖升级
- 核心扫描事实来自 npm `dsh-repo-scanner`（`^0.1.x`）。scanner 升级后：跑全量测试确认 `getTestInsightFacts` 等事实 API 字段兼容；报告中的「实际 scanner 版本」字段应如实反映。
- 不在仓内复制 scanner 源码或扫描逻辑（runbook 明确约定）。

### 5.3 测试执行路径变更（`src/execution.mjs`）⚠️ 最高风险区
- 双重授权（`--execute-tests` + allowlist `--test-command`）、shell-free 参数数组、固定工作目录、超时与输出上限是安全红线，任何放宽都属行为不兼容。
- 历史教训：1.0.0-rc.2 修复过 `normalizeArrayCommand` 函数体错位导致授权路径失效的存量 bug——改动此文件必须跑 `test/draft-execution.test.mjs` 全部用例。

### 5.4 草稿与输出安全（`src/drafts.mjs`）
- 草稿默认写入 `.dsh/test-insight/drafts`，原子写入 + 覆盖保护；输出不覆盖已有文件（`--force` 除外）。这些行为不允许默认关闭。

### 5.5 元数据与打包
- 改动对外描述时同步：`README.md` / `README.zh-CN.md` 首段（双语，结构一致）、`package.json` 的 `description`/`keywords`、awesome 条目（建立后）。
- 发版时同步双语 README 的 version 徽章与安装示例 tag。
- `files` 白名单已含 `plugin/`、`src/`、`scripts/`、`schema/`、`skills/`、`docs/`、双语 `README.md`/`README.zh-CN.md`、`CHANGELOG.md`、`LICENSE`、`cordis.patch.yml`——`PLUGIN-MAINTENANCE.md` 与开发计划为仓库维护资产，不在 npm 包内。

## 6. 版本与发布节奏

- 当前处于 **1.0 release candidate** 阶段；行为变更升 rc 号，正式发布时去掉后缀。
- 发布动作详见 [PUBLISHING.md](PUBLISHING.md) 与 [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md)。

## 7. 发布前清单

- [ ] `npm test` 全绿（10 个测试文件）
- [ ] `npm run release:check` 通过
- [ ] `npm run test:compat` 通过（DSH 0.1.5-rc.2 / Node 22.19+）
- [ ] `CHANGELOG.md` 已归并 `Unreleased`
- [ ] `package.json` version 与 tag 一致
- [ ] 双语 README 的 version 徽章与安装示例 tag 已同步
- [ ] `dsh-repo-scanner` 依赖版本范围与 scanner 最新发布兼容
- [ ] `files` 字段包含所有应发布文件
- [ ] 对外描述若变，列表条目已同步（或已提交 PR）
- [ ] 推送 `main`，GitHub Actions 全绿
- [ ] 打并推送 tag `vX.Y.Z`
