#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/engine.mjs";
import { ERROR_CODES, EXIT_CODES, InsightError, invalidInput } from "../src/errors.mjs";
import { writeReportFiles } from "../src/report.mjs";
import { writeDraftObjects } from "../src/drafts.mjs";

const execFileAsync = promisify(execFile);
const MODES = new Set(["all", "change", "target"]);
const FORMATS = new Set(["json", "markdown", "both"]);

function nextValue(args, index, option) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
	throw invalidInput(`${option} requires a value`);
  }
  return value;
}

function parseTarget(value) {
  const text = String(value);
  const separator = text.lastIndexOf(":");
  if (separator > 1 && separator < text.length - 1) {
	return { path: text.slice(0, separator), symbol: text.slice(separator + 1) };
  }
  return text;
}

export function parseArgs(argv) {
  const options = {
	mode: null,
	repo: null,
	targets: [],
	workingTree: false,
	base: null,
	head: null,
	diff: null,
	coverage: null,
	coverageThreshold: undefined,
	coverageFormat: null,
	output: "TEST-PLAN.md",
	format: "both",
	force: false,
	strict: false,
	generateDrafts: false,
	draftOutput: null,
	executeTests: false,
	testCommand: null,
	executionTimeout: undefined,
	executionMaxOutput: undefined,
	maxTargets: undefined,
	maxPropagation: undefined,
	includeDirs: [],
	excludeDirs: [],
	help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
	const argument = argv[index];
	if (argument === "--help" || argument === "-h") {
	  options.help = true;
	  continue;
	}
	if (!argument.startsWith("-")) {
	  if (options.repo !== null) throw invalidInput(`unexpected positional argument: ${argument}`);
	  options.repo = argument;
	  continue;
	}

	const [name, inlineValue] = argument.split(/=(.*)/s, 2);
	switch (name) {
	  case "--all":
		options.mode = "all";
		break;
	  case "--working-tree":
		options.mode = "change";
		options.workingTree = true;
		break;
	  case "--mode":
		options.mode = inlineValue ?? nextValue(argv, index++, name);
		break;
	  case "--base":
		options.base = inlineValue ?? nextValue(argv, index++, name);
		break;
	  case "--head":
		options.head = inlineValue ?? nextValue(argv, index++, name);
		break;
	  case "--diff":
		options.diff = inlineValue ?? nextValue(argv, index++, name);
		break;
	  case "--target":
		options.targets.push(parseTarget(inlineValue ?? nextValue(argv, index++, name)));
		break;
	  case "--coverage":
		options.coverage = inlineValue ?? nextValue(argv, index++, name);
		break;
		case "--coverage-threshold":
		options.coverageThreshold = inlineValue ?? nextValue(argv, index++, name);
		break;
	  case "--coverage-format":
		options.coverageFormat = inlineValue ?? nextValue(argv, index++, name);
		break;
	  case "--output":
		options.output = inlineValue ?? nextValue(argv, index++, name);
		break;
	  case "--format":
		options.format = inlineValue ?? nextValue(argv, index++, name);
		break;
	  case "--max-targets":
		options.maxTargets = inlineValue ?? nextValue(argv, index++, name);
		break;
	  case "--max-propagation":
		options.maxPropagation = inlineValue ?? nextValue(argv, index++, name);
		break;
	  case "--include-dirs":
		options.includeDirs.push(inlineValue ?? nextValue(argv, index++, name));
		break;
	  case "--exclude-dirs":
		options.excludeDirs.push(inlineValue ?? nextValue(argv, index++, name));
		break;
	  case "--generate-drafts":
		options.generateDrafts = true;
		break;
	  case "--draft-output":
		options.draftOutput = inlineValue ?? nextValue(argv, index++, name);
		break;
	  case "--execute-tests":
		options.executeTests = true;
		break;
	  case "--test-command":
		options.testCommand = inlineValue ?? nextValue(argv, index++, name);
		break;
	  case "--execution-timeout":
		options.executionTimeout = inlineValue ?? nextValue(argv, index++, name);
		break;
	  case "--execution-max-output":
		options.executionMaxOutput = inlineValue ?? nextValue(argv, index++, name);
		break;
	  case "--force":
		options.force = true;
		break;
	  case "--strict":
		options.strict = true;
		break;
	  default:
		throw invalidInput(`unknown argument: ${argument}`);
	}
  }

  return options;
}

export function validateArgs(options) {
  const errors = [];
  if (options.help) return errors;
  if (!options.repo) errors.push("repository path is required");
  if (!options.mode || !MODES.has(options.mode)) errors.push("--mode must be all, change, or target");
  if (options.mode === "target" && options.targets.length === 0) errors.push("--mode target requires at least one --target");
	if (options.draftOutput && !options.generateDrafts) errors.push("--draft-output requires --generate-drafts");
	if (options.testCommand && !options.executeTests) errors.push("--test-command requires --execute-tests");
	if (options.executeTests && !options.testCommand) errors.push("--execute-tests requires --test-command");
	if (options.coverageFormat && !["lcov", "istanbul-final", "istanbul-summary", "cobertura"].includes(options.coverageFormat)) {
	errors.push("--coverage-format must be lcov, istanbul-final, istanbul-summary, or cobertura");
  }
  if (!FORMATS.has(options.format)) errors.push("--format must be json, markdown, or both");
  if (options.mode !== "change" && (options.workingTree || options.base || options.head || options.diff)) {
	errors.push("Git change inputs require --mode change");
  }
  if (options.mode === "change") {
	const inputKinds = Number(options.workingTree) + Number(Boolean(options.diff)) + Number(Boolean(options.base));
	if (inputKinds === 0) errors.push("change mode requires --working-tree, --diff, or --base");
	if (options.workingTree && (options.diff || options.base || options.head)) errors.push("--working-tree cannot be combined with --base, --head, or --diff");
	if (options.diff && (options.base || options.head)) errors.push("--diff cannot be combined with --base or --head");
	if (options.head && !options.base) errors.push("--head requires --base");
	if (options.base && options.diff) errors.push("--base cannot be combined with --diff");
  }
  return errors;
}

export function printHelp(stream = process.stdout) {
  stream.write("Usage: dsh-test-insight <repo> --mode all|change|target [options]\n");
  stream.write("Analyze repository facts and write TEST-PLAN.md/test-insight.json without running target commands.\n\n");
  stream.write("Options:\n");
  stream.write("  --working-tree                 change mode from git status --porcelain -uall\n");
  stream.write("  --base <ref> --head <ref>      change mode from git diff <base>...<head>\n");
  stream.write("  --diff <path>                  read a patch file without invoking git\n");
  stream.write("  --target <path[:symbol]>       repeatable target mode input\n");
	stream.write("  --coverage <path>              lcov/Istanbul/Cobertura coverage file\n");
  stream.write("  --coverage-threshold N         line/branch threshold percentage\n");
  stream.write("  --coverage-format <format>     explicit coverage format\n");
	stream.write("  --generate-drafts              write isolated review-only test drafts\n");
	stream.write("  --draft-output <path>          draft directory (requires --generate-drafts)\n");
	stream.write("  --execute-tests                explicitly authorize an allowlisted test command\n");
	stream.write("  --test-command <preset/cmd>    npm-test|pytest|go-test|node-test or safe argv text\n");
	stream.write("  --execution-timeout N          authorized command timeout in milliseconds\n");
	stream.write("  --execution-max-output N       per-stream output cap in bytes\n");
  stream.write("  --max-targets N                cap report targets\n");
  stream.write("  --max-propagation N            narrow scanner propagation (0-3)\n");
  stream.write("  --output <path>                output file or directory\n");
  stream.write("  --format json|markdown|both    output format\n");
  stream.write("  --force --strict               overwrite / warnings exit 1\n");
}

async function assertRepository(repo) {
  try {
	const info = await stat(repo);
	if (!info.isDirectory()) throw new Error("not a directory");
  } catch (error) {
	throw invalidInput(`repository path is not a readable directory: ${repo}`, ERROR_CODES.INVALID_REPOSITORY, { cause: error.code || error.message });
  }
}

async function readDiffFile(diffPath) {
  try {
	return await readFile(diffPath, "utf8");
  } catch (error) {
	throw invalidInput(`cannot read diff file: ${diffPath}`, ERROR_CODES.INVALID_GIT_INPUT, { cause: error.code || error.message });
  }
}

async function readGitOutput(repo, args) {
  try {
	const result = await execFileAsync("git", args, {
	  cwd: repo,
	  shell: false,
	  windowsHide: true,
	  timeout: 30_000,
	  maxBuffer: 10 * 1024 * 1024,
	});
	return result.stdout;
  } catch (error) {
	const detail = String(error.stderr || error.message || "git query failed").trim();
	throw invalidInput(`read-only git query failed: ${detail}`, ERROR_CODES.INVALID_GIT_INPUT, { command: ["git", ...args] });
  }
}

async function prepareRawInput(options) {
  const raw = {
	repoPath: options.repo,
	mode: options.mode,
	targets: options.targets,
	coveragePath: options.coverage,
	coverage: {
	  threshold: options.coverageThreshold,
	  format: options.coverageFormat,
	},
	outputPath: options.output,
	format: options.format,
	generateDrafts: options.generateDrafts,
	draftOutputPath: options.draftOutput,
	executeTests: options.executeTests,
	testCommand: options.testCommand,
	executionTimeoutMs: options.executionTimeout,
	executionMaxOutputBytes: options.executionMaxOutput,
	force: options.force,
	strict: options.strict,
	maxTargets: options.maxTargets,
	maxPropagation: options.maxPropagation,
	includeDirs: options.includeDirs,
	excludeDirs: options.excludeDirs,
  };
  if (options.mode !== "change") return raw;
  if (options.workingTree) {
	raw.workingTree = true;
	raw.statusText = await readGitOutput(options.repo, ["status", "--porcelain", "-uall"]);
	return raw;
  }
  if (options.diff) {
	raw.diffText = await readDiffFile(options.diff);
	return raw;
  }
  raw.base = options.base;
  raw.head = options.head || "HEAD";
  raw.diffText = await readGitOutput(options.repo, ["diff", `${raw.base}...${raw.head}`]);
  return raw;
}

function asInsightError(error) {
  if (error instanceof InsightError) return error;
  return new InsightError(error?.message || "analysis failed", {
	code: ERROR_CODES.SCAN_FAILED,
	exitCode: EXIT_CODES.CONTRACT_ERROR,
	cause: error,
  });
}

export async function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  try {
	const options = parseArgs(argv);
	if (options.help) {
	  printHelp(io.stdout);
	  return EXIT_CODES.OK;
	}
	const validationErrors = validateArgs(options);
	if (validationErrors.length > 0) {
	  for (const message of validationErrors) io.stderr.write(`error: ${message}\n`);
	  return EXIT_CODES.INVALID_INPUT;
	}
	await assertRepository(options.repo);
	const rawInput = await prepareRawInput(options);
	const result = await analyze(rawInput);
  if (result.analysis.drafts?.length > 0) {
	const draftResult = await writeDraftObjects(result.analysis.drafts, result.input);
	result.report.drafts = draftResult.drafts;
	for (const filePath of draftResult.written) io.stdout.write(`wrote draft: ${filePath}\n`);
  }
	const written = await writeReportFiles(result.report, result.input);
	for (const filePath of written) io.stdout.write(`wrote: ${filePath}\n`);
	if (options.strict && result.report.warnings.length > 0) return EXIT_CODES.WARNING;
	return EXIT_CODES.OK;
  } catch (error) {
	const insightError = asInsightError(error);
	io.stderr.write(`error [${insightError.code}]: ${insightError.message}\n`);
	return insightError.exitCode;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
