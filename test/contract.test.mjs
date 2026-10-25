import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { buildGaps, contractError, ERROR_CODES } from "../src/index.mjs";
import { main } from "../scripts/cli.mjs";

const execFileAsync = promisify(execFile);
const adapterRepo = path.resolve("test/fixtures/adapter-repo");
const entryRepo = path.resolve("test/fixtures/entry-repo");
const coverageFixture = path.resolve("test/fixtures/coverage/lcov.info");

function io() {
  let stdout = "";
  let stderr = "";
  return {
	io: {
	  stdout: { write(value) { stdout += value; } },
	  stderr: { write(value) { stderr += value; } },
	},
	get stdout() { return stdout; },
	get stderr() { return stderr; },
  };
}

async function tempDir(prefix = "dsh-contract-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function readJsonReport(dir) {
  return JSON.parse(await readFile(path.join(dir, "test-insight.json"), "utf8"));
}

async function makeGitRepo() {
  const dir = await tempDir("dsh-contract-git-");
  const git = (...args) => execFileAsync("git", args, { cwd: dir });
  await mkdir(path.join(dir, "src"), { recursive: true });
  await writeFile(path.join(dir, "src", "a.js"), "export function a(value) {\n  if (!value) throw new Error(\"missing\");\n  return value;\n}\n");
  await writeFile(path.join(dir, "src", "a.test.js"), "import { a } from \"./a.js\";\nimport test from \"node:test\";\ntest(\"a\", () => {});\n");
  await git("init");
  await git("config", "user.email", "contract@example.com");
  await git("config", "user.name", "contract");
  await git("add", ".");
  await git("commit", "-m", "init");
  return dir;
}

async function writePatch(dir, fileWithContent) {
  const patchPath = path.join(dir, "change.patch");
  await writeFile(patchPath, fileWithContent);
  return patchPath;
}

function diffFor(file, line) {
  return [
	`diff --git a/${file} b/${file}`,
	`--- a/${file}`,
	`+++ b/${file}`,
	"@@ -1,2 +1,3 @@",
	" existing line",
	`+${line}`,
	" another line",
	"",
  ].join("\n");
}

test("comment-only change is not a high-priority test gap", () => {
  const report = {
	files: [{ path: "src/a.js", kind: "source" }],
	_files: [{ path: "src/a.js", _text: "export function a() {}" }],
	entry_points: [],
	symbols: [],
	dependencies: { internal: [], external: [] },
	risks: [],
	limits: { truncated: false, warnings: [] },
  };
  const mapping = { mappings: [], source_files_without_tests: ["src/a.js"] };
  const facts = {
	changed_files: [{ new_path: "src/a.js", status: "modified", hunks: [{ lines: ["+// formatting note", "+"] }] }],
	impacted_files: [],
  };
  const gaps = buildGaps(report, mapping, { mode: "change", maxPropagation: 3 }, facts);
  const gap = gaps.find((item) => item.type === "changed_without_test_change");
  assert.equal(gap.priority, "P2");
  assert.equal(gap.confidence, "low");
});

test("CLI returns documented invalid-input exit code", async () => {
  const capture = io();
  const code = await main([".", "--mode", "target"], capture.io);
  assert.equal(code, 2);
  assert.match(capture.stderr, /requires at least one --target/);
});

test("exit 0 on a full analysis and both artifacts are written", async () => {
  const outDir = await tempDir("dsh-contract-out-");
  const capture = io();
  try {
	const code = await main([adapterRepo, "--mode", "all", "--output", outDir, "--format", "both"], capture.io);
	assert.equal(code, 0);
	const report = await readJsonReport(outDir);
	assert.equal(report.input.mode, "all");
	assert.equal(report.input.git_channel, null);
	assert.ok(report.targets.length > 0);
	await readFile(path.join(outDir, "TEST-PLAN.md"), "utf8");
  } finally {
	await rm(outDir, { recursive: true, force: true });
  }
});

test("exit 1 under --strict when warnings exist", async () => {
  const outDir = await tempDir("dsh-contract-strict-");
  const capture = io();
  try {
	const code = await main([adapterRepo, "--mode", "all", "--output", outDir, "--format", "json", "--strict"], capture.io);
	assert.equal(code, 1);
	const report = await readJsonReport(outDir);
	assert.ok(report.warnings.length > 0);
  } finally {
	await rm(outDir, { recursive: true, force: true });
  }
});

test("exit 2 for an unresolvable git ref", async () => {
  const capture = io();
  const code = await main([adapterRepo, "--mode", "change", "--base", "no-such-ref-xyz"], capture.io);
  assert.equal(code, 2);
  assert.match(capture.stderr, /INVALID_GIT_INPUT/);
});

test("exit 2 for a non-Git directory with --working-tree", async () => {
  const dir = await tempDir("dsh-contract-nogit-");
  const capture = io();
  const code = await main([dir, "--mode", "change", "--working-tree"], capture.io);
  assert.equal(code, 2);
  assert.match(capture.stderr, /INVALID_GIT_INPUT|git query failed/);
});

test("exit 2 for a missing diff file", async () => {
  const dir = await tempDir("dsh-contract-nogit-");
  const capture = io();
  const code = await main([dir, "--mode", "change", "--diff", path.join(dir, "missing.patch")], capture.io);
  assert.equal(code, 2);
  assert.match(capture.stderr, /cannot read diff file/);
});

test("exit 2 for a missing coverage file", async () => {
  const outDir = await tempDir("dsh-contract-cov-");
  const capture = io();
  try {
	const code = await main([adapterRepo, "--mode", "all", "--coverage", path.join(outDir, "missing-lcov.info"), "--output", outDir, "--format", "json"], capture.io);
	assert.equal(code, 2);
	assert.match(capture.stderr, /INVALID_COVERAGE/);
  } finally {
	await rm(outDir, { recursive: true, force: true });
  }
});

test("exit 2 for an unsupported coverage format", async () => {
  const dir = await tempDir("dsh-contract-covfmt-");
  await writeFile(path.join(dir, "coverage.txt"), "not a coverage file");
  const outDir = await tempDir("dsh-contract-covfmt-out-");
  const capture = io();
  try {
	const code = await main([dir, "--mode", "all", "--coverage", path.join(dir, "coverage.txt"), "--output", outDir, "--format", "json"], capture.io);
	assert.equal(code, 2);
	assert.match(capture.stderr, /unsupported coverage format|INVALID_COVERAGE/);
  } finally {
	await rm(dir, { recursive: true, force: true });
	await rm(outDir, { recursive: true, force: true });
  }
});

test("exit 3 when report output cannot be written", async () => {
  const dir = await tempDir("dsh-contract-write-");
  const blocker = path.join(dir, "blocker");
  await writeFile(blocker, "a file, not a directory");
  const capture = io();
  const code = await main([adapterRepo, "--mode", "all", "--output", path.join(blocker, "inner.md"), "--format", "json"], capture.io);
  assert.equal(code, 3);
  assert.match(capture.stderr, /OUTPUT_FAILED|failed to write/);
});

test("exit 3 when the scanner report is schema-incompatible", async () => {
  const dir = await tempDir("dsh-contract-schema-");
  const capture = io();
  const code = await main([dir, "--mode", "all"], capture.io, {
	analyze: async () => {
	  throw contractError("scanner report contract failed: schema_version must be 1.0", ERROR_CODES.SCHEMA_INCOMPATIBLE);
	},
  });
  assert.equal(code, 3);
  assert.match(capture.stderr, /SCHEMA_INCOMPATIBLE/);
});

test("working-tree mode collects statusText end to end and flags changed source without test change", async () => {
  const repo = await makeGitRepo();
  const outDir = await tempDir("dsh-contract-wt-out-");
  try {
	await writeFile(path.join(repo, "src", "a.js"), "export function a(value) {\n  if (!value) throw new Error(\"missing\");\n  return value + 1;\n}\n");
	const capture = io();
	const code = await main([repo, "--mode", "change", "--working-tree", "--output", outDir, "--format", "json"], capture.io);
	assert.equal(code, 0);
	const report = await readJsonReport(outDir);
	assert.equal(report.input.git_channel, "statusText");
	assert.ok(report.scope.changed_files.includes("src/a.js"));
	assert.ok(report.gaps.some((gap) => gap.type === "changed_without_test_change" && gap.target_path === "src/a.js" && gap.priority === "P0"));
  } finally {
	await rm(repo, { recursive: true, force: true });
	await rm(outDir, { recursive: true, force: true });
  }
});

test("source and test changed together produce no changed_without_test_change gap", async () => {
  const repo = await makeGitRepo();
  const outDir = await tempDir("dsh-contract-both-out-");
  try {
	await writeFile(path.join(repo, "src", "a.js"), "export function a(value) {\n  if (!value) throw new Error(\"missing\");\n  return value + 1;\n}\n");
	await writeFile(path.join(repo, "src", "a.test.js"), "import { a } from \"./a.js\";\nimport test from \"node:test\";\ntest(\"a updated\", () => {});\n");
	const capture = io();
	const code = await main([repo, "--mode", "change", "--working-tree", "--output", outDir, "--format", "json"], capture.io);
	assert.equal(code, 0);
	const report = await readJsonReport(outDir);
	assert.ok(!report.gaps.some((gap) => gap.type === "changed_without_test_change"));
  } finally {
	await rm(repo, { recursive: true, force: true });
	await rm(outDir, { recursive: true, force: true });
  }
});

test("diff file mode skips git queries and still enjoys propagation", async () => {
  const dir = await tempDir("dsh-contract-diff-");
  const outDir = await tempDir("dsh-contract-diff-out-");
  try {
	await mkdir(path.join(dir, "src"), { recursive: true });
	await writeFile(path.join(dir, "src", "a.js"), "existing line\nbase\n");
	const patch = await writePatch(dir, diffFor("src/a.js", "changed line"));
	const capture = io();
	const code = await main([dir, "--mode", "change", "--diff", patch, "--output", outDir, "--format", "json"], capture.io);
	assert.equal(code, 0);
	const report = await readJsonReport(outDir);
	assert.equal(report.input.git_channel, "diffText");
	assert.ok(report.scope.changed_files.includes("src/a.js"));
  } finally {
	await rm(dir, { recursive: true, force: true });
	await rm(outDir, { recursive: true, force: true });
  }
});

test("library diffPath channel resolves to diffText facts", async () => {
  const { analyze } = await import("../src/index.mjs");
  const dir = await tempDir("dsh-contract-libdiff-");
  try {
	await mkdir(path.join(dir, "src"), { recursive: true });
	await writeFile(path.join(dir, "src", "a.js"), "existing line\nbase\n");
	const patch = await writePatch(dir, diffFor("src/a.js", "changed line"));
	const result = await analyze({ repoPath: dir, mode: "change", diffPath: patch, scanner: { cache: false } });
	assert.ok(result.analysis.changeFacts.changed_files.some((file) => file.new_path === "src/a.js"));
  } finally {
	await rm(dir, { recursive: true, force: true });
  }
});

test("multi-level propagation and entry-chain targets appear end to end", async () => {
  const outDir = await tempDir("dsh-contract-prop-out-");
  try {
	const patch = await writePatch(entryRepo, diffFor("src/guard.js", "hardened"));
	const capture = io();
	const code = await main([entryRepo, "--mode", "change", "--diff", patch, "--output", outDir, "--format", "both"], capture.io);
	assert.equal(code, 0);
	const report = await readJsonReport(outDir);
	const impacted = new Map(report.scope.impacted_files.map((file) => [file.path, file.depth]));
	assert.equal(impacted.get("src/gateway.js"), 1);
	assert.equal(impacted.get("bin/cli.js"), 2);
	const cliTarget = report.targets.find((target) => target.path === "bin/cli.js");
	assert.ok(cliTarget, "entry-chain file must become a target");
	assert.equal(cliTarget.entry_point, "cli");
	// §7: candidate commands from run_methods are shown for authorized-free runs.
	assert.ok(report.suggested_commands.some((item) => item.source === "scanner:run_methods:test" && String(item.command).includes("node --test")));
	const markdown = await readFile(path.join(outDir, "TEST-PLAN.md"), "utf8");
	assert.match(markdown, /node --test/);
	assert.match(markdown, /scanner:run_methods/);
  } finally {
	await rm(outDir, { recursive: true, force: true });
  }
});

test("coverage file feeds A-level evidence through the CLI", async () => {
  const outDir = await tempDir("dsh-contract-cova-out-");
  try {
	const capture = io();
	const code = await main([adapterRepo, "--mode", "all", "--coverage", coverageFixture, "--output", outDir, "--format", "json"], capture.io);
	assert.equal(code, 0);
	const report = await readJsonReport(outDir);
	assert.equal(report.coverage.format, "lcov");
	assert.ok(report.evidence.some((item) => item.level === "A" && item.target_file === "src/auth.js"));
  } finally {
	await rm(outDir, { recursive: true, force: true });
  }
});

test("a repository with no tests reports no_test_found gaps", async () => {
  const dir = await tempDir("dsh-contract-notests-");
  const outDir = await tempDir("dsh-contract-notests-out-");
  try {
	await mkdir(path.join(dir, "src"), { recursive: true });
	await writeFile(path.join(dir, "src", "one.js"), "export const one = 1;\n");
	await writeFile(path.join(dir, "src", "two.js"), "export const two = 2;\n");
	const capture = io();
	const code = await main([dir, "--mode", "all", "--output", outDir, "--format", "json"], capture.io);
	assert.equal(code, 0);
	const report = await readJsonReport(outDir);
	assert.equal(report.scope.source_file_count, 2);
	assert.equal(report.scope.test_file_count, 0);
	assert.ok(report.gaps.filter((gap) => gap.type === "no_test_found").length >= 2);
  } finally {
	await rm(dir, { recursive: true, force: true });
	await rm(outDir, { recursive: true, force: true });
  }
});

test("adjacent same-directory test without explicit reference stays weak evidence", async () => {
  const dir = await tempDir("dsh-contract-adjacent-");
  const outDir = await tempDir("dsh-contract-adjacent-out-");
  try {
	await mkdir(path.join(dir, "src"), { recursive: true });
	await writeFile(path.join(dir, "src", "util.js"), "export function util(x) { return x; }\n");
	// Deliberately does NOT import util.js — no import/symbol reference.
	await writeFile(path.join(dir, "src", "util.test.js"), "import test from \"node:test\";\ntest(\"smoke\", () => {});\n");
	const capture = io();
	const code = await main([dir, "--mode", "all", "--output", outDir, "--format", "json"], capture.io);
	assert.equal(code, 0);
	const report = await readJsonReport(outDir);
	assert.ok(!report.evidence.some((item) => item.level === "B" && item.target_file === "src/util.js"));
	assert.ok(report.gaps.some((gap) => gap.type === "weak_test_association" && gap.target_path === "src/util.js"));
  } finally {
	await rm(dir, { recursive: true, force: true });
	await rm(outDir, { recursive: true, force: true });
  }
});
