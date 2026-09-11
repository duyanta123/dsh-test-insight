import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { analyze } from "../src/index.mjs";

const repoPath = path.resolve("test/fixtures/adapter-repo");

test("reports cold and hot scanner cache metrics for a shared cache directory", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "dsh-test-insight-cache-"));
  try {
	const input = {
	  repoPath,
	  mode: "all",
	  scanner: { cache: true, cacheDir, perfBudgetMs: 60_000 },
	};
	const cold = await analyze(input);
	const hot = await analyze(input);
	assert.equal(cold.report.timing.performance.budget_exceeded, false);
	assert.ok(cold.report.timing.performance.cache);
	assert.ok(cold.report.timing.performance.cache.misses > 0);
	assert.ok(hot.report.timing.performance.cache);
	assert.ok(hot.report.timing.performance.cache.hits > 0);
	assert.equal(hot.report.timing.performance.cache.misses, 0);
	assert.ok(hot.report.timing.performance.calls.scan.elapsed_ms >= 0);
  } finally {
	await rm(cacheDir, { recursive: true, force: true });
  }
});

test("downgrades conclusions when the end-to-end performance budget is exceeded", async () => {
  let tick = 0;
  const result = await analyze({
	repoPath,
	mode: "all",
	scanner: { cache: false, perfBudgetMs: 1 },
  }, { clock: () => { tick += 10; return tick; } });
  assert.equal(result.report.timing.performance.budget_exceeded, true);
  assert.ok(result.report.warnings.some((warning) => warning.includes("perf_budget_ms=1")));
  assert.ok(result.report.targets.every((target) => target.confidence !== "high"));
  assert.ok(result.report.evidence.every((evidence) => evidence.confidence !== "high"));
});
