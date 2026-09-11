import fs from "node:fs/promises";
import path from "node:path";
import { ERROR_CODES, invalidInput } from "./errors.mjs";
import { compareText } from "./ordering.mjs";

const SUPPORTED_FORMATS = Object.freeze(["lcov", "istanbul-final", "istanbul-summary", "cobertura"]);
const FILE_EXTENSIONS = Object.freeze({
  lcov: [".info", ".lcov"],
  "istanbul-final": [".json"],
  "istanbul-summary": [".json"],
  cobertura: [".xml"],
});

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function coverageWarnings(coverage) {
  if (!coverage) return [];
  return coverage.below_threshold.map((item) => `coverage ${item.metric} ${item.percent.toFixed(2)}% < ${item.threshold}%`);
}

function ratio(covered, total) {
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.max(0, Math.min(100, (covered / total) * 100));
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function resolvePath(repoPath, value) {
  const raw = normalizePath(value);
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(repoPath, raw);
  const relative = path.relative(path.resolve(repoPath), absolute);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return normalizePath(relative);
  return normalizePath(raw);
}

function emptyTotals() {
  return { lines: { found: 0, hit: 0, percent: null }, branches: { found: 0, hit: 0, percent: null }, functions: { found: 0, hit: 0, percent: null }, statements: { found: 0, hit: 0, percent: null } };
}

function metric(found, hit) {
  const normalizedFound = Math.max(0, Number(found) || 0);
  const normalizedHit = Math.max(0, Math.min(normalizedFound, Number(hit) || 0));
  return { found: normalizedFound, hit: normalizedHit, percent: ratio(normalizedHit, normalizedFound) };
}

function summarizeTotals(files) {
  const totals = emptyTotals();
  for (const file of files) {
	for (const name of Object.keys(totals)) {
	  totals[name].found += file.metrics[name].found;
	  totals[name].hit += file.metrics[name].hit;
	}
  }
  for (const name of Object.keys(totals)) totals[name].percent = ratio(totals[name].hit, totals[name].found);
  return totals;
}

function makeFile(repoPath, filePath, metrics, details = {}) {
  return {
	path: resolvePath(repoPath, filePath),
	metrics: {
	  lines: metric(metrics.lines?.found, metrics.lines?.hit),
	  branches: metric(metrics.branches?.found, metrics.branches?.hit),
	  functions: metric(metrics.functions?.found, metrics.functions?.hit),
	  statements: metric(metrics.statements?.found, metrics.statements?.hit),
	},
	...(details.lines ? { lines: details.lines } : {}),
	...(details.branches ? { branches: details.branches } : {}),
  };
}

function parseLcov(text, repoPath) {
  const files = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
	if (line === "end_of_record") {
	  if (current?.path) files.push(makeFile(repoPath, current.path, current.metrics, { lines: current.lines, branches: current.branches }));
	  current = null;
	  continue;
	}
	const separator = line.indexOf(":");
	if (separator < 0) continue;
	const key = line.slice(0, separator);
	const value = line.slice(separator + 1);
	if (key === "SF") {
	  current = { path: value, metrics: { lines: {}, branches: {}, functions: {}, statements: {} }, lines: [], branches: [] };
	} else if (!current) {
	  continue;
	} else if (key === "DA") {
	  const [lineNumber, hits] = value.split(",");
	  current.lines.push({ line: Number(lineNumber), hit: Number(hits) > 0 });
	} else if (key === "BRDA") {
	  const [lineNumber, , branch, taken] = value.split(",");
	  current.branches.push({ line: Number(lineNumber), branch, hit: taken !== "0" && taken !== "-" });
	} else if (key === "LF") current.metrics.lines.found = Number(value);
	else if (key === "LH") current.metrics.lines.hit = Number(value);
	else if (key === "BRF") current.metrics.branches.found = Number(value);
	else if (key === "BRH") current.metrics.branches.hit = Number(value);
	else if (key === "FNF") current.metrics.functions.found = Number(value);
	else if (key === "FNH") current.metrics.functions.hit = Number(value);
  }
  return files;
}

function metricFromIstanbul(value) {
  if (!value || typeof value !== "object") return metric(0, 0);
  if (typeof value.total === "object") return metric(value.total.count, value.covered);
  return metric(value.total, value.covered);
}

function parseIstanbulEntry(repoPath, filePath, entry) {
  const statementMap = entry.statementMap || {};
  const statements = entry.s || {};
  const functionMap = entry.fnMap || {};
  const functions = entry.f || {};
  const branchMap = entry.branchMap || {};
  const branches = entry.b || {};
  const lineHits = new Map();
  for (const [id, location] of Object.entries(statementMap)) {
	const start = location?.start?.line;
	const hits = Number(statements[id]) || 0;
	if (Number.isInteger(start)) lineHits.set(start, Math.max(lineHits.get(start) || 0, hits));
  }
  const branchHits = Object.entries(branchMap).flatMap(([id, branch]) => (branch?.locations || []).map((location, index) => ({
	line: location?.start?.line || null,
	hit: Number(branches[id]?.[index]) > 0,
  })));
  return makeFile(repoPath, filePath, {
	statements: { found: Object.keys(statements).length, hit: Object.values(statements).filter((value) => Number(value) > 0).length },
	functions: { found: Object.keys(functions).length, hit: Object.values(functions).filter((value) => Number(value) > 0).length },
	branches: { found: branchHits.length, hit: branchHits.filter((branch) => branch.hit).length },
	lines: { found: lineHits.size, hit: [...lineHits.values()].filter((value) => value > 0).length },
  }, {
	lines: [...lineHits.entries()].map(([line, hit]) => ({ line, hit: hit > 0 })),
	branches: branchHits,
  });
}

function parseIstanbulFinal(value, repoPath) {
  return Object.entries(value || {}).map(([filePath, entry]) => parseIstanbulEntry(repoPath, filePath, entry));
}

function parseSummaryMetric(value) {
  const metricValue = value || {};
  return { found: metricValue.total || 0, hit: metricValue.covered || 0 };
}

function parseIstanbulSummary(value, repoPath) {
  return Object.entries(value || {})
	.filter(([filePath]) => filePath !== "total")
	.map(([filePath, entry]) => makeFile(repoPath, filePath, {
	  lines: parseSummaryMetric(entry.lines),
	  statements: parseSummaryMetric(entry.statements),
	  functions: parseSummaryMetric(entry.functions),
	  branches: parseSummaryMetric(entry.branches),
	}));
}

function xmlAttribute(tag, name) {
  const match = new RegExp(`${name}=["']([^"']*)["']`, "i").exec(tag);
  return match?.[1] ?? null;
}

function parseCobertura(text, repoPath) {
  const files = [];
  const classRe = /<class\b[^>]*>([\s\S]*?)<\/class>/gi;
  let classMatch;
  while ((classMatch = classRe.exec(String(text))) !== null) {
	const header = classMatch[0].slice(0, classMatch[0].indexOf(">") + 1);
	const body = classMatch[1];
	const filePath = xmlAttribute(header, "filename");
	if (!filePath) continue;
	const lines = [];
	const classLinesStart = body.lastIndexOf("<lines");
	const classLinesEnd = body.indexOf("</lines>", classLinesStart);
	const classLines = classLinesStart >= 0 && classLinesEnd >= 0 ? body.slice(classLinesStart, classLinesEnd) : body;
	const lineRe = /<line\b[^>]*\bnumber=["']([^"']+)["'][^>]*\bhits=["']([^"']+)["'][^>]*>/gi;
	let lineMatch;
	while ((lineMatch = lineRe.exec(classLines)) !== null) lines.push({ line: Number(lineMatch[1]), hit: Number(lineMatch[2]) > 0 });
	const methodCount = (body.match(/<method\b/gi) || []).length;
	const methodCovered = (body.match(/<method\b[^>]*\bline-rate=["'](?!0(?:\.0*)?)[^"']+/gi) || []).length;
	const branchMatches = [...classLines.matchAll(/<line\b[^>]*\bbranch=["']true["'][^>]*\bcondition-coverage=["']([^"']+)%\s*\((\d+)\s*\/\s*(\d+)\)/gi)];
	const branchCovered = branchMatches.reduce((sum, match) => sum + Number(match[2]), 0);
	const branchFound = branchMatches.reduce((sum, match) => sum + Number(match[3]), 0);
	files.push(makeFile(repoPath, filePath, {
	  lines: { found: lines.length, hit: lines.filter((line) => line.hit).length },
	  functions: { found: methodCount, hit: methodCovered },
		branches: { found: branchFound, hit: branchCovered },
	  statements: { found: lines.length, hit: lines.filter((line) => line.hit).length },
	}, { lines }));
  }
  return files;
}

function detectFormat(filePath, requested) {
  if (requested) return requested;
  const name = path.basename(filePath).toLowerCase();
  if (name === "lcov.info" || name.endsWith(".lcov")) return "lcov";
  if (name === "coverage-final.json" || name === "coverage.json") return "istanbul-final";
  if (name === "coverage-summary.json") return "istanbul-summary";
  if (name.endsWith(".xml")) return "cobertura";
  return null;
}

function validateFormat(format, filePath) {
  if (!SUPPORTED_FORMATS.includes(format)) {
	throw invalidInput(`unsupported coverage format for ${filePath}; expected lcov, istanbul-final, istanbul-summary, or cobertura`, ERROR_CODES.INVALID_COVERAGE, { format, supported: SUPPORTED_FORMATS });
  }
}

export function parseCoverageText(text, { repoPath = ".", filePath = "coverage", format = null, threshold = 0 } = {}) {
  const detected = detectFormat(filePath, format);
  validateFormat(detected, filePath);
  let files;
  try {
	if (detected === "lcov") files = parseLcov(text, repoPath);
	else if (detected === "cobertura") files = parseCobertura(text, repoPath);
	else files = detected === "istanbul-final" ? parseIstanbulFinal(JSON.parse(text), repoPath) : parseIstanbulSummary(JSON.parse(text), repoPath);
  } catch (error) {
	if (error instanceof SyntaxError || !Array.isArray(files)) {
	  throw invalidInput(`invalid ${detected} coverage data: ${filePath}`, ERROR_CODES.INVALID_COVERAGE, { format: detected, path: filePath, cause: error.message });
	}
	throw error;
  }
  if (files.length === 0) throw invalidInput(`coverage contains no file records: ${filePath}`, ERROR_CODES.INVALID_COVERAGE, { format: detected, path: filePath });
  const totals = summarizeTotals(files);
  const belowThreshold = Object.entries(totals)
	.filter(([, value]) => value.percent !== null && value.percent < threshold)
	.map(([name, value]) => ({ metric: name, percent: value.percent, threshold }));
  return {
	format: detected,
	path: normalizePath(filePath),
	files: files.sort((a, b) => compareText(a.path, b.path)),
	totals,
	threshold,
	below_threshold: belowThreshold,
	fresh: true,
  };
}

export async function readCoverage(input) {
  if (!input?.coverage?.path) return null;
  const filePath = path.resolve(input.repoPath, input.coverage.path);
  let text;
  try {
	text = await fs.readFile(filePath, "utf8");
  } catch (error) {
	throw invalidInput(`coverage file cannot be read: ${input.coverage.path}`, ERROR_CODES.INVALID_COVERAGE, { path: input.coverage.path, cause: error.code || error.message });
  }
  const format = input.coverage.format || detectFormat(filePath, null);
  return parseCoverageText(text, {
	repoPath: input.repoPath,
	filePath: input.coverage.path,
	format,
	threshold: input.coverage.threshold,
  });
}

export function findCoverageFile(coverage, filePath) {
  if (!coverage) return null;
  const normalized = normalizePath(filePath);
  return coverage.files.find((file) => file.path === normalized || file.path.endsWith(`/${normalized}`) || normalized.endsWith(`/${file.path}`)) || null;
}

export function coverageEvidence(coverage, filePath) {
  const file = findCoverageFile(coverage, filePath);
  if (!file) return null;
  return {
	level: "A",
	source: `coverage:${coverage.format}:${coverage.path}:${file.path}`,
	type: "coverage",
	target_file: file.path,
	confidence: "high",
	metrics: file.metrics,
	lines: file.lines || [],
	branches: file.branches || [],
  };
}

export { SUPPORTED_FORMATS };
