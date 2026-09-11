# Publishing

> 本文是 dsh-test-insight 的发布手册，结构遵循工作区顶层 docs/PUBLISHING-TEMPLATE.md 模板（该文件位于插件仓库之外，不在本仓库内）；其他插件仓库的 PUBLISHING.md 同构。发布前三段式自查清单另见 [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md)。

## 1. 命名与分发身份

- npm 包名：`dsh-test-insight`（与 GitHub 仓库名一致）。
- GitHub 仓库名：`duyanta123/dsh-test-insight`（2026-09-11 由孵化区转正为独立仓库）。
- bin 命令：`dsh-test-insight`（`scripts/test-insight.mjs`）；exports 子路径 `dsh-test-insight/core`（共享核心）。
- cordis.patch.yml 插件行 id/name 为 `dsh-test-insight`。
- 本仓是唯一带 `dependencies` 的插件仓：核心扫描能力依赖 npm 包 `dsh-repo-scanner`，发布时确认该依赖版本范围与 scanner 最新发布兼容。
- README 双语：`README.md` 为英文、`README.zh-CN.md` 为中文，顶部互链；两者章节结构必须一致，改动描述时同步更新。

## 2. 发布前检查清单

1. 运行 `npm test`（10 个测试文件：smoke / input / adapter / analysis / report / cli / contract / coverage / draft-execution / performance）。
2. 运行 `npm run release:check`（test + pack:check + 三处 `node --check`）。
3. 运行 `npm run test:compat`（DSH 宿主兼容门禁）。
4. 运行 `npm run pack:check`（`npm pack --dry-run`），确认包含 `plugin/`、`src/`、`scripts/`、`schema/`、`skills/`、`docs/`、双语 `README.md`/`README.zh-CN.md`、`CHANGELOG.md`、`LICENSE`、`cordis.patch.yml`。
5. 版本一致性核对：`package.json` version、`CHANGELOG.md` 发布段、git tag 三处一致。
6. 版本徽章同步：双语 README 的 version 徽章与安装示例 tag 指向最新发布版本。

## 3. DSH bundle 契约（对齐 2026-09 现行契约）

- `package.json` 声明 `dsh.bundle.patch: ./cordis.patch.yml`——harness 只激活声明该字段的包。
- `cordis.patch.yml` 为 config-tree `- insert:` 补丁格式；harness 加载 `main`（`plugin/index.js`）。
- `plugin/index.js` 经官方 `@deepseek-ai/dsh-skill-filesystem` 的 `FileSystemSkillProvider` 注册 `skills/` 为技能根（includeDefaultRoots: false）。
- `skills/test-insight-runbook/SKILL.md` frontmatter 必填 `name`（kebab-case）+ `description`。
- 扫描事实经依赖包 `dsh-repo-scanner/scanner` 获取，本仓不复制 scanner 源码。
- 安装契约：`dsh plugin --profile <profile> add "github:owner/repo#ref"`；兼容基线 `@deepseek-ai/dsh@0.1.5-rc.2`（Node >= 22.19）。

## 4. 发布渠道

### GitHub

1. push `main`，确认 CI 全绿（ubuntu + windows + macos × Node 20.11/22 + 包级 smoke + DSH compat job）。
2. 打 tag `vX.Y.Z`（与 `package.json` version 一致，如当前 `v1.0.0-rc.3`）并推送。npm 首发例外：首个版本需本地 `npm publish` 并在 npmjs.com 绑定 trusted publisher（见 §npm）。
3. 给仓库添加 GitHub topic `dsh-plugin`（awesome 收录门槛之一）。

### npm

1. `npm login`（bugcome 账号）。
2. `npm publish`（受限网络环境先由启动环境提供代理变量；`prepublishOnly` 如配置会先跑测试）。
3. 发布后核对 `npm view dsh-test-insight version` 与 dist-tags。

### awesome 列表收录（待建）

- 本仓 2026-09-11 转正后尚未提交 awesome 条目；收录时参照 dsh-repo-scanner 经验：仓库创建满 1 天且 ≥10 个提交、`package.json` 声明 `dsh.bundle`、topic `dsh-plugin`、检查失败向同一分支推送修复。
- awesome-deepseek-harness：真实仓库 + 一句话 + 链接，en/zh 同 PR。

## 5. 安装验证（发布后）

1. `dsh plugin --profile web add github:duyanta123/dsh-test-insight` 后重启 profile，技能列表应出现 `test-insight-runbook`。
2. 说「给 test/fixtures 出测试计划」（或对一个真实小仓库），确认 runbook 执行并产出 `TEST-PLAN.md` 与 `test-insight.json`。
3. 验证 allowlist 执行路径默认关闭：不带 `--execute-tests` 时任何测试命令都不应执行。
