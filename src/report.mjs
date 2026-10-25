import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { redactValue } from "./redaction.mjs";
import { ERROR_CODES, EXIT_CODES, contractError, InsightError } from "./errors.mjs";
import { assertNoSymbolicLink } from "./output-security.mjs";
import { detectTestFrameworks } from "./frameworks.mjs";
import { commandFromRunMethods } from "./execution.mjs";
import { compareText } from "./ordering.mjs";

const packageInfo = createRequire(import.meta.url)("../package.json");

export const REPORT_SCHEMA_VERSION = "1.0";

function now() {
  return Date.now();
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function posix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function relativeRepoPath(repoPath, value) {
  const absolute = path.resolve(value);
  const relative = path.relative(repoPath, absolute);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? posix(relative) : posix(value);
}

function warningText(value) {
  if (typeof value === "string") return value;
  if (value?.message) return value.message;
  if (value?.detail) return value.detail;
  if (value?.code) return value.code;
  return String(value);
}

function scopeFrom(report, input, changeFacts) {
  return {
	repo_path: posix(input.repoPath),
	mode: input.mode,
	include_dirs: input.includeDirs || [],
	exclude_dirs: input.excludeDirs || [],
	changed_files: (changeFacts?.changed_files || []).map((file) => file.new_path || file.old_path).filter(Boolean).sort(compareText),
	impacted_files: (changeFacts?.impacted_files || []).map((file) => ({ path: file.path, via: file.via, depth: file.depth })),
	working_tree_clean: report?.git?.working_tree_clean ?? null,
	truncated: report?.limits?.truncated === true,
	file_count: report?.files?.length || 0,
	source_file_count: report?.files?.filter((file) => file.kind === "source").length || 0,
	test_file_count: report?.files?.filter((file) => file.kind === "test").length || 0,
  };
}

function inputForReport(input) {
	const execution = input.execution || {};
  const coverage = input.coverage || { path: input.coveragePath || null, threshold: 0, format: null };
  return {
	mode: input.mode,
	repo_path: posix(input.repoPath),
	targets: input.targets,
	output_format: input.format,
	generate_drafts: input.generateDrafts,
	draft_output_path: input.draftOutputPath || null,
	max_targets: input.maxTargets,
	max_propagation: input.maxPropagation,
	include_dirs: input.includeDirs,
	exclude_dirs: input.excludeDirs,
	coverage_path: input.coveragePath,
	coverage,
	execution: {
	  authorized: Boolean(execution.authorized),
	  timeout_ms: execution.timeoutMs ?? 120000,
	  max_output_bytes: execution.maxOutputBytes ?? 1048576,
	},
	scanner: {
	  max_depth: input.scanner.maxDepth,
	  max_files: input.scanner.maxFiles,
	  max_file_bytes: input.scanner.maxFileBytes,
	  perf_budget_ms: input.scanner.perfBudgetMs,
	  cache: input.scanner.cache,
	  parsers: input.scanner.parsers,
	},
	git_channel: input.git?.channel || null,
  };
}

function designForTarget(target, gaps) {
  const targetGaps = gaps.filter((gap) => gap.target_path === target.path);
  const kinds = new Set(["happy_path", "boundary"]);
  if (target.entry_point) kinds.add("integration");
  if (targetGaps.some((gap) => gap.type === "error_path_untested")) kinds.add("error_path");
  if (targetGaps.some((gap) => gap.type === "public_api_untested" || target.exported_api)) kinds.add("contract");
  if (targetGaps.some((gap) => gap.type === "integration_path_untested")) kinds.add("integration");
  const expectedFor = {
	happy_path: "主行为返回预期结果，与公开契约一致",
	boundary: "空值、缺字段或边界值返回校验错误或明确定义的边界行为",
	error_path: "异常被拒绝且不泄露敏感原因，超时与重试行为符合约定",
	integration: "入口到目标模块的链路返回预期响应，失败路径可观察",
	contract: "公共导出、错误码或响应 schema 与预期契约一致",
  };
  return {
	target: target.symbol ? `${target.path}:${target.symbol}` : target.path,
	priority: target.priority,
	confidence: target.confidence,
	reason: target.risk_factors,
	  cases: [...kinds].sort(compareText).map((kind) => ({
	  kind,
	  name: {
		happy_path: "正常输入与主要行为",
		boundary: "空值、边界值和类型错误",
		error_path: "异常、超时、权限和依赖失败",
		integration: "入口到目标模块的集成路径",
		contract: "公共导出、错误码或响应契约",
	  }[kind] || kind,
	  expected: expectedFor[kind] || "预期行为需人工确认",
	  status: "design_only",
	})),
  };
}

function draftMetadata(draft) {
  if (!draft || typeof draft !== "object") return draft;
  const { content, ...metadata } = draft;
  return metadata;
}

export function buildReport({ input, report, testFacts, changeFacts, mapping, analysis, coverage = null, startedAt = now(), finishedAt = now(), performance = null }) {
  const warnings = [
	...(analysis?.warnings || []),
	...(report?.limits?.warnings || []).map(warningText),
	...(report?.git?.warnings || []).map(warningText),
  ];
  const designs = (analysis?.targets || []).map((target) => designForTarget(target, analysis?.gaps || []));
  const frameworks = detectTestFrameworks(report);
  const suggestedCommands = (frameworks.commands || [])
	.map((candidate) => {
	  if (candidate.source.startsWith("scanner:run_methods")) return candidate;
	  const normalized = commandFromRunMethods([candidate.command]);
	  return normalized ? { ...candidate, command: normalized.join(" ") } : null;
	})
	.filter(Boolean);
  const result = {
	schema_version: REPORT_SCHEMA_VERSION,
	tool: {
	  name: "dsh-test-insight",
	  version: packageInfo.version,
	  scanner: report?.tool?.version || null,
	},
	input: inputForReport(input),
	scope: scopeFrom(report, input, changeFacts),
	targets: analysis?.targets || [],
	evidence: analysis?.evidence || [],
	gaps: analysis?.gaps || [],
	designs,
	warnings: [...new Set(warnings.filter(Boolean))].sort(compareText),
	limits: {
	  scanner: report?.limits || {},
	  max_targets: input.maxTargets,
	  max_propagation: input.maxPropagation,
	  coverage_supported: coverage !== null, // explicit: true when a coverage object was passed (even if empty)
	  coverage_path: input.coveragePath,
	  coverage_format: coverage?.format || null,
	  coverage_threshold: input.coverage?.threshold ?? 0,
	  coverage_below_threshold: coverage?.below_threshold || [],
	},
	timing: {
	  elapsed_ms: Math.max(0, finishedAt - startedAt),
	  scanner: report?.performance || null,
	  performance: performance || {
		elapsed_ms: Math.max(0, finishedAt - startedAt),
		budget_ms: input.scanner?.perfBudgetMs ?? null,
		budget_exceeded: false,
		scanner: report?.performance || null,
	  },
	  facts: {
		test_files: testFacts?.test_files?.length || 0,
		impacted_files: changeFacts?.impacted_files?.length || 0,
	  },
	},
	coverage: coverage || null,
	test_matrix: analysis?.matrix || [],
	test_frameworks: frameworks.frameworks,
	suggested_commands: suggestedCommands,
	drafts: (analysis?.drafts || []).map(draftMetadata),
	execution: analysis?.execution || null,
  };
  return redactValue(result);
}

export function validateReportShape(report) {
  const errors = [];
  if (!report || typeof report !== "object" || Array.isArray(report)) errors.push("report must be an object");
  if (report?.schema_version !== REPORT_SCHEMA_VERSION) errors.push(`schema_version must be ${REPORT_SCHEMA_VERSION}`);
	for (const field of ["tool", "input", "scope", "targets", "evidence", "gaps", "designs", "warnings", "limits", "timing", "coverage", "test_matrix", "drafts", "execution"]) {
	if (!(field in (report || {}))) errors.push(`${field} is required`);
  }
  if (!Array.isArray(report?.targets) || !Array.isArray(report?.evidence) || !Array.isArray(report?.gaps) || !Array.isArray(report?.designs) || !Array.isArray(report?.warnings)) {
	errors.push("targets/evidence/gaps/designs/warnings must be arrays");
  }
	if (!Array.isArray(report?.test_matrix) || !Array.isArray(report?.drafts) || (report?.execution !== null && typeof report?.execution !== "object")) {
	errors.push("test_matrix/drafts must be arrays and execution must be an object or null");
  }
  for (const target of report?.targets || []) {
	if (!target.path || !["P0", "P1", "P2"].includes(target.priority) || !["high", "medium", "low", "unknown"].includes(target.confidence)) {
	  errors.push(`invalid target: ${target.path || "unknown"}`);
	}
  }
  for (const evidence of report?.evidence || []) {
	if (!["A", "B", "C", "D", "E"].includes(evidence.level) || typeof evidence.source !== "string") {
	  errors.push("invalid evidence level/source");
	}
  }
  const gapTypes = new Set(["no_test_found", "weak_test_association", "changed_without_test_change", "public_api_untested", "error_path_untested", "boundary_case_unknown", "integration_path_untested", "coverage_below_threshold", "unscannable"]);
  for (const gap of report?.gaps || []) {
	if (!gapTypes.has(gap.type) || !["P0", "P1", "P2"].includes(gap.priority) || !["high", "medium", "low", "unknown"].includes(gap.confidence)) {
	  errors.push(`invalid gap: ${gap.type || "unknown"}`);
	}
  }
  if (errors.length > 0) {
	throw contractError(`report contract failed: ${errors.join("; ")}`, ERROR_CODES.SCHEMA_INCOMPATIBLE, { errors });
  }
  return report;
}

function markdownList(items, empty = "无") {
  return items.length > 0 ? items.join("\n") : empty;
}

export function renderMarkdown(report) {
  validateReportShape(report);
  const p0 = report.targets.filter((target) => target.priority === "P0").length;
  const p1 = report.targets.filter((target) => target.priority === "P1").length;
  const targetRows = report.targets.length > 0
	? report.targets.map((target) => `| ${target.priority} | ${target.symbol ? `${target.path}:${target.symbol}` : target.path} | ${target.confidence} | ${(target.risk_factors || []).join("；")} |`).join("\n")
	: "| - | 无 | - | [待确认] 未发现分析目标 |";
  const evidenceRows = report.evidence.length > 0
	? report.evidence.slice(0, 200).map((item) => `| ${item.level} | ${item.type || "-"} | ${item.target_file || "-"} | ${item.test_file || "-"} | ${item.source} |`).join("\n")
	: "| - | - | - | - | [待确认] 无静态证据 |";
  const gapRows = report.gaps.length > 0
	? report.gaps.map((gap) => `| ${gap.priority} | ${gap.type} | ${gap.target_path || "-"}${gap.symbol ? `:${gap.symbol}` : ""} | ${gap.confidence} | ${gap.reason || "-"} |`).join("\n")
	: "| - | - | - | - | 未发现缺口 |";
  const designSections = report.designs.length > 0
	? report.designs.map((design) => `### ${design.priority} ${design.target}\n\n[推断] ${(design.reason || []).join("；") || "按目标类型生成基础设计"}\n\n${design.cases.map((item) => `- [建议] ${item.name}（${item.kind}）→ 预期：${item.expected || "待人工确认"}`).join("\n")}`).join("\n\n")
	: "[待确认] 没有可生成设计的目标。";
  const matrixRows = report.test_matrix?.length > 0
	? report.test_matrix.map((row) => `| ${row.target} | ${row.categories.happy_path} | ${row.categories.error_path} | ${row.categories.boundary} | ${row.categories.integration} | ${row.categories.security} |`).join("\n")
	: "| - | - | - | - | - | - |";
  const coverageSummary = report.coverage
	? `[事实] coverage 格式 ${report.coverage.format}，文件 ${report.coverage.files.length} 个，行覆盖率 ${report.coverage.totals.lines.percent === null ? "不可计算" : `${report.coverage.totals.lines.percent.toFixed(2)}%`}。`
	: "[待确认] 未提供 coverage 文件；不输出行覆盖率百分比。";

  return [
	"# 测试洞察与测试计划",
	"",
	`> 仓库：${report.scope.repo_path}`,
	`> 模式：${report.input.mode}`,
	`> 工具：${report.tool.name} ${report.tool.version}；scanner ${report.tool.scanner || "unknown"}`,
	`> Schema：${report.schema_version}`,
	"",
	"## 1. 结论摘要",
	"",
	`[事实] 分析目标 ${report.targets.length} 个，P0 ${p0} 个，P1 ${p1} 个；静态证据 ${report.evidence.length} 条，缺口 ${report.gaps.length} 条。`,
	"",
	"## 2. 分析范围与限制",
	"",
	`- [事实] 文件 ${report.scope.file_count} 个，源码 ${report.scope.source_file_count} 个，测试 ${report.scope.test_file_count} 个。`,
	`- [事实] 扫描截断：${report.scope.truncated ? "是" : "否"}；工作区干净：${report.scope.working_tree_clean === null ? "不可判定" : report.scope.working_tree_clean ? "是" : "否"}。`,
	`- [待确认] coverage：${report.limits.coverage_supported ? "已读取" : "未读取；不产生 A 级覆盖证据"}。`,
	`- [事实] 端到端耗时：${report.timing.elapsed_ms} ms。`,
	"",
	"## 3. 测试目标与风险",
	"",
	"| 优先级 | 目标 | 置信度 | 风险因子 |",
	"| --- | --- | --- | --- |",
	targetRows,
	"",
	"## 4. 测试证据",
	"",
	"| 等级 | 类型 | 目标 | 测试 | 来源 |",
	"| --- | --- | --- | --- | --- |",
	evidenceRows,
	"",
	"## 5. 测试缺口清单",
	"",
	"| 优先级 | 类型 | 目标 | 置信度 | 事实依据 |",
	"| --- | --- | --- | --- | --- |",
	gapRows,
	"",
	"## 5.1 覆盖与测试矩阵",
	"",
	coverageSummary,
	"",
	"| 目标 | 正常 | 异常 | 边界 | 集成 | 安全 |",
	"| --- | --- | --- | --- | --- | --- |",
	matrixRows,
	"",
	"## 6. 测试设计",
	"",
	designSections,
	"",
	"## 7. 测试执行建议",
	"",
	// 命令只展示、不自动执行；授权执行走显式 --execute-tests 白名单流程。
	report.execution
	  ? `[事实] 已按显式授权执行白名单命令：${report.execution.command.join(" ")}；状态：${report.execution.status}；本结果不替代人工审查。`
	  : (report.suggested_commands || []).length > 0
		? `[建议] 从 run_methods/框架识别得到的候选测试命令（仅展示，不自动执行）：\n${report.suggested_commands.map((item) => `- \`${item.command}\`（来源：${item.source}，置信度：${item.confidence}）`).join("\n")}\n\n[建议] 先审查 P0/P1 目标，再由人工确认测试框架、fixture、环境变量和断言。`
		: "[建议] 先审查 P0/P1 目标，再由人工确认测试框架、fixture、环境变量和断言；默认不执行目标仓库命令。",
	"",
	"## 8. 测试草稿",
	"",
	report.input.generate_drafts
	  ? (report.drafts || []).length > 0
		? `[待确认] 已生成 ${report.drafts.length} 份独立草稿，仅供人工审查；草稿不写入现有测试目录，且不构成“草稿已通过”的证据。`
		: "[待确认] 已请求草稿生成，但本次分析没有可生成草稿的目标。"
	  : "[事实] 未请求生成独立测试草稿。",
	"",
	"## 9. 文档与维护建议",
	"",
	"[建议] 将本报告与代码变更一并审查；静态关联不等于测试已通过，未发现证据不等于项目绝对没有测试。",
	"",
	"## 附录",
	"",
	`- [事实] scanner 版本：${report.tool.scanner || "unknown"}`,
	`- [事实] 规则限制：max_targets=${report.limits.max_targets}，max_propagation=${report.limits.max_propagation}`,
	...(report.warnings.length > 0 ? ["", "### Warnings", "", markdownList(report.warnings.map((warning) => `- [待确认] ${warning}`))] : []),
	"",
  ].join("\n");
}

function ensureOutputPath(outputPath, fallbackName) {
  const resolved = path.resolve(outputPath);
  const hasExtension = path.extname(resolved) !== "";
  return hasExtension ? resolved : path.join(resolved, fallbackName);
}

function outputPaths(input) {
  const requested = input.outputPath || "TEST-PLAN.md";
  const absolute = path.resolve(requested);
  const isDirectory = path.extname(absolute) === "";
  if (isDirectory) {
	return { markdown: path.join(absolute, "TEST-PLAN.md"), json: path.join(absolute, "test-insight.json") };
  }
	if (path.basename(absolute).toLowerCase() === "test-plan.md") {
	return { markdown: absolute, json: path.join(path.dirname(absolute), "test-insight.json") };
  }
  const extension = path.extname(absolute).toLowerCase();
  const markdown = extension === ".json" ? absolute.replace(/\.json$/i, ".md") : absolute;
  const json = extension === ".json" ? absolute : absolute.replace(/\.[^.]+$/, ".json");
  return { markdown, json };
}

async function pathExists(value) {
  try {
	await fs.access(value);
	return true;
  } catch {
	return false;
  }
}

async function atomicWrite(filePath, content, force) {
  const resolved = path.resolve(filePath);
  // Plan §8: reject paths that traverse a symbolic link before any write.
  await assertNoSymbolicLink(resolved, "report");
  if (!force && await pathExists(resolved)) {
	throw new InsightError(`output exists; use --force to overwrite: ${resolved}`, {
	  code: ERROR_CODES.INVALID_OUTPUT,
	  exitCode: EXIT_CODES.INVALID_INPUT,
	  details: { path: resolved },
	});
  }
  // mkdir failures (e.g. the parent path is an existing file) must surface as
  // OUTPUT_FAILED (exit 3), not as a raw SCAN_FAILED.
  const temp = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  try {
	await fs.mkdir(path.dirname(resolved), { recursive: true });
	await fs.writeFile(temp, content, "utf8");
	await fs.rename(temp, resolved);
  } catch (error) {
	try { await fs.rm(temp, { force: true }); } catch {}
	throw new InsightError(`failed to write output: ${resolved}`, {
	  code: ERROR_CODES.OUTPUT_FAILED,
	  exitCode: EXIT_CODES.CONTRACT_ERROR,
	  details: { path: resolved },
	  cause: error,
	});
  }
  return resolved;
}

export function resolveOutputPaths(input) {
  const paths = outputPaths(input);
  if (input.format === "json") return { markdown: null, json: paths.json };
  if (input.format === "markdown") return { markdown: paths.markdown, json: null };
  return paths;
}

export async function writeReportFiles(report, input) {
  validateReportShape(report);
  const paths = resolveOutputPaths(input);
	const targets = [paths.json, paths.markdown].filter(Boolean);
  if (new Set(targets.map((value) => path.resolve(value).toLowerCase())).size !== targets.length) {
	throw new InsightError("JSON and Markdown output paths must be different", {
	  code: ERROR_CODES.INVALID_OUTPUT,
	  exitCode: EXIT_CODES.INVALID_INPUT,
	});
  }
  const written = [];
  if (paths.json) written.push(await atomicWrite(paths.json, `${JSON.stringify(report, null, 2)}\n`, input.force));
  if (paths.markdown) written.push(await atomicWrite(paths.markdown, renderMarkdown(report), input.force));
  return written;
}
