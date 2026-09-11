import { compareText } from "./ordering.mjs";

const PRIORITY_RANK = Object.freeze({ P0: 0, P1: 1, P2: 2 });
const EVIDENCE_RANK = Object.freeze({ A: 0, B: 1, C: 2, D: 3, E: 4 });
const CONFIDENCE_RANK = Object.freeze({ high: 3, medium: 2, low: 1, unknown: 0 });
const SOURCE_KINDS = new Set(["source"]);
const TEST_KINDS = new Set(["test"]);

function pathOf(change) {
  return change?.new_path || change?.old_path || null;
}

function coverageForPath(coverage, targetPath) {
  if (!coverage) return null;
  const normalized = String(targetPath || "").replaceAll("\\", "/");
  return coverage.files.find((file) => file.path === normalized
	|| file.path.endsWith(`/${normalized}`)
	|| normalized.endsWith(`/${file.path}`)) || null;
}

export function buildCoverageEvidence(coverage) {
  if (!coverage) return [];
  return coverage.files.map((file) => ({
	level: "A",
	source: `coverage:${coverage.format}:${coverage.path}:${file.path}`,
	type: "coverage",
	target_file: file.path,
	confidence: "high",
	metrics: file.metrics,
	...(file.lines ? { lines: file.lines } : {}),
	...(file.branches ? { branches: file.branches } : {}),
  }));
}

export function buildTestMatrix(report, mapping, coverage = null) {
  const sourceFiles = (report?.files || []).filter((file) => SOURCE_KINDS.has(file.kind));
  const rows = sourceFiles.map((file) => {
	const evidence = (mapping?.mappings || []).filter((item) => item.target_file === file.path);
	const coverageFile = coverageForPath(coverage, file.path);
	const categories = {
	  happy_path: evidence.length > 0 ? "static_evidence" : "unknown",
	  error_path: "unknown",
	  boundary: "unknown",
	  integration: (report?.entry_points || []).some((entry) => entry.path === file.path) ? "unknown" : "not_applicable",
	  security: /auth|permission|token|secret|credential|password/i.test(file.path) ? "unknown" : "not_applicable",
	};
	if (coverageFile) {
	  const linePercent = coverageFile.metrics.lines.percent;
	  if (linePercent !== null && linePercent > 0) categories.happy_path = linePercent >= 80 ? "coverage_supported" : "coverage_below_threshold";
	}
	if (evidence.some((item) => item.evidence_level === "B")) categories.happy_path = coverageFile ? categories.happy_path : "static_evidence";
	return {
	  target: file.path,
	  test_files: evidence.map((item) => item.test_file).sort(),
	  categories,
	  coverage: coverageFile ? { metrics: coverageFile.metrics } : null,
	  evidence_levels: [...new Set(evidence.map((item) => item.evidence_level))].sort(),
	};
  });
	return rows.sort((a, b) => compareText(a.target, b.target));
}

function changeForPath(changeFacts, targetPath) {
  return (changeFacts?.changed_files || []).find((change) => pathOf(change) === targetPath) || null;
}

function isCommentOrBlankLine(line) {
  const content = String(line || "").replace(/^[-+]/, "").trim();
  return content === ""
	|| /^\/\//.test(content)
	|| /^#/.test(content)
	|| /^\/\*/.test(content)
	|| /^\*/.test(content)
	|| /^\*\//.test(content)
	|| /^<!--/.test(content)
	|| /^-->/.test(content);
}

function hasSemanticChange(change) {
  const hunks = change?.hunks || [];
  if (hunks.length === 0) return true;
  const changedLines = hunks.flatMap((hunk) => (hunk.lines || []).filter((line) => /^[+-]/.test(line) && !/^\+\+\+|^---/.test(line)));
  return changedLines.some((line) => !isCommentOrBlankLine(line));
}

function fileMap(report) {
  return new Map((report?.files || []).map((file) => [file.path, file]));
}

function rawFileMap(report) {
  return new Map((report?._files || []).map((file) => [file.path, file]));
}

function sortedUnique(values) {
	return [...new Set(values.filter(Boolean))].sort(compareText);
}

function confidenceForMapping(mapping) {
  if (mapping?.evidence_level === "B") return "high";
  if (mapping?.evidence_level === "C") return "medium";
  if (mapping?.evidence_level === "D") return "low";
  return "unknown";
}

function hasStrongMapping(mapping, targetPath) {
  return (mapping?.mappings || []).some((item) => item.target_file === targetPath && item.evidence_level === "B");
}

function hasAnyMapping(mapping, targetPath) {
  return (mapping?.mappings || []).some((item) => item.target_file === targetPath);
}

function pathMatches(requested, candidate) {
  return requested === candidate || candidate.endsWith(`/${requested}`) || requested.endsWith(`/${candidate}`);
}

function targetRequested(input, filePath) {
  return (input?.targets || []).find((target) => pathMatches(target.path, filePath)) || null;
}

function changedPathSet(changeFacts, maxPropagation = 3) {
  const direct = sortedUnique((changeFacts?.changed_files || []).map(pathOf));
  const impacted = (changeFacts?.impacted_files || [])
	.filter((item) => Number.isInteger(item.depth) && item.depth <= maxPropagation)
	.map((item) => item.path);
  return { direct, impacted: sortedUnique(impacted), all: new Set([...direct, ...impacted]) };
}

export function pruneChangeFacts(changeFacts, maxPropagation = 3) {
  if (!changeFacts) return null;
  const limit = Math.max(0, Math.min(3, Number.isInteger(maxPropagation) ? maxPropagation : 3));
  const direct = new Set((changeFacts.changed_files || []).map(pathOf).filter(Boolean));
  const impactedFiles = (changeFacts.impacted_files || []).filter((item) => item.depth <= limit);
  const included = new Set([...direct, ...impactedFiles.map((item) => item.path)]);
  const impactedModules = (changeFacts.impacted_modules || []).filter((module) => {
	const paths = module.file_paths || [];
	if (paths.length === 0) return true;
	return paths.some((path) => included.has(path));
  });
  return {
	...changeFacts,
	impacted_files: impactedFiles,
	impacted_modules: impactedModules,
	warnings: [
	  ...(changeFacts.warnings || []),
	  ...(limit < 3 ? [`变更影响传播已由 max_propagation=${limit} 收窄；官方传播硬上限为 3。`] : []),
	],
  };
}

export function buildEvidence(report, mapping, { testFacts = null, changeFacts = null } = {}) {
  const evidence = [];
  for (const item of mapping?.mappings || []) {
	evidence.push({
	  level: item.evidence_level,
	  source: `test_mapping:${item.test_file}->${item.target_file}`,
	  type: item.kind,
	  test_file: item.test_file,
	  target_file: item.target_file,
	  confidence: confidenceForMapping(item),
	  ...(item.symbol_references ? { symbol_references: item.symbol_references } : {}),
	});
  }
  for (const path of mapping?.source_files_without_tests || []) {
	evidence.push({
	  level: "E",
	  source: `scanner:source_files_without_tests:${path}`,
	  type: "no_test_found",
	  target_file: path,
	  confidence: "medium",
	});
  }
  for (const entry of report?.entry_points || []) {
	evidence.push({
	  level: "E",
	  source: `scanner:entry_point:${entry.path || entry.name || "unknown"}`,
	  type: "entry_point",
	  target_file: entry.path || null,
	  confidence: entry.confidence || "medium",
	});
  }
  for (const item of changeFacts?.changed_files || []) {
	const path = pathOf(item);
	if (!path) continue;
	evidence.push({
	  level: "E",
	  source: `git:changed_file:${path}`,
	  type: "changed_file",
	  target_file: path,
	  status: item.status || "modified",
	  confidence: "high",
	});
  }
  for (const warning of [
	...(testFacts?.warnings || []),
	...(changeFacts?.warnings || []),
  ]) {
	const source = typeof warning === "string" ? warning : warning?.code || warning?.message;
	if (source) evidence.push({ level: "E", source: `scanner:warning:${source}`, type: "warning", confidence: "unknown" });
  }
	return evidence.sort((a, b) => compareText(a.target_file, b.target_file)
	|| EVIDENCE_RANK[a.level] - EVIDENCE_RANK[b.level]
	|| compareText(a.source, b.source));
}

function scoreForTarget({ path, file, report, mapping, changePaths, directChanged, gapByPath }) {
  let score = 0;
  const reasons = [];
  if (directChanged.has(path)) {
	score += 5;
	reasons.push("directly changed");
  } else if (changePaths.has(path)) {
	score += 3;
	reasons.push("impacted by changed file");
  }
  const entry = (report?.entry_points || []).find((item) => item.path === path);
  if (entry) {
	score += 3;
	reasons.push(`${entry.type || "entry"} entry point`);
  }
  const exported = (report?.symbols || []).some((symbol) => symbol.path === path && symbol.visibility === "exported");
  if (exported) {
	score += 2;
	reasons.push("exported API");
  }
  if (!hasStrongMapping(mapping, path)) {
	score += 2;
	reasons.push("no direct test evidence");
  }
  if ((report?.risks || []).some((risk) => risk.path === path)) {
	score += 2;
	reasons.push("scanner risk");
  }
  const gapCount = gapByPath.get(path) || 0;
  score += Math.min(gapCount, 2);
  return { score, reasons, file, entry, exported };
}

function priorityForScore(score) {
  if (score >= 8) return "P0";
  if (score >= 4) return "P1";
  return "P2";
}

function confidenceForTarget({ path, input, directChanged, changePaths, mapping, report }) {
  const requested = targetRequested(input, path);
  if (requested) return "high";
  if (directChanged.has(path)) return "high";
  if (changePaths.has(path)) return "medium";
  if (hasStrongMapping(mapping, path)) return "medium";
  if ((report?.files || []).some((file) => file.path === path)) return "low";
  return "unknown";
}

export function buildGaps(report, mapping, input, changeFacts = null, coverage = null) {
  const fileIndex = fileMap(report);
  const rawIndex = rawFileMap(report);
  const paths = new Set((mapping?.source_files_without_tests || []).filter((path) => fileIndex.get(path)?.kind === "source"));
  const change = changedPathSet(changeFacts, input?.maxPropagation ?? 3);
  const selected = new Set([...change.all]);
  if (input?.mode === "target") {
	for (const target of input.targets || []) {
	  const file = [...fileIndex.keys()].find((path) => pathMatches(target.path, path));
	  if (file) selected.add(file);
	}
  }
  if (input?.mode !== "change" && input?.mode !== "target") {
	for (const path of paths) selected.add(path);
  }

  const gaps = [];
  const addGap = (gap) => {
	const key = `${gap.type}|${gap.target_path || ""}|${gap.symbol || ""}`;
	if (!gaps.some((item) => `${item.type}|${item.target_path || ""}|${item.symbol || ""}` === key)) gaps.push(gap);
  };
  const changedTestPaths = new Set(change.direct.filter((path) => fileIndex.get(path)?.kind === "test"));

  for (const path of selected) {
	const file = fileIndex.get(path);
	if (file && file.kind !== "source") continue;
	const direct = change.direct.includes(path);
	const directChange = changeForPath(changeFacts, path);
	const semanticChange = directChange ? hasSemanticChange(directChange) : true;
	const strong = hasStrongMapping(mapping, path);
	const any = hasAnyMapping(mapping, path);
	const coverageFile = coverageForPath(coverage, path);
	if (!any || paths.has(path)) {
	  addGap({
		type: "no_test_found",
		target_path: path,
		priority: direct ? "P1" : "P2",
		confidence: file ? "medium" : "unknown",
		reason: "扫描范围内未发现指向该源码文件的测试证据",
	  });
	} else if (!strong) {
	  addGap({
		type: "weak_test_association",
		target_path: path,
		priority: direct ? "P1" : "P2",
		confidence: "low",
		reason: "仅发现命名或模块级静态关联，不能证明行为覆盖",
	  });
	}

	if (direct && !changedTestPaths.has(path)) {
	  const relatedTests = (mapping?.mappings || []).filter((item) => item.target_file === path).map((item) => item.test_file);
	  const testChanged = relatedTests.some((testPath) => changedTestPaths.has(testPath));
	  if (!testChanged) {
		addGap({
		  type: "changed_without_test_change",
		  target_path: path,
			priority: semanticChange ? "P0" : "P2",
		  confidence: semanticChange ? "high" : "low",
		  reason: semanticChange
			? "源码文件发生语义变更，但对应测试文件未出现在变更清单中"
			: "变更 hunk 仅包含注释、空白或格式标记，未升级为高优先级缺口",
		});
	  }
	if (coverageFile && coverage?.threshold > 0 && coverageFile.metrics.lines.percent !== null && coverageFile.metrics.lines.percent < coverage.threshold) {
	  addGap({
		type: "coverage_below_threshold",
		target_path: path,
		priority: direct ? "P1" : "P2",
		confidence: "high",
		reason: `真实 coverage 行覆盖率 ${coverageFile.metrics.lines.percent.toFixed(2)}% 低于阈值 ${coverage.threshold}%`,
	  });
	}
	}

	const entry = (report?.entry_points || []).find((item) => item.path === path);
	if (entry && !strong) {
	  addGap({
		type: "integration_path_untested",
		target_path: path,
		priority: "P1",
		confidence: entry.confidence || "medium",
		reason: `${entry.type || "entry"} 入口缺少直接测试证据`,
	  });
	}

	const exportedSymbols = (report?.symbols || []).filter((symbol) => symbol.path === path && symbol.visibility === "exported");
	if (exportedSymbols.length > 0 && !strong) {
	  for (const symbol of exportedSymbols.slice(0, 20)) {
		addGap({
		  type: "public_api_untested",
		  target_path: path,
		  symbol: symbol.name,
		  priority: direct ? "P1" : "P2",
		  confidence: "medium",
		  reason: "导出符号未发现直接测试证据",
		});
	  }
	}

	const text = rawIndex.get(path)?._text || "";
	if (!strong && /\b(throw|catch|retry|timeout|permission|unauthori[sz]ed|forbidden)\b/i.test(text)) {
	  addGap({
		type: "error_path_untested",
		target_path: path,
		priority: direct ? "P1" : "P2",
		confidence: "low",
		reason: "源码包含异常、权限、重试或超时路径，但未发现直接测试证据",
	  });
	}
	if (!strong && /\b(null|undefined|empty|length|limit|offset|boundary|>=|<=)\b/i.test(text)) {
	  addGap({
		type: "boundary_case_unknown",
		target_path: path,
		priority: "P2",
		confidence: "low",
		reason: "源码存在边界输入迹象，但扫描无法确认对应边界用例",
	  });
	}
  }

  if (report?.limits?.truncated === true) {
	addGap({
	  type: "unscannable",
	  target_path: null,
	  priority: "P0",
	  confidence: "high",
	  reason: "扫描达到文件或深度限制，结论可能不完整",
	});
  }
  for (const risk of report?.risks || []) {
	if (risk.type === "dynamic_import" || risk.type === "dynamic_require" || risk.type === "parse_failure") {
	  addGap({
		type: "unscannable",
		target_path: risk.path || null,
		priority: "P1",
		confidence: "medium",
		reason: risk.detail || risk.type,
	  });
	}
  }

	return gaps.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
	|| compareText(a.target_path, b.target_path)
	|| compareText(a.symbol, b.symbol)
	|| compareText(a.type, b.type));
}

export function buildTargets(report, mapping, input, changeFacts = null, gaps = []) {
  const files = fileMap(report);
  const change = changedPathSet(changeFacts, input?.maxPropagation ?? 3);
  const gapByPath = new Map();
  for (const gap of gaps) {
	if (gap.target_path) gapByPath.set(gap.target_path, (gapByPath.get(gap.target_path) || 0) + 1);
  }

  let candidates;
  if (input?.mode === "target") {
	candidates = (input.targets || []).map((target) => {
	  const resolved = [...files.keys()].find((path) => pathMatches(target.path, path));
	  return { path: resolved || target.path, symbol: target.symbol || null };
	});
  } else if (input?.mode === "change") {
	candidates = [...change.all].filter((path) => files.get(path)?.kind === "source").map((path) => ({ path, symbol: null }));
	for (const symbol of changeFacts?.impacted_symbols || []) {
	  if (change.direct.includes(symbol.path)) candidates.push({ path: symbol.path, symbol: symbol.name });
	}
  } else {
	candidates = (report?.files || []).filter((file) => SOURCE_KINDS.has(file.kind)).map((file) => ({ path: file.path, symbol: null }));
  }

  const unique = new Map();
  for (const candidate of candidates) {
	const key = `${candidate.path}|${candidate.symbol || ""}`;
	if (!unique.has(key)) unique.set(key, candidate);
  }
  const targets = [];
  for (const candidate of unique.values()) {
	const result = scoreForTarget({
	  ...candidate,
	  report,
	  mapping,
	  changePaths: change.all,
	  directChanged: new Set(change.direct),
	  gapByPath,
	  file: files.get(candidate.path) || null,
	});
	targets.push({
	  path: candidate.path,
	  ...(candidate.symbol ? { symbol: candidate.symbol } : {}),
	  priority: priorityForScore(result.score),
	  confidence: confidenceForTarget({ ...candidate, input, directChanged: new Set(change.direct), changePaths: change.all, mapping, report }),
	  risk_factors: result.reasons,
	  ...(result.entry ? { entry_point: result.entry.type || null } : {}),
	  ...(result.exported ? { exported_api: true } : {}),
	});
  }

  return targets
	.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
	  || (CONFIDENCE_RANK[b.confidence] || 0) - (CONFIDENCE_RANK[a.confidence] || 0)
	  || compareText(a.path, b.path)
	  || compareText(a.symbol, b.symbol))
	.slice(0, input?.maxTargets ?? 50);
}

export function buildWarnings(report, { testFacts = null, changeFacts = null, input = null, coverage = null } = {}) {
  const warnings = [];
  const add = (message) => {
	if (message && !warnings.includes(message)) warnings.push(message);
  };
  for (const item of [
	...(report?.limits?.warnings || []),
	...(report?.risks || []),
	...(testFacts?.warnings || []),
	...(changeFacts?.warnings || []),
  ]) {
	if (typeof item === "string") add(item);
	else if (item?.message) add(item.message);
	else if (item?.detail) add(item.detail);
  }
	if (!coverage && !input?.coveragePath) add("未读取 coverage；不产生 A 级覆盖证据。");
  if (coverage?.below_threshold?.length > 0) add(`coverage 有 ${coverage.below_threshold.length} 项指标低于配置阈值。`);
  if (coverage && coverage.files.length === 0) add("coverage 未解析出文件级记录，A 级证据不可用。");
  if (report?.limits?.truncated === true) add("扫描结果因限制被截断，未覆盖的路径不能视为不存在。");
  if (input?.mode === "change" && (changeFacts?.changed_files || []).length === 0) add("变更输入未解析出文件；请确认 status/diff 文本是否为空或格式可解析。");
	return warnings.sort(compareText);
}

export function buildRiskAnalysis(report, mapping, input, { testFacts = null, changeFacts = null, coverage = null } = {}) {
  const effectiveChangeFacts = pruneChangeFacts(changeFacts, input?.maxPropagation ?? 3);
	const gaps = buildGaps(report, mapping, input, effectiveChangeFacts, coverage);
  const targets = buildTargets(report, mapping, input, effectiveChangeFacts, gaps);
	const evidence = [
	...buildEvidence(report, mapping, { testFacts, changeFacts: effectiveChangeFacts }),
	...buildCoverageEvidence(coverage),
	].sort((a, b) => compareText(a.target_file, b.target_file)
	|| EVIDENCE_RANK[a.level] - EVIDENCE_RANK[b.level]
	|| compareText(a.source, b.source));
  const warnings = buildWarnings(report, { testFacts, changeFacts: effectiveChangeFacts, input, coverage });
  return {
	targets,
	evidence,
	gaps,
	warnings,
	matrix: buildTestMatrix(report, mapping, coverage),
	coverage,
	changeFacts: effectiveChangeFacts,
  };
}
