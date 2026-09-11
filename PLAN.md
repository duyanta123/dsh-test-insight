# dsh-test-insight 详细开发计划

> 定位：根据代码变更、仓库结构和现有测试证据，发现测试保护缺口，生成可执行的测试计划与安全的测试草稿。
>
> 核心依赖：`dsh-repo-scanner`，可选结合 `dsh-change-impact`。扫描器提供模块、符号、入口、依赖、运行方式和 Git 事实；测试洞察插件负责测试映射、风险排序、缺口识别和测试设计建议。

## 0. 官方 DeepSeek Harness 现状基线

本计划依据本地官方 DSH 仓库与已发布生态最新状态修订（2026-09-06）。上游 GitHub 最新预发布为 `dsh-v0.1.3-alpha.1`，但截至本地维护文档记录，npm 可安装基线仍为 `@deepseek-ai/dsh@0.1.2-rc.1`。因此本计划的“兼容/CI 门禁基线”固定为 0.1.2-rc.1；“alpha 预发布”仅作为观察与可选验证，不作为默认可复现基线。scanner 通过 npm 包安装，安装命令固定为 `npm i dsh-repo-scanner`，具体版本以安装生成的 lockfile 和运行时 `tool.version` 为准：

- DSH 可执行/安装兼容基线 `@deepseek-ai/dsh@0.1.5-rc.2`（npm，2026-09-11 起）：
  - 宿主运行要求 Node `>=22.19`；本插件的 `test:compat`、CI 组合验证、发布前 smoke test 固定使用该版本。
- DSH GitHub 预发布 `dsh-v0.1.3-alpha.1`（2026-09，观察/可选验证）：
  - 所有出站网络请求遵循启动环境的 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`，企业代理环境下的插件安装与 CI 可用。
  - Windows：盘符根目录 Workspace 的路径分隔符与绝对路径校验已修复；本地非终端子进程不再弹出控制台窗口。
  - 统一未观察写入与编辑失败的 `FS_NOT_OBSERVED` 结构化诊断（保留文件路径与原始原因）；插件在会话内落盘必须走宿主可观察的文件写入路径。
  - Python SDK：修复单文件 runtime 把以 `node` 开头的 Bash 命令重写为 dsh runtime 的问题；新增 macOS x64 runtime wheel。
  - 破坏性变更：Session 持久化 API 改为生命周期持有的 `SessionHandle`，`agentLoop.create()` 变为异步并新增会话锁（同一会话至多一个进程持有）。本插件不直接依赖 Session API，但任何宿主集成（遥测、进度上报）必须按该模型设计。
  - 已知宿主性能回退（影响部分历史 session 加载），与本插件无直接关系，记录为基线已知项。
  - 该 alpha 尚未进入 npm，不作为默认安装/兼容门禁；如确需验证，必须显式从 GitHub ref 安装并另行记录。
- `dsh-repo-scanner`（npm 包；安装命令为 `npm i dsh-repo-scanner`）：官方只读仓库事实扫描器。
  - `"type": "module"`，主入口 `./plugin/index.js`，库接口子路径 `dsh-repo-scanner/scanner`。
  - 库接口除 `scanRepository` 外提供事实 API：`getTestInsightFacts`（同名 stem 映射基线）、`getChangeImpactFacts`（反向依赖传播，硬上限 3 层）、`getDocSyncFacts`。
  - Git 事实由调用方提供：scanner 不运行任何 git 命令，`changed_files` 只来自 `git.statusText` / `git.diffText` / `git.changedFiles` 三条输入通道（优先级依次降低）；`git.base`/`git.head` 仅作为 `compare` 元数据透传，不参与差异计算。
  - 安全红线：只读；不执行目标项目命令；不 spawn 子进程取 Git/文件事实；缓存只写系统临时目录；输出自动脱敏；默认排除 `node_modules`、`coverage`、`dist` 等。
  - 输出契约、模式名、事实 API 字段和选项的完整清单以 §4.1 为唯一权威来源，本节不重复维护。
- Phase 0 冒烟测试必须在干净临时项目中执行 `npm i dsh-repo-scanner`，验证安装包的导出、facts API、schema、变更通道和缓存行为；如需对照源码，必须单独记录 commit，不得把源码版本当作 npm 安装基线。
- `dsh-change-impact` 是兄弟插件；在它可用前，变更风险联动直接采用 scanner 的 `getChangeImpactFacts`，不自行另建反向依赖传播引擎。
- `dsh-telemetry`（npm 包 `dsh-local-telemetry`）v0.1.1：官方运行遥测插件，默认不采集内容；本插件不依赖它，但应保证可被宿主统一观测。
- 官方 DSH 插件打包规范：
  - `package.json` 声明 `dsh.bundle.patch: "./cordis.patch.yml"`，主入口 `./plugin/index.js`。
  - `plugin/index.js` 使用官方 `FileSystemSkillProvider` 注册 `skills/`，并声明 `inject = ["skills"]`。
  - `cordis.patch.yml` 使用 config-tree `- insert:` 补丁格式（`id`/`name`）。
  - `skills/<skill>/SKILL.md` 提供 runbook，frontmatter 必填 `name`（kebab-case）与 `description`；本插件技能名 `test-insight-runbook`。
  - 可选 peerDependencies：`@deepseek-ai/dsh-skill-filesystem`，并标记为 optional；若插件直接导入该包，必须提供缺失时的明确错误或降级路径，并加入全新安装后的插件加载测试。

> 结论：`dsh-test-insight` 不应重复实现 `getTestInsightFacts` 已提供的命名映射，也不应重复实现 `getChangeImpactFacts` 已提供的反向依赖传播。本插件增量价值是：符号/导入级映射增强、证据等级计算、coverage 解析、风险排序、测试设计生成、安全草稿与可执行测试计划。


## 1. 项目概览

### 1.1 产品定位

`dsh-test-insight` 不是简单的“让模型自动写测试”，而是先回答：

- 哪些代码路径风险最高？
- 哪些函数、入口和公共 API 缺少测试证据？
- 已有测试保护了哪些场景，哪些边界没有覆盖？
- 应该先补哪类测试？
- 生成的测试草稿是否符合项目现有框架和风格？

一句话定位：

```text
Turn code and change risk into an evidence-backed test plan and reviewable test drafts.
```

### 1.2 目标用户

- 修改高风险模块、需要快速补测试的开发者。
- 代码审查和 CI 前的测试缺口检查。
- `dsh-change-impact` 的后续验证阶段。
- `dsh-refactor-insight` 发现技术债后的保护性测试建设。
- 接手遗留项目、需要先建立回归测试的团队。

### 1.3 非目标

第一版不做：

- 声称实现了完整代码覆盖率分析，除非读取到真实 coverage 数据。
- 自动覆盖所有分支、异常和并发场景。
- 覆盖或删除现有测试文件。
- 自动修改源码或提交代码。
- 自动运行未知仓库命令。
- 生成与项目测试框架不匹配的测试。
- 把存在同名测试文件等同于“已经覆盖”。

## 2. 产品输出

默认产物：

```text
TEST-PLAN.md
test-insight.json
```

可选产物：

```text
tests/generated/<target>.test.<ext>
test-matrix.json
```

`test-matrix.json` 是目标 × 用例类别（正常、异常、边界、集成、安全）的覆盖矩阵，v0.2 起提供，v0.1 不生成。

测试草稿必须单独落盘，默认不写入现有测试目录，不覆盖同名文件。每个草稿文件顶部应包含生成信息和人工审查提示。在 DSH 会话内落盘时，产物写入必须通过宿主可观察的文件写入路径执行；遇到 `FS_NOT_OBSERVED` 结构化错误时原样透出错误码、文件路径与原始原因，不得静默重试。

### 2.1 v0.1 输出契约

Phase 0 必须交付 `schema/test-insight.schema.json` 和至少一个完整 JSON 示例。`test-insight.json` 使用自己的 `schema_version`（不等同于 scanner facts 的 `schema_version`），顶层字段固定为：

- `schema_version`：输出契约版本。
- `tool`：工具名称和实际版本，版本取 scanner 返回的 `tool.version`。
- `input`：规范化后的输入模式、仓库路径摘要和参数。
- `scope`：扫描范围、排除目录、未跟踪文件和截断信息。
- `targets`：目标文件、符号、入口和风险因子。
- `evidence`：测试映射、coverage 状态和证据来源。
- `gaps`：缺口类型、事实依据、优先级和置信度。
- `designs`：测试设计和适用的用例类别。
- `warnings`：限制、降级和待确认事项。
- `limits`：扫描限制、传播层数和性能预算状态。
- `timing`：冷扫描、缓存命中和端到端耗时。

`priority`、`confidence`、`evidence_level` 和 `gap_type` 必须使用固定枚举；字段缺失、类型错误和未知枚举值都应使 schema 校验失败。报告对象按目标路径、符号名称和优先级稳定排序，保证快照测试可重复。

`TEST-PLAN.md` 必须由同一份规范化 JSON 生成，Markdown 与 JSON 不得分别计算结论。Markdown 中的 `[事实]`、`[推断]`、`[建议]` 和 `[待确认]` 必须能映射到 JSON 中的来源或状态字段。

## 3. v0.1 输入范围与模式

v0.1 CLI 固定支持三种分析模式：

1. `all`：仓库全量测试体检。
2. `change`：Git working tree 或 `base...head` 变更分析。
3. `target`：指定文件、函数、类或模块的测试设计。

`working-tree` 和 `base...head` 是 `change` 模式的两种输入形态，不单独计为分析模式。

v0.1 首批验收语言为 Node.js/TypeScript、Python 和 Go。Java/Kotlin 仅允许输出低置信度的文件发现结果，不得生成高置信度覆盖结论。

coverage 解析、`test-matrix.json` 和历史测试趋势统一移至 v0.2。v0.1 提供 `coverage_path` 时返回“不支持该版本特性”的参数错误，不得伪造 coverage 证据。

建议输入：

```json
{
  "repo_path": ".",
  "mode": "change",
  "base": "origin/main",
  "head": "HEAD",
  "diff_path": null,
  "targets": [],
  "coverage_path": null,
  "output_path": "TEST-PLAN.md",
  "generate_drafts": false,
  "max_targets": 50,
  "max_propagation": 3,
  "include_dirs": [],
  "exclude_dirs": [],
  "scanner": {
    "max_depth": 3,
    "max_files": 2000,
    "max_file_bytes": 256000,
    "perf_budget_ms": 60000,
    "cache": true,
    "parsers": ["heuristic"]
  }
}
```

输入语义补充：

- `all` 不读取 Git；`target` 必须至少提供一个目标；`change` 必须明确选择 working-tree、`base...head` 或 `--diff`。
- 若没有 Git 变更，必须保留“工作区干净”的事实，不得擅自把 `change` 模式改成 `all`；用户指定目标时优先分析指定目标。
- `--mode target` 且 `targets` 为空属于无效输入，退出码 2。
- 提供 `diff_path`/`--diff` 补丁文件时，内容作为 `git.diffText` 传入官方事实 API，仍享有 3 层反向传播，且 CLI 不执行任何 Git 查询。
- `max_propagation` 只能收窄官方 `getChangeImpactFacts` 的传播结果（硬上限 3 层），不能放大；默认 3 等于不裁剪。
- working-tree 模式（无 `base`/`head`）以 `git status --porcelain -uall` 输出作为 `statusText` 传入（含未跟踪文件），调用语义见 §4.1。
- 空字符串 `statusText` 和空字符串 `diffText` 均为合法输入，分别表示干净工作区和空补丁，不能通过真假判断代替字段存在性判断。
- `changedFiles`、`statusText`、`diffText` 同时作为库接口输入时，优先级为 `changedFiles > statusText > diffText`；CLI 层必须在调用前拒绝互斥输入。

## 4. 事实来源和证据等级

### 4.1 依赖 `dsh-repo-scanner`

插件把 `dsh-repo-scanner` 声明为 npm `dependency`，初始化依赖必须执行：

```powershell
npm i dsh-repo-scanner
```

该命令必须更新 `package.json` 和 `package-lock.json`；CI 使用 `npm ci`。实现和报告均以安装后返回的 `tool.version` 为准，不在代码中硬编码 scanner 版本。scanner 的大版本变化必须经过人工契约评估并同步更新 §0 基线。

### 4.1.1 与 `dsh-repo-scanner` 的依赖关系和发布边界

`dsh-test-insight` 是上层测试洞察插件，`dsh-repo-scanner` 是底层事实扫描依赖。两者职责必须分离：

- `dsh-repo-scanner` 负责扫描文件、模块、符号、入口、依赖、Git 事实和基础测试映射。
- `dsh-test-insight` 负责测试证据等级、缺口识别、风险排序、测试设计、报告和测试草稿。
- `dsh-test-insight` 通过 `dsh-repo-scanner/scanner` 的库 API 调用 scanner，不复制 scanner 源码，也不重新实现仓库扫描、测试命名映射或反向依赖传播。

最终发布关系固定如下：

1. `dsh-repo-scanner` 必须声明在 `dsh-test-insight` 的 `package.json` `dependencies` 中，而不是只声明在 `devDependencies` 或 `peerDependencies` 中；运行时必须能够自动获得该依赖。
2. 本地执行 `npm i dsh-repo-scanner` 后，`node_modules/dsh-repo-scanner` 通常存在，但 `node_modules` 不提交到源码仓库。
3. `dsh-test-insight` 的源码目录不得复制或提交 `dsh-repo-scanner/` 源码目录；默认不使用 `bundledDependencies`，不把 scanner 源码打包进本插件发布包。
4. 发布的 `dsh-test-insight` npm 包只需携带自身代码、`package.json` 和技能文件；用户安装 `dsh-test-insight` 时，npm 根据 `dependencies` 自动安装 `dsh-repo-scanner`。依赖实际位于用户安装环境的 npm 依赖树中，不能依赖固定的物理目录层级。
5. `package-lock.json` 用于本项目开发和 CI 的可复现安装；运行时版本和 scanner 输出版本以实际安装结果及 `tool.version` 为准。

预期本地目录关系：

```text
dsh-test-insight/
├─ package.json
├─ package-lock.json
├─ plugin/
├─ skills/
└─ node_modules/                 # 本地安装产生，通常被 Git 忽略
   └─ dsh-repo-scanner/          # npm 依赖，不是本项目源码
```

Phase 0 和 Phase 5 必须分别验证：干净环境执行 `npm i dsh-repo-scanner` 能够导入 scanner API；打包 `dsh-test-insight` 时不包含 scanner 源码；全新环境执行 `npm i dsh-test-insight` 后能够通过 npm 依赖树加载 scanner。

运行时优先通过库接口调用，避免相对路径子进程调用受安装位置影响失效；如需 CLI，必须用 `import.meta.resolve("dsh-repo-scanner/...")`（Node ≥ 20.11 起同步稳定）或 `createRequire(import.meta.url).resolve(...)` 定位入口，禁止写死相对路径，也禁止裸用 `require.resolve`（ESM 包内不存在全局 `require`）。

推荐调用方式（以 `dsh-repo-scanner/scanner` 的官方导出为准）：

```js
import {
  scanRepository,
  getTestInsightFacts,
  getChangeImpactFacts,
} from "dsh-repo-scanner/scanner";

// 统一事实外壳：files 始终被发现；run_methods 由 entry 探测输出，无需独立 mode。
const scan = await scanRepository({
  repoPath: repo,
  modes: ["probe", "files", "scan", "deps", "entry", "symbols", "graphs", "git"],
  maxDepth: 3,
  maxFiles: 2000,
  maxFileBytes: 256000,
  cache: true,
  cacheDir, // 三次调用共享同一缓存目录（facts API 全量透传本选项）
  parsers: ["heuristic"],
  strict: false,
});

// 官方测试洞察基线：同名 stem 映射、孤儿测试、模块测试覆盖、缺少测试的源码文件
const testFacts = await getTestInsightFacts({ repoPath: repo, cacheDir });

// 变更模式：官方反向依赖传播（硬上限 3 层）、受影响模块与符号。
// scanner 不运行 git：变更文本由调用方采集后传入，且只传一条通道。
const request = input;
const has = (key) => Object.prototype.hasOwnProperty.call(request, key);
const gitInput = has("changedFiles")
  ? { changedFiles: request.changedFiles }
  : has("statusText")
    ? { statusText: request.statusText }
    : has("diffText")
      ? {
          base: request.base,
          head: request.head ?? "HEAD",
          diffText: request.diffText,
        }
      : null;
const changeFacts = request.mode === "change"
  ? await getChangeImpactFacts({ repoPath: repo, cacheDir, git: gitInput })
  : null;
```

调用与缓存约束（以 `npm i dsh-repo-scanner` 安装后的实际行为为准）：

- 变更文本来源契约：scanner 不运行 git，插件负责采集变更文本。CLI 仅允许执行两条只读查询，作为“默认不运行仓库命令”的唯一豁免：`git status --porcelain -uall`（working-tree 模式）与 `git diff <base>...<head>`（base...head 模式）；`--diff` 补丁文件直接作为 `diffText` 传入，等价于跳过全部 git 查询。DSH 技能流程中由 runbook 指导 agent 采集文本后经库接口传入；库接口自身永远不 spawn。
- 三条输入通道按 `changedFiles` > `statusText` > `diffText` 优先，同时提供时只有最高优先级生效，调用时传且只传其一。
- `statusText` 空字符串是合法输入（代表工作区干净），并使 `git.working_tree_clean` 可判定；`diffText` 携带 hunk 级数据，是 `changed_without_test_change` 语义过滤的输入。
- 三个 facts API 会把调用参数整体透传给 `scanRepository`，因此 `cache`/`cacheDir`/`perfBudgetMs` 等选项全部可用；插件向三次调用传入同一 `cacheDir` 共享缓存（缓存只写系统临时目录，按 mtime+size 失效，不写目标仓库）。
- scanner 的 `perfBudgetMs` 是单次 `scanRepository` 调用的性能预算，不是跨三次调用自动结算的端到端预算。若插件要求三次调用总耗时受 `perf_budget_ms` 约束，必须由 `dsh-test-insight` 外层统一计时/截止，不能依赖 scanner 自动累计。

`scanRepository` 官方模式名：`probe`、`files`、`scan`（模块）、`deps`、`entry`、`symbols`、`graphs`、`git`、`all`；`modules`/`dependencies`/`entries` 等是兼容别名，新代码统一使用规范名。

官方输出契约（以 `npm i dsh-repo-scanner` 安装后的实际版本为准）：
- `schema_version` 固定 `"1.0"`。
- `analysis_schema` 为 `{ name: "dsh-analysis-schema", version: "1.0" }`。
- `tool` 包含 scanner 名称和实际版本；实现时应以返回的 `tool.version` 为准，不硬编码版本号。
- 关键选项：`maxDepth`、`maxFiles`、`maxFileBytes`、`perfBudgetMs`、`cache`、`cacheDir`、`parsers`、`includeDirs`、`excludeDirs`、`language`、`strict`。

需要使用：

- `files[]`：源码和测试文件分类。
- `modules[]`：模块边界和关键文件。
- `symbols[]`：函数、方法、类和导出范围。
- `dependencies.internal[]`：被测代码的调用和反向依赖关系。
- `entry_points[]`：Web、CLI、Worker、Scheduler 入口。
- `run_methods[]`：测试、构建、类型检查和 lint 命令。
- `risks[]`：动态导入、解析失败、扫描截断。
- `limits`：`max_depth`、`max_files`、`max_file_bytes`、`truncated`、`warnings` 和性能预算警告。
- `graphs`：模块调用图和符号引用（供优先级排序与传播展示）。
- `git.changed_files[]`：本次变更文件和 hunk。
- `getTestInsightFacts`：返回 `test_files[]`（同名 stem 映射：同目录优先、歧义不猜）、`orphan_tests[]`、`module_test_coverage[]`、`source_files_without_tests[]`；插件不得重写这套官方映射，而应在其上补充导入/符号级证据和证据等级。
- `getChangeImpactFacts`：返回 `changed_files[]`（调用方通道透传）、`impacted_files[]`（每项带传播 `depth`，硬上限 3 层）、`impacted_modules[]`、`impacted_symbols[]`（仅含变更文件内的符号，上限 200）；在 `dsh-change-impact` 可用前，它是变更风险传播的基线，插件不得自行另建传播引擎。

scanner schema 兼容性校验：
- `schema_version` 必须为 `"1.0"` 或满足 `^1.0` 语义化范围。
- `analysis_schema.name` 必须为 `"dsh-analysis-schema"`。
- 不满足时，报告必须标记错误，退出码为 3，停止生成高置信度结论；可以输出限制清单，但不得输出确定性风险、覆盖或测试结论。

### 4.2 测试证据等级

| 等级 | 证据 | 能说明什么 |
| --- | --- | --- |
| A（v0.2） | 真实 coverage 报告中的行/分支数据 | 有实际运行证据；v0.1 不产生该等级 |
| B | 测试文件中明确引用目标符号或入口 | 存在静态测试关联 |
| C | 同模块存在测试文件 | 可能有关联，但不能证明覆盖 |
| D | 根据命名、目录或框架推断 | 仅作为待确认线索 |
| E | 没有找到测试证据 | 扫描范围内未发现，不等于项目绝对没有 |

报告中必须显示证据等级，不能只输出“有测试/无测试”。

coverage 格式解析、source map 和报告新鲜度校验在 v0.2 实现，支持清单为 lcov（`lcov.info`）、istanbul `coverage-final.json`、`coverage-summary.json` 和 cobertura；不在清单内的格式按格式错误处理，不降级为猜测。v0.1 不解析 coverage，也不输出 A 级证据。

## 5. 测试目标识别

### 5.1 目标分类

- 纯函数和工具函数。
- 服务和业务规则。
- HTTP/CLI/Worker 入口。
- 数据访问和外部服务适配器。
- 配置解析和环境变量处理。
- 公共 API、schema、序列化和错误码。
- 并发、队列、定时任务和重试逻辑。
- 数据库 migration 和持久化模型。

### 5.2 测试文件识别

按语言和框架约定识别：

- JavaScript/TypeScript：`*.test.*`、`*.spec.*`、`__tests__/`、Vitest、Jest、Mocha、Node test。
- Python：`test_*.py`、`*_test.py`、pytest、unittest。
- Go：`*_test.go`、testing、testify。
- Java/Kotlin：`src/test`、JUnit、Mockito、Spring Test。
- 通用：README、package scripts、pyproject、pom、Makefile 和 CI 中的测试命令。

官方 `dsh-repo-scanner` 的 `files[].kind` 已提供 `test`/`source`/`docs` 等分类，插件沿用该分类，只在本层补充框架识别（如 Jest、Vitest、pytest、Go testing）和测试运行命令来源。识别结果要保留 `source` 和 `confidence`，不只依赖文件名。

### 5.3 测试与目标映射

映射以官方 `getTestInsightFacts` 返回的 `test_files[]` 作为基线。官方映射是同名 stem 映射：剥除 `.test`/`.spec`/`test_` 等约定后缀按文件名匹配，同名歧义时同目录优先、仍歧义则不猜并归入 `orphan_tests[]`；不含镜像目录遍历和导入分析。插件在此基础上补充符号级证据，不重写官方映射。

映射优先级：

1. 测试文件导入目标模块。
2. 测试代码直接引用目标符号或入口路径。
3. 测试文件位于目标模块的镜像路径。
4. 测试名称包含目标模块/符号名称。
5. 仅凭目录邻近关系推断，标记低置信度。

映射对象：

```json
{
  "test_path": "test/auth/service.test.ts",
  "target_path": "src/auth/service.ts",
  "target_symbols": ["authenticate"],
  "evidence": ["import", "symbol_reference"],
  "confidence": "high"
}
```

## 6. 缺口模型

### 6.1 缺口类型

- `no_test_found`：没有发现测试证据。
- `weak_test_association`：只有目录或名称关联。
- `changed_without_test_change`：源码变更但对应测试未变。
- `public_api_untested`：公共导出、路由或 schema 缺少契约证据。
- `error_path_untested`：错误、超时、重试、权限等异常路径未找到测试。
- `boundary_case_unknown`：空值、边界数值、编码、分页等边界覆盖未知。
- `integration_path_untested`：入口到服务或数据层的集成路径没有证据。
- `coverage_below_threshold`：只有在真实 coverage 数据确认后使用。
- `unscannable`：动态调用、生成代码或扫描截断导致无法判断。

### 6.2 重要性排序

初始优先级由以下因素组合：

- 是否被官方 `getChangeImpactFacts` 标记为受冲击文件/模块/符号；`dsh-change-impact` 可用时采纳其风险等级作为额外输入。
- 是否位于 Web、CLI、Worker 或 Scheduler 入口链路。
- 反向依赖模块数和是否处于依赖环。
- 是否属于权限、金额、数据写入、配置和公共 API。
- 函数复杂度、长函数、深嵌套和上帝对象等结构风险。
- 是否缺少直接测试证据。
- 测试成本和可隔离程度。

排序建议：

```text
风险影响 × 测试缺口 × 可验证价值 / 预计成本
```

评分只是排序辅助，必须输出具体因子和证据，不能伪装成精确质量分数。

### 6.3 覆盖声明边界

使用以下措辞：

- “发现测试文件”不等于“已覆盖”。
- “静态关联”不等于“测试已通过”。
- “未发现证据”不等于“项目中绝对没有测试”。
- 没有 coverage 文件时，不输出行覆盖率百分比。
- 没有运行测试时，不输出测试通过结论。

## 7. 测试设计生成

### 7.1 设计优先于代码

每个目标先生成测试设计：

```json
{
  "target": "src/auth/service.ts:authenticate",
  "priority": "P0",
  "reason": [
    "reachable from web entry",
    "public authentication behavior",
    "no direct test evidence"
  ],
  "cases": [
    {"name": "valid credentials", "kind": "happy_path", "expected": "returns session"},
    {"name": "invalid credentials", "kind": "error_path", "expected": "rejects without leaking reason"},
    {"name": "missing input", "kind": "boundary", "expected": "validation error"}
  ],
  "confidence": "medium"
}
```

### 7.2 用例类别

默认检查：

- 正常路径。
- 空值、缺字段和类型错误。
- 最小值、最大值、零、负数和精度。
- 重复请求、幂等性和重试。
- 权限不足、认证失败和敏感信息泄漏。
- 依赖超时、异常和部分失败。
- 并发和顺序依赖。
- 编码、时区、分页和排序。
- 数据库事务、重复执行和回滚。
- API 状态码、错误码和响应 schema。

并非所有类别都适用于每个目标。报告需要说明跳过依据，避免生成模板化噪声。

### 7.3 草稿生成约束

生成测试代码前必须读取：

- 项目 manifest 和测试脚本。
- 至少一个相邻测试文件。
- 测试框架、断言库和 fixture 风格。
- 目标模块的导出方式和依赖注入方式。

草稿要求：

- 使用项目已有框架和命名风格。
- 不修改生产代码。
- 不写入密钥、真实连接串或真实用户数据。
- 外部服务使用项目已有 mock/fake 约定；没有约定时只生成设计，不擅自引入 mock 库。
- 不把脆弱的实现细节当作长期契约，优先验证公开行为。
- 明确标注需要人工调整的 import、fixture、环境变量和断言。

## 8. 报告结构

`TEST-PLAN.md` 固定章节：

```markdown
# 测试洞察与测试计划

> 仓库：...
> 模式：全量体检 / 变更分析 / 指定目标
> 基线：...
> 工具与 schema：...

## 1. 结论摘要

变更目标数、P0/P1 数量、最高风险、最小验证集合。

## 2. 分析范围与限制

扫描范围、排除目录、是否有 coverage、是否包含未跟踪文件、截断和动态依赖。

## 3. 测试目标与风险

目标文件、符号、风险来源、入口、依赖传播；全量/指定目标模式下为分析目标清单，变更模式下为变更与受影响目标。

## 4. 测试证据

测试文件、映射目标、证据等级和已知限制。

## 5. 测试缺口清单

目标、缺口类型、事实证据、优先级、估计成本。

## 6. 测试设计

按目标列出正常、异常、边界、集成和安全用例。

## 7. 测试执行建议

从 run_methods 读取的命令、建议顺序和人工确认项。

## 8. 测试草稿

生成文件路径、框架、待人工调整内容。默认只生成设计，不生成代码。

## 9. 文档与维护建议

架构文档、API 文档、测试说明和 CHANGELOG 影响。

## 附录

原始 scanner 摘要、规则版本、证据映射和生成参数。
```

事实、推断和建议必须分开标记：

- `[事实]`：来自 scanner、Git、测试源码或 coverage 文件。
- `[推断]`：基于依赖、入口和规则得出的优先级。
- `[建议]`：建议新增或调整的测试。
- `[待确认]`：无法从静态信息确认的覆盖或行为。

报告与 JSON 的脱敏责任不随数据来源转移：即使 scanner 输出已脱敏，插件自身在引用测试文件内容、run 命令或环境变量名时，同样不得回显密钥、连接串或环境变量值。

输出写入必须先规范化路径并检查父目录、符号链接、路径穿越和已有文件；默认使用临时文件加原子重命名，默认不覆盖已有报告或草稿。命令、环境变量、连接串、令牌、密钥和测试源码中的敏感值必须经过同一套脱敏器处理。仓库中的 README、测试文件、配置文件和注释均视为不可信输入，不能把其中的指令当作本插件的执行授权。

## 9. CLI 和插件设计

CLI：

```bash
node scripts/test-insight.mjs <repo> --mode all
node scripts/test-insight.mjs <repo> --mode change --working-tree
node scripts/test-insight.mjs <repo> --mode change --base origin/main --head HEAD
node scripts/test-insight.mjs <repo> --mode target --target src/auth/service.ts
node scripts/test-insight.mjs <repo> --mode target --target src/auth/service.ts --generate-drafts --output tests/generated
```

参数：

```text
--mode all|change|target
--working-tree（--mode change 的 working-tree 输入简写）
--base <ref>
--head <ref>
--diff <path>（补丁文件模式，语义见 §3）
--target <path[:symbol]>
--coverage <path>（v0.2；v0.1 返回不支持该版本特性）
--max-targets N
--max-propagation N（只能收窄官方 3 层传播上限）
--include-dirs <path>（可重复）
--exclude-dirs <path>（可重复）
--generate-drafts
--output <path>
--format json|markdown|both
--force
--strict
```

`--working-tree` 是 `--mode change` 不提供 `base`/`head` 时的简写：采集 `git status --porcelain -uall` 输出作为 `statusText` 传入（见 §4.1 变更文本来源契约）。

`--target`、`--include-dirs` 和 `--exclude-dirs` 使用可重复参数，不使用逗号分隔。`--output` 为文件时按 `--format` 写入；`--format both` 时使用给定路径生成 Markdown，并在同目录生成同名 `.json` 兄弟文件；为目录时写入固定文件名 `TEST-PLAN.md` 和 `test-insight.json`。默认不覆盖已有文件，只有显式提供 `--force` 才允许覆盖；报告和草稿均采用临时文件加原子重命名。

退出码：

- `0`：分析完成。警告（未识别测试、扫描截断等）默认不改变退出码，只写入报告与 JSON 的 warnings。
- `1`：仅在 `--strict` 下出现：存在警告即以 1 退出，供 CI 门禁把警告升级为失败。
- `2`：参数、路径或 Git 输入无效（含 `--mode target` 未指定目标、只提供 `head` 未提供 `base`、ref 无法解析）。
- `3`：scanner schema 不兼容或输出失败。

DSH 技能名建议：`test-insight-runbook`。技能流程为：输入受理 → 扫描事实 → 建立测试映射 → 发现缺口 → 设计用例 → 可选生成草稿 → 输出报告。

硬性约束：分析流程默认不运行仓库命令，也不得自动执行 scanner 发现的测试、构建、lint 或 typecheck 命令。唯一允许的外部命令是 CLI 层以 `shell: false`、参数数组、工作目录校验、输出上限和超时执行的两条只读 Git 查询（`git status --porcelain -uall`、`git diff <base>...<head>`）；库接口被宿主或 agent 调用时永远不 spawn。若未来增加命令执行能力，必须作为独立的显式授权流程，不得由本计划默认开启。

## 10. 分阶段实施

### Phase 0：产品契约和样例

- 固定 `test-insight.json` schema。
- 在干净临时项目中执行 `npm i dsh-repo-scanner` 并做 API 冒烟测试：验证导出存在、facts API 返回字段与 schema 契约、`statusText`/`diffText`/`changedFiles` 三条变更通道的行为与优先级、`cacheDir` 透传生效和 `tool.version` 可读取。冒烟测试只以已安装 npm 包为基线，源码对照必须单独记录。
- 建立 Node、Python、Go、Web API、CLI 和无测试 fixture。
- 设计全量、变更和指定目标三类样例；coverage 样例与格式错误行为移至 v0.2。
- 固定“未发现证据”与“已覆盖”的措辞边界。

验收：样例报告不把静态关联误写成覆盖结论。

Phase 0 当前进度：

- [x] 创建 npm manifest、ESM plugin 入口、CLI 入口、schema、技能 runbook、README 和 CHANGELOG。
- [x] 执行 `npm i dsh-repo-scanner`，生成 `package-lock.json` 并确认 `scanRepository`、`getTestInsightFacts`、`getChangeImpactFacts` 均可导入。
- [x] 完成 4 个最小 smoke test：package metadata、plugin metadata、输出 schema 和 scanner facts API。
- [x] `npm pack --dry-run` 验证发布包不包含 `node_modules` 或 scanner 源码。
- [ ] 完成 scanner facts 行为、working-tree/diff 通道、缓存共享和 schema 兼容性契约测试。
- [ ] 完成实际扫描、测试映射、风险排序和报告生成逻辑。

### Phase 1：测试文件发现和静态映射

- 通过 `scanRepository` 库接口读取 scanner 输出的 files、symbols、modules。
- 接入 `getTestInsightFacts` 作为命名映射基线；只在其 `test_files[]` 之上补充 import/符号级证据，不重写 `test_file -> target_file` 映射。
- 识别测试框架和测试文件。
- 建立测试到目标文件、符号和入口的映射。
- 输出证据等级和未识别风险。

验收：Node、Python、Go fixture 的测试映射准确，低置信度场景不会升级为高置信度。

### Phase 2：变更风险联动

- 接入 `dsh-change-impact`；在它可用前使用 scanner 的 `getChangeImpactFacts`，变更文本按 §4.1 的来源契约采集（`statusText` / `diffText` / `--diff` 文件）。
- 消费官方传播结果（硬上限 3 层），按 `max_propagation` 收窄；本插件不实现反向依赖传播引擎。
- 识别源码改动但测试未变、测试同步变更和高风险入口变更；对 `changed_without_test_change` 做 hunk 语义过滤，仅注释、空白或格式化的变更降级为信息级，控制误报。
- 输出 P0/P1/P2 测试目标。

验收：公共 API、路由、数据写入和纯文档变更得到不同建议。

### Phase 3：测试设计和命令推荐

- 形成用例分类器和测试设计 JSON。
- 从 run_methods 选择已有测试、lint、typecheck 命令。
- 发现异常路径、边界和集成测试缺口。
- 生成固定结构的 `TEST-PLAN.md`。

验收：每条建议都有目标、理由、预期和事实依据；不存在虚构命令。

### Phase 4：可选测试草稿

- 读取相邻测试风格。
- 按框架生成独立草稿。
- 只使用进程内解析器检查草稿语法；没有对应语言解析器时标记为“未验证”，不得执行 `node --check`、Python、Go 或目标项目命令；语法检查通过不构成“草稿已通过”的证据。
- 对 import、fixture 和环境变量添加人工调整标记。

验收：不覆盖已有文件；草稿不能被误认为已经通过。

### Phase 5：发布和组合验证

- 添加 DSH plugin bundle、skill、README、CI 和发布文档。
- 与 `dsh-repo-scanner`、`dsh-change-impact`、`dsh-refactor-insight` 做组合测试。
- 默认在可安装的 `@deepseek-ai/dsh@0.1.2-rc.1`（Node >=22.19）上做组合验证；scanner 通过干净环境中的 `npm i dsh-repo-scanner` 安装并使用 lockfile 复现。另将 `dsh-v0.1.3-alpha.1` 列为可选预发布验证：Python SDK 单文件 runtime 下以 `node scripts/test-insight.mjs` 开头的命令不被重写；Windows 盘符根目录 Workspace 可正常分析；会话内产物落盘走可观察写入并正确处理 `FS_NOT_OBSERVED`；代理环境下安装与运行遵循 `HTTP_PROXY`/`NO_PROXY`。alpha 验证必须显式安装并记录，不纳入默认 CI 门禁。
- 用真实仓库提交建立回归样例。

验收：插件安装后技能可见，真实变更可生成报告，所有限制均有展示。

## 11. 测试计划

### 单元测试

- 测试文件命名和目录识别。
- import、symbol、名称和镜像路径映射。
- 证据等级计算。
- 缺口分类和风险排序。
- coverage 文件读取和格式错误。
- 报告和 JSON 一致性。

### 契约测试

使用 `node:test`：

- 缺参数和不存在路径。
- `--mode target` 未指定目标（退出码 2）。
- working-tree 模式（`statusText` 通道，含未跟踪文件，空状态 = 工作区干净）。
- diff 文件输入模式（`diffText` 通道，跳过 git 查询，仍享有 3 层传播）。
- 三条变更通道同时提供时的优先级（`changedFiles` > `statusText` > `diffText`）。
- 退出码契约：默认警告退出 0、`--strict` 下警告退出 1、无效输入 2、schema 不兼容 3。
- 无测试项目。
- 有相邻测试但无明确引用。
- 多级依赖和入口传播。
- 源码改动而测试未变。
- 源码和测试同时改动。
- coverage 可用、缺失、格式错误。
- scanner schema 不兼容。
- 草稿输出不会覆盖已有文件。

### 跨平台测试

- Windows、Ubuntu、macOS（x64 与 arm64；默认 DSH 0.1.2-rc.1 门禁按 npm 可安装平台执行，`dsh-v0.1.3-alpha.1` 的 macOS x64 runtime wheel 仅在可选 alpha 验证中覆盖）。
- Node：独立 CLI/库脚本 Node 20.11+ 与 22；DSH 宿主统一 Node >=22.19（Node 18 已 EOL，不再支持）。
- CRLF、UTF-8 BOM、路径空格、中文路径和 Windows 盘符根目录 Workspace。
- Node、Python、Go fixture。

### 性能回归

- 样例仓库端到端分析（`scanRepository` + 两个 facts API 共享缓存）由插件外层统一计时；至少覆盖冷扫描、缓存命中和 2000 文件仓库，并分别记录耗时。
- P95 必须不超过配置的 `perf_budget_ms`；超时只能产生明确 warning，不能输出高置信度结论。

### 质量回归

维护误报和漏报 fixture：

- 同名但无关联测试。
- 通过公共 helper 间接关联。
- 动态导入。
- 生成代码。
- 仅注释、空白或格式化的源码变更而测试未变（不应判为高优先级缺口）。
- 测试只覆盖 happy path。
- v0.2 的真实 coverage 与静态映射不一致。

## 12. 版本规划

### v0.1

- 测试文件识别。
- 文件/模块/符号静态映射。
- 变更测试缺口。
- Markdown + JSON 测试计划。
- `schema/test-insight.schema.json`、稳定排序和 Markdown/JSON 一致性。
- `npm i dsh-repo-scanner` 安装、lockfile 复现和实际 `tool.version` 检查。

### v0.2

- coverage 报告接入。
- 入口和公共 API 契约测试分析。
- 更精确的异常路径和边界识别。
- 多框架测试草稿。

### v0.3

- 与变更影响、重构诊断联动。
- 生成测试数据和 fixture 设计。
- 历史测试失败和 flaky 测试统计。
- 可配置团队风险规则。

### v1.0

- 稳定的 schema 演进与兼容策略。
- 大型 monorepo 增量分析。
- 可选、明确授权的测试执行 workflow。
- 真实 coverage、变更影响和质量趋势联合分析。

## 13. Definition of Done

- [ ] 支持全量、变更、指定目标三种分析模式。
- [ ] 以 npm 依赖 + `scanRepository` 库接口接入 scanner，不复制仓库扫描逻辑。
- [ ] scanner API 冒烟测试通过（导出存在性、facts 契约、working-tree 形态、缓存共享）。
- [ ] 能区分“发现测试文件”和“有覆盖证据”。
- [ ] 输出缺口、优先级、测试设计和建议验证命令；命令仅展示，不自动执行。
- [ ] 默认不修改、不执行目标项目。
- [ ] Markdown 与 JSON 内容一致。
- [ ] `schema/test-insight.schema.json` 与 Markdown/JSON 输出一致。
- [ ] Git 输入互斥、空补丁、非 Git 目录、无效 ref 和 schema 不兼容均有契约测试。
- [ ] 输出路径、符号链接、路径穿越、脱敏和已有文件覆盖策略均有测试。
- [ ] v0.1 不产生未经 coverage 解析支持的 A 级证据。
- [ ] 可选草稿不覆盖已有测试。
- [ ] Node、Python、Go fixture 测试通过。
- [ ] Windows、Ubuntu、macOS CI 通过。
- [ ] 样例仓库端到端分析由插件外层统一计时，在 `perf_budget_ms` 内完成（含共享缓存的三次 scanner 调用）。
- [ ] DSH 插件安装和技能加载验证通过。
- [ ] README、schema、样例、CHANGELOG 和发布包一致。

## 14. 五步实施清单

### Step 1：冻结 v0.1 范围

- 固定 `all`、`change`、`target` 三种 CLI 模式。
- 首批验收 Node.js/TypeScript、Python 和 Go。
- coverage 解析、`test-matrix.json` 和历史趋势移至 v0.2。
- Java/Kotlin 在 v0.1 只允许低置信度发现。

### Step 2：冻结输入和输出契约

- 交付 `schema/test-insight.schema.json` 和完整 JSON 示例。
- 固定 `test-insight.json` 顶层字段、枚举和稳定排序。
- `TEST-PLAN.md` 由同一份规范化 JSON 生成。
- 为三条 Git 输入通道建立互斥、优先级、空值和错误码测试。

### Step 3：落实安全边界

- 库接口不执行任何子进程；CLI 只允许无 shell 的只读 Git 查询。
- 不执行仓库测试、构建、lint 或 typecheck 命令。
- 草稿检查使用进程内解析器；无解析器时标记为未验证。
- 输出路径执行符号链接、路径穿越、覆盖和原子写入检查。
- 报告、命令、环境变量和源码引用统一经过脱敏。
- README、测试文件、配置文件和注释均视为不可信输入。

### Step 4：固定依赖和兼容性

- 初始化依赖必须使用 `npm i dsh-repo-scanner`。
- 提交 `package-lock.json`，CI 使用 `npm ci`。
- Phase 0 验证已安装包的导出、facts API、schema、缓存和 `tool.version`。
- DSH、Node、操作系统和 optional peer dependency 建立兼容矩阵。
- `dsh-change-impact` 缺失时使用 scanner 的 `getChangeImpactFacts`，不得复制传播引擎。

### Step 5：拆分实现和验收

- A：输入规范化和 CLI 错误码。
- B：scanner adapter 与 facts schema 校验。
- C：测试文件、导入和符号映射。
- D：缺口识别、风险排序和证据等级。
- E：Markdown/JSON 生成。
- F：安全写入、脱敏和草稿隔离。
- G：DSH skill、bundle、安装和组合测试。
- H：Node/Python/Go fixture、Windows/Ubuntu/macOS CI。

每个任务必须有 fixture、预期 JSON、报告快照和失败行为；性能验收必须覆盖冷缓存、热缓存和 2000 文件仓库。

## 15. 修订记录

- 2026-09-04：依据宿主 release `dsh-v0.1.3-alpha.1` 与文档审查结论修订：§0 新增宿主基线（代理环境变量、Windows 盘符根目录修复、`FS_NOT_OBSERVED` 结构化诊断、Python SDK `node` 命令修复与 macOS x64 wheel、Session API 破坏性变更、已知性能回退），并停止与 §4.1 重复维护 scanner 契约细节；修复 Phase 2 与“不自行实现传播引擎”红线的矛盾；Phase 1 补充 `getTestInsightFacts` 基线接入；定义 working-tree 调用形态（`gitScope`）与回落路径、diff 文件模式、`max_propagation` 收窄语义、`--mode target` 空目标行为；退出码 1 收窄为 `--strict` 专用；移除 Node 18 并修正 `import.meta.resolve` 用法；补充 `test-matrix.json` 定义、coverage 格式清单、三次调用缓存共享与端到端性能预算、macOS CI、`changed_without_test_change` 的 hunk 语义过滤、报告脱敏责任、Phase 0 API 冒烟测试与性能回归测试。
- 2026-09-04（第二次）：对照 `duyanta123/dsh-repo-scanner` 真实源码（commit `ac2ae71`）核实基线并修正：scanner 不运行 git，`changed_files` 只来自 `statusText`/`diffText`/`changedFiles` 调用方通道，`base`/`head` 仅为 `compare` 元数据——删除第一次修订引入的 `git: { base: "HEAD" }` working-tree 假设与回落路径，改为“变更文本来源契约”（CLI 两条只读 git 查询豁免，库接口永不 spawn）；`getTestInsightFacts` 映射确认为同名 stem 映射（同目录优先、歧义不猜），修正 §5.3；确认 facts API 全量透传 scan 选项（`cacheDir`/`perfBudgetMs` 可用）且缓存只写系统临时目录；`--diff` 模式更正为仍享有 3 层传播；Phase 0 冒烟测试收窄为防发布漂移。
- 2026-09-06：对照本地官方维护文档与仓库当前状态修订基线：区分 npm 可安装宿主 `@deepseek-ai/dsh@0.1.2-rc.1` 与 GitHub 预发布 `dsh-v0.1.3-alpha.1`，默认 CI/组合验证改为 0.1.2-rc.1；scanner 基线更新为 v0.1.1（当前源码/文档），输出契约 `tool.version` 不再硬编码 0.1.0；`dsh-telemetry` 更新为 v0.1.1；修正 `perfBudgetMs` 为单次 `scanRepository` 预算、端到端预算由插件外层统一计时；补齐 DSH 插件入口 `FileSystemSkillProvider`/`inject`、`cordis.patch.yml` 与 `SKILL.md` frontmatter 打包细节；跨平台测试按 DSH 宿主 Node >=22.19 与独立 CLI Node 20.11+ 分层表述。
- 2026-09-06（五步合并）：统一 v0.1 范围和 CLI 输入模式；补充 `test-insight.json` schema 交付要求；收紧 Git、草稿、输出路径和脱敏边界；将 scanner 安装固定为 `npm i dsh-repo-scanner` 并以 lockfile/`tool.version` 为版本依据；将 coverage 解析明确移至 v0.2；新增五步实施清单和 DoD 验收项。
- 2026-09-06（Phase 0 骨架）：创建 npm/ESM 项目骨架，执行 `npm i dsh-repo-scanner` 并验证三个 scanner API 导出；加入初版输出 schema、CLI/plugin/runbook、smoke test 和 npm pack 检查。修正 Windows 下 `node:test` 不应扫描 CLI 入口的问题；完整 facts 契约和分析逻辑仍待实现。
