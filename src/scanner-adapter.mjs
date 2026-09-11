import {
  getChangeImpactFacts as scannerGetChangeImpactFacts,
  getTestInsightFacts as scannerGetTestInsightFacts,
  scanRepository,
} from "dsh-repo-scanner/scanner";
import { contractError, ERROR_CODES, InsightError } from "./errors.mjs";
import { getGitScannerInput } from "./input.mjs";

const SCANNER_SCHEMA_VERSION = "1.0";
const ANALYSIS_SCHEMA_NAME = "dsh-analysis-schema";
const REQUIRED_ARRAYS = ["files", "modules", "symbols"];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function detailsFor(report) {
  return {
	schemaVersion: report?.schema_version ?? null,
	analysisSchema: report?.analysis_schema ?? null,
	tool: report?.tool ?? null,
  };
}

export function validateScannerReport(report, { requireGit = false } = {}) {
  const errors = [];
  if (!isObject(report)) {
	throw contractError("scanner returned a non-object report", ERROR_CODES.SCHEMA_INCOMPATIBLE);
  }
  if (report.schema_version !== SCANNER_SCHEMA_VERSION) {
	errors.push(`schema_version must be ${SCANNER_SCHEMA_VERSION}`);
  }
  if (report.analysis_schema?.name !== ANALYSIS_SCHEMA_NAME || report.analysis_schema?.version !== "1.0") {
	errors.push("analysis_schema must be dsh-analysis-schema v1.0");
  }
  if (report.tool?.name !== "dsh-repo-scanner" || typeof report.tool?.version !== "string" || report.tool.version.length === 0) {
	errors.push("tool.name/version must identify dsh-repo-scanner");
  }
  for (const field of REQUIRED_ARRAYS) {
	if (!Array.isArray(report[field])) errors.push(`${field} must be an array`);
  }
  if (!isObject(report.dependencies) || !Array.isArray(report.dependencies.internal) || !Array.isArray(report.dependencies.external)) {
	errors.push("dependencies.internal and dependencies.external must be arrays");
  }
  if (report.git !== null && report.git !== undefined && !isObject(report.git)) {
	errors.push("git must be an object or null");
  }
  if (requireGit && !isObject(report.git)) errors.push("git is required for change analysis");
  if (errors.length > 0) {
	throw contractError(`scanner report contract failed: ${errors.join("; ")}`, ERROR_CODES.SCHEMA_INCOMPATIBLE, {
	  errors,
	  report: detailsFor(report),
	});
  }
  return report;
}

export function validateFacts(facts, kind) {
  if (!isObject(facts)) {
	throw contractError(`${kind} facts must be an object`, ERROR_CODES.SCHEMA_INCOMPATIBLE);
  }
  if (facts.schema_version !== SCANNER_SCHEMA_VERSION) {
	throw contractError(`${kind} facts schema_version must be ${SCANNER_SCHEMA_VERSION}`, ERROR_CODES.SCHEMA_INCOMPATIBLE, {
	  schemaVersion: facts.schema_version,
	});
  }
  if (facts.analysis_schema?.name !== ANALYSIS_SCHEMA_NAME || facts.analysis_schema?.version !== "1.0") {
	throw contractError(`${kind} facts analysis_schema must be dsh-analysis-schema v1.0`, ERROR_CODES.SCHEMA_INCOMPATIBLE);
  }
  if (facts.tool?.name !== "dsh-repo-scanner" || typeof facts.tool?.version !== "string") {
	throw contractError(`${kind} facts tool identity is invalid`, ERROR_CODES.SCHEMA_INCOMPATIBLE);
  }
  return facts;
}

export function toScannerOptions(input, { modes, git } = {}) {
  const scannerOptions = input?.scanner || {};
  const normalizedGit = git === undefined ? getGitScannerInput(input) : git;
  return {
	repoPath: input.repoPath,
	modes: modes || defaultModesFor(input.mode),
	includeDirs: input.includeDirs,
	excludeDirs: input.excludeDirs,
	maxDepth: scannerOptions.maxDepth,
	maxFiles: scannerOptions.maxFiles,
	maxFileBytes: scannerOptions.maxFileBytes,
	perfBudgetMs: scannerOptions.perfBudgetMs,
	cache: scannerOptions.cache,
	...(scannerOptions.cacheDir === undefined ? {} : { cacheDir: scannerOptions.cacheDir }),
	...(scannerOptions.language === undefined ? {} : { language: scannerOptions.language }),
	...(scannerOptions.strict === undefined ? {} : { strict: scannerOptions.strict }),
	parsers: scannerOptions.parsers,
	// All three scanner/facts calls receive the same cache settings. The scanner
	// itself owns the cache lifecycle and keeps it outside the target repository.
	...(normalizedGit ? { git: normalizedGit } : {}),
  };
}

function defaultModesFor(mode) {
  if (mode === "change") return ["probe", "files", "scan", "deps", "symbols", "graphs", "git"];
  if (mode === "target") return ["probe", "files", "scan", "deps", "entry", "symbols", "graphs"];
  return ["probe", "files", "scan", "deps", "entry", "symbols", "graphs"];
}

export async function scanWithAdapter(input, options = {}) {
  const report = await scanRepository(toScannerOptions(input, options));
  return validateScannerReport(report, { requireGit: input?.mode === "change" });
}

export async function getTestFactsWithAdapter(input) {
  const facts = await scannerGetTestInsightFacts(toScannerOptions(input, { modes: ["probe", "files", "scan"] }));
  return validateFacts(facts, "test insight");
}

export async function getChangeFactsWithAdapter(input) {
  if (input?.mode !== "change") {
	throw new InsightError("change facts require change mode", {
	  code: ERROR_CODES.INVALID_MODE,
	  details: { mode: input?.mode ?? null },
	});
  }
  const facts = await scannerGetChangeImpactFacts(toScannerOptions(input, {
	modes: ["probe", "files", "scan", "deps", "symbols", "git"],
  }));
  return validateFacts(facts, "change impact");
}

export async function collectScannerFacts(input, { clock = () => Date.now() } = {}) {
	const now = clock;
  const startedAt = now();
  const scanStartedAt = now();
  const report = await scanWithAdapter(input);
	const scanFinishedAt = now();
  const testStartedAt = now();
  const testFacts = await getTestFactsWithAdapter(input);
	const testFinishedAt = now();
  let changeFacts = null;
  let changeElapsedMs = 0;
  if (input.mode === "change") {
	const changeStartedAt = now();
	changeFacts = await getChangeFactsWithAdapter(input);
	changeElapsedMs = Math.max(0, now() - changeStartedAt);
  }
  return {
	report,
	testFacts,
	changeFacts,
	timing: {
	  elapsed_ms: Math.max(0, now() - startedAt),
	  calls: {
		scan: { elapsed_ms: Math.max(0, scanFinishedAt - scanStartedAt), performance: report.performance || null },
		test_facts: { elapsed_ms: Math.max(0, testFinishedAt - testStartedAt) },
		...(input.mode === "change" ? { change_facts: { elapsed_ms: changeElapsedMs } } : {}),
	  },
	  cache: report.performance?.cache || null,
	},
  };
}
