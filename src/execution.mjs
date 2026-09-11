import { spawn } from "node:child_process";
import path from "node:path";
import { ERROR_CODES, EXIT_CODES, InsightError } from "./errors.mjs";
import { redactString } from "./redaction.mjs";

const PRESETS = Object.freeze({
  "npm-test": ["npm", "test"],
  "npm-run-test": ["npm", "run", "test"],
  "pnpm-test": ["pnpm", "test"],
  "yarn-test": ["yarn", "test"],
  pytest: ["pytest"],
  "python-pytest": ["python", "-m", "pytest"],
  "go-test": ["go", "test", "./..."],
  "node-test": ["node", "--test"],
});

const ALLOWED_SIGNATURES = Object.freeze([
  ["npm", "test"],
  ["npm", "run", "test"],
  ["pnpm", "test"],
  ["yarn", "test"],
  ["pytest"],
  ["python", "-m", "pytest"],
  ["python3", "-m", "pytest"],
  ["go", "test", "./..."],
  ["node", "--test"],
]);
const SHELL_TOKENS = /[&|;<>`$(){}\n\r]/;

function executable(value) {
  if (process.platform === "win32" && value === "npm") return "npm.cmd";
  return value;
}

function signatureMatches(actual, expected) {
  if (actual.length < expected.length) return false;
  return expected.every((value, index) => actual[index] === value);
}

function normalizeArrayCommand(value) {
	if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length === 0 || SHELL_TOKENS.test(item))) {
	throw new InsightError("execution command must be a non-empty shell-free argument array", {
	  code: ERROR_CODES.EXECUTION_NOT_AUTHORIZED,
	  exitCode: EXIT_CODES.INVALID_INPUT,
	});
  }
  const command = value.map((item) => item.trim());
  if (!ALLOWED_SIGNATURES.some((signature) => signatureMatches(command, signature))) {
	throw new InsightError("execution command is not on the allowlist", {
	  code: ERROR_CODES.EXECUTION_NOT_AUTHORIZED,
	  exitCode: EXIT_CODES.INVALID_INPUT,
	  details: { command: [command[0], ...command.slice(1, 4)] },
	});
  }
  return command;
}

function executionError(message, details = null) {
  return new InsightError(message, {
	code: ERROR_CODES.EXECUTION_NOT_AUTHORIZED,
	exitCode: EXIT_CODES.INVALID_INPUT,
	details,
  });
}

function isInsideRepository(repoPath, value) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) return false;
  const root = path.resolve(repoPath);
  const candidate = path.resolve(root, value);
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function validateNodeTestArguments(command, repoPath) {
  const safeOptions = [
	/^--test-name-pattern=/,
	/^--test-skip-pattern=/,
	/^--test-concurrency=\d+$/,
	/^--test-shard=\d+\/\d+$/,
	/^--test-only$/,
  ];
  for (const token of command.slice(2)) {
	if (token === "--") continue;
	if (token.startsWith("--")) {
	  if (!safeOptions.some((pattern) => pattern.test(token))) {
		throw executionError("node test option is not allowlisted", { option: token.slice(0, 80) });
	  }
	  continue;
	}
	if (token.startsWith("-")) throw executionError("node test flag is not allowlisted", { option: token.slice(0, 80) });
	if (!isInsideRepository(repoPath, token)) {
	  throw executionError("node test path must remain inside the repository", { path: token.slice(0, 160) });
	}
  }
}

function validateExecutionCommand(command, repoPath) {
  if (command[0] === "node" && command[1] === "--test") {
	validateNodeTestArguments(command, repoPath);
	return;
  }
  const exact = ["npm", "pnpm", "yarn", "pytest", "python", "python3", "go"];
  if (exact.includes(command[0])) {
	const allowed = ALLOWED_SIGNATURES.some((signature) => signature.length === command.length && signature.every((value, index) => value === command[index]));
	if (!allowed) throw executionError("test command arguments must match an allowlisted command exactly", { command: command.slice(0, 4) });
  }
}

function redactedCommand(command) {
  return command.map((value) => redactString(value));
}

function tokenize(value) {
  if (typeof value !== "string" || SHELL_TOKENS.test(value)) return null;
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 ? tokens : null;
}

export function normalizeAuthorizedCommand(command) {
  if (typeof command === "string" && PRESETS[command]) return PRESETS[command].slice();
  if (Array.isArray(command)) return normalizeArrayCommand(command);
	if (typeof command === "string") {
	const tokens = tokenize(command);
	return tokens ? normalizeArrayCommand(tokens) : (() => {
	  throw new InsightError("execution command must be a non-empty shell-free allowlisted command", {
		code: ERROR_CODES.EXECUTION_NOT_AUTHORIZED,
		exitCode: EXIT_CODES.INVALID_INPUT,
	  });
	})();
  }
  throw new InsightError("an explicit allowlisted test command is required", {
	code: ERROR_CODES.EXECUTION_NOT_AUTHORIZED,
	exitCode: EXIT_CODES.INVALID_INPUT,
  });
}

function commandFromRunMethods(runMethods = []) {
  for (const method of runMethods) {
	const candidate = typeof method === "string" ? method : method?.command || method?.run;
	if (!candidate) continue;
	try {
	  return normalizeAuthorizedCommand(candidate);
	} catch {
	  continue;
	}
  }
  return null;
}

export function resolveAuthorizedCommand(command, report) {
  if (command !== null && command !== undefined) return normalizeAuthorizedCommand(command);
  const discovered = commandFromRunMethods(report?.run_methods || []);
  if (discovered) return discovered;
  throw new InsightError("no allowlisted test command was provided or discovered", {
	code: ERROR_CODES.EXECUTION_NOT_AUTHORIZED,
	exitCode: EXIT_CODES.INVALID_INPUT,
  });
}

function appendLimited(state, chunk, maxBytes) {
  if (state.bytes >= maxBytes) {
	state.truncated = true;
	return;
  }
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  const remaining = maxBytes - state.bytes;
  const accepted = buffer.subarray(0, remaining).toString("utf8");
  state.value += accepted;
  state.bytes += Buffer.byteLength(accepted);
  if (accepted.length < buffer.length) state.truncated = true;
}

// A host that itself runs under node:test marks its process environment with
// NODE_TEST_CONTEXT; an authorized `node --test` child that inherits the
// marker skips its files and exits 0 without running anything, so strip it.
function sanitizeSpawnEnvironment() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

export async function executeAuthorizedTests({ repoPath, command, report = null, authorized = false, timeoutMs = 120_000, maxOutputBytes = 1_048_576 } = {}) {
  if (!authorized) {
	throw new InsightError("test execution requires explicit authorization", {
	  code: ERROR_CODES.EXECUTION_NOT_AUTHORIZED,
	  exitCode: EXIT_CODES.INVALID_INPUT,
	});
  }
  const normalizedCommand = resolveAuthorizedCommand(command, report);
	validateExecutionCommand(normalizedCommand, repoPath);
  const [file, ...args] = normalizedCommand;
  const stdout = { value: "", bytes: 0, truncated: false };
  const stderr = { value: "", bytes: 0, truncated: false };
  const startedAt = Date.now();
  const child = spawn(executable(file), args, {
	cwd: path.resolve(repoPath),
	env: sanitizeSpawnEnvironment(),
	shell: false,
	windowsHide: true,
	stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => appendLimited(stdout, chunk, maxOutputBytes));
  child.stderr.on("data", (chunk) => appendLimited(stderr, chunk, maxOutputBytes));
  return await new Promise((resolve, reject) => {
	let timedOut = false;
	const timer = setTimeout(() => {
	  timedOut = true;
	  child.kill();
	}, timeoutMs);
	child.once("error", (error) => {
	  clearTimeout(timer);
	  reject(new InsightError(`authorized test command failed to start: ${redactString(error.message)}`, {
		code: ERROR_CODES.EXECUTION_FAILED,
		exitCode: EXIT_CODES.CONTRACT_ERROR,
		details: { command: normalizedCommand, cause: error.code || "spawn_error" },
		cause: error,
	  }));
	});
	child.once("close", (code, signal) => {
	  clearTimeout(timer);
	  const status = timedOut ? "timed_out" : code === 0 ? "passed" : "failed";
	  resolve({
		status,
		command: normalizedCommand,
		exit_code: code,
		signal: signal || null,
		timed_out: timedOut,
		elapsed_ms: Date.now() - startedAt,
		stdout: redactString(stdout.value),
		stderr: redactString(stderr.value),
		output_truncated: stdout.truncated || stderr.truncated,
	  });
	});
  });
}

export { PRESETS as AUTHORIZED_COMMAND_PRESETS };
