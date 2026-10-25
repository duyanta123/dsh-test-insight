import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

// Plan §11 / §14 Step 5: performance acceptance must cover a 2000-file
// repository with cold-scan and cache-hit durations recorded separately.
test("records separate cold and cache-hit timings for a 2000-file repository", async (t) => {
  const largeRepo = await mkdtemp(path.join(os.tmpdir(), "dsh-perf-2000-"));
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "dsh-perf-2000-cache-"));
  try {
	const srcDir = path.join(largeRepo, "src");
	const testDir = path.join(largeRepo, "test");
	await mkdir(srcDir, { recursive: true });
	await mkdir(testDir, { recursive: true });
	// 1900 sources + 100 tests = 2000 files.
	for (let index = 0; index < 1900; index += 1) {
	  await writeFile(path.join(srcDir, `mod${index}.js`), `export function f${index}(x) {\n  if (x == null) throw new Error("missing");\n  return x + ${index};\n}\n`);
	}
	for (let index = 0; index < 100; index += 1) {
	  await writeFile(path.join(testDir, `mod${index}.test.js`), `import { f${index} } from "../src/mod${index}.js";\nimport test from "node:test";\ntest("f${index}", () => {});\n`);
	}
	const input = {
	  repoPath: largeRepo,
	  mode: "all",
	  scanner: { cache: true, cacheDir, maxFiles: 2200, maxDepth: 6, perfBudgetMs: 300_000 },
	};
	const cold = await analyze(input);
	const hot = await analyze(input);
	const coldMs = cold.report.timing.elapsed_ms;
	const hotMs = hot.report.timing.elapsed_ms;
	// 分别记录耗时（plan §11 性能回归）。
	t.diagnostic(`2000-file cold=${coldMs}ms hot=${hotMs}ms`);
	assert.equal(typeof coldMs, "number");
	assert.equal(typeof hotMs, "number");
	assert.equal(cold.report.timing.performance.budget_exceeded, false);
	assert.equal(hot.report.timing.performance.budget_exceeded, false);
	assert.ok(cold.report.timing.performance.cache.misses > 0);
	assert.ok(hot.report.timing.performance.cache.hits > 0);
	assert.equal(hot.report.timing.performance.cache.misses, 0);
	assert.ok(hotMs <= coldMs + 5000, `cache-hit run should not be slower than cold: cold=${coldMs} hot=${hotMs}`);
  } finally {
	await rm(largeRepo, { recursive: true, force: true });
	await rm(cacheDir, { recursive: true, force: true });
  }
});
