import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  REPORT_SCHEMA_VERSION,
  analyze,
  renderMarkdown,
  validateReportShape,
} from "../src/index.mjs";

const repoAbs = path.resolve("test/fixtures/adapter-repo");
const repoLabel = "test/fixtures/adapter-repo";

// Snapshot stability: volatile fields (absolute repo path, wall-clock timings)
// are normalized identically for the committed example and the live run.
function normalize(report) {
  const clone = JSON.parse(JSON.stringify(report));
  clone.input.repo_path = repoLabel;
  clone.scope.repo_path = repoLabel;
  clone.input.output_path = "TEST-PLAN.md";
  clone.timing = {
	elapsed_ms: 0,
	scanner: null,
	performance: {
	  elapsed_ms: 0,
	  budget_ms: clone.timing.performance.budget_ms,
	  budget_exceeded: false,
	  scanner: null,
	  calls: {},
	  cache: null,
	},
	facts: clone.timing.facts,
  };
  return clone;
}

test("the committed example is a complete, valid report", async () => {
  const example = JSON.parse(await readFile(new URL("../examples/test-insight.example.json", import.meta.url), "utf8"));
  assert.equal(example.schema_version, REPORT_SCHEMA_VERSION);
  assert.doesNotThrow(() => validateReportShape(example));
  assert.ok(example.targets.length > 0);
  assert.ok(example.evidence.some((item) => item.level === "B"));
  assert.ok(Array.isArray(example.test_frameworks) && example.test_frameworks.length > 0);
  assert.ok(Array.isArray(example.suggested_commands) && example.suggested_commands.length > 0);
});

test("live output reproduces the committed example (stable ordering snapshot)", async () => {
  const example = JSON.parse(await readFile(new URL("../examples/test-insight.example.json", import.meta.url), "utf8"));
  const result = await analyze({
	repoPath: repoAbs,
	mode: "all",
	scanner: { cache: false, maxDepth: 5, maxFiles: 100, maxFileBytes: 10000, perfBudgetMs: 60000 },
  });
  const live = normalize(result.report);
  // Stable ordering guarantees from plan §2.1: targets by priority/confidence/path,
  // evidence and gaps by their own sort keys, matrix rows by target.
  assert.deepEqual(live.targets.map((target) => [target.path, target.priority]), example.targets.map((target) => [target.path, target.priority]));
  assert.deepEqual(live.gaps, example.gaps);
  assert.deepEqual(live.evidence, example.evidence);
  assert.deepEqual(live.test_matrix, example.test_matrix);
  assert.deepEqual(live.test_frameworks, example.test_frameworks);
  assert.deepEqual(live.suggested_commands, example.suggested_commands);
  assert.deepEqual(live.tool, example.tool);
  assert.deepEqual(live.scope, example.scope);
  validateReportShape(live);
});

test("the example markdown renders from the same normalized JSON", async () => {
  const example = JSON.parse(await readFile(new URL("../examples/test-insight.example.json", import.meta.url), "utf8"));
  const markdown = renderMarkdown(example);
  for (const heading of ["## 1. 结论摘要", "## 2. 分析范围与限制", "## 3. 测试目标与风险", "## 4. 测试证据", "## 5. 测试缺口清单", "## 6. 测试设计", "## 7. 测试执行建议", "## 8. 测试草稿", "## 9. 文档与维护建议"]) {
	assert.ok(markdown.includes(heading), `missing heading: ${heading}`);
  }
  // Markdown/JSON 一致性：同一份 JSON 生成，事实标记可映射回 JSON 状态字段。
  assert.ok(markdown.includes("[事实]"));
  assert.ok(markdown.includes("[建议]"));
  assert.ok(markdown.includes(example.targets[0].path));
});
