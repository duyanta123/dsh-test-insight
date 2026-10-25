import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertInsideRoot,
  assertNoSymbolicLink,
  buildDrafts,
  buildReport,
  writeReportFiles,
} from "../src/index.mjs";

async function canSymlink() {
  const probeDir = await mkdtemp(path.join(os.tmpdir(), "dsh-symlink-probe-"));
  try {
	await writeFile(path.join(probeDir, "target.txt"), "x");
	await symlink(path.join(probeDir, "target.txt"), path.join(probeDir, "link.txt"), "file");
	return true;
  } catch {
	return false;
  } finally {
	await rm(probeDir, { recursive: true, force: true });
  }
}

function reportInput(outputPath) {
  return {
	mode: "all",
	repoPath: path.resolve("fixture-repo"),
	targets: [],
	format: "both",
	generateDrafts: false,
	force: false,
	maxTargets: 50,
	maxPropagation: 3,
	includeDirs: [],
	excludeDirs: [],
	coveragePath: null,
	coverage: { path: null, threshold: 0, format: null },
	draftOutputPath: null,
	execution: { authorized: false, timeoutMs: 120000, maxOutputBytes: 1048576, command: null },
	git: null,
	outputPath,
	scanner: { maxDepth: 3, maxFiles: 100, maxFileBytes: 10000, perfBudgetMs: 60000, cache: false, parsers: ["heuristic"] },
  };
}

function minimalReport() {
  const value = {
	input: reportInput("unused"),
	report: { tool: { name: "dsh-repo-scanner", version: "0.1.1" }, files: [], limits: { truncated: false, warnings: [] }, git: null, performance: null },
	analysis: { targets: [], evidence: [], gaps: [], warnings: [], matrix: [] },
  };
  return buildReport({ ...value, testFacts: null, changeFacts: null, mapping: null });
}

test("output paths through a symbolic link are rejected", async (t) => {
  if (!(await canSymlink())) return t.skip("symlink creation not permitted on this platform/account");
  const dir = await mkdtemp(path.join(os.tmpdir(), "dsh-sec-symlink-"));
  try {
	await mkdir(path.join(dir, "real"));
	await symlink(path.join(dir, "real"), path.join(dir, "link"), "dir");
	await assert.rejects(
	  () => writeReportFiles(minimalReport(), reportInput(path.join(dir, "link", "test-insight.json"))),
	  (error) => error.code === "INVALID_OUTPUT" && /symbolic link/.test(error.message),
	);
	await assert.rejects(() => assertNoSymbolicLink(path.join(dir, "link", "nested", "report.md")), /symbolic link/);
	await assertNoSymbolicLink(path.join(dir, "real", "nested", "report.md"));
  } finally {
	await rm(dir, { recursive: true, force: true });
  }
});

test("derived draft paths must stay inside the draft root", () => {
  const root = path.resolve("some-draft-root");
  assertInsideRoot(root, path.join(root, "01-target.test.js"));
  assert.throws(() => assertInsideRoot(root, path.join(path.dirname(root), "escape.test.js")), (error) => error.code === "INVALID_OUTPUT");
  assert.throws(() => assertInsideRoot(root, root), (error) => error.code === "INVALID_OUTPUT");
});

test("draft file names neutralize traversal-looking targets and symbols", () => {
  const report = {
	files: [{ path: "../evil.js", kind: "source", language: "javascript" }],
	targets: [
	  { path: "../evil.js", priority: "P1", confidence: "low", risk_factors: [] },
	  { path: "src/ok.js", symbol: "..\\..\\escape", priority: "P2", confidence: "low", risk_factors: [] },
	],
  };
  const input = { repoPath: path.resolve("fixture-repo"), draftOutputPath: path.resolve("draft-root") };
  const drafts = buildDrafts(report, input);
  const root = path.resolve("draft-root");
  for (const draft of drafts) {
	assert.ok(path.resolve(draft.path).startsWith(root + path.sep), `draft escaped root: ${draft.path}`);
  }
});

test("report writer refuses an existing symlinked output even with --force", async (t) => {
  if (!(await canSymlink())) return t.skip("symlink creation not permitted on this platform/account");
  const dir = await mkdtemp(path.join(os.tmpdir(), "dsh-sec-force-"));
  try {
	await writeFile(path.join(dir, "victim.txt"), "do not touch");
	await symlink(path.join(dir, "victim.txt"), path.join(dir, "out.json"), "file");
	const input = { ...reportInput(path.join(dir, "out.json")), format: "json", force: true };
	await assert.rejects(
	  () => writeReportFiles(minimalReport(), input),
	  (error) => error.code === "INVALID_OUTPUT" && /symbolic link/.test(error.message),
	);
	assert.equal(await readFile(path.join(dir, "victim.txt"), "utf8"), "do not touch");
  } finally {
	await rm(dir, { recursive: true, force: true });
  }
});
