import path from "node:path";
import { ERROR_CODES, invalidInput } from "./errors.mjs";

export const MODES = Object.freeze(["all", "change", "target"]);
export const OUTPUT_FORMATS = Object.freeze(["json", "markdown", "both"]);

const DEFAULTS = Object.freeze({
  maxTargets: 50,
  maxPropagation: 3,
  outputPath: "TEST-PLAN.md",
  outputFormat: "both",
	coverage: {
	threshold: 0,
  },
  execution: {
	authorized: false,
	timeoutMs: 120_000,
	maxOutputBytes: 1_048_576,
  },
  scanner: {
	maxDepth: 3,
	maxFiles: 2000,
	maxFileBytes: 256000,
	perfBudgetMs: 60000,
	cache: true,
	parsers: ["heuristic"],
  },
});

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function requiredString(value, field, code = ERROR_CODES.INVALID_ARGUMENT) {
  if (typeof value !== "string" || value.trim() === "") {
	throw invalidInput(`${field} must be a non-empty string`, code, { field });
  }
  return value.trim();
}

function normalizeDraftOutputPath(raw) {
  const value = raw.draftOutputPath ?? raw.draft_output_path ?? null;
  if (value === null || value === undefined) return null;
  return requiredString(value, "draftOutputPath", ERROR_CODES.INVALID_OUTPUT);
}

function normalizeCoverageOptions(raw) {
  const value = raw?.coverage;
  const coveragePath = raw.coveragePath ?? raw.coverage_path ?? (typeof value === "string" ? value : null);
  const options = isObject(value) ? value : {};
  if (coveragePath !== null && (typeof coveragePath !== "string" || coveragePath.trim() === "")) {
	throw invalidInput("coveragePath must be a non-empty string", ERROR_CODES.INVALID_COVERAGE);
  }
  const threshold = integerOption(options.threshold ?? raw.coverageThreshold ?? raw.coverage_threshold, "coverage.threshold", {
	min: 0,
	max: 100,
	fallback: DEFAULTS.coverage.threshold,
  });
  return {
	path: coveragePath === null ? null : coveragePath.trim(),
	threshold,
	format: options.format === undefined ? null : requiredString(options.format, "coverage.format", ERROR_CODES.INVALID_COVERAGE).toLowerCase(),
  };
}

function normalizeExecutionOptions(raw) {
  const value = isObject(raw.execution) ? raw.execution : {};
	const command = value.command ?? raw.testCommand ?? raw.test_command ?? null;
  if (command !== null && typeof command !== "string" && !Array.isArray(command)) {
	throw invalidInput("execution.command must be a supported preset, string, or argv array", ERROR_CODES.EXECUTION_NOT_AUTHORIZED);
  }
  return {
	authorized: Boolean(raw.executeTests ?? raw.execute_tests ?? value.authorized),
	command,
	timeoutMs: integerOption(value.timeoutMs ?? raw.executionTimeoutMs ?? raw.execution_timeout_ms, "execution.timeoutMs", {
	  min: 1,
	  max: 86_400_000,
	  fallback: DEFAULTS.execution.timeoutMs,
	}),
	maxOutputBytes: integerOption(value.maxOutputBytes ?? raw.executionMaxOutputBytes ?? raw.execution_max_output_bytes, "execution.maxOutputBytes", {
	  min: 1024,
	  max: 100_000_000,
	  fallback: DEFAULTS.execution.maxOutputBytes,
	}),
  };
}

function integerOption(value, field, { min, max, fallback }) {
  const normalized = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
	throw invalidInput(`${field} must be an integer between ${min} and ${max}`, ERROR_CODES.INVALID_LIMIT, { field, min, max });
  }
  return normalized;
}

function listOption(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
	throw invalidInput(`${field} must be an array`, ERROR_CODES.INVALID_ARGUMENT, { field });
  }
  return value.map((item) => requiredString(item, `${field}[]`));
}

function normalizeTargets(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
	throw invalidInput("targets must be an array", ERROR_CODES.INVALID_TARGET);
  }
  return value.map((target) => {
	if (typeof target === "string") {
	  return { path: requiredString(target, "target", ERROR_CODES.INVALID_TARGET) };
	}
	if (isObject(target)) {
	  return {
		path: requiredString(target.path, "target.path", ERROR_CODES.INVALID_TARGET),
		...(target.symbol === undefined ? {} : { symbol: requiredString(target.symbol, "target.symbol", ERROR_CODES.INVALID_TARGET) }),
	  };
	}
	throw invalidInput("each target must be a path or an object", ERROR_CODES.INVALID_TARGET);
  });
}

function normalizeScannerOptions(value = {}) {
  if (!isObject(value)) {
	throw invalidInput("scanner must be an object", ERROR_CODES.INVALID_ARGUMENT);
  }
  const maxDepth = integerOption(value.maxDepth ?? value.max_depth, "scanner.maxDepth", { min: 0, max: 100, fallback: DEFAULTS.scanner.maxDepth });
  const maxFiles = integerOption(value.maxFiles ?? value.max_files, "scanner.maxFiles", { min: 1, max: 1_000_000, fallback: DEFAULTS.scanner.maxFiles });
  const maxFileBytes = integerOption(value.maxFileBytes ?? value.max_file_bytes, "scanner.maxFileBytes", { min: 1, max: 100_000_000, fallback: DEFAULTS.scanner.maxFileBytes });
  const perfBudgetMs = integerOption(value.perfBudgetMs ?? value.perf_budget_ms, "scanner.perfBudgetMs", { min: 0, max: 86_400_000, fallback: DEFAULTS.scanner.perfBudgetMs });
  const parsers = value.parsers === undefined ? [...DEFAULTS.scanner.parsers] : listOption(value.parsers, "scanner.parsers");

  return {
	maxDepth,
	maxFiles,
	maxFileBytes,
	perfBudgetMs,
	cache: value.cache === undefined ? DEFAULTS.scanner.cache : Boolean(value.cache),
	...(value.cacheDir === undefined ? {} : { cacheDir: requiredString(value.cacheDir, "scanner.cacheDir") }),
	parsers,
	...(value.language === undefined ? {} : { language: requiredString(value.language, "scanner.language") }),
	...(value.strict === undefined ? {} : { strict: Boolean(value.strict) }),
  };
}

function directGitCandidates(raw) {
  const git = isObject(raw.git) ? raw.git : {};
  const source = [
	["changedFiles", hasOwn(git, "changedFiles") ? git.changedFiles : raw.changedFiles],
	["statusText", hasOwn(git, "statusText") ? git.statusText : raw.statusText],
	["diffText", hasOwn(git, "diffText") ? git.diffText : raw.diffText],
  ];
  return source.filter(([key]) => hasOwn(git, key) || hasOwn(raw, key));
}

function normalizeGitInput(raw, mode) {
  const git = isObject(raw.git) ? raw.git : {};
  const candidates = directGitCandidates(raw);
  const hasWorkingTree = raw.workingTree === true;
  const hasDiffPath = raw.diffPath !== undefined && raw.diffPath !== null;
  const hasBase = raw.base !== undefined && raw.base !== null;
  const hasHead = raw.head !== undefined && raw.head !== null;

  if (mode !== "change") {
	if (hasWorkingTree || hasDiffPath || hasBase || hasHead || candidates.length > 0) {
	  throw invalidInput("Git change inputs are only valid in change mode", ERROR_CODES.INVALID_GIT_INPUT);
	}
	return null;
  }

  if (hasHead && !hasBase && !hasDiffPath && !candidates.some(([key]) => key === "diffText")) {
	throw invalidInput("head requires base in change mode", ERROR_CODES.INVALID_GIT_INPUT);
  }

  const sourceKinds = Number(hasWorkingTree) + Number(hasDiffPath) + Number(hasBase) + Number(candidates.length > 0);
  if (sourceKinds === 0) {
	throw invalidInput("change mode requires working-tree, diff, base/head, or a direct git input", ERROR_CODES.INVALID_GIT_INPUT);
  }

  if (raw.strictGitInputs && sourceKinds > 1) {
	throw invalidInput("change inputs are mutually exclusive", ERROR_CODES.INVALID_GIT_INPUT);
  }

  if (hasWorkingTree) {
	const nonStatusCandidates = candidates.filter(([key]) => key !== "statusText");
	if (hasDiffPath || hasBase || hasHead || nonStatusCandidates.length > 0) {
	  throw invalidInput("working-tree cannot be combined with other change inputs", ERROR_CODES.INVALID_GIT_INPUT);
	}
	const statusText = hasOwn(git, "statusText") ? git.statusText : raw.statusText;
	if (statusText !== undefined && typeof statusText !== "string") {
	  throw invalidInput("statusText must be a string", ERROR_CODES.INVALID_GIT_INPUT);
	}
	return {
	  channel: "statusText",
	  statusText: statusText ?? "",
	};
  }

  if (hasDiffPath) {
	if (hasBase || hasHead || candidates.length > 0) {
	  throw invalidInput("diffPath cannot be combined with other change inputs", ERROR_CODES.INVALID_GIT_INPUT);
	}
	return { channel: "diffPath", diffPath: requiredString(raw.diffPath, "diffPath") };
  }

  if (hasBase) {
	return {
	  channel: "diffText",
	  base: requiredString(raw.base, "base"),
	  head: raw.head === undefined || raw.head === null ? "HEAD" : requiredString(raw.head, "head"),
	  ...(hasOwn(git, "diffText") ? { diffText: git.diffText } : hasOwn(raw, "diffText") ? { diffText: raw.diffText } : {}),
	};
  }

  if (candidates.length > 0) {
	const [channel, value] = candidates[0];
	if (channel === "changedFiles") {
	  if (!Array.isArray(value)) throw invalidInput("changedFiles must be an array", ERROR_CODES.INVALID_GIT_INPUT);
	  return { channel, changedFiles: value };
	}
	if (channel === "statusText") {
	  if (typeof value !== "string") throw invalidInput("statusText must be a string", ERROR_CODES.INVALID_GIT_INPUT);
	  return { channel, statusText: value };
	}
	if (typeof value !== "string") throw invalidInput("diffText must be a string", ERROR_CODES.INVALID_GIT_INPUT);
	return { channel, diffText: value };
  }

  throw invalidInput("invalid change input", ERROR_CODES.INVALID_GIT_INPUT);
}

export function normalizeInput(raw = {}) {
  if (!isObject(raw)) {
	throw invalidInput("input must be an object");
  }

  const mode = raw.mode ?? "all";
  if (!MODES.includes(mode)) {
	throw invalidInput(`mode must be one of: ${MODES.join(", ")}`, ERROR_CODES.INVALID_MODE);
  }

  const repoPath = raw.repoPath ?? raw.repo_path;
  const normalized = {
	mode,
	repoPath: path.resolve(requiredString(repoPath, "repoPath", ERROR_CODES.INVALID_REPOSITORY)),
	targets: normalizeTargets(raw.targets),
  coveragePath: raw.coveragePath ?? raw.coverage_path ?? (typeof raw.coverage === "string" ? raw.coverage : null),
  coverage: normalizeCoverageOptions(raw),
	outputPath: raw.outputPath ?? raw.output_path ?? DEFAULTS.outputPath,
	format: raw.format ?? DEFAULTS.outputFormat,
	generateDrafts: Boolean(raw.generateDrafts ?? raw.generate_drafts),
	force: Boolean(raw.force),
	strict: Boolean(raw.strict),
  execution: normalizeExecutionOptions(raw),
	maxTargets: integerOption(raw.maxTargets ?? raw.max_targets, "maxTargets", { min: 1, max: 10_000, fallback: DEFAULTS.maxTargets }),
	maxPropagation: integerOption(raw.maxPropagation ?? raw.max_propagation, "maxPropagation", { min: 0, max: 3, fallback: DEFAULTS.maxPropagation }),
	includeDirs: listOption(raw.includeDirs ?? raw.include_dirs, "includeDirs"),
	excludeDirs: listOption(raw.excludeDirs ?? raw.exclude_dirs, "excludeDirs"),
	draftOutputPath: normalizeDraftOutputPath(raw),
	scanner: normalizeScannerOptions(raw.scanner),
  };

  if (!OUTPUT_FORMATS.includes(normalized.format)) {
	throw invalidInput(`format must be one of: ${OUTPUT_FORMATS.join(", ")}`, ERROR_CODES.INVALID_ARGUMENT);
  }
  if (mode === "target" && normalized.targets.length === 0) {
	throw invalidInput("target mode requires at least one target", ERROR_CODES.INVALID_TARGET);
  }
  normalized.git = normalizeGitInput(raw, mode);
  return normalized;
}

export function getGitScannerInput(normalized) {
  if (!normalized?.git) return null;
  const { channel, ...value } = normalized.git;
  return value;
}
