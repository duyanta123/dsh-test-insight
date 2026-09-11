import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildReport,
  renderMarkdown,
  resolveOutputPaths,
  validateReportShape,
  writeReportFiles,
} from "../src/index.mjs";

function fixture() {
  const input = {
	mode: "all",
	repoPath: path.resolve("fixture-repo"),
	targets: [],
	format: "both",
	generateDrafts: false,
	maxTargets: 50,
	maxPropagation: 3,
	includeDirs: [],
	excludeDirs: [],
	coveragePath: null,
	coverage: { path: null, threshold: 0, format: null },
	draftOutputPath: null,
	execution: { authorized: false, timeoutMs: 120000, maxOutputBytes: 1048576, command: null },
	git: null,
	scanner: {
	  maxDepth: 3,
	  maxFiles: 100,
	  maxFileBytes: 10000,
	  perfBudgetMs: 60000,
	  cache: false,
	  parsers: ["heuristic"],
	},
  };
  const report = {
	tool: { name: "dsh-repo-scanner", version: "0.1.1" },
	files: [
	  { path: "src/a.js", kind: "source" },
	  { path: "src/a.test.js", kind: "test" },
	],
	limits: { truncated: false, warnings: [] },
	git: null,
	performance: null,
  };
  const analysis = {
	targets: [{ path: "src/a.js", priority: "P1", confidence: "medium", risk_factors: ["no direct test evidence"] }],
	evidence: [{ level: "B", source: "test_mapping:src/a.test.js->src/a.js", type: "dependency", target_file: "src/a.js", test_file: "src/a.test.js", confidence: "high" }],
	gaps: [{ type: "weak_test_association", target_path: "src/a.js", priority: "P1", confidence: "low", reason: "static association" }],
	warnings: ["secret=should-not-appear"],
	changeFacts: null,
  };
  return { input, report, analysis };
}

test("builds one validated report for JSON and Markdown", () => {
  const value = fixture();
  const report = buildReport({ ...value, testFacts: null, changeFacts: null, mapping: null, startedAt: 10, finishedAt: 20 });
  validateReportShape(report);
  assert.equal(report.schema_version, "1.0");
  assert.equal(report.timing.elapsed_ms, 10);
	assert.equal(report.timing.performance.budget_exceeded, false);
	assert.equal(report.coverage, null);
	assert.deepEqual(report.test_matrix, []);
	assert.deepEqual(report.drafts, []);
	assert.equal(report.execution, null);
  assert.ok(renderMarkdown(report).includes("## 5. 测试缺口清单"));
  assert.ok(!JSON.stringify(report).includes("should-not-appear"));
});

test("report keeps draft source out of the JSON contract", () => {
  const value = fixture();
  const report = buildReport({
	...value,
	analysis: {
	  ...value.analysis,
	  drafts: [{
		target: "src/a.js",
		path: "drafts/a.test.js",
		language: "javascript",
		status: "draft_only",
		review_required: true,
		syntax: { status: "heuristic_pass" },
		content: "secret draft source",
	  }],
	},
  });
  assert.equal(report.drafts.length, 1);
  assert.equal(report.drafts[0].content, undefined);
  assert.equal(JSON.stringify(report).includes("secret draft source"), false);
});

test("writes JSON and Markdown atomically and refuses overwrite by default", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dsh-test-insight-report-"));
  try {
	const value = fixture();
	const report = buildReport({ ...value, testFacts: null, changeFacts: null, mapping: null });
	const input = { ...value.input, outputPath: directory, format: "both", force: false };
	const paths = resolveOutputPaths(input);
	const written = await writeReportFiles(report, input);
	assert.deepEqual(written, [paths.json, paths.markdown]);
	assert.ok(JSON.parse(await readFile(paths.json, "utf8")));
	await assert.rejects(() => writeReportFiles(report, input), /output exists/);
	await writeReportFiles(report, { ...input, force: true });
  } finally {
	await rm(directory, { recursive: true, force: true });
  }
});
