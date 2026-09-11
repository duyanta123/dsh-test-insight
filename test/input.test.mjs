import assert from "node:assert/strict";
import { test } from "node:test";
import { ERROR_CODES, InsightError, normalizeInput, redactString, redactValue } from "../src/index.mjs";

test("normalizes all mode and scanner limits", () => {
  const input = normalizeInput({
	repoPath: ".",
	mode: "all",
	maxTargets: 12,
	scanner: { max_depth: 4, max_files: 100, perf_budget_ms: 5000 },
  });

test("preserves the shared scanner cache directory for all facts calls", () => {
  const input = normalizeInput({
	repoPath: ".",
	mode: "all",
	scanner: { cache: true, cacheDir: ".cache/test-insight" },
  });
  assert.equal(input.scanner.cache, true);
  assert.equal(input.scanner.cacheDir, ".cache/test-insight");
});
  assert.equal(input.mode, "all");
  assert.equal(input.maxTargets, 12);
  assert.equal(input.scanner.maxDepth, 4);
  assert.equal(input.scanner.maxFiles, 100);
  assert.equal(input.scanner.perfBudgetMs, 5000);
  assert.equal(input.git, null);
});

test("preserves empty status text and chooses changedFiles first", () => {
  const input = normalizeInput({
	repoPath: ".",
	mode: "change",
	git: { changedFiles: [], statusText: "", diffText: "" },
  });
  assert.deepEqual(input.git, { channel: "changedFiles", changedFiles: [] });
});

test("normalizes target mode and rejects an empty target list", () => {
  const input = normalizeInput({ repoPath: ".", mode: "target", targets: ["src/auth.ts"] });
  assert.deepEqual(input.targets, [{ path: "src/auth.ts" }]);
  assert.throws(() => normalizeInput({ repoPath: ".", mode: "target" }), (error) => {
	assert.ok(error instanceof InsightError);
	assert.equal(error.code, ERROR_CODES.INVALID_TARGET);
	return true;
  });
});

test("rejects mutually exclusive CLI change inputs", () => {
  assert.throws(() => normalizeInput({ repoPath: ".", mode: "change", workingTree: true, base: "main" }), (error) => {
	assert.equal(error.code, ERROR_CODES.INVALID_GIT_INPUT);
	return true;
  });
});

test("redacts secrets in strings and objects", () => {
  assert.equal(redactString("Authorization: Bearer abc.def.ghi"), "Authorization: Bearer [REDACTED]");
  assert.equal(redactValue({ token: "secret-value", nested: "password=hidden" }).token, "[REDACTED]");
  assert.equal(redactValue({ nested: "password=hidden" }).nested, "password=[REDACTED]");
});
